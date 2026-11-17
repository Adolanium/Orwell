import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../types.js"
import { semVotacoesDeSalasApagadas } from "./votacoes.js"

/**
 * Deleting a room deletes its polls, for everyone (17/11/2026). The other
 * messages of the deleted room still read in the default room.
 */
const mensagem = (id: string, room: string | undefined, poll = false): ChatMessage =>
  ({
    channel: "!c:s",
    sender: "@a:s",
    payload: {
      t: "message",
      id,
      sentAt: 1,
      body: id,
      attachments: [],
      mentions: [],
      ...(room !== undefined ? { room } : {}),
      ...(poll ? { poll: { question: "Jantar?", options: ["sim", "não"] } } : {}),
    },
  }) as unknown as ChatMessage

describe("as votações de uma sala eliminada", () => {
  const todas = [
    mensagem("v-apagada", "forum-votos", true),
    mensagem("texto-da-apagada", "forum-votos"),
    mensagem("v-viva", "forum-outra", true),
    mensagem("v-por-omissao", undefined, true),
  ]

  it("saem: a votação da sala eliminada não se lê em lado nenhum", () => {
    const ficam = semVotacoesDeSalasApagadas(todas, new Set(["forum-votos"])).map((m) => m.payload.id)
    expect(ficam).toEqual(["texto-da-apagada", "v-viva", "v-por-omissao"])
  })

  it("sem salas eliminadas, a lista é a mesma, sem cópia", () => {
    expect(semVotacoesDeSalasApagadas(todas, new Set())).toBe(todas)
  })
})
