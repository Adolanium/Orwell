import { describe, expect, it } from "vitest"
import { appendHistory, entradasDoCanal, newVaultContents, tipoDoEstado, type StoredChatMessage } from "./vault.js"

const reaccao = (seq: number): StoredChatMessage => ({
  seq,
  sender: "@ana:x",
  at: seq,
  payload: { t: "reaction", target: "m1", emoji: "👍", remove: seq % 2 === 0 },
})

describe("reacções no cofre", () => {
  it("são estado, não conversa: não empurram mensagens para fora do tecto", () => {
    expect(tipoDoEstado(reaccao(1))).toBe("gosto")
    const contents = newVaultContents()
    appendHistory(contents, "c", { seq: 1, sender: "@bruno:x", at: 1, payload: { t: "message", id: "m1", sentAt: 1, body: "olá" } })
    for (let seq = 2; seq < 1_000; seq++) appendHistory(contents, "c", reaccao(seq))
    const entradas = entradasDoCanal(contents, "c")
    expect(entradas.some((e) => e.payload.t === "message")).toBe(true)
    expect(entradas.filter((e) => e.payload.t === "reaction")).toHaveLength(998)
  })
})
