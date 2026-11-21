import { mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { chromium, type Browser } from "playwright"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Profile } from "../../bridge.js"
import { MemberPanel } from "./MemberPanel.js"

/**
 * The syncing members column measured in a real Chromium (21/11/2026): at
 * 1280 px (the column beside the conversation) and 390 px (the members screen
 * on the phone), in the dark and the light theme, with and without reduced
 * motion. The sheet is the app's own (`styles.css` and its imports).
 *
 * `CAPTURAS_DIR=/some/dir` also writes one screenshot per width and theme there.
 */

const AQUI = dirname(fileURLToPath(import.meta.url))
const ESTILOS = join(AQUI, "../..")
const ler = (nome: string): string => readFileSync(join(ESTILOS, nome), "utf8")
const folha = [...ler("styles.css").matchAll(/@import "\.\/styles\/([A-Za-z.]+)\.css"/g)]
  .map((m) => ler(`styles/${m[1]}.css`))
  .join("\n")

const PESSOAS = ["@marta:s", "@rui:s", "@ines:s", "@tomas:s", "@carla:s", "@joao:s"]
const NOMES: Record<string, string> = {
  "@marta:s": "Marta",
  "@rui:s": "Rui",
  "@ines:s": "Inês",
  "@tomas:s": "Tomás",
  "@carla:s": "Carla",
  "@joao:s": "João",
}

function coluna(syncing: boolean, daysAway: number | null, telemovel: boolean): string {
  return renderToStaticMarkup(
    <MemberPanel
      channel="!geral:s"
      open
      onClose={() => {}}
      onVoltar={telemovel ? () => {} : undefined}
      members={PESSOAS}
      state="ready"
      onRetry={() => {}}
      me={null}
      directory={new Map<string, Profile>()}
      nameFor={(m) => NOMES[m] ?? m}
      onInvite={() => {}}
      onUserMenu={() => {}}
      onOpenProfile={() => {}}
      presenceFor={(m) => (PESSOAS.indexOf(m) < 3 ? "active" : "idle")}
      syncing={syncing}
      daysAway={daysAway}
    />,
  )
}

/** The column as the app lays it out: beside a conversation, or the phone's pushed screen. */
function pagina(largura: number, tema: "escuro" | "claro", corpo: string): string {
  const telemovel = largura < 600
  const envolta = telemovel
    ? `<div class="app telemovel" style="height:100vh">${corpo}</div>`
    : `<div style="display:grid;height:100vh;grid-template-columns:minmax(0,1fr) 260px;grid-template-areas:'main members'"><main style="grid-area:main"></main>${corpo}</div>`
  return `<!doctype html><html${tema === "claro" ? ' data-theme="claro"' : ""}><head><meta name="viewport" content="width=device-width"><style>${folha}</style></head><body style="margin:0">${envolta}</body></html>`
}

let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
}, 60_000)
afterAll(async () => {
  await browser?.close()
})

const CASOS = [1280, 390].flatMap((largura) =>
  (["escuro", "claro"] as const).flatMap((tema) => (["no-preference", "reduce"] as const).map((movimento) => ({ largura, tema, movimento }))),
)

describe("the syncing members column, measured", () => {
  it.each(CASOS)("$largura px, $tema, motion $movimento", async ({ largura, tema, movimento }) => {
    const ctx = await browser.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 720 }, reducedMotion: movimento })
    const page = await ctx.newPage()
    try {
      await page.setContent(pagina(largura, tema, coluna(true, 6, largura < 600)))
      const m = await page.evaluate(() => {
        const rgb = (cor: string): [number, number, number, number] => {
          const n = cor.match(/[\d.]+/g)!.map(Number)
          return [n[0]!, n[1]!, n[2]!, n[3] ?? 1]
        }
        const lum = ([r, g, b]: number[]): number => {
          const l = (c: number): number => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
          return 0.2126 * l(r!) + 0.7152 * l(g!) + 0.0722 * l(b!)
        }
        const contraste = (a: number[], b: number[]): number => {
          const [x, y] = [lum(a), lum(b)]
          return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
        }
        const painel = document.querySelector("aside.members") as HTMLElement
        const fundo = rgb(getComputedStyle(painel).backgroundColor)
        const titulo = document.querySelector(".members-syncing-title") as HTMLElement
        const sub = document.querySelector(".members-syncing-away") as HTMLElement
        const barra = document.querySelector(".members-syncing-bar") as HTMLElement
        const trilho = document.querySelector(".members-syncing-track") as HTMLElement
        const lista = document.querySelector(".member-list") as HTMLElement
        const estado = document.querySelector(".members-syncing") as HTMLElement
        const animacoes = barra.getAnimations().map((a) => {
          const t = (a.effect as KeyframeEffect).getComputedTiming()
          return { duracao: Number(t.duration), iteracoes: t.iterations, estado: a.playState }
        })
        const caixa = painel.getBoundingClientRect()
        return {
          ocupado: painel.getAttribute("aria-busy"),
          estado: estado.getAttribute("role"),
          fundoOpaco: fundo[3],
          contrasteTitulo: contraste(rgb(getComputedStyle(titulo).color), fundo),
          contrasteSub: contraste(rgb(getComputedStyle(sub).color), fundo),
          tamanhoTitulo: getComputedStyle(titulo).fontSize,
          pesoTitulo: getComputedStyle(titulo).fontWeight,
          tamanhoSub: getComputedStyle(sub).fontSize,
          alturaDaBarra: trilho.getBoundingClientRect().height,
          corDaBarra: getComputedStyle(barra).backgroundColor,
          acento: getComputedStyle(document.documentElement).getPropertyValue("--acento").trim(),
          animacoes,
          opacidade: getComputedStyle(lista).opacity,
          ponteiro: getComputedStyle(lista).pointerEvents,
          inerte: lista.hasAttribute("inert"),
          transicao: getComputedStyle(lista).transitionDuration,
          transicaoDoBloco: getComputedStyle(estado).transitionDuration,
          largura: caixa.width,
          transborda: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          estadoNoTopo: estado.getBoundingClientRect().top - document.querySelector(".members-header")!.getBoundingClientRect().bottom,
        }
      })

      expect(m.ocupado).toBe("true")
      expect(m.estado).toBe("status")
      expect(m.fundoOpaco).toBe(1)
      expect(m.contrasteTitulo).toBeGreaterThanOrEqual(4.5)
      expect(m.contrasteSub).toBeGreaterThanOrEqual(4.5)
      expect(m.tamanhoTitulo).toBe("14px")
      expect(m.pesoTitulo).toBe("600")
      expect(m.tamanhoSub).toBe("12px")
      expect(m.alturaDaBarra).toBe(2)
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(m.acento.slice(i, i + 2), 16))
      expect(m.corDaBarra).toBe(`rgb(${r}, ${g}, ${b})`)
      // Runs forever, 3 times slower with reduced motion, and never stops.
      expect(m.animacoes).toEqual([{ duracao: movimento === "reduce" ? 4800 : 1600, iteracoes: Infinity, estado: "running" }])
      expect(m.opacidade).toBe("0.45")
      expect(m.ponteiro).toBe("none")
      expect(m.inerte).toBe(true)
      // The way back is 360 ms in both motion modes.
      expect(m.transicao).toBe("0.36s")
      expect(m.transicaoDoBloco).toBe("0.36s")
      expect(m.transborda).toBe(false)
      expect(m.largura).toBe(largura < 600 ? 390 : 260)
      // Right under the header (the count, and the back arrow on the phone): nothing between.
      expect(Math.abs(m.estadoNoTopo)).toBeLessThan(1)

      // One capture per width and theme: a paused frame looks the same in both motion modes.
      if (process.env.CAPTURAS_DIR && movimento === "no-preference") {
        mkdirSync(process.env.CAPTURAS_DIR, { recursive: true })
        const nome = `${largura}-${tema}`
        // The bar mid-run, the same frame in every capture.
        await page.evaluate(() => {
          for (const a of document.querySelector(".members-syncing-bar")!.getAnimations()) {
            a.pause()
            a.currentTime = (Number((a.effect as KeyframeEffect).getComputedTiming().duration) * 0.45)
          }
        })
        await page.screenshot({ path: join(process.env.CAPTURAS_DIR, `${nome}.png`) })
      }

      // And back to normal: no block, no busy, the rows whole.
      await page.setContent(pagina(largura, tema, coluna(false, null, largura < 600)))
      const depois = await page.evaluate(() => ({
        ocupado: document.querySelector("aside.members")!.getAttribute("aria-busy"),
        bloco: document.querySelector(".members-syncing") !== null,
        opacidade: getComputedStyle(document.querySelector(".member-list")!).opacity,
        ponteiro: getComputedStyle(document.querySelector(".member-list")!).pointerEvents,
      }))
      expect(depois).toEqual({ ocupado: null, bloco: false, opacidade: "1", ponteiro: "auto" })
    } finally {
      await ctx.close()
    }
  }, 60_000)
})
