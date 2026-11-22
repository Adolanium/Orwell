import { useCallback, useEffect, useRef, useState } from "react"
import type { EnclaveBridge, HistoricoDosIrmaos } from "../bridge.js"
import type { HistoryForLock } from "./useBloqueioAutomatico.js"

/** What says the sync moved: the counts, and the part-level mark of the core. */
function progressSignature(event: HistoricoDosIrmaos): string {
  const envio = event.envio
  return [event.feitas, event.total, event.media?.feitas ?? "", envio?.mensagens.feitas ?? "", envio?.fotografias?.feitas ?? "", event.progressAt ?? ""].join("/")
}

/** A history sync runs on this device: receiving, or sending to a sibling. */
export function historyRunning(event: HistoricoDosIrmaos | null | undefined): boolean {
  return Boolean(event && (event.aTrazer || event.envio))
}

/**
 * The history sync between devices, as the auto-lock reads it (1.3.27). Above
 * the shell on purpose: locking remounts the shell, and the gate must still know
 * the vault locked mid-sync. `read` gives when the sync started and when it last
 * moved (the time this page heard it move); `active` changes only at the start
 * and the end of a sync.
 */
export function useHistoryForLock(bridge: EnclaveBridge): { active: boolean; read: () => HistoryForLock | null } {
  const state = useRef<{ startedAt: number; progressAt: number; signature: string } | null>(null)
  const [active, setActive] = useState(false)
  useEffect(() => {
    const hear = (event: HistoricoDosIrmaos | null): void => {
      const now = Date.now()
      if (!historyRunning(event)) {
        state.current = null
        setActive(false)
        return
      }
      const signature = progressSignature(event as HistoricoDosIrmaos)
      const current = state.current
      if (!current) state.current = { startedAt: now, progressAt: now, signature }
      else if (current.signature !== signature) state.current = { ...current, progressAt: now, signature }
      setActive(true)
    }
    let alive = true
    void bridge.sincronia
      ?.historico?.()
      .then((event) => {
        if (alive && state.current === null) hear(event)
      })
      .catch(() => {})
    const stop = bridge.on.historico?.(hear)
    return () => {
      alive = false
      stop?.()
    }
  }, [bridge])
  const read = useCallback((): HistoryForLock | null => {
    const current = state.current
    return current ? { startedAt: current.startedAt, progressAt: current.progressAt } : null
  }, [])
  return { active, read }
}
