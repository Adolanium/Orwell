import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, renderHook } from "@testing-library/react"
import { HISTORY_HOLD_CAP_MS, HISTORY_PROGRESS_WINDOW_MS, historyHoldsLock, useBloqueioAutomatico, type HistoryForLock } from "./useBloqueioAutomatico.js"

/**
 * The auto-lock and the history between devices (1.3.27). A phone left alone
 * during a long history sync locked at 15 min, and the sync stopped there until
 * someone unlocked it. The lock now waits only while the history really moves
 * (progress in the last 2 min) on a visible page, and never past 60 min of one sync.
 */

afterEach(cleanup)
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const MIN = 60_000

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state })
}
afterEach(() => setVisibility("visible"))

/** A sync that started now; `advancing` moves its progress forward with the clock. */
function sync(advancing: boolean): { history: () => HistoryForLock | null; end: () => void } {
  const startedAt = Date.now()
  let ended = false
  return {
    history: () => (ended ? null : { startedAt, progressAt: advancing ? Date.now() : startedAt }),
    end: () => {
      ended = true
    },
  }
}

function mount(history: () => HistoryForLock | null, active = true) {
  const aoBloquear = vi.fn()
  const view = renderHook(
    (p: { historyActive: boolean }) => useBloqueioAutomatico({ minutos: 15, activo: true, emChamada: false, aoBloquear, history, historyActive: p.historyActive }),
    { initialProps: { historyActive: active } },
  )
  return { aoBloquear, ...view }
}

describe("historyHoldsLock", () => {
  const now = 10 * 60 * MIN
  it("holds while the history moved in the last 2 min, on a visible page, under the cap", () => {
    expect(historyHoldsLock({ startedAt: now - 30 * MIN, progressAt: now - HISTORY_PROGRESS_WINDOW_MS + 1 }, now, true)).toBe("hold")
  })
  it("does not hold a stopped sync, a hidden page, or no sync", () => {
    expect(historyHoldsLock({ startedAt: now - 30 * MIN, progressAt: now - HISTORY_PROGRESS_WINDOW_MS }, now, true)).toBe(null)
    expect(historyHoldsLock({ startedAt: now - 30 * MIN, progressAt: now }, now, false)).toBe(null)
    expect(historyHoldsLock(null, now, true)).toBe(null)
  })
  it("says the cap when one sync passed 60 min", () => {
    expect(historyHoldsLock({ startedAt: now - HISTORY_HOLD_CAP_MS, progressAt: now }, now, true)).toBe("cap")
  })
})

describe("useBloqueioAutomatico with the history between devices", () => {
  it("a sync that moves does not lock", () => {
    const { history } = sync(true)
    const { aoBloquear } = mount(history)
    vi.advanceTimersByTime(45 * MIN)
    expect(aoBloquear).not.toHaveBeenCalled()
  })

  it("a stopped sync locks at 15 min, for inactivity", () => {
    const { history } = sync(false)
    const { aoBloquear } = mount(history)
    vi.advanceTimersByTime(15 * MIN - 1000)
    expect(aoBloquear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(aoBloquear).toHaveBeenCalledTimes(1)
    expect(aoBloquear).toHaveBeenCalledWith("inactivity")
  })

  it("the 60 min cap locks a sync that still moves", () => {
    const { history } = sync(true)
    const { aoBloquear } = mount(history)
    vi.advanceTimersByTime(HISTORY_HOLD_CAP_MS - MIN)
    expect(aoBloquear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2 * MIN)
    expect(aoBloquear).toHaveBeenCalledTimes(1)
    expect(aoBloquear).toHaveBeenCalledWith("sync-cap")
  })

  it("a hidden page locks even with a sync that moves", () => {
    const { history } = sync(true)
    setVisibility("hidden")
    const { aoBloquear } = mount(history)
    vi.advanceTimersByTime(15 * MIN + 1000)
    expect(aoBloquear).toHaveBeenCalledTimes(1)
  })

  it("when the sync ends, the 15 min count starts again", () => {
    const { history, end } = sync(true)
    const { aoBloquear, rerender } = mount(history)
    vi.advanceTimersByTime(30 * MIN)
    end()
    rerender({ historyActive: false })
    vi.advanceTimersByTime(14 * MIN)
    expect(aoBloquear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2 * MIN)
    expect(aoBloquear).toHaveBeenCalledTimes(1)
  })
})
