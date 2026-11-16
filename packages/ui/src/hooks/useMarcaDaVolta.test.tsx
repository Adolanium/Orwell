import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { ConnectionState, ContadoresDeDiagnostico, EnclaveBridge } from "../bridge.js"
import { clearDiagnostics, diagnosticsSnapshot } from "../lib/diagnostics.js"
import { JANELA_DA_VOLTA_MS, detalheDaVolta, useMarcaDaVolta } from "./useMarcaDaVolta.js"

/**
 * The mark of the return to the foreground in the diagnostic log (1.3.15): the
 * window after a return, with the counters' change, the connection, and never
 * content.
 */

let visibilidade: DocumentVisibilityState = "visible"
beforeEach(() => {
  vi.useFakeTimers()
  clearDiagnostics()
  visibilidade = "visible"
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidade })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function mudar(para: DocumentVisibilityState): void {
  visibilidade = para
  document.dispatchEvent(new Event("visibilitychange"))
}

function ponte(leituras: ContadoresDeDiagnostico[]): EnclaveBridge {
  let i = 0
  return { diagnostico: { contadores: async () => leituras[Math.min(i++, leituras.length - 1)]! } } as unknown as EnclaveBridge
}

const marcas = (): string[] => diagnosticsSnapshot().filter((e) => e.code === "foreground").map((e) => e.detail ?? "")

describe("a marca da volta ao primeiro plano", () => {
  it("dez segundos depois de voltar, o registo diz as gravações do cofre, os temporizadores atrasados, o principal e a ligação", async () => {
    const bridge = ponte([
      { gravacoesDoCofre: 10, temporizadoresAtrasados: 2, maiorAtrasoMs: 500, principalPresoMs: 0 },
      { gravacoesDoCofre: 13, temporizadoresAtrasados: 7, maiorAtrasoMs: 61_000, principalPresoMs: 4_200 },
    ])
    const { rerender } = renderHook(({ ligacao }: { ligacao: ConnectionState }) => useMarcaDaVolta(bridge, true, ligacao), {
      initialProps: { ligacao: "online" },
    })
    mudar("hidden")
    await act(async () => {
      vi.advanceTimersByTime(12 * 60_000)
    })
    mudar("visible")
    rerender({ ligacao: "reconnecting" })
    rerender({ ligacao: "online" })
    expect(marcas()).toEqual([])

    await act(async () => {
      vi.advanceTimersByTime(JANELA_DA_VOLTA_MS)
    })

    expect(marcas()).toHaveLength(1)
    const marca = marcas()[0]!
    expect(marca).toContain("escondida=720s")
    expect(marca).toContain("cofre=3")
    expect(marca).toContain("atrasados=5")
    expect(marca).toContain("maiorAtraso=61s")
    expect(marca).toContain("principal=4200ms")
    expect(marca).toContain("ligacao=caiu-e-voltou")
  })

  it("sem voltar de escondida não há marca, e esconder outra vez dentro da janela fecha-a já", async () => {
    const bridge = ponte([{ gravacoesDoCofre: 0, temporizadoresAtrasados: 0, maiorAtrasoMs: 0 }])
    renderHook(() => useMarcaDaVolta(bridge, true, "online"))
    mudar("visible")
    await act(async () => {
      vi.advanceTimersByTime(JANELA_DA_VOLTA_MS)
    })
    expect(marcas()).toEqual([])

    mudar("hidden")
    mudar("visible")
    mudar("hidden")
    await act(async () => {
      await Promise.resolve()
    })
    expect(marcas()).toHaveLength(1)
    expect(marcas()[0]).toContain("ligacao=estavel")
  })

  it("a linha só tem números e estados: nada de conteúdo", () => {
    const linha = detalheDaVolta({
      escondidaMs: 5_000,
      presaMs: 4_870.4,
      tarefasLongas: 12,
      contadores: { gravacoesDoCofre: 1, temporizadoresAtrasados: 0, maiorAtrasoMs: 0 },
      respostaMs: 2_100,
      ligacao: "estavel",
    })
    expect(linha).toBe("escondida=5s presa=4870ms longas=12 cofre=1 atrasados=0 resposta=2100ms ligacao=estavel")
  })
})
