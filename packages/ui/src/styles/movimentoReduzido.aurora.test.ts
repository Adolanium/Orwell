import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { folhaDaAurora } from "./aurora.folhas.js"

/**
 * The three continuous animations with reduced motion: the background aurora,
 * the pulse of a voice room with people in it and the ring pulse of whoever is
 * on a call.
 *
 * The rule (Windows with animation effects off runs with reduced motion): nothing stops, it
 * just moves slower. Up to 1.3.7 all three stopped (`animation: none`, and on
 * the ring `content: none`). Each now has a calm version: more time, less
 * distance or less opacity, with `!important` against the universal rule in
 * `base.css` (0.01 ms, a single iteration), like the opening ring.
 *
 * The proof in the three engines, with `document.getAnimations()`, is done in a real browser, outside this file.
 */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const semComentarios = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "")
const fundo = semComentarios(folhaDaAurora("fundo.css"))
const ecras = semComentarios(folhaDaAurora("screens.css"))
const componentes = semComentarios(folhaDaAurora("components.css"))

/** A sheet's reduced-motion `@media` blocks (each one ends in a «}» at column zero). */
const blocosReduzidos = (css: string): string[] =>
  [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)[^{]*\{((?:(?!\n\})[\s\S])*)\n\}/g)].map((m) => m[1] ?? "")
const regraEm = (css: string, seletor: string): string => {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`${escapado}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ""
}
const fotogramas = (css: string, nome: string): string => new RegExp(`@keyframes ${nome}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? ""
const segundos = (regra: string): number => Number(/([\d.]+)s\b/.exec(regra)?.[1])
/** Only `transform` and `opacity`, without `var()`: the compositor animates them on its own. */
const soCompositor = (f: string): void => {
  expect(f).not.toContain("var(")
  expect(f).toMatch(/transform|opacity/)
  expect([...f.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]).filter((p) => p !== "transform" && p !== "opacity")).toEqual([])
}

describe("movimento reduzido: nada pára, anda mais devagar", () => {
  it("nenhuma das três tem `animation: none` nem perde o pseudo-elemento", () => {
    for (const bloco of blocosReduzidos(fundo)) expect(regraEm(bloco, "body::before")).not.toMatch(/animation:\s*none/)
    for (const bloco of blocosReduzidos(ecras)) expect(regraEm(bloco, ".room-glyph.room-live svg")).not.toMatch(/animation:\s*none/)
    for (const bloco of blocosReduzidos(componentes)) {
      const anel = regraEm(bloco, "[data-anel][data-em-chamada]::after")
      expect(anel).not.toMatch(/content:\s*none/)
      expect(anel).not.toMatch(/animation:\s*none/)
    }
  })

  it("a aurora anda ao triplo do tempo e a metade da distância, e no telemóvel continua parada", () => {
    expect(fundo).toMatch(/@media \(prefers-reduced-motion: reduce\) and \(min-width: 601px\)\s*\{\s*body::before\s*\{\s*animation:\s*aurora-calma 72s ease-in-out infinite alternate !important/)
    expect(folhaDaAurora("tokens.css")).toMatch(/--aurora-volta:\s*24s/)
    const normal = fotogramas(fundo, "aurora")
    const calma = fotogramas(fundo, "aurora-calma")
    soCompositor(calma)
    expect(calma).toContain("translate(-1.5%, 2%) scale(1.025)")
    expect(calma).toContain("translate(2%, -1%) scale(1.04)")
    expect(normal).toContain("translate(-3%, 4%) scale(1.05)")
    expect(normal).toContain("translate(4%, -2%) scale(1.08)")
    expect(fundo).toMatch(/max-width:\s*600px\)\s*\{\s*body::before\s*\{\s*animation:\s*none/)
  })

  it("a sala de voz com gente pulsa ao dobro do tempo, e a opacidade desce menos", () => {
    const normal = regraEm(ecras, ".room-glyph.room-live svg")
    expect(normal).toMatch(/animation:\s*pulse 1\.8s ease-in-out infinite/)
    const reduzida = blocosReduzidos(ecras).map((b) => regraEm(b, ".room-glyph.room-live svg")).find(Boolean) ?? ""
    expect(reduzida).toMatch(/animation:\s*pulse-calmo [\d.]+s ease-in-out infinite !important/)
    expect(segundos(reduzida)).toBe(segundos(normal) * 2)
    const minimo = Number(/opacity:\s*([\d.]+)/.exec(fotogramas(ecras, "pulse-calmo"))?.[1])
    expect(minimo).toBeGreaterThan(Number(/opacity:\s*([\d.]+)/.exec(fotogramas(componentes, "pulse"))?.[1]))
    expect(minimo).toBeLessThan(1)
  })

  it("o anel de quem está em chamada pulsa ao dobro do tempo, mais ténue e a crescer menos, nas caras e nos cartões", () => {
    const blocos = blocosReduzidos(componentes)
    const caras = blocos.map((b) => regraEm(b, "[data-anel][data-em-chamada]::after")).find(Boolean) ?? ""
    expect(caras).toMatch(/animation:\s*anel-pulsa-calmo 3\.2s ease-in-out infinite !important/)
    expect(segundos(caras)).toBe(segundos(regraEm(componentes, "[data-anel][data-em-chamada]::after")) * 2)
    const cartao = blocos.map((b) => regraEm(b, ".call-chip [data-anel][data-em-chamada]::after")).find(Boolean) ?? ""
    expect(cartao).toMatch(/animation-name:\s*anel-pulsa-calmo-no-cartao !important/)

    const escala = (f: string): number => Number(/100%\s*\{[^}]*scale\(([\d.]+)\)/.exec(f)?.[1])
    const inicio = (f: string): number => Number(/0%\s*\{[^}]*opacity:\s*([\d.]+)/.exec(f)?.[1])
    for (const [calmo, normal] of [
      ["anel-pulsa-calmo", "anel-pulsa"],
      ["anel-pulsa-calmo-no-cartao", "anel-pulsa-no-cartao"],
    ] as const) {
      const f = fotogramas(componentes, calmo)
      soCompositor(f)
      expect(escala(f) - 1, calmo).toBeCloseTo((escala(fotogramas(componentes, normal)) - 1) / 2, 5)
      expect(inicio(f), calmo).toBeLessThan(inicio(fotogramas(componentes, normal)))
    }
  })
})

/**
 * The nudge with reduced motion (12/11/2026: "on Windows the
 * window turns blue, it does not produce the effect we wanted").
 *
 * Up to 1.3.7 the reduced block swapped `buzz-shake` for `buzz-flash`, a blue
 * highlight. A Windows machine may run with reduced motion, so the nudge there was a
 * blue window. Now the shake stays, at twice the time and half the distance.
 */
describe("movimento reduzido: a cotovelada continua a abanar", () => {
  const base = semComentarios(folhaDaAurora("base.css"))
  /** The largest pixel offset in a keyframe block. */
  const amplitude = (f: string): number => Math.max(...[...f.matchAll(/(-?[\d.]+)px/g)].map((m) => Math.abs(Number(m[1]))))

  it("troca o abanão pela versão calma, ao dobro do tempo, e nunca por um clarão", () => {
    const normal = regraEm(ecras, ".main.buzzing")
    expect(normal).toMatch(/animation:\s*buzz-shake 0\.82s/)
    const reduzida = blocosReduzidos(ecras).map((b) => regraEm(b, ".main.buzzing")).find(Boolean) ?? ""
    expect(reduzida).toMatch(/animation:\s*buzz-shake-calmo [\d.]+s [^;]* !important/)
    expect(segundos(reduzida)).toBeCloseTo(segundos(normal) * 2, 5)
    expect(ecras).not.toContain("buzz-flash")
    // The old exception in `base.css` set the duration of the highlight; with it
    // there the two `!important` rules would fight over the duration by file order.
    expect(base).not.toContain(".main.buzzing")
  })

  it("a versão calma só mexe no transform, a metade da distância", () => {
    const calma = fotogramas(ecras, "buzz-shake-calmo")
    soCompositor(calma)
    expect(amplitude(calma)).toBeCloseTo(amplitude(fotogramas(ecras, "buzz-shake")) / 2, 5)
  })
})

/**
 * The bell with reduced motion (12/11/2026, house rule: nothing stops, it moves
 * slower). Up to 1.3.7 the swing was swapped for a colour highlight.
 */
describe("movimento reduzido: o sino continua a balançar", () => {
  const base = semComentarios(folhaDaAurora("base.css"))
  /** The largest angle in a keyframe block. */
  const angulo = (f: string): number => Math.max(...[...f.matchAll(/(-?[\d.]+)deg/g)].map((m) => Math.abs(Number(m[1]))))

  it("troca o balanço pela versão calma, ao dobro do tempo, e nunca por um realce de cor", () => {
    const normal = regraEm(ecras, ".me-bell.avisa")
    expect(normal).toMatch(/animation:\s*sino-bate 520ms/)
    const reduzida = blocosReduzidos(ecras).map((b) => regraEm(b, ".me-bell.avisa")).find(Boolean) ?? ""
    expect(reduzida).toMatch(/animation:\s*sino-bate-calmo 1040ms [^;]* !important/)
    expect(ecras).not.toContain("sino-realce")
    expect(base).not.toContain(".me-bell.avisa")
  })

  it("a versão calma só roda, a metade do ângulo", () => {
    const calma = fotogramas(ecras, "sino-bate-calmo")
    soCompositor(calma)
    expect(angulo(calma)).toBeCloseTo(angulo(fotogramas(ecras, "sino-bate")) / 2, 5)
  })
})
