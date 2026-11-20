import { describe, expect, it } from "vitest"
import { codigoDoEstado, htmlDoArranque, textoDoArranque } from "./ecra-de-arranque.js"
import { linguaDoAnfitriao, linguasDoSistemaElectron, textosDoAnfitriao } from "./lingua-do-anfitriao.js"

/**
 * The language of the main process (20/11/2026).
 *
 * English is the default. Portuguese only when the page last showed
 * Portuguese, or, before any page, when the first system language is
 * Portuguese. A German system once showed Portuguese here: that is the defect.
 */
describe("a língua do processo principal", () => {
  it.each([
    [null, ["de-DE"], "en"],
    [null, ["pt-BR"], "pt"],
    [null, ["pt-PT", "en"], "pt"],
    [null, ["fr"], "en"],
    [null, [], "en"],
    ["en", ["pt-PT"], "en"],
    ["pt", ["de-DE"], "pt"],
    ["lixo", ["de-DE"], "en"],
  ] as const)("guardada %s, sistema %j: %s", (guardada, sistema, esperada) => {
    expect(linguaDoAnfitriao(guardada, sistema)).toBe(esperada)
  })

  it("lê a lista do sistema, e o locale quando a lista falta", () => {
    expect(linguasDoSistemaElectron({ getPreferredSystemLanguages: () => ["de-DE", "en"], getLocale: () => "pt" })).toEqual(["de-DE", "en"])
    expect(linguasDoSistemaElectron({ getPreferredSystemLanguages: () => [], getLocale: () => "pt-PT" })).toEqual(["pt-PT"])
    expect(linguasDoSistemaElectron({ getLocale: () => "" })).toEqual([])
  })

  it("as palavras: inglês para tudo o que não é português", () => {
    expect(textosDoAnfitriao("en").bandeja.abrir).toBe("Open Orwell")
    expect(textosDoAnfitriao("de").bandeja.sair).toBe("Quit")
    expect(textosDoAnfitriao(null).sairComPendentes.mensagem).toBe("Some messages are not sent yet. Quit anyway?")
    expect(textosDoAnfitriao("pt").bandeja.abrir).toBe("Abrir o Orwell")
  })
})

describe("o ecrã de arranque, na língua da app", () => {
  it("por omissão, inglês: a página e as fases", () => {
    const html = htmlDoArranque("escuro")
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<div id="titulo">Looking for updates</div>')
    expect(textoDoArranque({ fase: "a-instalar", versao: "1.3.25" }).titulo).toBe("Installing version 1.3.25")
    expect(codigoDoEstado({ fase: "a-procurar" })).toContain('"Looking for updates"')
  })

  it("em português, quando a app está em português", () => {
    expect(htmlDoArranque("escuro", "pt")).toContain('<html lang="pt">')
    expect(htmlDoArranque("escuro", "pt")).toContain("A procurar actualizações")
    expect(textoDoArranque({ fase: "a-descarregar", versao: "1.3.25", recebidos: 0, total: 0 }, "pt").detalhe).toBe("0 MB de 0 MB")
  })
})
