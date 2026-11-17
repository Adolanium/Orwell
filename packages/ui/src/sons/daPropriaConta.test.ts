import { describe, expect, it } from "vitest"
import { daPropriaConta, somDaMensagem, somDoCanal } from "./acontecimentos.js"

/** No sound for an event of this account, from any of its devices (16/11/2026). */
const EU = "@eu:casa.pt"
const LAGAR = "!lagar:casa.pt"

describe("o que a própria conta escreveu", () => {
  it("compara o autor com a conta, e só com a conta", () => {
    expect(daPropriaConta(EU, EU)).toBe(true)
    expect(daPropriaConta("@ana:casa.pt", EU)).toBe(false)
    expect(daPropriaConta(EU, null)).toBe(false)
    expect(daPropriaConta(undefined, EU)).toBe(false)
  })

  it("uma mensagem minha vinda do telemóvel, ao vivo, não toca no canal nem como ticket", () => {
    const doTelemovel = { channel: LAGAR, sender: EU, aoVivo: true as const, payload: { t: "message", body: "olá" } }
    expect(somDoCanal(doTelemovel, EU)).toBeNull()
    const ticket = { ...doTelemovel, payload: { t: "message", body: "ajuda", ticket: { id: "t1", subject: "Ajuda" } } }
    expect(somDaMensagem(ticket, EU, () => ({ opener: EU, assignee: EU }))).toBeNull()
  })
})
