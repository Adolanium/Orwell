import { useEffect, useRef, useState } from "react"
import { BUZZ_MAX_AGE_MS } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"
import { isDirect } from "../lib/format.js"
import { playSound } from "../lib/sounds.js"
import { daPropriaConta } from "../sons/acontecimentos.js"

/**
 * A nudge that arrives, for the whole app (20/11/2026).
 *
 * Two things happen. The nudge sound plays, and the Friends button on the rail
 * shows the nudge (red outline and glyph, `AvisosDoCarril`) until the person
 * opens Friends, or opens the nudged conversation.
 *
 * Before this, only `useBuzz` listened, and it listens only for the open
 * conversation: a nudge to someone in Communities shook nothing and played
 * nothing. The shake stays in `useBuzz`, because a shake is for the
 * conversation on screen. The sound moved here, so it plays once, wherever the
 * person is.
 *
 * **The sound goes through the common engine.** The engine already respects
 * the master switch, the volume, the "nudge" toggle in Sounds, Busy,
 * Invisible, the notification pause and the burst limit (`sons/motor.ts`).
 *
 * **The same filters as the shake.** Only in a direct conversation, and never
 * an old nudge.
 *
 * **One from another device of this account plays too (21/11/2026: both
 * sides hear it, on every device of both accounts).** It does not
 * light Friends: it is our own gesture, and there is nothing to go and see.
 */
export interface OpcoesDaCotoveladaPorVer {
  /** This account's address, or `null` before it is known. */
  eu: string | null
  /** The Friends destination is on screen. */
  emAmigos: boolean
  /** The direct conversation open in Friends, or `null`. */
  directaAberta: string | null
}

/** The nudge still unseen: who gave the last one. `null` when there is none. */
export interface CotoveladaPorVer {
  de: string
}

export function useCotoveladaPorVer(bridge: EnclaveBridge, opcoes: OpcoesDaCotoveladaPorVer): CotoveladaPorVer | null {
  /** The conversations with a nudge not seen yet, and who gave the last one. */
  const [porVer, setPorVer] = useState<ReadonlyMap<string, string>>(new Map())
  /** Read at the moment of the event, not closed over at subscribe time. */
  const agora = useRef(opcoes)
  agora.current = opcoes

  useEffect(() => {
    return bridge.on.buzz((event) => {
      const { eu, emAmigos, directaAberta } = agora.current
      if (!isDirect(event.channel)) return
      if (Math.abs(Date.now() - event.at) > BUZZ_MAX_AGE_MS) return
      playSound("buzz")
      if (daPropriaConta(event.from, eu)) return
      // The person is already looking at that conversation: nothing to mark.
      if (emAmigos && directaAberta === event.channel) return
      setPorVer((antes) => new Map(antes).set(event.channel, event.from))
    })
    // Subscribed once, like the app's other subscriptions.
  }, [bridge])

  // Opening Friends clears every mark. Opening the nudged conversation clears
  // its mark (it can only open inside Friends, but Friends may already be open).
  useEffect(() => {
    if (!opcoes.emAmigos) return
    setPorVer((antes) => (antes.size === 0 ? antes : new Map()))
  }, [opcoes.emAmigos])
  useEffect(() => {
    const aberta = opcoes.directaAberta
    if (aberta === null) return
    setPorVer((antes) => {
      if (!antes.has(aberta)) return antes
      const depois = new Map(antes)
      depois.delete(aberta)
      return depois
    })
  }, [opcoes.directaAberta])

  const ultimo = [...porVer.values()].at(-1)
  return ultimo === undefined ? null : { de: ultimo }
}
