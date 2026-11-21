import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { chromium, type Browser, type Page } from "playwright"
import postcss from "postcss"
import type { Participant } from "@enclave/client-core"
import type { Profile } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import { Button } from "../components/Button.js"
import { ToastProvider } from "../components/Toast.js"
import { CartaoDaConta } from "../screens/profile/CartaoDaConta.js"
import { CallDock } from "../screens/call/CallDock.js"
import { CallPanel } from "../screens/call/CallPanel.js"
import { Timeline } from "../screens/chat/Timeline.js"
import { Splash } from "../screens/gate/Splash.js"
import { Composer } from "../screens/chat/Composer.js"
import { BridgeContext } from "../App.js"
import type { EnclaveBridge } from "../bridge.js"

/**
 * The Aurora theme looks like 1.3.19, measured in Chromium.
 *
 * The reference is 1.3.19's own stylesheet: `aurora.gen.css` with the scope
 * taken off is, rule for rule, the sheets of 1.3.19 (`gerar-tema-aurora.mjs`
 * only scopes selectors and renames keyframes). Each fixture is drawn twice,
 * with that sheet alone and with today's full sheet under
 * `data-theme="aurora"`, and every element (and its `::before` and `::after`)
 * must compute the same colours, borders, shadows, type and box.
 *
 * The fixtures are the screens 1.3.19 already had: a conversation, the
 * account card in a call, the call screen with its dock, a settings card, and
 * the opening. Markup that is new since (the room glyph in the chat header,
 * the theme choice) is not in them: 1.3.19 has no look for it to keep.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const ler = (nome: string): string => readFileSync(join(AQUI, nome), "utf8")
const ESCOPO = ':root[data-theme="aurora"]'

/** Today's full sheet on Aurora: `styles.css`, then `styles-aurora.css` (`folha-da-aurora.ts`). */
function folhaDeHoje(): string {
  return [...(ler("../styles.css") + ler("../styles-aurora.css")).matchAll(/@import "\.\/styles\/([A-Za-z.]+)\.css"/g)].map((m) => ler(`./${m[1]}.css`)).join("\n")
}

/** 1.3.19's sheet: the generated Aurora with the scope taken off. */
function folhaDa1319(): string {
  // "SCOPE .x" is ".x"; "SCOPE {", "SCOPE," and "SCOPE[attr]" were rules on the root itself.
  return ler("./aurora.gen.css")
    // A selector that named the root kept its own `:root` or `html` beside the scope.
    .split(`${ESCOPO}:root`)
    .join(":root")
    .split(`html${ESCOPO}`)
    .join("html")
    .split(`${ESCOPO} `)
    .map((parte, i) => (i > 0 && /^[{,]/.test(parte) ? `:root ${parte}` : parte))
    .join("")
    .split(ESCOPO)
    .join(":root")
}

/**
 * The text box is a text area since 20/11/2026. 1.3.19 styled it as an
 * `<input>` (`.chat-composer input`): the reference gives the text area what
 * 1.3.19 gave the input, so the comparison is about the same box.
 */
function comACaixaDeTexto(folha: string): string {
  const raiz = postcss.parse(folha)
  raiz.walkRules((regra) => {
    const extra = regra.selectors
      .filter((seletor) => /\.chat-composer\b/.test(seletor) && /\binput(?=[:\s]|$)(?![^\s]*\[type)/.test(seletor))
      .map((seletor) => seletor.replace(/\binput(?=[:\s]|$)/g, "textarea"))
      .filter((seletor) => !regra.selectors.includes(seletor))
    if (extra.length > 0) regra.selectors = [...regra.selectors, ...extra]
  })
  return raiz.toString()
}

/**
 * The call card's name row (1.3.26): the voice wave left the top-right corner,
 * where it sat under the "⋯", and went into a row with the name
 * (`.call-chip-name-row`). 1.3.19 had no such row: the reference gets the row
 * as it is today, so the comparison is about the same card, and the wave's
 * own size and colour still come from 1.3.19.
 */
function comAFilaDoNome(folha: string): string {
  return `${folha}
.call-chip-name-row { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.call-chip-name { min-width: 0; }
.call-chip-onda { position: static; }
`
}

const EU = "@eu:s"
const OUTRA = "@outra:s"
const PNG = `data:image/png;base64,${Buffer.from(
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0xb0, 0, 0, 3, 0x20, 8, 6, 0, 0, 0]),
).toString("base64")}`
const mensagem = (seq: number, sender: string, payload: Partial<ChatMessage["payload"]>): ChatMessage => ({
  channel: "!c:s",
  seq,
  sender,
  payload: { t: "message", id: `m${seq}`, sentAt: seq * 600_000, ...payload },
})
const pessoas = [
  { address: "@ana:s", connected: true, stream: null, video: false, encrypted: true, micMuted: false, screen: null },
  { address: "@rui:s", connected: true, stream: null, video: false, encrypted: true, micMuted: true, screen: null },
] as unknown as Participant[]
const motor = {
  setMuted() {},
  setCameraOff() {},
  active: false,
  tectoDePartilha: 6,
  podePartilharEcra: true,
  medirLimiteDeVideo: () => Promise.resolve(null),
  startScreenShare: () => Promise.resolve(false),
  stopScreenShare: () => Promise.resolve(),
}

const FIXTURAS: Record<string, () => React.JSX.Element> = {
  conversa: () => (
    <div className="main" style={{ height: "100vh" }}>
      <Timeline
        channel="!c:s"
        messages={[
          mensagem(1, OUTRA, { body: "olá, isto é uma frase normal" }),
          mensagem(2, EU, { body: "resposta minha" }),
          mensagem(3, OUTRA, { body: "uma imagem", attachments: [{ inline: PNG, mediaType: "image/png", name: "foto.png" }] }),
        ]}
        pending={[]}
        onRetry={() => {}}
        onDiscard={() => {}}
        me={EU}
        onMessageMenu={() => {}}
        nameFor={(quem) => (quem === EU ? "Eu" : "Outra")}
        directory={new Map<string, Profile>()}
      />
    </div>
  ),
  cartao: () => (
    <aside className="sidebar open">
      <CartaoDaConta
        profile={{ displayName: "Vesna", statusText: "Em reunião", donations: [] }}
        address="@vesna:s"
        onEditProfile={() => {}}
        onSaveStatus={() => {}}
        onToggleMic={() => {}}
        onToggleSound={() => {}}
        onNotifications={() => {}}
        onAbrirDefinicoes={() => {}}
        unreadNotifications={3}
        latencia={{ ms: 12, ate: "servidor" }}
        emChamada
        chamada={{
          caixa: (
            <CallDock
              variante="lateral"
              comAudio={false}
              channel="!nexo:s"
              channelLabel="nexo"
              roomLabel="Sala"
              latencia={{ ms: 12, ate: "servidor" }}
              participants={pessoas}
              localStream={null}
              nameFor={(quem) => quem}
              onBack={() => {}}
              onLeave={() => {}}
            />
          ),
          onSair: () => {},
        }}
      />
    </aside>
  ),
  chamada: () => (
    <div className="app">
      <main className="main">
        <CallPanel
          call={motor as never}
          channel="!lagar:s"
          participants={pessoas}
          localStream={null}
          selfLabel="Eu"
          selfProfile={{ displayName: "Eu", donations: [] }}
          nameFor={(quem) => quem}
          directory={new Map()}
          onToggleMic={() => {}}
          onToggleSound={() => {}}
          onLeave={() => {}}
        />
      </main>
      <CallDock channel="!lagar:s" channelLabel="Lagar" roomLabel="pátio" participants={pessoas} localStream={null} nameFor={(q) => q} onBack={() => {}} onLeave={() => {}} />
    </div>
  ),
  definicoes: () => (
    <section className="card settings-card">
      <h2>Conta</h2>
      <Button variant="primary" onClick={() => {}}>
        Editar perfil
      </Button>
      <Button variant="ghost" onClick={() => {}}>
        Copiar o teu id
      </Button>
      <p className="field-note">Uma nota.</p>
    </section>
  ),
  abertura: () => <Splash />,
  // The shell: rail, column, the conversation's top bar and the writing box.
  casca: () => (
    <BridgeContext.Provider value={{ social: {}, channels: {}, profile: {} } as unknown as EnclaveBridge}>
      <div className="app">
        <nav className="rail">
          <button className="rail-btn active" aria-label="Comunidades" />
          <button className="rail-btn" aria-label="Amigos" />
        </nav>
        <aside className="sidebar open">
          <div className="sidebar-header">Comunidades</div>
          <div className="sidebar-body" />
        </aside>
        <main className="main">
          <header className="topbar">
            <h1>lagar</h1>
          </header>
          <Composer connection="online" value="olá" onChange={() => {}} onSend={() => {}} />
        </main>
      </div>
    </BridgeContext.Provider>
  ),
}

const PROPRIEDADES = [
  "color",
  "background-color",
  "background-image",
  "border-top-color",
  "border-top-width",
  "border-left-color",
  "border-left-width",
  "border-radius",
  "box-shadow",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "line-height",
  "padding-top",
  "padding-left",
  "margin-top",
  "margin-left",
  "width",
  "height",
  "display",
  "opacity",
  "filter",
  "animation-name",
  "animation-duration",
]

async function medir(page: Page, folha: string, html: string, tema: string | null): Promise<Record<string, string>> {
  await page.setContent(
    `<!doctype html><html${tema ? ` data-theme="${tema}"` : ""}><head><style>${folha}</style></head><body>${html}</body></html>`,
  )
  return page.evaluate((propriedades) => {
    const fora: Record<string, string> = {}
    const todos = [document.documentElement, document.body, ...document.body.querySelectorAll("*")]
    todos.forEach((el, i) => {
      for (const pseudo of [null, "::before", "::after"]) {
        const s = getComputedStyle(el, pseudo)
        if (pseudo && (s.content === "none" || s.content === "normal")) continue
        const nome = `${i}:${el.tagName.toLowerCase()}.${[...el.classList].join(".")}${pseudo ?? ""}`
        for (const p of propriedades) {
          // Keyframes are renamed in the Aurora sheet; the motion is the same.
          fora[`${nome} ${p}`] = s.getPropertyValue(p).replace(/-aurora\b/g, "")
        }
      }
    })
    return fora
  }, PROPRIEDADES)
}

let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
}, 60_000)
afterAll(async () => {
  await browser?.close()
})

describe("o tema Aurora é a 1.3.19", () => {
  const referencia = comAFilaDoNome(comACaixaDeTexto(folhaDa1319()))
  const hoje = folhaDeHoje()

  it.each(Object.keys(FIXTURAS))("%s: as mesmas cores, contornos, sombras, letra e caixas", async (nome) => {
    const html = renderToStaticMarkup(<ToastProvider>{FIXTURAS[nome]!()}</ToastProvider>)
    const diferencas: string[] = []
    for (const [largura, movimento] of [
      [1440, "no-preference"],
      [390, "reduce"],
    ] as const) {
      const ctx = await browser.newContext({ viewport: { width: largura, height: 900 }, reducedMotion: movimento })
      const page = await ctx.newPage()
      try {
        const antes = await medir(page, referencia, html, null)
        const agora = await medir(page, hoje, html, "aurora")
        for (const [chave, valor] of Object.entries(antes)) {
          if (agora[chave] !== valor) diferencas.push(`${largura}/${movimento} ${chave}: 1.3.19 ${valor} | aurora ${agora[chave]}`)
        }
      } finally {
        await ctx.close()
      }
    }
    // To read the differences whole: AURORA_SAIDA=/some/dir npx vitest run aurora
    if (process.env.AURORA_SAIDA) writeFileSync(join(process.env.AURORA_SAIDA, `${nome}.txt`), diferencas.join("\n"))
    expect(diferencas).toEqual([])
  }, 60_000)

  it("o escuro e o claro não mudam com o Aurora presente: as regras dele só valem debaixo do atributo", () => {
    let regras = 0
    for (const folha of ["./aurora.gen.css", "./aurora.css"]) {
      postcss.parse(ler(folha)).walkRules((regra) => {
        if (regra.parent?.type === "atrule" && /keyframes$/.test((regra.parent as postcss.AtRule).name)) return
        regras += 1
        for (const um of regra.selectors) expect(um.startsWith(ESCOPO) || um.startsWith(`html${ESCOPO}`), `${folha}: ${um}`).toBe(true)
      })
    }
    expect(regras).toBeGreaterThan(1000)
  })
})
