import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { EnclaveBridge } from "../bridge.js"
import { cacheDeMedia } from "../lib/cacheDeMedia.js"
import type { ChatMessage } from "../types.js"

/** The separator key for the channel list: NUL, which no address has. */
const SEPARADOR = "\u0000"

/** How a channel presents itself. */
export interface SpaceMeta {
  name: string
  topic?: string
  /** What is drawn: the data URL, or the URL of the store thumbnail. Only a data URL is published. */
  icon?: string
  /**
   * The icon in the media store (Task 10): the `sha` of the reference. Saving
   * the properties without changing the icon sends this back (`setMeta`), and
   * the core reuses the stored attachment. An `icon` resolved from here is
   * never published.
   */
  iconRef?: string
  iconMini?: string
  updatedAt?: number
}

/**
 * The name, description, and icon of each channel.
 *
 * Two sources, and both are accurate. The vault knows ALL channels and responds
 * right away, it puts the right name in the sidebar before the connection even
 * opens. Messages in memory know only the open channel, but know it better: a
 * change made now appears without waiting for save.
 *
 * The rule between the two is the same one the vault applies to members: the
 * newer timestamp wins. This is the same design as `useDirectory`, and on
 * purpose, anyone who can read one can read the other.
 *
 * What this does NOT solve, and cannot: who writes. The subject of a profile is
 * the sender, so no one publishes for others; the subject of this is the
 * channel, and today any member writes. It becomes a matter of roles.
 */
export function useSpaceMeta(
  bridge: EnclaveBridge,
  channels: string[],
  messages: ChatMessage[],
): {
  spaceMeta: Map<string, SpaceMeta>
  /** Reread from the vault. Call after publishing, or when switching channels. */
  refresh: () => void
} {
  const [doCofre, setDoCofre] = useState<Map<string, SpaceMeta>>(new Map())
  /*
    The key joins channels by a character that an address does not have (NUL),
    and splits by the SAME. It used to split by a space: with two channels or
    more, the split list was a single nonexistent address, and no names came
    from the vault. Names only appeared when a `space.meta` went live, and after
    reloading you saw the address (seen 3/11/2026 in the portrait script, phase 1
    of 1.1).
    */
  const chave = channels.join(SEPARADOR)

  /**
   * The bridge is read by reference, not by dependency.
   *
   * A host that recreates it on every render, and React does not promise
   * otherwise, would make the effect below run, change the state, and run
   * again, forever. It took a stop for lack of memory to discover, in a test
   * that only built the bridge honestly.
   */
  const ponte = useRef(bridge)
  ponte.current = bridge

  const refresh = useCallback(() => {
    const mapa = new Map<string, SpaceMeta>()
    for (const channel of chave ? chave.split(SEPARADOR) : []) {
      const meta = ponte.current.channels.meta?.(channel)
      if (meta) mapa.set(channel, meta)
    }
    // Only replace when it actually changed. A `setState` with equal content
    // causes a render anyway, and it is the second brake against the loop.
    setDoCofre((actual) => (mesmoConteudo(actual, mapa) ? actual : mapa))
  }, [chave])

  useEffect(refresh, [refresh])

  const spaceMeta = useMemo(() => {
    const mapa = new Map(doCofre)
    for (const message of messages) {
      if (message.payload.t !== "space.meta") continue
      const bruto = message.payload as { name?: unknown; topic?: unknown; icon?: { inline?: unknown }; updatedAt?: unknown }
      if (typeof bruto.name !== "string") continue
      const at = typeof bruto.updatedAt === "number" ? bruto.updatedAt : 0
      const conhecido = mapa.get(message.channel)
      if (conhecido && (conhecido.updatedAt ?? 0) > at) continue
      mapa.set(message.channel, {
        name: bruto.name,
        ...(typeof bruto.topic === "string" ? { topic: bruto.topic } : {}),
        ...(typeof bruto.icon?.inline === "string" ? { icon: bruto.icon.inline } : {}),
        updatedAt: at,
      })
    }
    return mapa
  }, [doCofre, messages])

  // The icons by reference: through the thumbnail, once per `sha`, through the media cache.
  const [icones, setIcones] = useState<ReadonlyMap<string, string>>(new Map())
  // Goes up when the core says one of these arrived: ask again (a null does not stay in the cache).
  const [volta, setVolta] = useState(0)
  const shas = useMemo(() => {
    const lista = new Set<string>()
    for (const meta of spaceMeta.values()) if (!meta.icon && meta.iconRef) lista.add(meta.iconMini ?? meta.iconRef)
    return [...lista].sort().join(" ")
  }, [spaceMeta])
  useEffect(() => {
    const media = ponte.current.media
    if (!media || !shas) return
    let vivo = true
    const lista = shas.split(" ")
    for (const sha of lista) {
      cacheDeMedia.prender(sha)
      void cacheDeMedia.obter(sha, "", (s) => media.bytes(s)).then((url) => {
        if (vivo && url) setIcones((antes) => (antes.get(sha) === url ? antes : new Map(antes).set(sha, url)))
      })
    }
    const largar = ponte.current.on?.media?.((evento) => {
      if ((evento.estado === "chegou" || evento.estado === "guardado") && lista.includes(evento.sha)) setVolta((n) => n + 1)
    })
    return () => {
      vivo = false
      largar?.()
      for (const sha of lista) cacheDeMedia.soltar(sha)
    }
  }, [shas, volta])
  const comIcones = useMemo(() => {
    if (icones.size === 0) return spaceMeta
    const mapa = new Map(spaceMeta)
    for (const [canal, meta] of spaceMeta) {
      const url = !meta.icon && meta.iconRef ? icones.get(meta.iconMini ?? meta.iconRef) : undefined
      if (url) mapa.set(canal, { ...meta, icon: url })
    }
    return mapa
  }, [spaceMeta, icones])

  return { spaceMeta: comIcones, refresh }
}

/** Two view maps with the same content? See `refresh`. */
function mesmoConteudo(a: Map<string, SpaceMeta>, b: Map<string, SpaceMeta>): boolean {
  if (a.size !== b.size) return false
  for (const [channel, meta] of a) {
    const outro = b.get(channel)
    if (!outro || outro.name !== meta.name || outro.topic !== meta.topic || outro.icon !== meta.icon || outro.iconRef !== meta.iconRef) return false
  }
  return true
}
