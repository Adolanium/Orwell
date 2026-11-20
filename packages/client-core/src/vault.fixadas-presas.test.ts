import { describe, expect, it } from "vitest"
import { appendHistory, newVaultContents, type StoredChatMessage } from "./vault.js"
import { FIXADAS_PRESAS_MAX, fixadasPresas, guardarApagada } from "./fixadas.js"

/**
 * A pinned message stays in the vault (fixadas-topo, 20/11/2026).
 *
 * The pin list itself lives in `channelRooms` and never depended on the history. The
 * ORIGINAL message did: the cap (`HISTORY_MAX_PER_CHANNEL`) moved it to the archive,
 * and the bar at the top of the room had nothing to jump to. The same rule as an open
 * poll: the cap takes the next oldest message instead.
 */

const CANAL = "!canal:s"
const ANA = "@ana:s"
const BRUNO = "@bruno:s"

const entrada = (seq: number, sender: string, id: string): StoredChatMessage => ({
  seq,
  sender,
  at: seq,
  payload: { t: "message", id, body: `mensagem ${seq}`, sentAt: seq },
})
const noCofre = (c: ReturnType<typeof newVaultContents>, id: string): boolean => (c.history[CANAL] ?? []).some((e) => e.payload["id"] === id)
const arquivada = (c: ReturnType<typeof newVaultContents>, id: string): boolean => (c.porArquivar?.[CANAL] ?? []).some((e) => e.payload["id"] === id)

function fixar(c: ReturnType<typeof newVaultContents>, sala: string, lista: { id: string; sender: string; pinnedAt?: number }[]): void {
  const salas = (c.channelRooms[CANAL] ??= {})
  salas[sala] = {
    at: 1,
    payload: {
      t: "channel.meta",
      room: sala,
      pinned: lista.map((f) => ({ id: f.id, sender: f.sender, body: "", sentAt: 1, pinnedAt: f.pinnedAt ?? 1, pinnedBy: ANA })),
    },
  } as never
}

describe("uma mensagem fixada fica no cofre", () => {
  it("sala com 500 mensagens e a fixada na 10.ª: fica no cofre; as vizinhas vão para o arquivo", () => {
    const c = newVaultContents()
    for (let seq = 1; seq <= 9; seq++) appendHistory(c, CANAL, entrada(seq, ANA, `m${seq}`))
    appendHistory(c, CANAL, entrada(10, BRUNO, "m10"))
    fixar(c, "geral", [{ id: "m10", sender: BRUNO }])
    for (let seq = 11; seq <= 500; seq++) appendHistory(c, CANAL, entrada(seq, ANA, `m${seq}`))
    expect(noCofre(c, "m10")).toBe(true)
    expect(arquivada(c, "m10")).toBe(false)
    expect(arquivada(c, "m9")).toBe(true)
    expect(arquivada(c, "m11")).toBe(true)
  })

  it("o mesmo id de outra pessoa não fica preso", () => {
    const c = newVaultContents()
    appendHistory(c, CANAL, entrada(1, ANA, "m1"))
    fixar(c, "geral", [{ id: "m1", sender: BRUNO }])
    for (let seq = 2; seq <= 500; seq++) appendHistory(c, CANAL, entrada(seq, ANA, `m${seq}`))
    expect(arquivada(c, "m1")).toBe(true)
  })

  it("desafixada ou eliminada, volta às regras normais", () => {
    const c = newVaultContents()
    appendHistory(c, CANAL, entrada(1, ANA, "a"))
    appendHistory(c, CANAL, entrada(2, ANA, "b"))
    fixar(c, "geral", [{ id: "a", sender: ANA }, { id: "b", sender: ANA }])
    for (let seq = 3; seq <= 450; seq++) appendHistory(c, CANAL, entrada(seq, ANA, `m${seq}`))
    expect(noCofre(c, "a")).toBe(true)
    expect(noCofre(c, "b")).toBe(true)
    fixar(c, "geral", [{ id: "b", sender: ANA }])
    guardarApagada(c, CANAL, "b", 1)
    appendHistory(c, CANAL, entrada(451, ANA, "m451"))
    appendHistory(c, CANAL, entrada(452, ANA, "m452"))
    expect(arquivada(c, "a")).toBe(true)
    expect(arquivada(c, "b")).toBe(true)
  })

  it("fixadas de todas as salas do canal contam, com tecto", () => {
    const c = newVaultContents()
    const salas = 10
    for (let s = 0; s < salas; s++) {
      fixar(
        c,
        `sala${s}`,
        Array.from({ length: 20 }, (_, i) => ({ id: `f${s}-${i}`, sender: ANA, pinnedAt: s * 100 + i })),
      )
    }
    const presas = fixadasPresas(c, CANAL)
    expect(presas.size).toBe(FIXADAS_PRESAS_MAX)
    // The newest pins stay, the oldest are the ones left out.
    expect(presas.has(`${ANA}|f9-19`)).toBe(true)
    expect(presas.has(`${ANA}|f0-0`)).toBe(false)
  })
})
