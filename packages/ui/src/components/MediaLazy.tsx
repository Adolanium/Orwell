import { useContext, useEffect, useRef, useState } from "react"
import { BridgeContext } from "../App.js"
import type { DesfechoDoTrazer } from "../bridge.js"
import { useMedia } from "../hooks/useMedia.js"
import { reserva } from "../lib/dimensoesDaImagem.js"
import { strings } from "../strings.js"
import type { MediaItem } from "../types.js"
import { AnexosDoItem } from "./AnexoAPedido.js"

/** The margin within which an image counts as "entering the screen" (design §8). */
const MARGEM = "600px"

/** Reduced motion: no transition and no blur. The thumbnail and the original appear without animating. */
function movimentoReduzido(): boolean {
  return typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Whether the element is on screen (with `MARGEM`), both ways: on leaving, the
 * bytes stop being pinned (in the store and in the cache), and the ceiling may
 * remove them; the URL stays while the cache has it. Without
 * `IntersectionObserver`, it always is. `ja`: always (the zoom, the stage).
 */
function useNoEcra(ja: boolean): [React.RefObject<HTMLSpanElement | null>, boolean] {
  const ref = useRef<HTMLSpanElement | null>(null)
  const semVigia = typeof IntersectionObserver === "undefined"
  const [visivel, setVisivel] = useState(ja || semVigia)
  useEffect(() => {
    if (ja || semVigia || !ref.current) return
    const vigia = new IntersectionObserver((entradas) => setVisivel(entradas.some((entrada) => entrada.isIntersecting)), { rootMargin: MARGEM })
    vigia.observe(ref.current)
    return () => vigia.disconnect()
  }, [ja, semVigia])
  return [ref, ja || semVigia || visivel]
}

type FaseDoTrazer = { fase: "parado" } | { fase: "a-trazer" } | { fase: "falhou"; motivo: Exclude<DesfechoDoTrazer, { ok: true }>["motivo"] }

/**
 * The "Fetch" gesture for a media item by reference: `bridge.media.trazer`, to
 * a sibling device and then to the members (in the core). With the message
 * context, it asks by attachment; without it, by `sha`. What arrives notifies
 * through `on.media`, and `useMedia` asks for the bytes again.
 */
export function useTrazer(item: MediaItem): { pode: boolean; estado: FaseDoTrazer; trazer: () => Promise<boolean> } {
  const bridge = useContext(BridgeContext)
  const doItem = useContext(AnexosDoItem)
  const [estado, setEstado] = useState<FaseDoTrazer>({ fase: "parado" })
  const indice = doItem ? doItem.lista.indexOf(item) : -1
  const id = doItem && indice >= 0 ? { channel: doItem.channel, alvo: doItem.alvo, indice } : item.ref ? { sha: item.ref } : null
  const media = bridge?.media
  const trazer = async (): Promise<boolean> => {
    if (!media || !id) return false
    setEstado({ fase: "a-trazer" })
    const desfecho = await media.trazer(id).catch((): DesfechoDoTrazer => ({ ok: false, motivo: "ninguem" }))
    setEstado(desfecho.ok ? { fase: "parado" } : { fase: "falhou", motivo: desfecho.motivo })
    return desfecho.ok
  }
  return { pode: Boolean(media && id), estado, trazer }
}

/** The sentence of a "Fetch" that did not work. "sem-irmao" and "ninguem" say the same (R24). */
export function fraseDoTrazer(motivo: Exclude<DesfechoDoTrazer, { ok: true }>["motivo"]): string {
  return motivo === "sem-ligacao" ? strings.sincronia.anexoSemLigacao : strings.media.ninguemTem
}

/** The "Fetch" button, small, over the thumbnail; the sentence when it failed. */
export function BotaoTrazer({ item }: { item: MediaItem }): React.JSX.Element | null {
  const { pode, estado, trazer } = useTrazer(item)
  if (!pode) return null
  return (
    <span className="media-trazer">
      {estado.fase === "falhou" && (
        <span className="media-trazer-frase" role="status">
          {fraseDoTrazer(estado.motivo)}
        </span>
      )}
      <button type="button" className="media-trazer-botao" disabled={estado.fase === "a-trazer"} onClick={() => void trazer()}>
        {estado.fase === "a-trazer" ? strings.media.aTrazer : strings.media.trazer}
      </button>
    </span>
  )
}

/**
 * An image from the media store (Task 10, design §8).
 *
 * - **The reserved box**: `w` and `h` from the reference, before there are
 *   bytes. An empty canvas with those dimensions takes the image's exact
 *   place, and the conversation does not jump when it arrives.
 * - **On entering the screen** (600 px margin) it asks for the bytes; `eager`
 *   asks at once (the zoom, the carousel stage).
 * - **The thumbnail first**: while the original loads, the thumbnail, blurred
 *   (only without reduced motion: there it appears sharp, without a
 *   transition).
 * - **Original missing**: the sharp thumbnail, and the "Fetch" button over it.
 *   Without a thumbnail, the sentence "Imagem guardada noutro aparelho." with
 *   the same button.
 *
 * The image `load` still sticks whoever was at the bottom to the bottom: the
 * `Timeline` listens to it in the capture phase, for any `<img>` inside.
 */
export function MediaLazy({
  item,
  onOpen,
  eager = false,
  draggable,
}: {
  item: MediaItem
  /** When given, the image is a button that opens it large (not with the original missing). */
  onOpen?: ((item: MediaItem, event?: React.MouseEvent) => void) | undefined
  eager?: boolean
  draggable?: boolean
}): React.JSX.Element {
  const [ref, visivel] = useNoEcra(eager)
  const original = useMedia(item, { visivel, tamanho: "original" })
  const temMini = item.mini !== undefined && item.mini !== item.ref
  const mini = useMedia(item, { visivel: visivel && temMini && original.estado !== "pronto", tamanho: "mini" })
  const srcMini = temMini ? mini.src : null
  const src = original.src ?? srcMini
  const emFalta = original.estado === "em-falta"
  const aCarregar = original.estado === "a-carregar" && src !== null
  const animar = !movimentoReduzido()
  const d = item.w && item.h ? { largura: item.w, altura: item.h } : null
  const medidas = d ? { width: d.largura, height: d.altura } : {}
  const classe = ["media-lazy", aCarregar && "a-carregar", animar && "media-transicao", emFalta && "em-falta"].filter(Boolean).join(" ")

  const corpo = (
    <span ref={ref} className={classe}>
      {src ? (
        <img
          className={src === original.src ? "media-original" : "media-mini"}
          src={src}
          alt={item.name ?? ""}
          // Decoded off the frame that shows it: the box is reserved, nothing jumps.
          decoding="async"
          {...medidas}
          {...(draggable !== undefined ? { draggable } : {})}
        />
      ) : emFalta ? (
        <span className="media-evicted" role="img" aria-label={strings.media.noutroAparelho}>
          {strings.media.noutroAparelho}
        </span>
      ) : (
        <canvas className="media-caixa" aria-hidden="true" {...medidas} />
      )}
      {emFalta && <BotaoTrazer item={item} />}
    </span>
  )
  if (!onOpen || emFalta) return corpo
  return (
    <button type="button" className="image-open" title={strings.social.viewImage} style={reserva(d)} onClick={(event) => onOpen(item, event)}>
      {corpo}
    </button>
  )
}
