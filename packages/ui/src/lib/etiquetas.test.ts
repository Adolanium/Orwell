import { describe, expect, it } from "vitest"
import { aplicarMencoesComTodos, inserirMencao, MENCAO_TODOS } from "./mentions.js"
import {
  candidatoDeCargo,
  candidatoDeSala,
  etiquetaEmCurso,
  salaDoToken,
  sugerirEtiquetas,
  tokenDeSala,
} from "./etiquetas.js"

const ANA = { address: "@ana-b-c-d:s", name: "Ana" }
const PORTEIRO = candidatoDeCargo({ role: "porteiro", name: "Porteiro", powers: [] })
const GERAL = candidatoDeSala({ room: "", name: "geral" })
const ANUNCIOS = candidatoDeSala({ room: "forum-alfa-beta", name: "anúncios" })

describe("etiquetas: @ pessoas e cargos, # salas", () => {
  it("o # abre a lista de salas, como o @ abre a de pessoas", () => {
    expect(etiquetaEmCurso("vejam #an", 9)).toEqual({ inicio: 6, procura: "an", sinal: "#" })
    expect(etiquetaEmCurso("olá @a", 6)).toEqual({ inicio: 4, procura: "a", sinal: "@" })
    // Glued to a letter (an anchor in a URL) is not a tag.
    expect(etiquetaEmCurso("site.pt/x#topo", 14)).toBeNull()
    // The nearest sign to the cursor wins.
    expect(etiquetaEmCurso("@ana #ger", 9)?.sinal).toBe("#")
  })

  it("sugere pessoas primeiro, depois cargos, e @all no fim", () => {
    const lista = sugerirEtiquetas([ANA], [PORTEIRO], "", true)
    expect(lista.map((c) => c.name)).toEqual(["Ana", "Porteiro", "all"])
    expect(sugerirEtiquetas([ANA], [PORTEIRO], "por", true).map((c) => c.name)).toEqual(["Porteiro"])
  })

  it("um cargo escolhido viaja como <@&id> no corpo e &id nas menções", () => {
    const { texto, pick } = inserirMencao("olá @por", 4, 8, PORTEIRO)
    expect(texto).toBe("olá @Porteiro ")
    expect(aplicarMencoesComTodos(texto, [pick], true)).toEqual({ corpo: "olá <@&porteiro> ", mentions: ["&porteiro"] })
  })

  it("uma sala escolhida viaja como <#id> no corpo e não menciona ninguém", () => {
    const { texto, pick } = inserirMencao("vejam #an", 6, 9, ANUNCIOS)
    expect(texto).toBe("vejam #anúncios ")
    expect(aplicarMencoesComTodos(texto, [pick], false)).toEqual({ corpo: "vejam <#forum-alfa-beta> ", mentions: [] })
    const geral = inserirMencao("#", 0, 1, GERAL)
    expect(aplicarMencoesComTodos(geral.texto, [geral.pick], false).corpo).toBe("<#> ")
  })

  it("lê o token da sala de volta", () => {
    expect(salaDoToken(tokenDeSala("forum-alfa-beta"))).toBe("forum-alfa-beta")
    expect(salaDoToken("<#>")).toBe("")
    expect(salaDoToken("<#a b>")).toBeNull()
  })

  it("pessoas e @all continuam como antes", () => {
    const { texto, pick } = inserirMencao("@a", 0, 2, ANA)
    expect(aplicarMencoesComTodos(`${texto}@all`, [pick], true)).toEqual({
      corpo: `${ANA.address} @all`,
      mentions: [ANA.address, MENCAO_TODOS],
    })
  })
})
