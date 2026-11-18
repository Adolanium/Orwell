import { afterEach, describe, expect, it } from "vitest"
import { relatarAtributoAoAnfitriao, relatarTemaAoAnfitriao } from "./tema.js"

afterEach(() => {
  delete document.documentElement.dataset.theme
})

describe("o tema chega ao processo principal", () => {
  it("relata o tema agora e a cada mudança, sem repetir", async () => {
    const relatados: string[] = []
    document.documentElement.dataset.theme = "claro"
    const parar = relatarTemaAoAnfitriao(document.documentElement, { definir: (tema) => relatados.push(tema) })
    expect(relatados).toEqual(["claro"])
    document.documentElement.dataset.theme = "sistema"
    await Promise.resolve()
    document.documentElement.dataset.theme = "sistema"
    await Promise.resolve()
    document.documentElement.dataset.theme = "escuro"
    await Promise.resolve()
    expect(relatados).toEqual(["claro", "sistema", "escuro"])
    parar()
  })

  it("sem anfitrião (testes, preload antigo), não faz nada", () => {
    expect(() => relatarTemaAoAnfitriao(document.documentElement, undefined)()).not.toThrow()
  })
})

describe("a língua chega ao processo principal", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("lang")
  })

  it("relata o lang agora e a cada mudança", async () => {
    const relatados: string[] = []
    document.documentElement.lang = "en"
    const parar = relatarAtributoAoAnfitriao(document.documentElement, "lang", { definir: (l) => relatados.push(l) })
    document.documentElement.lang = "pt"
    await Promise.resolve()
    expect(relatados).toEqual(["en", "pt"])
    parar()
  })
})
