import { describe, expect, it } from "vitest"
import { corpoDaRespostaAoConvite, corpoDoActoDoTicket, lerCorpoDaResposta, lerCorpoDoTicket } from "./actosEmTexto.js"
import { Session } from "./session.js"

/**
 * The bodies of the act messages, in English, and read back (20/11/2026).
 */
describe("os corpos dos actos", () => {
  it("a resposta a um convite vai em inglês e lê-se de volta", () => {
    expect(corpoDaRespostaAoConvite('"Lagar"', true)).toBe('I accepted the invitation to "Lagar".')
    expect(lerCorpoDaResposta(corpoDaRespostaAoConvite('"Lagar"', true), true)).toBe('"Lagar"')
    expect(lerCorpoDaResposta(corpoDaRespostaAoConvite("#x", false), false)).toBe("#x")
    expect(lerCorpoDaResposta("Aceitei o convite para #x.", true)).toBeUndefined()
  })

  it("o acto de um ticket vai em inglês e lê-se de volta, com e sem assunto", () => {
    for (const estado of ["open", "working", "closed"] as const) {
      expect(lerCorpoDoTicket(corpoDoActoDoTicket(estado, "porta"), estado)).toBe("porta")
      expect(lerCorpoDoTicket(corpoDoActoDoTicket(estado, ""), estado)).toBe("")
    }
    expect(corpoDoActoDoTicket("working", "porta")).toBe('Moved the ticket "porta" to in progress.')
    expect(lerCorpoDoTicket('Fechou o ticket "porta".', "closed")).toBeUndefined()
    expect(lerCorpoDoTicket(corpoDoActoDoTicket("closed", "porta"), "open")).toBeUndefined()
  })
})

describe("as salas de um canal novo nascem na língua de quem o cria", () => {
  it("inglês por omissão, português só para quem está em português", () => {
    expect(Session.salasIniciais("en").map((sala) => sala.name)).toEqual(["announcements", "chat", "voice"])
    expect(Session.salasIniciais("de").map((sala) => sala.name)).toEqual(["announcements", "chat", "voice"])
    expect(Session.salasIniciais(undefined).map((sala) => sala.name)).toEqual(["announcements", "chat", "voice"])
    expect(Session.salasIniciais("pt").map((sala) => sala.name)).toEqual(["anúncios", "conversa", "voz"])
  })
})
