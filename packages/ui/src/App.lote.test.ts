import { describe, expect, it } from "vitest"
import { appendBounded, juntarLote } from "./App.js"
import type { ChatMessage } from "./types.js"
import { juntarCopiaAoVivo } from "./lib/mesmaMensagem.js"

/**
 * A burst of live messages enters the list in one update (hotfix 1.3.12), and the
 * result is the same as one by one: order, the cap per channel, and the live copy
 * merged into one line.
 */
const CANAL = "!sala:casa.pt"

const estado = (i: number): ChatMessage =>
  ({ channel: CANAL, seq: i, sender: "@ana:casa.pt", payload: { t: "role.assign", subject: `@p${i}:casa.pt`, roles: [], assignedAt: i } }) as unknown as ChatMessage
const mensagem = (i: number, id: string, seq = i): ChatMessage =>
  ({ channel: CANAL, seq, sender: "@ana:casa.pt", payload: { t: "message", id, body: `m${i}`, sentAt: i, attachments: [], mentions: [], links: [] } }) as unknown as ChatMessage

describe("juntarLote", () => {
  it("dá a mesma lista que juntar uma a uma, numa só actualização", () => {
    const antes = Array.from({ length: 300 }, (_, i) => mensagem(i, `a${i}`))
    const lote = [
      ...Array.from({ length: 150 }, (_, i) => estado(1000 + i)),
      mensagem(2000, "nova"),
      // The server copy of a message the report already showed: one line, not two.
      mensagem(2000, "nova", 2001),
    ]
    const umaAUma = lote.reduce((lista, m) => juntarCopiaAoVivo(lista, m) ?? appendBounded(lista, m), antes)
    const emLote = juntarLote(antes, lote)
    expect(emLote).toEqual(umaAUma)
    expect(emLote.filter((m) => m.payload.id === "nova")).toHaveLength(1)
    // The cap is kept, and state leaves before conversation.
    expect(emLote.filter((m) => m.channel === CANAL).length).toBeLessThanOrEqual(400)
    expect(emLote.filter((m) => m.payload.t === "message")).toHaveLength(301)
  })

  it("um lote vazio devolve a mesma lista", () => {
    const antes = [mensagem(1, "x")]
    expect(juntarLote(antes, [])).toBe(antes)
  })
})
