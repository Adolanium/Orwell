import { useEffect, useState } from "react"
import { BUZZ_MAX_AGE_MS } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"
import { isDirect } from "../lib/format.js"
import { duracaoDoAbanao } from "./useBuzz.js"

/**
 * The shake of a nudge that arrives, for the whole app (21/11/2026: both sides
 * shake and hear it, on every device of both accounts).
 *
 * Until now only the open conversation shook (`useBuzz`), so a nudge to someone
 * in Communities, in Settings, or with another conversation open moved nothing.
 * The shell puts `buzzing` on `.app`, and `screens.css` shakes the `.main`
 * frame of whatever screen is open: the sidebar and the rail stay still.
 *
 * **Every device of both accounts.** A nudge from another device of my own
 * account shakes too: it is the sender's side. The device that sent it never
 * gets the event (the core proves it, `session.nudge-all-devices.rede`), and
 * shakes from the press instead (`useBuzz`).
 *
 * The same filters as the sound (`useCotoveladaPorVer`): only a direct
 * conversation, never an old nudge. It never steals focus: a class, nothing else.
 */
export function useNudgeShake(bridge: EnclaveBridge): boolean {
  const [shaking, setShaking] = useState(false)
  /** Bumped on every nudge, so two in a row give two jolts, not one cut short. */
  const [nudges, setNudges] = useState(0)

  useEffect(() => {
    return bridge.on.buzz((event) => {
      if (!isDirect(event.channel)) return
      if (Math.abs(Date.now() - event.at) > BUZZ_MAX_AGE_MS) return
      setShaking(true)
      setNudges((n) => n + 1)
    })
    // Subscribed once, like the app's other subscriptions.
  }, [bridge])

  useEffect(() => {
    if (nudges === 0) return
    const end = setTimeout(() => setShaking(false), duracaoDoAbanao())
    return () => clearTimeout(end)
  }, [nudges])

  return shaking
}
