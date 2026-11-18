import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { REPETIR_IDADES_MS, useIdadesDosVotantes, type IdadeLida } from "./useIdadesDosVotantes.js"

const CANAL = "!sala:casa.pt"
const EU = "@eu:casa.pt"
const ANTIGA = Date.UTC(2026, 9, 1)

const voto = (sender: string) => ({ channel: CANAL, sender, payload: { t: "post.reaction", vote: 0 } })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("as idades dos votantes", () => {
  it("sem ligação não pergunta; ligada, uma pergunta sem resposta repete-se, e só a resposta fica (C1)", async () => {
    let tentativas = 0
    const ler = vi.fn(async (): Promise<IdadeLida> => {
      tentativas += 1
      // The first one runs into a reconnect: the bridge rejects ("no answer yet").
      if (tentativas === 1) throw new Error("account age: no answer yet")
      return { regra: true, criadaEm: ANTIGA }
    })
    const { result, rerender } = renderHook((props: { connection: string }) =>
      useIdadesDosVotantes({ ler, active: CANAL, address: EU, messages: [], connection: props.connection }), { initialProps: { connection: "connecting" } })
    await act(async () => {})
    expect(ler).not.toHaveBeenCalled()

    rerender({ connection: "online" })
    await act(async () => {})
    expect(ler).toHaveBeenCalledTimes(1)
    // "No answer" is not "unknown": nothing kept, the rule not decided.
    expect(result.current.idades.has(EU)).toBe(false)
    expect(result.current.regraDaIdade).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REPETIR_IDADES_MS)
    })
    expect(ler).toHaveBeenCalledTimes(2)
    expect(result.current.idades.get(EU)).toBe(ANTIGA)
    expect(result.current.regraDaIdade).toBe(true)
  })

  it("cem votantes dão uma só mudança de estado, não cem (M8)", async () => {
    const votantes = Array.from({ length: 100 }, (_, i) => `@v${i}:casa.pt`)
    // The answers come one by one, a millisecond apart, as they do over a real socket.
    let ordem = 0
    const ler = vi.fn(
      (): Promise<IdadeLida> => new Promise((resolve) => setTimeout(() => resolve({ regra: true, criadaEm: ANTIGA }), ++ordem)),
    )
    const vistas = new Set<ReadonlyMap<string, number | null>>()
    const { result } = renderHook(() => {
      const lidas = useIdadesDosVotantes({ ler, active: CANAL, address: EU, messages: votantes.map(voto), connection: "online" })
      vistas.add(lidas.idades)
      return lidas
    })
    for (let ms = 0; ms <= 110; ms++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
    }
    expect(result.current.idades.size).toBe(101)
    // The empty map, then the full one: nothing in between.
    expect(vistas.size).toBe(2)
  })
})
