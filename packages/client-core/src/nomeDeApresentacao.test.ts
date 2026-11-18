import { describe, expect, it } from "vitest"
import { contarGrafemas, cortarNome, NOME_MAX, nomeVisivel, nomeValido } from "./nomeDeApresentacao.js"

describe("display name: 12 graphemes on write, cut with an ellipsis on read", () => {
  it("12 passes and 13 fails", () => {
    expect(NOME_MAX).toBe(12)
    expect(nomeValido("abcdefghijkl")).toBe(true)
    expect(nomeValido("abcdefghijklm")).toBe(false)
  })

  it("trims before counting, and an empty name is not valid", () => {
    expect(nomeValido("   abcdefghijkl   ")).toBe(true)
    expect(nomeValido("")).toBe(false)
    expect(nomeValido("    ")).toBe(false)
  })

  it("12 emojis pass, compound ones counted as one each", () => {
    const familia = "👨‍👩‍👧‍👦"
    const bandeira = "🇵🇹"
    const pele = "👍🏽"
    const doze = [familia, bandeira, pele, "😀", "🎉", "❤️", familia, bandeira, pele, "😀", "🎉", "❤️"].join("")
    expect(contarGrafemas(doze)).toBe(12)
    expect(nomeValido(doze)).toBe(true)
    expect(nomeValido(doze + "😀")).toBe(false)
  })

  it("a letter with a combining accent counts as one", () => {
    const comAcento = "João" // "João" with a combining tilde
    expect(comAcento.length).toBe(5)
    expect(contarGrafemas(comAcento)).toBe(4)
  })

  it("cutting keeps the first 12 graphemes and never splits a compound emoji", () => {
    expect(cortarNome("abcdefghijklmnop")).toBe("abcdefghijkl")
    const familias = "👨‍👩‍👧‍👦".repeat(13)
    expect(cortarNome(familias)).toBe("👨‍👩‍👧‍👦".repeat(12))
    // Within the limit, what was typed stays as typed, spaces included.
    expect(cortarNome("Ana ")).toBe("Ana ")
  })

  it("an old 30-character name reads as 12 graphemes and an ellipsis", () => {
    const antigo = "Maria Eduarda Albuquerque Sous"
    expect(antigo.length).toBe(30)
    expect(nomeVisivel(antigo)).toBe("Maria Eduard…")
    expect(contarGrafemas(nomeVisivel(antigo))).toBe(13)
  })

  it("a name within the limit reads as is", () => {
    expect(nomeVisivel("Ana")).toBe("Ana")
    expect(nomeVisivel("abcdefghijkl")).toBe("abcdefghijkl")
  })

  it("the ellipsis does not sit after a space", () => {
    expect(nomeVisivel("Maria Edu    ardo Sousa")).toBe("Maria Edu…")
  })
})
