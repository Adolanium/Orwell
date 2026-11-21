import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { useAutoresNovos, useContaNova } from "./useContaNova.js"

afterEach(cleanup)

/** The interface's side of the new-account limits (1.3.26). */
describe("useContaNova", () => {
  it("lê os limites quando liga, e diz a fase", async () => {
    const agora = Date.now()
    const ler = vi.fn(async () => ({ ate24h: agora + 3_600_000, ate72h: agora + 7_200_000, intervaloAte24hS: 30, intervaloAte72hS: 10 }))
    const { result, rerender } = renderHook(({ ligacao }) => useContaNova(ler, ligacao), { initialProps: { ligacao: "connecting" } })
    expect(result.current.fase).toBeNull()
    expect(ler).not.toHaveBeenCalled()
    rerender({ ligacao: "online" })
    await waitFor(() => expect(result.current.fase).toBe("24h"))
    expect(result.current.contaNova?.intervaloAte24hS).toBe(30)
  })

  it("um anfitrião sem a pergunta: nada", () => {
    const { result } = renderHook(() => useContaNova(undefined, "online"))
    expect(result.current.fase).toBeNull()
  })
})

describe("useAutoresNovos", () => {
  it("pergunta uma vez por autor e devolve os que são novos; enquanto não sabe, conta como novo", async () => {
    const ler = vi.fn(async (address: string) => (address === "@nova:s" ? Date.now() + 3_600_000 : null))
    const linhas = [{ sender: "@nova:s" }, { sender: "@velha:s" }, { sender: "@nova:s" }]
    const { result } = renderHook(() => useAutoresNovos(ler, true, linhas))
    expect(result.current.has("@velha:s")).toBe(true)
    await waitFor(() => expect(result.current.has("@velha:s")).toBe(false))
    expect(result.current.has("@nova:s")).toBe(true)
    expect(ler).toHaveBeenCalledTimes(2)
  })

  it("fora da sala comum, ou sem a pergunta, ninguém é novo", () => {
    const ler = vi.fn(async () => Date.now() + 1000)
    const fora = renderHook(() => useAutoresNovos(ler, false, [{ sender: "@a:s" }]))
    expect(fora.result.current.size).toBe(0)
    const sem = renderHook(() => useAutoresNovos(undefined, true, [{ sender: "@a:s" }]))
    expect(sem.result.current.size).toBe(0)
    expect(ler).not.toHaveBeenCalled()
  })

  it("uma pergunta que falha conta como conta antiga", async () => {
    const ler = vi.fn(async () => {
      throw new Error("sem resposta")
    })
    const { result } = renderHook(() => useAutoresNovos(ler, true, [{ sender: "@a:s" }]))
    await waitFor(() => expect(result.current.has("@a:s")).toBe(false))
  })
})
