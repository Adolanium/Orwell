import { describe, expect, it } from "vitest"
import { lerVoto } from "./votos.js"
import { appendHistory, entradasDoCanal, newVaultContents, TECTOS_DO_ESTADO, type StoredChatMessage } from "./vault.js"

/**
 * A poll its author could not create (`semVotacao`, 1.3.21) is no poll for the
 * vault's vote bucket: its votes are orphans, and the cap takes them before the
 * votes of a real poll (`votosAGuardar`, "orphans before the oldest").
 */

const SALA = "!sala:s"
const BRUNO = "@bruno:s"

const entrada = (seq: number, sender: string, payload: StoredChatMessage["payload"], extra: Partial<StoredChatMessage> = {}): StoredChatMessage => ({
  seq,
  sender,
  at: seq,
  payload,
  ...extra,
})

const poll = { question: "?", options: ["a", "b"] }

describe("os votos de uma votação sem poder, no tecto do cofre", () => {
  it("saem primeiro, mesmo sendo os mais recentes", () => {
    const c = newVaultContents()
    let seq = 1
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "message", id: "valida", body: "?", sentAt: 1, poll }))
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "message", id: "forjada", body: "?", sentAt: 2, poll }, { semVotacao: true }))
    const naValida = TECTOS_DO_ESTADO.voto / 2 + 100
    const naForjada = TECTOS_DO_ESTADO.voto / 2
    // The real poll's votes are the OLDEST: by age alone, they would leave first.
    for (let i = 0; i < naValida; i++) {
      appendHistory(c, SALA, entrada(seq++, `@v${i}:s`, { t: "post.reaction", id: `a${i}`, target: "valida", emoji: "", at: seq, remove: false, vote: 0 }))
    }
    for (let i = 0; i < naForjada; i++) {
      appendHistory(c, SALA, entrada(seq++, `@f${i}:s`, { t: "post.reaction", id: `b${i}`, target: "forjada", emoji: "", at: seq, remove: false, vote: 1 }))
    }
    const votos = (alvo: string): number => entradasDoCanal(c, SALA).filter((e) => lerVoto(e)?.alvo === alvo).length
    expect(votos("valida")).toBe(naValida)
    expect(votos("forjada")).toBeLessThan(naForjada)
    expect(votos("valida") + votos("forjada")).toBeLessThanOrEqual(TECTOS_DO_ESTADO.voto)
  })

  it("uma votação relatada (julgada pelo relógio) e confirmada pelo servidor fica com o veredicto do servidor (M1)", () => {
    const c = newVaultContents()
    const payload = { t: "message", id: "relatada", body: "?", sentAt: 1, poll }
    // Reported after the cut, judged by this clock: text.
    appendHistory(c, SALA, entrada(-1, BRUNO, payload, { relatada: true, semVotacao: true, apos: 4 }))
    // The server event, received before the cut: not judged, a poll.
    appendHistory(c, SALA, entrada(5, BRUNO, payload))
    const guardadas = entradasDoCanal(c, SALA).filter((e) => e.payload["id"] === "relatada")
    expect(guardadas).toHaveLength(1)
    expect(guardadas[0]?.seq).toBe(5)
    expect(guardadas[0]?.semVotacao).toBeUndefined()
    // And the other way round: the server's verdict wins when it says "no power".
    appendHistory(c, SALA, entrada(-1, BRUNO, { ...payload, id: "relatada-2" }, { relatada: true, apos: 5 }))
    appendHistory(c, SALA, entrada(6, BRUNO, { ...payload, id: "relatada-2" }, { semVotacao: true }))
    expect(entradasDoCanal(c, SALA).find((e) => e.payload["id"] === "relatada-2")?.semVotacao).toBe(true)
  })
})
