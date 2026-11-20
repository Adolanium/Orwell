import { moradaDeTeste } from "../../testes/moradas.js"
import { lembrarFichasDosCanais } from "../lib/tipoDoCanal.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { BUZZ_MAX_AGE_MS } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"

const tocados = vi.hoisted(() => [] as string[])
vi.mock("../lib/sounds.js", () => ({
  playSound: (tipo: string) => {
    tocados.push(tipo)
    return true
  },
}))

import { useCotoveladaPorVer, type OpcoesDaCotoveladaPorVer } from "./useCotoveladaPorVer.js"

/**
 * A nudge that arrives (20/11/2026): it plays its own sound and the
 * Friends button turns red until the person opens Friends.
 *
 * Before this, the sound played only when the nudged conversation was open on
 * screen, which is the one case where you least need it.
 */

const DM = moradaDeTeste("directa abc", "s")
const DM_OUTRA = moradaDeTeste("directa outra", "s")
const GRUPO = "!geral:s"
const EU = "@eu:s"
const ELA = "@ela:s"

beforeEach(() => {
  tocados.length = 0
  lembrarFichasDosCanais({ [DM]: { tipo: "directa" }, [DM_OUTRA]: { tipo: "directa" } })
})
afterEach(cleanup)

type Ouvinte = (event: { channel: string; from: string; at: number }) => void

function ponte(): { bridge: EnclaveBridge; emitir: Ouvinte } {
  const ouvintes = new Set<Ouvinte>()
  const bridge = {
    on: {
      buzz: (handler: Ouvinte) => {
        ouvintes.add(handler)
        return () => ouvintes.delete(handler)
      },
    },
  } as unknown as EnclaveBridge
  return {
    bridge,
    emitir: (event) => {
      for (const ouvinte of ouvintes) ouvinte(event)
    },
  }
}

function montar(inicio: OpcoesDaCotoveladaPorVer) {
  const { bridge, emitir } = ponte()
  const hook = renderHook((opcoes: OpcoesDaCotoveladaPorVer) => useCotoveladaPorVer(bridge, opcoes), { initialProps: inicio })
  const receber = (canal = DM, de = ELA, at = Date.now()): void => act(() => emitir({ channel: canal, from: de, at }))
  return { ...hook, receber }
}

const nasComunidades: OpcoesDaCotoveladaPorVer = { eu: EU, emAmigos: false, directaAberta: null }

describe("receber uma cotovelada", () => {
  it("toca o som da cotovelada, mesmo com outra coisa no ecrã", () => {
    const { receber } = montar(nasComunidades)
    receber()
    expect(tocados).toEqual(["buzz"])
  })

  it("acende o botão Amigos, e diz quem a deu", () => {
    const { result, receber } = montar(nasComunidades)
    expect(result.current).toBeNull()
    receber()
    expect(result.current).toEqual({ de: ELA })
  })

  it("abrir os Amigos apaga o vermelho", () => {
    const { result, receber, rerender } = montar(nasComunidades)
    receber()
    rerender({ eu: EU, emAmigos: true, directaAberta: null })
    expect(result.current).toBeNull()
  })

  it("com a própria conversa aberta nos Amigos, não acende: a pessoa já está lá", () => {
    const { result, receber } = montar({ eu: EU, emAmigos: true, directaAberta: DM })
    receber()
    expect(tocados).toEqual(["buzz"])
    expect(result.current).toBeNull()
  })

  it("nos Amigos com outra conversa aberta acende, e abrir a conversa do toque apaga", () => {
    const { result, receber, rerender } = montar({ eu: EU, emAmigos: true, directaAberta: DM_OUTRA })
    receber()
    expect(result.current).toEqual({ de: ELA })
    rerender({ eu: EU, emAmigos: true, directaAberta: DM })
    expect(result.current).toBeNull()
  })

  it("a de outro aparelho da própria conta não toca nem acende", () => {
    const { result, receber } = montar(nasComunidades)
    receber(DM, EU)
    expect(tocados).toEqual([])
    expect(result.current).toBeNull()
  })

  it("num canal de grupo não conta", () => {
    const { result, receber } = montar(nasComunidades)
    receber(GRUPO)
    expect(tocados).toEqual([])
    expect(result.current).toBeNull()
  })

  it("uma cotovelada velha não se sente", () => {
    const { result, receber } = montar(nasComunidades)
    receber(DM, ELA, Date.now() - BUZZ_MAX_AGE_MS - 1000)
    expect(tocados).toEqual([])
    expect(result.current).toBeNull()
  })
})
