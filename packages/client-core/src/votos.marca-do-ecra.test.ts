import { describe, expect, it } from "vitest"
import { comoNoEcra } from "./votos.js"

/**
 * `votacaoSemPoder` is written by this device only, from its own verdict (`semVotacao`).
 * A marker in a stored payload never reaches the screen (I3 of the review of diag-votacao).
 * On the wire the payload schema already drops unknown fields; this is the second barrier,
 * for any payload that reaches the vault by another path.
 */
describe("a marca votacaoSemPoder no ecrã", () => {
  it("uma marca no payload guardado não chega ao ecrã", () => {
    const payload = { t: "message", id: "m1", body: "texto", votacaoSemPoder: true }
    expect(comoNoEcra({ payload })).not.toHaveProperty("votacaoSemPoder")
    expect(comoNoEcra({ payload }).body).toBe("texto")
  })

  it("o veredicto deste aparelho marca a votação sem o poder", () => {
    const payload = { t: "message", id: "m2", body: "?", poll: { question: "?", options: ["a", "b"] } }
    const noEcra = comoNoEcra({ payload, semVotacao: true }) as Record<string, unknown>
    expect(noEcra["poll"]).toBeUndefined()
    expect(noEcra["votacaoSemPoder"]).toBe(true)
  })
})
