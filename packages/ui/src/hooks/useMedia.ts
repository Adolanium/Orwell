import { useContext, useEffect, useState } from "react"
import { BridgeContext } from "../App.js"
import { cacheDeMedia } from "../lib/cacheDeMedia.js"
import type { MediaItem } from "../types.js"

export type EstadoDoMedia = "a-carregar" | "pronto" | "em-falta"

/**
 * The URL of a media item for an `<img>` (Task 10, design §8).
 *
 * - An item with `inline` (or `url`) is ready at once: the case of a message
 *   that arrived just now, live, before the vault absorbed it.
 * - An item with `ref` asks the store for the bytes (`bridge.media.bytes`)
 *   only when `visivel`, and pins them (`fixar`) while it is on screen, so the
 *   store ceiling does not remove them. The URL stays in the session cache
 *   (`cacheDeMedia`). `tamanho` "mini" asks for the thumbnail (`mini`, or the
 *   `ref` itself for an image without a separate thumbnail).
 * - Without bytes: "em-falta". When the core says the `sha` arrived or was
 *   stored (`on.media`), it asks again.
 * - An `evicted` marker, or a bridge without a store, is missing.
 */
export function useMedia(
  item: MediaItem,
  opcoes: { visivel: boolean; tamanho: "mini" | "original" },
): { src: string | null; estado: EstadoDoMedia } {
  const bridge = useContext(BridgeContext)
  const directo = item.ref ? null : (item.inline ?? item.url ?? null) || null
  const sha = item.ref && !item.evicted ? (opcoes.tamanho === "mini" ? (item.mini ?? item.ref) : item.ref) : null
  const media = bridge?.media
  const tipo = opcoes.tamanho === "original" ? (item.mediaType ?? "") : ""

  const inicial = (): { sha: string | null; src: string | null; estado: EstadoDoMedia } => {
    if (directo) return { sha, src: directo, estado: "pronto" }
    if (!sha || !media) return { sha, src: null, estado: "em-falta" }
    const ja = cacheDeMedia.ja(sha)
    return ja ? { sha, src: ja, estado: "pronto" } : { sha, src: null, estado: "a-carregar" }
  }
  const [lido, setLido] = useState(inicial)
  // Another item in the same place (the list changed): start over.
  const actual = lido.sha === sha && (directo === null || lido.src === directo) ? lido : inicial()
  if (actual !== lido) setLido(actual)

  useEffect(() => {
    if (directo || !sha || !media || !opcoes.visivel) return
    let vivo = true
    cacheDeMedia.prender(sha)
    void media.fixar(sha).catch(() => {})
    const carregar = (): void => {
      void cacheDeMedia.obter(sha, tipo, (s) => media.bytes(s)).then((src) => {
        if (!vivo) return
        setLido((antes) => (antes.sha !== sha ? antes : src ? { sha, src, estado: "pronto" } : { sha, src: null, estado: "em-falta" }))
      })
    }
    carregar()
    const largar = bridge?.on?.media?.((evento) => {
      if (evento.sha === sha && (evento.estado === "chegou" || evento.estado === "guardado")) carregar()
    })
    return () => {
      vivo = false
      largar?.()
      cacheDeMedia.soltar(sha)
      void media.soltar(sha).catch(() => {})
    }
  }, [bridge, media, directo, sha, tipo, opcoes.visivel])

  // A cache URL that left meanwhile (the ceiling, or locking) is no longer drawn: it is asked for again on entering the screen.
  if (sha && !directo && actual.src !== null && !cacheDeMedia.ainda(sha, actual.src)) return { src: null, estado: "a-carregar" }
  return { src: actual.src, estado: actual.estado }
}

/**
 * A small image that can come as text or by reference: a link card thumbnail
 * (`thumbnail`) or a video poster. The vault keeps them as `{ ref }`, always
 * of class "mini" (design §3); live they arrive as a data URL (the text passes
 * as is). Null with nothing.
 */
export function useImagemPequena(valor: unknown, visivel = true): string | null {
  const texto = typeof valor === "string" && valor !== "" ? valor : null
  const ref = typeof valor === "object" && valor !== null && typeof (valor as { ref?: unknown }).ref === "string" ? (valor as { ref: string }).ref : undefined
  const { src } = useMedia(ref ? { ref } : {}, { visivel: visivel && ref !== undefined, tamanho: "mini" })
  return texto ?? (ref ? src : null)
}
