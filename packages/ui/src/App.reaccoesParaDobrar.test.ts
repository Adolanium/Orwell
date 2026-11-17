import { describe, expect, it } from "vitest"
import { dobrarReaccoes } from "@enclave/client-core"
import { reaccoesParaDobrar, toChatMessage } from "./App.js"
import type { ChatMessage } from "./types.js"

const CANAL = "!lagar:s"
const ANA = "@ana:s"
const BRUNO = "@bruno:s"
const reaccao = (remove: boolean) => ({ t: "reaction", target: "m1", emoji: "👍", remove })

describe("as reacções em memória, para a dobra (16/11/2026)", () => {
  it("uma pressão do cofre sem seq fica no lugar da marca, e uma retirada depois dela ganha", () => {
    const doCofre = [
      { seq: 24, sender: ANA, at: 1, payload: reaccao(false) },
      { seq: 25, sender: BRUNO, at: 2, payload: reaccao(false) },
      { seq: 27, sender: ANA, at: 3, payload: reaccao(true) },
      // An old copy of the press at 24, stored without seq (a report, before 16/11/2026).
      { seq: -1, apos: 23, sender: ANA, at: 4, payload: reaccao(false) },
    ].map((entrada) => toChatMessage(CANAL, entrada))
    const fichas = dobrarReaccoes(reaccoesParaDobrar(doCofre, CANAL), ANA).get("m1")
    expect(fichas).toEqual([{ emoji: "👍", quem: [BRUNO], minha: false }])
  })

  it("um envio nosso ainda sem eco e sem marca continua a ser o mais recente", () => {
    const emMemoria: ChatMessage[] = [
      { channel: CANAL, seq: 27, sender: ANA, payload: reaccao(true) },
      { channel: CANAL, seq: -1, sender: ANA, payload: reaccao(false) },
    ]
    expect(dobrarReaccoes(reaccoesParaDobrar(emMemoria, CANAL), ANA).get("m1")).toEqual([{ emoji: "👍", quem: [ANA], minha: true }])
  })
})
