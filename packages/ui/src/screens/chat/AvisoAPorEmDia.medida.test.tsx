import { mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { chromium, type Browser } from "playwright"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import { strings } from "../../strings.js"
import { AvisoAPorEmDia } from "./AvisoAPorEmDia.js"
import { Composer } from "./Composer.js"

/**
 * The catching-up notice measured in a real Chromium (1.3.26): at 1280 px (the
 * conversation beside the member column) and 390 px (the phone, touch, with the
 * keyboard open), in the dark and the light theme, with and without reduced
 * motion. The sheet is the app's own (`styles.css` and its imports).
 *
 * What it proves: the line is under the box; the composer and the conversation
 * keep their exact boxes when the notice comes and goes; only the opacity moves,
 * in 200 ms (600 ms with reduced motion, never 0); and on the phone the line
 * stays above the keyboard.
 *
 * `CAPTURAS_DIR=/some/dir` also writes one screenshot per width and theme there.
 */

const AQUI = dirname(fileURLToPath(import.meta.url))
const ESTILOS = join(AQUI, "../..")
const ler = (nome: string): string => readFileSync(join(ESTILOS, nome), "utf8")
const folha = [...ler("styles.css").matchAll(/@import "\.\/styles\/([A-Za-z.]+)\.css"/g)]
  .map((m) => ler(`styles/${m[1]}.css`))
  .join("\n")

const bridge = { social: { linkPreview: () => Promise.reject(new Error("no")) } } as unknown as EnclaveBridge
const TECLADO = 300

const composer = renderToStaticMarkup(
  <BridgeContext.Provider value={bridge}>
    <Composer connection="online" value="" onChange={() => {}} onSend={() => {}} rodape={<AvisoAPorEmDia ativo={false} />} />
  </BridgeContext.Provider>,
)

function pagina(largura: number, tema: "escuro" | "claro"): string {
  const telemovel = largura < 600
  const main = `<main class="main"><div class="timeline"><p>Line one</p><p>Line two</p></div>${composer}</main>`
  const corpo = telemovel
    ? `<div class="app telemovel" style="height:100vh;box-sizing:border-box;--teclado:${TECLADO}px">${main}</div>`
    : `<div style="display:grid;height:100vh;grid-template-rows:minmax(0,1fr);overflow:hidden">${main}</div>`
  return `<!doctype html><html${tema === "claro" ? ' data-theme="claro"' : ""}><head><meta name="viewport" content="width=device-width"><style>${folha}</style></head><body style="margin:0;overflow:hidden">${corpo}</body></html>`
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

describe("the catching-up notice, measured", () => {
  it.each(CASOS)("$largura px, $tema, motion $movimento", async ({ largura, tema, movimento }) => {
    const telemovel = largura < 600
    const altura = telemovel ? 844 : 720
    const ctx = await browser.newContext({
      viewport: { width: largura, height: altura },
      reducedMotion: movimento,
      ...(telemovel ? { hasTouch: true, isMobile: true } : {}),
    })
    const page = await ctx.newPage()
    try {
      await page.setContent(pagina(largura, tema))
      await page.evaluate(() => document.fonts.ready)
      // Boxes against the conversation's own grid, so a scroll of the harness page cannot pass for a move.
      const caixas = (): Promise<{ composer: number[]; caixa: number[]; timeline: number[]; aviso: number[] }> =>
        page.evaluate(() => {
          const origem = document.querySelector(".main")!.getBoundingClientRect()
          const r = (seletor: string): number[] => {
            const c = document.querySelector(seletor)!.getBoundingClientRect()
            return [c.top - origem.top, c.left - origem.left, c.width, c.height]
          }
          return { composer: r("form.chat-composer"), caixa: r(".composer-line"), timeline: r(".timeline"), aviso: r(".chat-a-recuperar") }
        })
      const antes = await caixas()

      // What React does when the notice comes on: the attribute, the text, no aria-hidden.
      await page.evaluate((texto) => {
        const linha = document.querySelector(".chat-a-recuperar") as HTMLElement
        linha.setAttribute("data-visivel", "")
        linha.removeAttribute("aria-hidden")
        linha.textContent = texto
      }, strings.chat.aPorEmDia)
      await page.waitForTimeout(movimento === "reduce" ? 800 : 400)
      const durante = await caixas()
      const m = await page.evaluate(() => {
        const linha = document.querySelector(".chat-a-recuperar") as HTMLElement
        const app = document.querySelector(".app")
        return {
          fundoNoEcra: linha.getBoundingClientRect().bottom,
          opacidade: getComputedStyle(linha).opacity,
          transicao: getComputedStyle(linha).transitionDuration,
          propriedade: getComputedStyle(linha).transitionProperty,
          papel: linha.getAttribute("role"),
          cortado: linha.scrollWidth > linha.clientWidth + 1 && getComputedStyle(linha).textOverflow !== "ellipsis",
          transborda: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          fundoDoApp: app ? Number.parseFloat(getComputedStyle(app).paddingBottom) : 0,
        }
      })

      // Under the box, inside the composer, and nothing moved.
      expect(durante.aviso[0]!).toBeGreaterThanOrEqual(durante.caixa[0]! + durante.caixa[3]! - 0.5)
      expect(durante.aviso[0]! + durante.aviso[3]!).toBeLessThanOrEqual(durante.composer[0]! + durante.composer[3]! + 0.5)
      expect(durante.aviso[3]).toBe(16)
      expect(durante.composer).toEqual(antes.composer)
      expect(durante.caixa).toEqual(antes.caixa)
      expect(durante.timeline).toEqual(antes.timeline)
      expect(durante.aviso).toEqual(antes.aviso)

      expect(m.opacidade).toBe("1")
      expect(m.papel).toBe("status")
      expect(m.propriedade).toBe("opacity")
      // Never 0 s with reduced motion: slower, not stopped.
      expect(m.transicao).toBe(movimento === "reduce" ? "0.6s" : "0.2s")
      expect(m.transborda).toBe(false)
      expect(m.cortado).toBe(false)

      if (telemovel) {
        // The keyboard space is the app's bottom padding (`movel.css`), and the line stays above it.
        expect(m.fundoDoApp).toBeGreaterThanOrEqual(TECLADO)
        expect(m.fundoNoEcra).toBeLessThanOrEqual(altura - TECLADO + 0.5)
      }

      if (process.env.CAPTURAS_DIR && movimento === "no-preference") {
        mkdirSync(process.env.CAPTURAS_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.CAPTURAS_DIR, `${largura}-${tema}.png`) })
      }

      // And off again: same boxes, opacity back to 0.
      await page.evaluate(() => {
        const linha = document.querySelector(".chat-a-recuperar") as HTMLElement
        linha.removeAttribute("data-visivel")
        linha.setAttribute("aria-hidden", "true")
      })
      await page.waitForTimeout(movimento === "reduce" ? 800 : 400)
      const depois = await caixas()
      expect(depois).toEqual(antes)
      expect(await page.evaluate(() => getComputedStyle(document.querySelector(".chat-a-recuperar")!).opacity)).toBe("0")
    } finally {
      await ctx.close()
    }
  }, 60_000)
})
