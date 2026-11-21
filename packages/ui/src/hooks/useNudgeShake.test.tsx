import { moradaDeTeste } from "../../testes/moradas.js"
import { lembrarFichasDosCanais } from "../lib/tipoDoCanal.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { BUZZ_MAX_AGE_MS } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"
import { useNudgeShake } from "./useNudgeShake.js"

/**
 * A nudge that arrives shakes the screen, whatever is on it (21/11/2026: both
 * sides shake and hear it, on every device of both accounts).
 *
 * Before, only the open conversation shook (`useBuzz`): a nudge to someone in
 * Communities, in Settings or on another device of the sender's account played
 * a sound, or nothing, and moved nothing.
 */

const DM = moradaDeTeste("directa abc", "s")
const DM_OUTRA = moradaDeTeste("directa outra", "s")
const GRUPO = "!geral:s"
const EU = "@eu:s"
const ELA = "@ela:s"

type Listener = (event: { channel: string; from: string; at: number }) => void

function bridgeWithBuzz(): { bridge: EnclaveBridge; emit: Listener } {
  const listeners = new Set<Listener>()
  const bridge = {
    on: {
      buzz: (handler: Listener) => {
        listeners.add(handler)
        return () => listeners.delete(handler)
      },
    },
  } as unknown as EnclaveBridge
  return { bridge, emit: (event) => listeners.forEach((listener) => listener(event)) }
}

beforeEach(() => {
  vi.useFakeTimers()
  lembrarFichasDosCanais({ [DM]: { tipo: "directa" }, [DM_OUTRA]: { tipo: "directa" } })
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

function mount() {
  const { bridge, emit } = bridgeWithBuzz()
  const hook = renderHook(() => useNudgeShake(bridge))
  const receive = (channel = DM, from = ELA, at = Date.now()): void => act(() => emit({ channel, from, at }))
  return { ...hook, receive }
}

describe("a nudge shakes the screen on every device", () => {
  it("shakes whatever conversation is open, and stops on its own", () => {
    const { result, receive } = mount()
    receive(DM_OUTRA)
    expect(result.current).toBe(true)
    act(() => vi.advanceTimersByTime(2_000))
    expect(result.current).toBe(false)
  })

  it("a nudge from another device of my own account shakes too: it is the sender's side", () => {
    const { result, receive } = mount()
    receive(DM, EU)
    expect(result.current).toBe(true)
  })

  it("a nudge in a group channel does not shake", () => {
    const { result, receive } = mount()
    receive(GRUPO)
    expect(result.current).toBe(false)
  })

  it("an old nudge is not felt", () => {
    const { result, receive } = mount()
    receive(DM, ELA, Date.now() - BUZZ_MAX_AGE_MS - 1)
    expect(result.current).toBe(false)
  })

  it("with reduced motion it still shakes, for twice as long", () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    try {
      const { result, receive } = mount()
      receive()
      act(() => vi.advanceTimersByTime(1_200))
      expect(result.current).toBe(true)
      act(() => vi.advanceTimersByTime(600))
      expect(result.current).toBe(false)
    } finally {
      window.matchMedia = original
    }
  })

  it("never steals focus", () => {
    const { receive } = mount()
    const box = document.createElement("input")
    document.body.append(box)
    box.focus()
    receive()
    expect(document.activeElement).toBe(box)
    box.remove()
  })
})
