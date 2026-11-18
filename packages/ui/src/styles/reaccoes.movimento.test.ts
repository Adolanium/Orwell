import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The reaction animations with reduced motion: nothing stops, it moves slower.
 *
 * The universal rule in `base.css` zeroes every animation and transition with
 * `!important`. Each animation added for reactions and for the picker's skin
 * tones has a calm version here, with its own `!important`: three times the
 * time (or more) and less distance, only transform and opacity.
 */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const ecras = ler("./screens.css").replace(/\/\*[\s\S]*?\*\//g, "")
const blocosReduzidos = [...ecras.matchAll(/@media \(prefers-reduced-motion: reduce\)[^{]*\{((?:(?!\n\})[\s\S])*)\n\}/g)].map((m) => m[1] ?? "")
const regraEm = (css: string, seletor: string): string => {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?:^|\\n)\\s*${escapado}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ""
}
const reduzida = (seletor: string): string => blocosReduzidos.map((b) => regraEm(b, seletor)).find(Boolean) ?? ""
const fotogramas = (nome: string): string => new RegExp(`@keyframes ${nome}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(ecras)?.[1] ?? ""
const ms = (regra: string): number => Number(/(\d+)ms/.exec(regra)?.[1])
const propriedades = (f: string): string[] => [...f.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1] ?? "")

describe("reacções com movimento reduzido: nada pára, anda mais devagar", () => {
  it.each([
    [".reaccao.nova", "reaccao-entra"],
    [".reaccao-n.mudou", "reaccao-conta"],
    [".emoji-tons", "emoji-tons-entra"],
  ])("%s tem uma versão calma, com !important, pelo menos três vezes mais lenta", (seletor, nome) => {
    const calma = reduzida(seletor)
    expect(calma).toMatch(new RegExp(`animation:\\s*${nome}-calma \\d+ms[^;]*!important`))
    expect(calma).not.toMatch(/animation:\s*none/)
    const normal = regraEm(ecras, seletor)
    const duracaoNormal = /var\(--dur-fast\)/.test(normal) ? 120 : ms(normal)
    expect(ms(calma)).toBeGreaterThanOrEqual(duracaoNormal * 3)
  })

  it("as versões calmas só mexem em transform e opacity, e andam menos", () => {
    for (const nome of ["reaccao-entra-calma", "reaccao-conta-calma", "emoji-tons-entra-calma"]) {
      const f = fotogramas(nome)
      expect(f, nome).not.toBe("")
      expect(propriedades(f).filter((p) => p !== "transform" && p !== "opacity"), nome).toEqual([])
    }
    expect(fotogramas("reaccao-entra-calma")).toContain("scale(0.88)")
    expect(fotogramas("reaccao-entra")).toContain("scale(0.6)")
  })

  it("a transição da ficha continua, mais lenta, contra a regra universal", () => {
    expect(reduzida(".reaccao")).toMatch(/transition-duration:\s*360ms !important/)
  })
})
