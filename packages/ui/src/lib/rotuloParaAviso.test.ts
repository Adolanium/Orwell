import { describe, expect, it } from "vitest"
import { shortName } from "./format.js"
import { rotuloParaAviso, salaParaAviso } from "./notifications.js"

/**
 * The name a notice shows for a channel or a room (16/11/2026): the decrypted
 * name, the last one known, or nothing. Never the identifier, which outside the
 * app reads as broken encryption ("New message in !q7x…").
 */
const CANAL = "!q7xk2m9w0p4s:orwell.pt"

describe("o nome de um canal num aviso", () => {
  it("o nome decifrado passa, e fica como o último conhecido", () => {
    const conhecidos = new Map<string, string>()
    expect(rotuloParaAviso(CANAL, "Lagar", conhecidos)).toBe("Lagar")
    // The name went back to the identifier (a reload, before `space.meta`): the last one known.
    expect(rotuloParaAviso(CANAL, shortName(CANAL), conhecidos)).toBe("Lagar")
  })

  it("sem nome nenhum, nada: nem o identificador curto nem o inteiro", () => {
    const conhecidos = new Map<string, string>()
    expect(rotuloParaAviso(CANAL, shortName(CANAL), conhecidos)).toBeNull()
    expect(rotuloParaAviso(CANAL, CANAL, conhecidos)).toBeNull()
    expect(rotuloParaAviso(CANAL, "", conhecidos)).toBeNull()
  })
})

describe("o nome de uma sala num aviso", () => {
  it("o nome da sala, ou nada; nunca o identificador da sala", () => {
    expect(salaParaAviso("x7Hk2", { room: "x7Hk2", name: "Voz" })).toBe("Voz")
    expect(salaParaAviso("x7Hk2", undefined)).toBeNull()
    expect(salaParaAviso("x7Hk2", { room: "x7Hk2", name: "" })).toBeNull()
  })
})
