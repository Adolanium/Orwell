import { useEffect, useState } from "react"

/**
 * How long the opening screen stays after entering, on top of the time it took
 * to open the vault.
 *
 * Since 12/11/2026 the gate enters as soon as the vault is open and the
 * connection goes on behind. The layout then came up while the app was still
 * connecting, with the "connecting" banner on screen. Now the opening stays
 * until BOTH this time has passed AND the session is online: whichever comes
 * last decides.
 */
export const POST_LOGIN_EXTRA_MS = 2000

/**
 * The ceiling of that wait. A connection that never comes (no network, server
 * down) must not leave the opening stuck: past this, the layout opens with the
 * "connecting" banner it already has, and the core keeps reconnecting.
 */
export const POST_LOGIN_CAP_MS = 10_000

/**
 * The values the hook reads, on each entry. Mutable only for tests: the
 * package's global test setup (`testes/lingua-de-teste.ts`) sets `capMs` to 0,
 * which turns the hold off, so the hundreds of App tests that wait for the
 * layout behind a fake bridge that never goes online keep running as before.
 * The hold's own tests set the values they measure.
 */
export const postLoginHold = { extraMs: POST_LOGIN_EXTRA_MS, capMs: POST_LOGIN_CAP_MS }

/**
 * Should the opening screen still cover the layout after entry number `entry`?
 *
 * `entry` counts the entries (0 = none yet): each new one starts its own wait,
 * and the layout stays behind the opening. Once released, an entry stays
 * released: a connection that drops later is the banner's job, not the
 * opening's.
 */
export function usePostLoginHold(entry: number, online: boolean): boolean {
  const [extraPassedFor, setExtraPassedFor] = useState(0)
  const [cappedFor, setCappedFor] = useState(0)
  const [releasedFor, setReleasedFor] = useState(0)

  useEffect(() => {
    if (entry === 0) return
    const { extraMs, capMs } = postLoginHold
    if (capMs <= 0) return
    const extra = setTimeout(() => setExtraPassedFor(entry), extraMs)
    const cap = setTimeout(() => setCappedFor(entry), capMs)
    return () => {
      clearTimeout(extra)
      clearTimeout(cap)
    }
  }, [entry])

  if (entry === 0 || releasedFor === entry || postLoginHold.capMs <= 0) return false
  const holding = cappedFor !== entry && !(extraPassedFor === entry && online)
  // Latched on the render that releases, not in an effect: a drop right after
  // must not bring the opening back for one frame.
  if (!holding) setReleasedFor(entry)
  return holding
}
