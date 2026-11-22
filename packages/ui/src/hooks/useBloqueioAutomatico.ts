import { useEffect, useRef } from "react"

/**
 * Actions that count as activity: key, mouse and touch.
 *
 * `pointermove` is here on purpose. Someone reading a long conversation without
 * typing moves the mouse and wheel, and closing the vault mid-read would punish them
 * for being there.
 */
export const GESTOS_DE_USO = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const

/** Why the vault locked, for the diagnostic log. `manual` is "Lock now". */
export type AutoLockReason = "inactivity" | "sync-cap" | "manual"

/** The history sync, as the auto-lock reads it: when it started, and when it last moved. */
export interface HistoryForLock {
  startedAt: number
  progressAt: number
}

/** The history moved this recently: the auto-lock waits. */
export const HISTORY_PROGRESS_WINDOW_MS = 2 * 60_000
/** At most this long per sync: past it, the auto-lock locks as always. */
export const HISTORY_HOLD_CAP_MS = 60 * 60_000
/** While the history holds the lock, how often the timer looks again. */
const HISTORY_CHECK_MS = 30_000

/**
 * Whether a history sync holds the auto-lock now. `hold`: it moved in the last
 * `HISTORY_PROGRESS_WINDOW_MS`, the page is visible, and the sync is younger than
 * `HISTORY_HOLD_CAP_MS`. `cap`: the sync is older than the cap (the reason in the
 * log). `null`: no hold.
 */
export function historyHoldsLock(history: HistoryForLock | null, now: number, visible: boolean): "hold" | "cap" | null {
  if (!history) return null
  if (now - history.startedAt >= HISTORY_HOLD_CAP_MS) return "cap"
  if (!visible || now - history.progressAt >= HISTORY_PROGRESS_WINDOW_MS) return null
  return "hold"
}

/**
 * "Lock on its own": closes the vault after `minutes` without use.
 *
 * **One timer only, not one per gesture.** A `pointermove` fires dozens of
 * times per second; restarting a `setTimeout` on each one was work for nothing.
 * The gesture just writes the time (`ultimo`), and the timer, when it wakes,
 * measures what passed: if it hasn't hit the limit, it sleeps the rest.
 *
 * **Never during a call.** On a voice call alone no one touches the keyboard
 * for an hour, and closing the vault would boot them from the conversation. End
 * of call counts as use: time starts counting from there.
 *
 * **After the laptop sleeps.** The `setTimeout` doesn't run while the machine
 * sleeps and wakes late. Because it measures by time, not by ticks, it wakes
 * and locks right away. And the tab that becomes visible again checks at once,
 * so the vault doesn't stay open until the next tick.
 *
 * **The history between devices (1.3.27).** A phone left alone during a long
 * history sync locked at 15 min, and the sync stopped there: with the vault
 * locked nothing asks for the next part, and nothing counts as a failure. The
 * lock now waits while the history really moves (`historyHoldsLock`): progress
 * in the last `HISTORY_PROGRESS_WINDOW_MS`, the page visible, and never more than
 * `HISTORY_HOLD_CAP_MS` for one sync. A stopped sync, a hidden page or the cap
 * lock as always. The end of the sync counts as use, like the end of a call.
 * The accepted risk is in `docs/THREAT-MODEL.md`.
 *
 * `aoBloquear` is the same path as "Sign out" (see `App.tsx`), with the reason.
 */
export function useBloqueioAutomatico({
  minutos,
  activo,
  emChamada,
  aoBloquear,
  history,
  historyActive = false,
}: {
  /** 0 means "Never". */
  minutos: number
  /** Only when the vault is open: at the gate there is nothing to close. */
  activo: boolean
  emChamada: boolean
  aoBloquear: (reason: AutoLockReason) => void
  /** The history sync now, read when the timer wakes. Absent: no history hold. */
  history?: () => HistoryForLock | null
  /** A history sync is running. Its start and its end are both use. */
  historyActive?: boolean
}): void {
  const aoBloquearRef = useRef(aoBloquear)
  aoBloquearRef.current = aoBloquear
  const emChamadaRef = useRef(emChamada)
  emChamadaRef.current = emChamada
  const historyRef = useRef(history)
  historyRef.current = history
  const ultimo = useRef(Date.now())

  // Joining and leaving a call are both use. Without this, someone hanging up
  // after an hour of voice chat would see the vault lock the instant after.
  // The same for the end of a history sync.
  useEffect(() => {
    ultimo.current = Date.now()
  }, [emChamada, historyActive])

  useEffect(() => {
    if (!activo || minutos <= 0 || typeof window === "undefined") return
    const limite = minutos * 60_000
    ultimo.current = Date.now()
    let temporizador: ReturnType<typeof setTimeout> | null = null
    let fechado = false

    const marcar = (): void => {
      ultimo.current = Date.now()
    }
    const agendar = (ms: number): void => {
      if (temporizador) clearTimeout(temporizador)
      temporizador = setTimeout(verificar, Math.max(1000, ms))
    }
    function verificar(): void {
      if (fechado) return
      if (emChamadaRef.current) {
        marcar()
        agendar(limite)
        return
      }
      const agora = Date.now()
      const passou = agora - ultimo.current
      if (passou >= limite) {
        const hold = historyHoldsLock(historyRef.current?.() ?? null, agora, document.visibilityState === "visible")
        if (hold === "hold") {
          // Look again soon: the hold ends when the history stops moving.
          agendar(HISTORY_CHECK_MS)
          return
        }
        fechado = true
        aoBloquearRef.current(hold === "cap" ? "sync-cap" : "inactivity")
        return
      }
      agendar(limite - passou)
    }
    const aoVoltar = (): void => {
      if (document.visibilityState === "visible") verificar()
    }

    agendar(limite)
    for (const gesto of GESTOS_DE_USO) window.addEventListener(gesto, marcar, { capture: true, passive: true })
    document.addEventListener("visibilitychange", aoVoltar)
    return () => {
      fechado = true
      if (temporizador) clearTimeout(temporizador)
      for (const gesto of GESTOS_DE_USO) window.removeEventListener(gesto, marcar, { capture: true })
      document.removeEventListener("visibilitychange", aoVoltar)
    }
  }, [activo, minutos])
}
