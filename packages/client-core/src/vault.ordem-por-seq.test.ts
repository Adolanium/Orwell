import { describe, expect, it } from "vitest"
import { appendHistory, confirmarSeq, entradasDoCanal, newVaultContents, type StoredChatMessage, type VaultContents } from "./vault.js"
import { chaveDoEvento } from "./dobras.js"

/**
 * The vault list keeps server order for our quick replies (ordem-resposta, 20/11/2026).
 * The session-level reproduction is in `session.ordem-da-resposta.test.ts`.
 */

const CANAL = "!c:localhost"
const EU = "@eu:localhost"
const ELA = "@ela:localhost"

function dita(sender: string, id: string, seq: number, apos?: number): StoredChatMessage {
  return {
    seq,
    sender,
    at: 0,
    ...(apos !== undefined ? { apos } : {}),
    payload: { t: "message", id, sentAt: 0, body: id, attachments: [], mentions: [], links: [] },
  }
}

function ordem(contents: VaultContents): string[] {
  return entradasDoCanal(contents, CANAL).map((entrada) => `${String(entrada.payload["id"])}:${entrada.seq}`)
}

function eco(contents: VaultContents, id: string, seq: number): boolean {
  const chave = chaveDoEvento({ sender: EU, payload: dita(EU, id, -1).payload })
  if (chave === null) throw new Error("no key")
  return confirmarSeq(contents, CANAL, chave, seq)
}

describe("ordem por seq no cofre", () => {
  it("uma chegada em ordem vai para o fim", () => {
    const contents = newVaultContents()
    appendHistory(contents, CANAL, dita(ELA, "a", 1))
    appendHistory(contents, CANAL, dita(ELA, "b", 2))
    expect(ordem(contents)).toEqual(["a:1", "b:2"])
  })

  it("a pergunta numerada antes chega depois do eco da resposta: fica antes dela", () => {
    const contents = newVaultContents()
    appendHistory(contents, CANAL, dita(ELA, "ola", 1))
    appendHistory(contents, CANAL, dita(EU, "resposta", -1, 1))
    expect(eco(contents, "resposta", 3)).toBe(true)
    appendHistory(contents, CANAL, dita(ELA, "pergunta", 2))
    expect(ordem(contents)).toEqual(["ola:1", "pergunta:2", "resposta:3"])
  })

  it("a pergunta chega antes do eco: o eco põe a resposta depois dela", () => {
    const contents = newVaultContents()
    appendHistory(contents, CANAL, dita(ELA, "ola", 1))
    appendHistory(contents, CANAL, dita(EU, "resposta", -1, 1))
    appendHistory(contents, CANAL, dita(ELA, "pergunta", 2))
    expect(ordem(contents)).toEqual(["ola:1", "resposta:-1", "pergunta:2"])
    eco(contents, "resposta", 3)
    expect(ordem(contents)).toEqual(["ola:1", "pergunta:2", "resposta:3"])
  })

  it("dois envios nossos sem eco e a pergunta pelo meio: os dois ficam depois dela, pela ordem em que saíram", () => {
    const contents = newVaultContents()
    appendHistory(contents, CANAL, dita(ELA, "ola", 1))
    appendHistory(contents, CANAL, dita(EU, "r1", -1, 1))
    appendHistory(contents, CANAL, dita(EU, "r2", -1, 1))
    appendHistory(contents, CANAL, dita(ELA, "pergunta", 2))
    eco(contents, "r1", 3)
    expect(ordem(contents)).toEqual(["ola:1", "pergunta:2", "r1:3", "r2:-1"])
    eco(contents, "r2", 4)
    expect(ordem(contents)).toEqual(["ola:1", "pergunta:2", "r1:3", "r2:4"])
  })

  it("a pergunta chega depois do eco de r1, com r2 ainda sem eco: fica antes dos dois", () => {
    const contents = newVaultContents()
    appendHistory(contents, CANAL, dita(ELA, "ola", 1))
    appendHistory(contents, CANAL, dita(EU, "r1", -1, 1))
    eco(contents, "r1", 3)
    appendHistory(contents, CANAL, dita(EU, "r2", -1, 3))
    appendHistory(contents, CANAL, dita(ELA, "pergunta", 2))
    expect(ordem(contents)).toEqual(["ola:1", "pergunta:2", "r1:3", "r2:-1"])
  })

  it("um envio nosso antigo sem eco, de antes da pergunta, fica onde estava", () => {
    const contents = newVaultContents()
    appendHistory(contents, CANAL, dita(ELA, "ola", 1))
    appendHistory(contents, CANAL, dita(EU, "antigo", -1, 1))
    appendHistory(contents, CANAL, dita(ELA, "pergunta", 2))
    expect(ordem(contents)).toEqual(["ola:1", "antigo:-1", "pergunta:2"])
  })
})
