/**
 * The profile bio on a phone (12/11/2026, iPhone 13): it sat in a
 * 138 px column, with the photo's empty space to its left, and a long URL ran
 * off the screen. The layout itself is measured in WebKit by
 * `scripts/capturar-bio-telemovel.mjs` (16 checks, 390 and 1280 px); this
 * locks the rules that make it, so a later edit cannot drop them in silence.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const estilos = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles")
const screens = readFileSync(join(estilos, "screens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")

describe("a bio do perfil", () => {
  it("mantém as quebras de linha e parte as palavras compridas, em qualquer largura", () => {
    const regra = screens.match(/^\.profile-bio \{([^}]*)\}/m)?.[1] ?? ""
    expect(regra).toMatch(/white-space:\s*pre-wrap/)
    expect(regra).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it("no telemóvel a cabeça do perfil é uma coluna, e a bio ocupa a largura toda", () => {
    const blocos = [...screens.matchAll(/@media \(max-width: 560px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? "")
    const bloco = blocos.find((b) => b.includes(".profile-head"))
    expect(bloco, "o bloco do telemóvel com a cabeça do perfil").toBeDefined()
    expect(bloco).toMatch(/\.profile-head \{[^}]*flex-direction:\s*column/)
    expect(bloco).toMatch(/\.profile-facts \{[^}]*width:\s*100%/)
    expect(bloco).toMatch(/\.profile-bio \{[^}]*max-width:\s*none/)
  })

  it("o ecrã largo continua uma linha: foto à esquerda, factos à direita", () => {
    const regra = screens.match(/^\.profile-head \{([^}]*)\}/m)?.[1] ?? ""
    expect(regra).toMatch(/flex-direction:\s*row/)
  })
})
