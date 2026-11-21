import { useCallback, useEffect, useRef, useState } from "react"
import type { EnclaveBridge } from "../bridge.js"
import { isDirect } from "../lib/format.js"
import { COTOVELADA_INTERVALO_MS, segundosQueFaltam } from "../lib/limiteDaCotovelada.js"
import { tocarCotoveladaEnviada } from "../lib/sounds.js"

/**
 * The nudge, the MSN Messenger nudge.
 *
 * Shakes the other person's window and plays a sound. It is not a
 * notification: it is a tap on the shoulder of someone distracted, and it
 * matters precisely because it is physical. It was one of the few things from
 * MSN that nobody copied and everyone remembers.
 *
 * **Direct conversations only.** A nudge to thirty people is not a nudge, it
 * is an alarm, and in a group channel it would be the cheapest tool the app
 * has to ruin everyone's afternoon. The guard is in here, not just in the
 * button design: a rule that lives in appearance is a rule the first refactor
 * throws away.
 *
 * **Never recorded.** Same trap as the typing signal, and worse: a buzz in
 * history gets replayed on backfill, and whoever opened the conversation
 * tomorrow would get all today's nudges at once, each one shaking the screen.
 * The cut is at the session, before the vault.
 *
 * **Never steals focus.** This sets a CSS class and plays a sound, and nothing
 * else: no `window.focus()`, no `element.focus()`, nothing to bring the app to
 * the front. Someone typing in another window keeps typing in another window,  * and that is what separates a nudge from a hijack.
 *
 * **With reduced motion it still shakes, slower and smaller (12/11/2026).** Up
 * to 1.3.7 CSS swapped the shake for a blue highlight, and on a
 * Windows, which runs with reduced motion, the nudge became "the window turns
 * blue". The house rule is that nothing stops, it moves slower: the calm
 * shake in `screens.css` takes twice the time at half the distance, and the
 * class stays on for all of it (`SHAKE_CALMO_MS`).
 *
 * **Whoever sends hears it too (21/11/2026).** Once the send is accepted, the
 * same sound plays on the sender's device (`tocarCotoveladaEnviada`).
 *
 * **Both sides, every device (21/11/2026).** A nudge that
 * arrives shakes the whole app (`useNudgeShake`) and plays its sound
 * (`useCotoveladaPorVer`) on every device of both accounts, also on the
 * sender's other devices. This hook keeps the sending device's half: the shake
 * of the press and the sound once the send is accepted.
 *
 * **Silences with the rest.** The sound goes through the common engine, which
 * already respects the mute button, volume, and "Busy". Someone working can
 * mute the noise without losing the message: the shake still
 * arrives. A buzz that ignored "Busy" would be the only voice in the app
 * with the right to break an explicit choice by the user, and there is nothing
 * in it to justify that privilege.
 */

/** How long the shake shows on screen. A jolt, not an earthquake. */
const SHAKE_MS = 820
/** The calm shake, with reduced motion: twice as long. Keep in step with `screens.css`. */
const SHAKE_CALMO_MS = 1640

/** Read at the moment of each nudge: the preference can change while the app is open. Also for `useNudgeShake`. */
export function duracaoDoAbanao(): number {
  const reduzido =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  return reduzido ? SHAKE_CALMO_MS : SHAKE_MS
}

export interface Buzz {
  /** Send the nudge. No effect while the cooldown is running. */
  buzz: () => void
  /** Seconds left before we can try again. Zero means free. */
  cooldown: number
  /** A nudge just came in: this is the class that shakes the screen. */
  shaking: boolean
  /** Whether this conversation allows nudges at all. False on group channels. */
  available: boolean
}

/**
 * Both ends of the buzz, in a portable hook.
 *
 * Takes the bridge and channel, and nothing else, on purpose. Direct
 * conversations will move to the Friends page, and what carries over from here
 * to there is this file and the button, with no glue left behind.
 */
export function useBuzz(bridge: EnclaveBridge, channel: string | null): Buzz {
  const [cooldown, setCooldown] = useState(0)
  const [shaking, setShaking] = useState(false)
  /**
   * The last nudge given in each conversation. Per conversation, not just one:
   * coming back to a conversation finds its wait where it was left. See
   * `lib/limiteDaCotovelada.ts`.
   */
  const ultimosEnvios = useRef(new Map<string, number>())
  const available = channel !== null && isDirect(channel)

  /** The open channel, read at the time of the event and not closed on subscribe. */
  const canalRef = useRef(channel)
  canalRef.current = channel

  /*
    A nudge that ARRIVES does not shake here since 21/11/2026: `useNudgeShake`
    shakes the whole app, on every screen and every device, and its sound is in
    `useCotoveladaPorVer`. This hook shakes only for our own press.
  */

  // Clear the shake on its own. Restarted on each new nudge, so two in a row
  // give two jolts, not one cut short.
  useEffect(() => {
    if (!shaking) return
    const fim = setTimeout(() => setShaking(false), duracaoDoAbanao())
    return () => clearTimeout(fim)
  }, [shaking])

  /**
   * The visible countdown. In MSN the button locked and you could see it was
   * locked; a button that does not work and does not explain looks broken.
   *
   * The timer is tied to "waiting is ongoing" and never to the number of
   * seconds. Tied to the number, the countdown froze: two steps in a row often
   * compute the SAME second, writing the same value to state does not rerun the
   * effect, and the clock died there, at "5s", forever, with the button closed
   * until you switched conversations.
   */
  const aEsperar = cooldown > 0
  useEffect(() => {
    if (!aEsperar) return
    const relogio = setInterval(() => {
      const canal = canalRef.current
      setCooldown(canal === null ? 0 : segundosQueFaltam(ultimosEnvios.current.get(canal), Date.now()))
    }, 250)
    return () => clearInterval(relogio)
  }, [aEsperar])

  // Switching conversations does not inherit the wait from the previous one: the
  // cooldown protects the person on the other end, and on the other end is now
  // someone else. But the new conversation might have its own, from a nudge sent
  // less than a minute ago.
  useEffect(() => {
    setCooldown(channel === null ? 0 : segundosQueFaltam(ultimosEnvios.current.get(channel), Date.now()))
    setShaking(false)
  }, [channel])

  const buzz = useCallback(() => {
    if (!channel || !isDirect(channel)) return
    const agora = Date.now()
    if (segundosQueFaltam(ultimosEnvios.current.get(channel), agora) > 0) return
    ultimosEnvios.current.set(channel, agora)
    setCooldown(Math.ceil(COTOVELADA_INTERVALO_MS / 1000))
    // The shake is the echo of what you just did, on both sides, like in MSN. The
    // shake comes so whoever pressed it knows it worked.
    setShaking(true)
    // The sound too, since 21/11/2026, but only once the send was accepted: a
    // refused nudge (rate, error) plays nothing. A lost nudge is not an error to
    // put on anyone's screen.
    void bridge.channels
      .buzz(channel)
      .then((resposta) => {
        if (resposta.ok) tocarCotoveladaEnviada()
      })
      .catch(() => undefined)
  }, [bridge, channel])

  return { buzz, cooldown, shaking, available }
}
