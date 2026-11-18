import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { deflateSync } from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { chromium, type Browser } from "playwright"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { ToastProvider } from "../../components/Toast.js"
import { citacaoDe, indiceDasCitacoes } from "../../lib/respostas.js"
import { Timeline } from "./Timeline.js"

/**
 * The face in a reply's quote stays 16 px, on every theme.
 *
 * The bug (1.3.21, "the avatars float"): the flat skin made the author's face
 * 40 px with `.message .avatar-wrap > .message-avatar` (`pele.css`). That
 * selector also matched the small face in the quote line, which sits inside
 * the same `.message`, and it outweighed the 16 px rule of the quote
 * (`screens.css`, two classes against three). The quote's face grew to 40 px
 * in its 16 px slot and spilled over the name and the line above. On Aurora
 * the size held (its rules carry the theme's weight), but `aurora.css` undid
 * the font size with the same selector: the initial was 14 px in a 16 px
 * circle, and 1.3.19 drew it at 9.
 *
 * jsdom has no layout, so this opens Chromium (Playwright) with the app's real
 * sheets and measures the boxes.
 */

const aqui = (relativo: string): string => fileURLToPath(new URL(relativo, import.meta.url))
const ler = (relativo: string): string => readFileSync(aqui(relativo), "utf8")

/** A sheet entry point (`styles.css`, `styles-aurora.css`), its imports joined in order. */
function folhasDe(entrada: string): string {
  return [...ler(`../../${entrada}`).matchAll(/@import "\.\/styles\/([A-Za-z.]+)\.css"/g)]
    .map((m) => ler(`../../styles/${m[1]}.css`))
    .join("\n")
}

/** What each theme loads: Aurora adds its own sheet after the main one (`folha-da-aurora.ts`). */
const FOLHA = {
  escuro: folhasDe("styles.css"),
  claro: folhasDe("styles.css"),
  aurora: folhasDe("styles.css") + folhasDe("styles-aurora.css"),
} as const

/** A real, decodable 512x512 PNG: a profile photo far larger than any slot it lands in. */
function png512(): string {
  const lado = 512
  const crc = (dados: Buffer): number => {
    let c = ~0
    for (const byte of dados) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const bloco = (tipo: string, dados: Buffer): Buffer => {
    const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados])
    const tamanho = Buffer.alloc(4)
    tamanho.writeUInt32BE(dados.length)
    const soma = Buffer.alloc(4)
    soma.writeUInt32BE(crc(corpo))
    return Buffer.concat([tamanho, corpo, soma])
  }
  const cabecalho = Buffer.alloc(13)
  cabecalho.writeUInt32BE(lado, 0)
  cabecalho.writeUInt32BE(lado, 4)
  cabecalho.set([8, 2, 0, 0, 0], 8)
  const linha = Buffer.alloc(1 + lado * 3)
  for (let x = 0; x < lado; x++) linha.set([200, 90, 40], 1 + x * 3)
  const imagem = deflateSync(Buffer.concat(Array.from({ length: lado }, () => linha)))
  const ficheiro = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", cabecalho),
    bloco("IDAT", imagem),
    bloco("IEND", Buffer.alloc(0)),
  ])
  return `data:image/png;base64,${ficheiro.toString("base64")}`
}

const CANAL = "!c:s"
const COM_FOTO = "@com-foto:s"
const SEM_FOTO = "@sem-foto:s"

function dita(seq: number, sender: string, body: string, extra: Partial<ChatMessage["payload"]> = {}): ChatMessage {
  return { channel: CANAL, seq, sender, payload: { t: "message", id: `id-${seq}`, sentAt: seq * 600_000, body, ...extra } }
}

/** A reply to someone with a photo, and a reply to someone with only the initial. */
const conversa = [
  dita(1, COM_FOTO, "Quem vem amanhã ao lagar?"),
  dita(2, SEM_FOTO, "Eu vou.", { replyTo: "id-1" }),
  dita(3, COM_FOTO, "Óptimo.", { replyTo: "id-2" }),
]

/** `comBotao`: the author's face is a button that opens the profile, as in the app. */
function desenho(comBotao: boolean): string {
  const indice = indiceDasCitacoes(conversa, conversa)
  const directorio = new Map<string, Profile>([
    [COM_FOTO, { displayName: "Bruno", donations: [], avatarDataUrl: png512() }],
    [SEM_FOTO, { displayName: "Ana", donations: [] }],
  ])
  return renderToStaticMarkup(
    <ToastProvider>
      <div className="main" style={{ height: "100vh" }}>
        <Timeline
          channel={CANAL}
          messages={conversa}
          pending={[]}
          onRetry={() => {}}
          onDiscard={() => {}}
          me={SEM_FOTO}
          nameFor={(quem) => (quem === COM_FOTO ? "Bruno" : "Ana")}
          directory={directorio}
          citacaoDe={(id) => citacaoDe(id, indice, false)}
          onIrParaOriginal={() => {}}
          {...(comBotao ? { onOpenAuthor: () => {} } : {})}
        />
      </div>
    </ToastProvider>,
  )
}

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

type Medida = { caixa: string; cara: string; img: string; dentro: boolean; letra: string; autor: string }

describe("a cara na citação de uma resposta", () => {
  it.each(
    (["escuro", "claro", "aurora"] as const).flatMap((tema) =>
      ([1440, 390] as const).flatMap((largura) => [true, false].map((comBotao) => [tema, largura, comBotao] as const)),
    ),
  )("no tema %s, a %ipx (cara do autor em botão: %s): a foto e a inicial cabem na caixa de 16 px, e a cara do autor mantém o tamanho", async (tema, largura, comBotao) => {
    const page = await browser.newPage({ viewport: { width: largura, height: 844 } })
    try {
      await page.setContent(
        `<!doctype html><html data-theme="${tema}"><head><style>${FOLHA[tema]}</style></head><body>${desenho(comBotao)}</body></html>`,
      )
      await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0))
      const medidas = await page.evaluate((): Medida[] =>
        [...document.querySelectorAll<HTMLElement>(".message-citacao")].map((citacao) => {
          const tamanho = (el: Element | null): string => {
            const r = el?.getBoundingClientRect()
            return r ? `${Math.round(r.width)}x${Math.round(r.height)}` : "-"
          }
          const caixa = citacao.querySelector(".message-citacao-cara")!
          const cara = caixa.querySelector(".message-avatar")!
          const img = cara.querySelector("img")
          const c = caixa.getBoundingClientRect()
          const r = (img ?? cara).getBoundingClientRect()
          const linha = citacao.closest(".message")!
          return {
            caixa: tamanho(caixa),
            cara: tamanho(cara),
            img: tamanho(img),
            dentro: r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5,
            letra: img ? "-" : getComputedStyle(cara).fontSize,
            autor: tamanho(linha.querySelector(":scope > .avatar-wrap > .message-avatar, :scope > .message-avatar-botao .message-avatar")),
          }
        }),
      )
      // Before/after pictures for a report: CAPTURAS=<folder> npx vitest run ...
      if (process.env.CAPTURAS && comBotao) {
        await page.locator(".timeline").screenshot({ path: `${process.env.CAPTURAS}/citacao-${tema}-${largura}.png` })
      }
      // Ana replies to Bruno (photo), Bruno replies to Ana (initial). Each
      // author's own face keeps the size of the theme: 40 on the flat skin,
      // 1.3.19's 32 on Aurora.
      const autor = tema === "aurora" ? "32x32" : "40x40"
      expect(medidas).toEqual([
        { caixa: "16x16", cara: "16x16", img: "16x16", dentro: true, letra: "-", autor },
        { caixa: "16x16", cara: "16x16", img: "-", dentro: true, letra: "9px", autor },
      ])
    } finally {
      await page.close()
    }
  }, 30_000)
})
