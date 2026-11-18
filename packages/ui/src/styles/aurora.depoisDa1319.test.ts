import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { chromium, type Browser } from "playwright"

/**
 * What came after 1.3.19 works in Aurora too (1.3.20).
 *
 * `aurora.test` proves Aurora draws the screens 1.3.19 had as 1.3.19 drew them.
 * This file is the other side: markup and motion that are new since, where a
 * 1.3.19 rule brought back under the Aurora scope weighs more than the new rule
 * and breaks it. Each case is measured in Chromium with today's full sheet,
 * Aurora against Dark.
 *
 * - The virtual emoji list: 1.3.19's `.emoji-grid` was the eight-column grid;
 *   now it is a scroller and the columns are in each row. Without the undo in
 *   `aurora.css` the list sat in the first column, 39 px wide.
 * - Reactions with reduced motion: 1.3.19's universal rule in `base.css`, scoped,
 *   zeroed the calm versions. Nothing stops, it moves slower.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const ler = (nome: string): string => readFileSync(join(AQUI, nome), "utf8")
// On Aurora the document holds `styles.css` and then `styles-aurora.css` (`folha-da-aurora.ts`).
const folha = [...(ler("../styles.css") + ler("../styles-aurora.css")).matchAll(/@import "\.\/styles\/([A-Za-z.]+)\.css"/g)].map((m) => ler(`./${m[1]}.css`)).join("\n")

const linha = (topo: number): string =>
  `<div class="emoji-linha" style="top:${topo}px">${'<button class="emoji-cell">😀</button>'.repeat(8)}</div>`
const HTML = `
  <div class="emoji-panel" style="width:360px;height:420px;display:flex;flex-direction:column">
    <div class="emoji-grid"><div class="emoji-lista" style="height:4000px">${linha(28)}${linha(68)}</div></div>
  </div>
  <div class="reaccoes"><button class="reaccao nova">👍 <span class="reaccao-n mudou">2</span></button></div>
  <div class="emoji-tons"></div>`

let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
}, 60_000)
afterAll(async () => {
  await browser?.close()
})

async function medir(tema: string, movimento: "reduce" | "no-preference"): Promise<Record<string, string | number>> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: movimento })
  try {
    const page = await ctx.newPage()
    await page.setContent(`<!doctype html><html data-theme="${tema}"><head><style>${folha}</style></head><body>${HTML}</body></html>`)
    return await page.evaluate(() => {
      const el = (s: string): Element => document.querySelector(s) as Element
      const css = (s: string, p: string): string => getComputedStyle(el(s)).getPropertyValue(p).replace(/-aurora\b/g, "")
      return {
        larguraDaLista: el(".emoji-lista").getBoundingClientRect().width,
        larguraDaGrelha: el(".emoji-grid").getBoundingClientRect().width,
        alturaMinima: css(".emoji-grid", "min-height"),
        transicaoDaFicha: css(".reaccao", "transition-duration"),
        entrada: `${css(".reaccao.nova", "animation-name")} ${css(".reaccao.nova", "animation-duration")}`,
        conta: `${css(".reaccao-n.mudou", "animation-name")} ${css(".reaccao-n.mudou", "animation-duration")}`,
        tons: `${css(".emoji-tons", "animation-name")} ${css(".emoji-tons", "animation-duration")}`,
      }
    })
  } finally {
    await ctx.close()
  }
}

describe("o que veio depois da 1.3.19 também funciona no Aurora", () => {
  it("a lista virtual dos emoji ocupa a largura toda, como no Escuro", async () => {
    const aurora = await medir("aurora", "no-preference")
    const escuro = await medir("dark", "no-preference")
    expect(aurora.larguraDaLista).toBe(aurora.larguraDaGrelha)
    expect(aurora.larguraDaLista).toBe(escuro.larguraDaLista)
    expect(aurora.alturaMinima).toBe(escuro.alturaMinima)
  }, 60_000)

  it("com movimento reduzido, as reacções continuam a mexer, mais devagar, como no Escuro", async () => {
    const aurora = await medir("aurora", "reduce")
    const escuro = await medir("dark", "reduce")
    for (const chave of ["transicaoDaFicha", "entrada", "conta", "tons"]) expect(aurora[chave], chave).toBe(escuro[chave])
    expect(aurora.entrada).toBe("reaccao-entra-calma 0.66s")
  }, 60_000)
})
