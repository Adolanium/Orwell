import { describe, expect, it } from "vitest"
import { dobrarVotos } from "./dobras.js"
import { appendHistory, entradasDoCanal, HISTORY_MAX_PER_CHANNEL, newVaultContents, TECTOS_DO_ESTADO, type StoredChatMessage } from "./vault.js"

/**
 * Poll votes must never leave the vault by a cap (17/11/2026).
 *
 * A vote is a `post.reaction` with a numeric `vote`, so the ledger files it as
 * "gosto", in the same bucket as every chat reaction and every like, capped at
 * 5 000 per channel. In the common room, with thousands of events a day, the
 * oldest votes were the first to leave: the poll stayed on screen and the vote
 * was gone after a reload.
 */

const SALA = "!sala:s"
const ANA = "@ana:s"
const BRUNO = "@bruno:s"

const entrada = (seq: number, sender: string, payload: StoredChatMessage["payload"]): StoredChatMessage => ({ seq, sender, at: seq, payload })

describe("os votos das votações e os tectos do cofre", () => {
  it("com mais de 5 000 reacções depois, o voto continua no cofre", () => {
    const c = newVaultContents()
    let seq = 1
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "message", id: "v1", body: "Pizza ou sushi?", sentAt: 1, poll: { question: "Pizza ou sushi?", options: ["Pizza", "Sushi"] } }))
    appendHistory(c, SALA, entrada(seq++, ANA, { t: "post.reaction", id: "voto-ana", target: "v1", emoji: "", at: seq, remove: false, vote: 1 }))
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "post.reaction", id: "voto-bruno", target: "v1", emoji: "", at: seq, remove: false, vote: 0 }))
    for (let i = 0; i < TECTOS_DO_ESTADO.gosto + 10; i++) {
      appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "reaction", target: `m${i % 50}`, emoji: "👍", remove: i % 2 === 1 }))
    }
    // The poll message is still in the conversation: only reactions came after it.
    expect(c.history[SALA]?.some((e) => e.payload["id"] === "v1")).toBe(true)
    const votos = dobrarVotos(entradasDoCanal(c, SALA)).get("v1")
    expect(votos?.get(ANA)).toBe(1)
    expect(votos?.get(BRUNO)).toBe(0)
  })

  it("a mudança de voto e a retirada sobrevivem ao tecto", () => {
    const c = newVaultContents()
    let seq = 1
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "message", id: "v1", body: "?", sentAt: 1, poll: { question: "?", options: ["a", "b", "c"] } }))
    appendHistory(c, SALA, entrada(seq++, ANA, { t: "post.reaction", id: "a1", target: "v1", emoji: "", at: 10, remove: false, vote: 0 }))
    appendHistory(c, SALA, entrada(seq++, ANA, { t: "post.reaction", id: "a2", target: "v1", emoji: "", at: 20, remove: false, vote: 2 }))
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "post.reaction", id: "b1", target: "v1", emoji: "", at: 10, remove: false, vote: 1 }))
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "post.reaction", id: "b2", target: "v1", emoji: "", at: 20, remove: true, vote: 1 }))
    for (let i = 0; i < TECTOS_DO_ESTADO.gosto + 10; i++) {
      appendHistory(c, SALA, entrada(seq++, ANA, { t: "post.reaction", id: `g${i}`, target: `p${i}`, emoji: "👍", at: seq, remove: false }))
    }
    const votos = dobrarVotos(entradasDoCanal(c, SALA)).get("v1")
    expect(votos?.get(ANA)).toBe(2)
    expect(votos?.has(BRUNO)).toBe(false)
  })

  it("controlo: com 400 mensagens depois, a própria votação sai da conversa", () => {
    const c = newVaultContents()
    let seq = 1
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "message", id: "v1", body: "?", sentAt: 1, poll: { question: "?", options: ["a", "b"] } }))
    appendHistory(c, SALA, entrada(seq++, ANA, { t: "post.reaction", id: "a1", target: "v1", emoji: "", at: 10, remove: false, vote: 0 }))
    for (let i = 0; i < HISTORY_MAX_PER_CHANNEL; i++) appendHistory(c, SALA, entrada(seq++, ANA, { t: "message", id: `m${i}`, body: "x", sentAt: seq }))
    expect(c.history[SALA]?.some((e) => e.payload["id"] === "v1")).toBe(false)
  })

  it("um atacante que manda 20 000 votos para alvos inventados não faz crescer o cofre, e o voto verdadeiro fica", () => {
    // Review of 1.3.19, C1: the vote that counts was kept outside every cap, and the
    // target is free text. 20 000 invented targets left 20 000 entries in every vault.
    const c = newVaultContents()
    let seq = 1
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "message", id: "v1", body: "?", sentAt: 1, poll: { question: "?", options: ["a", "b"] } }))
    appendHistory(c, SALA, entrada(seq++, ANA, { t: "post.reaction", id: "a1", target: "v1", emoji: "", at: 10, remove: false, vote: 1 }))
    const ATACANTE = "@mau:s"
    for (let i = 0; i < 20_000; i++) {
      appendHistory(c, SALA, entrada(seq++, ATACANTE, { t: "post.reaction", id: `x${i}`, target: `inventado-${i}`, emoji: "", at: seq, remove: false, vote: 0 }))
    }
    const votos = (c.estadoDoCanal[SALA] ?? []).filter((e) => e.payload.t === "post.reaction" && typeof e.payload["vote"] === "number")
    expect(votos.length).toBeLessThanOrEqual(5_000)
    expect(dobrarVotos(entradasDoCanal(c, SALA)).get("v1")?.get(ANA)).toBe(1)
  }, 60_000)

  it("o voto que conta é o último antes do prazo, nunca um voto tardio", () => {
    // Review of 1.3.19, I1: the vault kept the highest `at` even after the close, and the
    // screen refused it (`votosDe` in the UI). After a reload the voter had no vote.
    const c = newVaultContents()
    let seq = 1
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "message", id: "v1", body: "?", sentAt: 1, poll: { question: "?", options: ["a", "b"], closesAt: 100 } }))
    appendHistory(c, SALA, entrada(seq++, ANA, { t: "post.reaction", id: "a-50", target: "v1", emoji: "", at: 50, remove: false, vote: 1 }))
    appendHistory(c, SALA, entrada(seq++, ANA, { t: "post.reaction", id: "a-500", target: "v1", emoji: "", at: 500, remove: false, vote: 0 }))
    // Past the vote cap, so the vault has to choose.
    for (let i = 0; i < 5_100; i++) {
      appendHistory(c, SALA, entrada(seq++, `@p${i}:s`, { t: "post.reaction", id: `x${i}`, target: `outra-${i}`, emoji: "", at: seq, remove: false, vote: 0 }))
    }
    const ids = (c.estadoDoCanal[SALA] ?? []).map((e) => e.payload["id"])
    expect(ids).toContain("a-50")
  }, 60_000)

  it("um fecho à mão antes do prazo guarda o voto anterior a ele, seja quem for que fechou", () => {
    // Whether a moderator's close counts depends on roles the vault does not see: it keeps
    // the vote that counts under each close it holds.
    const c = newVaultContents()
    let seq = 1
    appendHistory(c, SALA, entrada(seq++, BRUNO, { t: "message", id: "v1", body: "?", sentAt: 1, poll: { question: "?", options: ["a", "b"] } }))
    appendHistory(c, SALA, entrada(seq++, ANA, { t: "post.reaction", id: "a-50", target: "v1", emoji: "", at: 50, remove: false, vote: 1 }))
    appendHistory(c, SALA, entrada(seq++, ANA, { t: "post.reaction", id: "a-500", target: "v1", emoji: "", at: 500, remove: false, vote: 0 }))
    appendHistory(c, SALA, entrada(seq++, "@moderador:s", { t: "edit", target: "v1", body: "?", editedAt: 100, closePoll: true }))
    for (let i = 0; i < 5_100; i++) {
      appendHistory(c, SALA, entrada(seq++, `@p${i}:s`, { t: "post.reaction", id: `x${i}`, target: `outra-${i}`, emoji: "", at: seq, remove: false, vote: 0 }))
    }
    const ids = (c.estadoDoCanal[SALA] ?? []).map((e) => e.payload["id"])
    expect(ids).toContain("a-50")
    expect(ids).toContain("a-500")
  }, 60_000)
})
