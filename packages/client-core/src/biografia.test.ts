import { describe, expect, it } from "vitest"
import { BIO_MAX, bioVisivel, cortarBio } from "./biografia.js"
import { contarGrafemas } from "./nomeDeApresentacao.js"

const FAMILIA = "👨‍👩‍👧‍👦"

describe("bio: 300 graphemes on write, cut with an ellipsis on read", () => {
  it("the limit is 300", () => {
    expect(BIO_MAX).toBe(300)
  })

  it("counts graphemes, not UTF-16 units: a compound emoji is one", () => {
    const trezentos = FAMILIA.repeat(300)
    expect(trezentos.length).toBe(300 * FAMILIA.length)
    expect(contarGrafemas(trezentos)).toBe(300)
    expect(cortarBio(trezentos)).toBe(trezentos)
  })

  it("300 passes as is, 301 is cut to 300 without splitting a grapheme", () => {
    const a = "a".repeat(300)
    expect(cortarBio(a)).toBe(a)
    expect(cortarBio(a + "b")).toBe(a)
    const cortada = cortarBio(FAMILIA.repeat(301))
    expect(contarGrafemas(cortada)).toBe(300)
    expect(cortada).toBe(FAMILIA.repeat(300))
  })

  it("within the limit the text keeps its spaces and line breaks", () => {
    expect(cortarBio("  Fotografia.\nEscrita.  ")).toBe("  Fotografia.\nEscrita.  ")
  })

  it("an old 1000-character bio reads as 300 graphemes and an ellipsis", () => {
    const antiga = "x".repeat(1000)
    const visivel = bioVisivel(antiga)
    expect(visivel).toBe(`${"x".repeat(300)}…`)
    expect(contarGrafemas(visivel)).toBe(301)
  })

  it("a bio within the limit is drawn whole, with no ellipsis", () => {
    expect(bioVisivel("Fotografo a planície.")).toBe("Fotografo a planície.")
    expect(bioVisivel("a".repeat(300))).toBe("a".repeat(300))
  })

  it("the drawn cut drops a trailing space before the ellipsis", () => {
    expect(bioVisivel(`${"a".repeat(299)} ${"b".repeat(50)}`)).toBe(`${"a".repeat(299)}…`)
  })
})
