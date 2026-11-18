import { describe, expect, it } from "vitest"
import { appendBounded, juntarLote } from "./App.js"
import type { ChatMessage } from "./types.js"
import { votosDe } from "./lib/votacoes.js"

/**
 * Poll votes in the in-memory list (17/11/2026).
 *
 * The list on screen is capped at 400 per channel, and what is not conversation
 * leaves first. A vote is a `post.reaction`, not conversation: in a busy channel
 * every new message pushed out the oldest vote, the poll card stayed and its
 * count went back to zero, the voter's own mark included. Opening the polls page
 * brings the whole vault into the list, and the very next message trimmed it
 * back to 400, taking every vote at once.
 */
const CANAL = "!sala:casa.pt"
const ANA = "@ana:casa.pt"
const BRUNO = "@bruno:casa.pt"

const votacao = (): ChatMessage =>
  ({
    channel: CANAL,
    seq: 1,
    sender: BRUNO,
    payload: { t: "message", id: "v1", body: "Pizza ou sushi?", sentAt: 1, attachments: [], mentions: [], links: [], poll: { question: "Pizza ou sushi?", options: ["Pizza", "Sushi"] } },
  }) as unknown as ChatMessage
const voto = (seq: number, sender: string, option: number): ChatMessage =>
  ({ channel: CANAL, seq, sender, payload: { t: "post.reaction", id: `voto-${seq}`, target: "v1", emoji: "", at: seq, remove: false, vote: option } }) as unknown as ChatMessage
const mensagem = (seq: number): ChatMessage =>
  ({ channel: CANAL, seq, sender: BRUNO, payload: { t: "message", id: `m${seq}`, body: `m${seq}`, sentAt: seq, attachments: [], mentions: [], links: [] } }) as unknown as ChatMessage

describe("os votos na lista em memória", () => {
  it("as mensagens que chegam a seguir não levam os votos", () => {
    let lista: ChatMessage[] = [votacao(), voto(2, ANA, 1), voto(3, BRUNO, 0)]
    // Two over the cap: the poll card is still in the list.
    for (let seq = 10; seq < 10 + 399; seq++) lista = appendBounded(lista, mensagem(seq))
    expect(lista.some((m) => m.payload.id === "v1")).toBe(true)
    const escolhas = votosDe(lista).get("v1")
    expect(escolhas?.get(ANA)).toBe(1)
    expect(escolhas?.get(BRUNO)).toBe(0)
  })

  it("depois de trazer o cofre inteiro, a mensagem seguinte não leva os votos todos de uma vez", () => {
    // What `trazerTudoDoCofre` leaves in memory: the whole vault, past the cap.
    // A hundred older messages, the poll in the middle with thirty voters, then the rest.
    const doCofre: ChatMessage[] = []
    for (let seq = 1000; seq < 1100; seq++) doCofre.push(mensagem(seq))
    doCofre.push({ ...votacao(), seq: 1100 })
    const eleitores = Array.from({ length: 30 }, (_, i) => `@p${i}:casa.pt`)
    eleitores.forEach((quem, i) => doCofre.push(voto(1101 + i, quem, i % 2)))
    doCofre.push(voto(1131, ANA, 1), voto(1132, BRUNO, 0))
    for (let seq = 1200; seq < 1480; seq++) doCofre.push(mensagem(seq))
    const lista = juntarLote(doCofre, [mensagem(2000)])
    expect(lista.some((m) => m.payload.id === "v1")).toBe(true)
    const escolhas = votosDe(lista).get("v1")
    expect(escolhas?.get(ANA)).toBe(1)
    expect(escolhas?.get(BRUNO)).toBe(0)
    expect(escolhas?.size).toBe(32)
  })

  it("20 000 votos para alvos inventados não fazem crescer a lista, e o voto verdadeiro fica", () => {
    // Review of 1.3.19, C1: votes never left the list and did not count toward its bound.
    let lista: ChatMessage[] = [votacao(), voto(2, ANA, 1)]
    for (let i = 0; i < 20_000; i++) {
      lista = appendBounded(lista, { channel: CANAL, seq: 10 + i, sender: "@mau:casa.pt", payload: { t: "post.reaction", id: `x${i}`, target: `inventado-${i}`, emoji: "", at: 10 + i, remove: false, vote: 0 } } as unknown as ChatMessage)
    }
    expect(lista.filter((m) => m.payload.t === "post.reaction").length).toBeLessThanOrEqual(5_000)
    expect(votosDe(lista).get("v1")?.get(ANA)).toBe(1)
  }, 120_000)
})
