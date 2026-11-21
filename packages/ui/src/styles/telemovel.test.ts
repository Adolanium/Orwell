import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The phone sheet (option B, 20/11/2026), read as text: jsdom applies no CSS.
 *
 * 1. Desktop and tablet unchanged: every rule that changes the shell hangs
 *    from `.app.telemovel`, which only exists at 840 px and less.
 * 2. Touch targets of 44 px at least.
 * 3. Reduced motion: slower, never stopped.
 * 4. What 390 px used to hide (the nudge) comes back.
 */
const caminho = "./telemovel.css"
const folha = readFileSync(fileURLToPath(new URL(caminho, import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")

/** The selectors of every rule outside `@keyframes`. */
function seletores(css: string): string[] {
  const semFotogramas = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, "")
  return [...semFotogramas.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .map((m) => (m[1] ?? "").trim())
    .filter((s) => s.length > 0 && !s.startsWith("@"))
    .flatMap(partirNasVirgulas)
}

/** Split a selector list on its top-level commas: `:is(a, b)` stays whole. */
function partirNasVirgulas(lista: string): string[] {
  const partes: string[] = []
  let profundidade = 0
  let actual = ""
  for (const letra of lista) {
    if (letra === "(") profundidade++
    if (letra === ")") profundidade--
    if (letra === "," && profundidade === 0) {
      partes.push(actual.trim())
      actual = ""
    } else actual += letra
  }
  partes.push(actual.trim())
  return partes
}

const corpo = (seletor: string): string => {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`${escapado}\\s*\\{([^}]*)\\}`).exec(folha)?.[1] ?? ""
}

/** Classes that only the phone layout draws, so their rules cannot touch a computer. */
const SO_DO_TELEMOVEL = [
  ".menu-do-tu",
  ".separador",
  ".borda-de-voltar",
  ".barra-do-telemovel",
  ".topbar-voltar",
  ".context-veu",
  ".context-menu.context-folha",
  ".audio-faixa-subir",
]

describe("telemovel.css", () => {
  it("every rule is for the phone layout only: the computer and the tablet stay as they were", () => {
    const fora = seletores(folha).filter(
      (s) => !s.includes(".app.telemovel") && !SO_DO_TELEMOVEL.some((classe) => s.startsWith(classe)),
    )
    expect(fora).toEqual([])
  })

  it("the one rule outside `.app.telemovel` that a computer meets hides its element", () => {
    expect(corpo(".audio-faixa-subir")).toMatch(/display:\s*none/)
  })

  it("touch targets: tabs, back arrow, community faces, channel and room lines, sheet entries", () => {
    const px = (regra: string, propriedade: string): number => Number(new RegExp(`${propriedade}:\\s*(\\d+)px`).exec(regra)?.[1] ?? 0)
    expect(px(corpo(".separador"), "min-height")).toBeGreaterThanOrEqual(44)
    expect(px(corpo(".topbar-voltar"), "height")).toBeGreaterThanOrEqual(44)
    expect(px(corpo(".topbar-voltar"), "width")).toBeGreaterThanOrEqual(44)
    expect(px(corpo(":root .app.telemovel .carril-comunidade"), "height")).toBeGreaterThanOrEqual(44)
    expect(px(corpo(":root .app.telemovel > .sidebar button:is(.channel, .room)"), "min-height")).toBeGreaterThanOrEqual(44)
    expect(px(corpo(".context-menu.context-folha button"), "min-height")).toBeGreaterThanOrEqual(44)
    expect(px(corpo(".menu-do-tu-entrada"), "min-height")).toBeGreaterThanOrEqual(44)
  })

  it("reduced motion: the pushed screen and the members still move, slower", () => {
    const reduzido = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(folha)?.[1] ?? ""
    expect(reduzido).toMatch(/animation-duration:\s*0\.45s\s*!important/)
    expect(reduzido).toMatch(/transition-duration:\s*0\.45s/)
    expect(reduzido).not.toMatch(/animation:\s*none|transition:\s*none/)
    expect(folha).toMatch(/@keyframes telemovel-entra-calma/)
  })

  it("the nudge is in the composer line on the phone", () => {
    expect(corpo(":root .app.telemovel .composer-line .composer-buzz")).toMatch(/display:\s*inline-flex/)
  })
})
