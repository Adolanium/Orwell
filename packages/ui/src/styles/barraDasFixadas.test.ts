import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { chromium, type Browser } from "playwright"

/**
 * The pinned bar never sits over the conversation (fixadas-topo, owner's review of 20/11/2026).
 *
 * The owner saw a message cut right under the bar and read it as the bar covering the
 * chat. In Chromium, with the full sheets of every theme, at 1280 and 390 px:
 *
 * - the scroller starts where the bar ends, never under it;
 * - no line of the conversation is behind any point of the bar (`elementsFromPoint`);
 * - the bar is opaque, Aurora's glass too: nothing could show through it;
 * - its lower edge is a clear line (alpha at least 0.12), so the cut line below
 *   reads as the edge of the conversation, not as something under the bar.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const ler = (nome: string): string => readFileSync(join(AQUI, nome), "utf8")
// The document holds `styles.css` and, on Aurora, `styles-aurora.css` after it (`folha-da-aurora.ts`).
const folhas = (aurora: boolean): string =>
  [...(ler("../styles.css") + (aurora ? ler("../styles-aurora.css") : "")).matchAll(/@import "\.\/styles\/([A-Za-z.]+)\.css"/g)]
    .map((m) => ler(`./${m[1]}.css`))
    .join("\n")

const linhas = Array.from(
  { length: 40 },
  (_, i) => `<div class="message" data-mensagem="m${i}"><div class="message-body"><p>Linha ${i} da conversa</p></div></div>`,
).join("")
const HTML = `
  <div class="app" style="height:100dvh">
    <main class="main with-members" style="height:100dvh">
      <header class="topbar"><h1>geral</h1></header>
      <div class="conversa">
        <section class="barra-fixadas" aria-label="fixadas">
          <button type="button" class="barra-fixadas-abrir"><span class="barra-fixadas-texto">
            <span class="barra-fixadas-rotulo">Mensagem fixada</span>
            <span class="barra-fixadas-linha"><span class="barra-fixadas-autor">Ana</span> O código do portão</span>
          </span></button>
          <button type="button" class="barra-fixadas-botao">x</button>
        </section>
        <div class="timeline">${linhas}</div>
      </div>
    </main>
  </div>`

let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
}, 60_000)
afterAll(async () => {
  await browser?.close()
})

interface Medida {
  barraFundo: number
  conversaTopo: number
  linhasPorTras: number
  alfaDoFundo: number
  alfaDaAresta: number
  larguraDaAresta: number
}

async function medir(tema: string, largura: number): Promise<Medida> {
  const ctx = await browser.newContext({ viewport: { width: largura, height: 800 } })
  try {
    const page = await ctx.newPage()
    await page.setContent(`<!doctype html><html data-theme="${tema}"><head><style>${folhas(tema === "aurora")}</style></head><body>${HTML}</body></html>`)
    return await page.evaluate(() => {
      const barra = document.querySelector(".barra-fixadas") as HTMLElement
      const conversa = document.querySelector(".conversa > .timeline") as HTMLElement
      // Halfway down the history: there is conversation above the visible part.
      conversa.scrollTop = conversa.scrollHeight / 2
      const b = barra.getBoundingClientRect()
      let porTras = 0
      for (let x = b.left + 2; x < b.right; x += 12) {
        for (let y = b.top + 1; y < b.bottom; y += 4) {
          if (document.elementsFromPoint(x, y).some((el) => el.closest(".timeline"))) porTras += 1
        }
      }
      const alfa = (cor: string): number => {
        const m = /rgba?\(([^)]+)\)/.exec(cor)
        if (!m) return cor === "transparent" ? 0 : 1
        const partes = m[1]!.split(/[ ,/]+/).filter(Boolean)
        return partes.length >= 4 ? Number(partes[3]) : 1
      }
      const estilo = getComputedStyle(barra)
      return {
        barraFundo: b.bottom,
        conversaTopo: conversa.getBoundingClientRect().top,
        linhasPorTras: porTras,
        alfaDoFundo: alfa(estilo.backgroundColor),
        alfaDaAresta: alfa(estilo.borderBottomColor),
        larguraDaAresta: parseFloat(estilo.borderBottomWidth),
      }
    })
  } finally {
    await ctx.close()
  }
}

describe("a barra das fixadas não se sobrepõe à conversa", () => {
  for (const tema of ["escuro", "claro", "aurora"]) {
    for (const largura of [1280, 390]) {
      it(`${tema}, ${largura} px: a conversa começa onde a barra acaba, e nada fica por trás`, async () => {
        const m = await medir(tema, largura)
        expect(m.conversaTopo).toBeGreaterThanOrEqual(m.barraFundo - 0.5)
        expect(m.linhasPorTras).toBe(0)
        expect(m.alfaDoFundo).toBe(1)
        expect(m.larguraDaAresta).toBeGreaterThanOrEqual(1)
        expect(m.alfaDaAresta).toBeGreaterThanOrEqual(0.12)
      }, 60_000)
    }
  }
})
