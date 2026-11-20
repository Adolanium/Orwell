import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The rail notices on the sheets (20/11/2026, option A, "pill and pastille").
 *
 * jsdom applies no CSS, so what the drawing promises is read from the sheets:
 * where each notice sits, which token paints it, that Aurora does not bring
 * back the old top-right badge, and that the nudge still moves with reduced
 * motion, only slower. The proof in a real browser is in the report's
 * screenshots (three themes, 1x and 1.5x).
 */
const ler = (relativo: string): string =>
  readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
const ecras = ler("./screens.css")
const componentes = ler("./components.css")
const pele = ler("./pele.css")
const aurora = ler("./aurora.css")

/** The body of the first top-level rule with exactly this selector. */
function regra(css: string, seletor: string): string {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?:^|\\})\\s*${escapado}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ""
}
/** A sheet's reduced-motion `@media` blocks. */
const reduzidos = (css: string): string =>
  [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n")

describe("os avisos do carril, na folha", () => {
  it("o ponto morto saiu de todas as folhas da pele plana", () => {
    for (const folha of [ecras, componentes, pele]) expect(folha).not.toMatch(/\.rail-dot/)
  })

  it("por ler: a pílula curta à esquerda, sem número, na cor neutra", () => {
    const pilula = regra(ecras, ".rail-pill")
    expect(pilula).toMatch(/position:\s*absolute/)
    expect(pilula).toMatch(/width:\s*4px/)
    expect(pilula).toMatch(/height:\s*8px/)
    expect(pilula).toMatch(/background:\s*var\(--aviso-neutro\)/)
    // Same edge as the open pill on the flat skin (`.rail-btn::before`, left -12px).
    expect(regra(pele, ".rail-pill")).toMatch(/left:\s*-12px/)
  })

  it("o número: em baixo à direita, 16 px, com a tinta da menção", () => {
    const n = regra(ecras, ".rail-count")
    expect(n).toMatch(/bottom:\s*-4px/)
    expect(n).toMatch(/right:\s*-4px/)
    expect(n).not.toMatch(/top:/)
    expect(n).toMatch(/min-width:\s*16px/)
    expect(n).toMatch(/background:\s*var\(--aviso-mencao\)/)
    expect(n).toMatch(/color:\s*var\(--aviso-mencao-tinta\)/)
  })

  it("o toque: contorno vermelho no botão e a pastilha vermelha no lugar do número", () => {
    expect(regra(ecras, ".rail-btn.tocado")).toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--aviso-toque\)/)
    expect(regra(ecras, ".rail-toque")).toMatch(/background:\s*var\(--aviso-toque\)/)
    expect(regra(ecras, ".rail-toque")).toMatch(/bottom:\s*-4px/)
  })

  it("a chamada: o selo verde em cima, do lado oposto ao número", () => {
    const selo = regra(ecras, ".rail-chamada")
    expect(selo).toMatch(/top:\s*-4px/)
    expect(selo).toMatch(/background:\s*var\(--aviso-chamada\)/)
  })

  it("sem ligação: o logo a 45 % e o selo âmbar", () => {
    expect(regra(ecras, ".rail-logo.sem-ligacao > svg")).toMatch(/opacity:\s*0\.45/)
    expect(regra(ecras, ".rail-offline")).toMatch(/background:\s*var\(--aviso-ligacao\)/)
  })

  it("com movimento reduzido o toque continua a mexer, mais devagar", () => {
    const normal = regra(ecras, ".rail-toque svg")
    expect(normal).toMatch(/animation:\s*rail-abanar 1\.6s/)
    const calmo = reduzidos(ecras)
    expect(calmo).toMatch(/\.rail-toque svg\s*\{\s*animation:\s*rail-abanar-calmo 4\.8s ease-in-out infinite !important/)
  })
})

describe("os avisos do carril, na Aurora", () => {
  it("o crachá antigo da 1.3.19 (em cima à direita) volta ao desenho A", () => {
    const n = regra(aurora, ':root[data-theme="aurora"] .rail-count')
    expect(n).toMatch(/top:\s*auto/)
    expect(n).toMatch(/bottom:\s*-4px/)
    expect(n).toMatch(/background:\s*var\(--aviso-mencao\)/)
  })

  it("a pílula fica visível na margem do carril largo (76 px de carril, 44 de botão)", () => {
    expect(aurora).toMatch(/@media \(min-width: 841px\)\s*\{\s*:root\[data-theme="aurora"\] \.rail-pill\s*\{\s*left:\s*-16px/)
    expect(aurora).not.toMatch(/\.rail-pill[^{]*\{[^}]*display:\s*none/)
  })

  it("o toque calmo também vale na Aurora, onde a regra universal da 1.3.19 volta com mais peso", () => {
    expect(reduzidos(aurora)).toMatch(/:root\[data-theme="aurora"\] \.rail-toque svg\s*\{\s*animation:\s*rail-abanar-calmo/)
  })
})
