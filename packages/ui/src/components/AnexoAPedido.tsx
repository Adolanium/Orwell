import { createContext, useContext, useState } from "react"
import { BridgeContext } from "../App.js"
import type { DesfechoDoAnexo, DesfechoDoTrazer, EnclaveBridge, IdDoAnexo } from "../bridge.js"
import { descarregar, descarregarBytes } from "../lib/ficheiros.js"
import { strings, translateError } from "../strings.js"
import type { MediaItem } from "../types.js"
import { dimensoesDaImagem, reserva } from "../lib/dimensoesDaImagem.js"
import { MediaLazy } from "./MediaLazy.js"

/**
 * Which message or post owns the attachments drawn here (S5, §5.4): the
 * channel, the `id`, and the ORIGINAL attachment list (an attachment's
 * position in it is what the core asks for). The message drawer sets it; the
 * grid and file list read it. Without it, an attachment with no bytes is just
 * the usual marker (the profile sheet, for example).
 */
export const AnexosDoItem = createContext<{ channel: string; alvo: string; lista: readonly MediaItem[] } | null>(null)

type Motivo = Exclude<DesfechoDoAnexo, { ok: true }>["motivo"]
type Estado = { fase: "parado" } | { fase: "a-pedir" } | { fase: "chegou"; item: MediaItem } | { fase: "falhou"; motivo: Motivo }

/**
 * The message for a request that yielded no bytes. These are limits, not
 * errors, except one: `falhou` is a fault, and is reported with its code (515).
 */
export function fraseDoMotivo(motivo: Motivo, ficheiro: boolean): string {
  switch (motivo) {
    case "falhou":
      return translateError("the attachment request failed")
    case "recusado":
      return strings.sincronia.anexoRecusado
    case "sem-ligacao":
      return strings.sincronia.anexoSemLigacao
    default:
      return ficheiro ? strings.sincronia.anexoFicheiroNinguem : strings.sincronia.anexoNinguem
  }
}

/**
 * Item `indice` of entry `alvo`, reread from the history after a "Fetch" that
 * worked (the core wrote it to the vault, with the reference). Null if it is
 * not there, or if it is still without bytes. The same order as the core:
 * `attachments` and then `media`.
 */
async function itemDaEntrada(bridge: EnclaveBridge, id: IdDoAnexo): Promise<MediaItem | null> {
  const entradas = await bridge.channels.history(id.channel).catch(() => [])
  const entrada = entradas.find((e) => (e.payload as { id?: unknown }).id === id.alvo)
  if (!entrada) return null
  const payload = entrada.payload as { attachments?: unknown; media?: unknown }
  const lista = [payload.attachments, payload.media].flatMap((valor) => (Array.isArray(valor) ? (valor as MediaItem[]) : []))
  const item = lista[id.indice]
  return item && !item.evicted && (item.ref || item.inline || item.url) ? item : null
}

/**
 * Ask for the bytes of `item`, if there is a way: the bridge and the context.
 * `cancelar` only exists if the bridge allows giving up. A cancelled request,
 * or one that did not fit in the core queue, goes back to the start: the ask
 * button.
 *
 * With the media store (Task 10), the request is the "Fetch" gesture: first
 * `media.trazer` (a sibling device, then the members, in the core), and the
 * item is reread from the history. If it cannot be reread, `anexo.pedir` gives
 * it.
 */
export function usePedirAnexo(item: MediaItem): {
  pode: boolean
  /** The gesture is "Fetch" (the bridge has the media store), not the S5 "Ask". */
  trazer: boolean
  estado: Estado
  pedir: () => Promise<MediaItem | null>
  cancelar: (() => void) | null
} {
  // Direct context, not `useBridge`, which throws without a provider: this piece
  // also renders where there is no bridge (component tests, the profile sheet).
  const bridge = useContext(BridgeContext)
  const doItem = useContext(AnexosDoItem)
  const [estado, setEstado] = useState<Estado>({ fase: "parado" })
  const indice = doItem ? doItem.lista.indexOf(item) : -1
  const trazer = Boolean(bridge?.media)
  const pode = Boolean((bridge?.anexo || bridge?.media) && doItem && indice >= 0)
  const pedir = async (): Promise<MediaItem | null> => {
    if (!bridge || !doItem || indice < 0) return null
    setEstado({ fase: "a-pedir" })
    const id = { channel: doItem.channel, alvo: doItem.alvo, indice }
    if (bridge.media) {
      const trazido = await bridge.media.trazer(id).catch((): DesfechoDoTrazer => ({ ok: false, motivo: "ninguem" }))
      if (!trazido.ok) {
        // "sem-irmao" and "ninguem" say the same (R24).
        setEstado({ fase: "falhou", motivo: trazido.motivo === "sem-ligacao" ? "sem-ligacao" : "ninguem" })
        return null
      }
      const relido = await itemDaEntrada(bridge, id)
      if (relido) {
        setEstado({ fase: "chegou", item: relido })
        return relido
      }
    }
    if (!bridge.anexo) {
      setEstado({ fase: "falhou", motivo: "ninguem" })
      return null
    }
    const desfecho = await bridge.anexo
      .pedir({ channel: doItem.channel, alvo: doItem.alvo, indice })
      .catch((): DesfechoDoAnexo => ({ ok: false, motivo: "falhou" }))
    if (!desfecho.ok) {
      if (desfecho.motivo === "cancelado" || desfecho.motivo === "por-pedir") setEstado({ fase: "parado" })
      else setEstado({ fase: "falhou", motivo: desfecho.motivo })
      return null
    }
    const chegou = desfecho.anexo as MediaItem
    setEstado({ fase: "chegou", item: chegou })
    return chegou
  }
  const cancelar =
    bridge?.anexo?.cancelar && doItem && indice >= 0
      ? (): void => {
          void bridge.anexo?.cancelar?.({ channel: doItem.channel, alvo: doItem.alvo, indice }).catch(() => false)
        }
      : null
  return { pode, trazer, estado, pedir, cancelar }
}

/** The "Try again" button of a request that failed ("Fetch", with the media store). */
function TentarOutraVez({ pedir, trazer = false }: { pedir: () => Promise<unknown>; trazer?: boolean }): React.JSX.Element {
  return (
    <button type="button" className="ghost" onClick={() => void pedir()}>
      {trazer ? strings.media.trazer : strings.sincronia.anexoTentarOutraVez}
    </button>
  )
}

/** The sentence of a "Fetch" that did not work: the limit one (R24), or the connection one. */
function fraseDoTrazerAnexo(motivo: Motivo, ficheiro: boolean): string {
  if (motivo === "sem-ligacao") return strings.sincronia.anexoSemLigacao
  return ficheiro ? strings.sincronia.anexoFicheiroNinguem : strings.media.ninguemTem
}

/** The "Cancel" button of a request running or in the queue. */
function Cancelar({ cancelar }: { cancelar: () => void }): React.JSX.Element {
  return (
    <button type="button" className="ghost" onClick={cancelar}>
      {strings.sincronia.anexoCancelar}
    </button>
  )
}

/**
 * An image where this device has only the name (S5, §5.4). Bytes do not come
 * with the channel: they are requested when the user opens it, from other members, and only
 * show after verification against the author's signature (in the core). If
 * no one has it, we say so with the message from §2.5.
 */
export function ImagemAPedido({
  item,
  className = "media-evicted",
  onOpen,
}: {
  item: MediaItem
  className?: string
  onOpen?: ((item: MediaItem) => void) | undefined
}): React.JSX.Element {
  const { pode, trazer, estado, pedir, cancelar } = usePedirAnexo(item)
  const pedirLabel = trazer ? strings.media.trazer : strings.sincronia.anexoPedir
  const aPedirLabel = trazer ? strings.media.aTrazer : strings.sincronia.anexoAPedir
  if (estado.fase === "chegou") {
    // Fetched into the store: the box, the bytes and the thumbnail through `MediaLazy`.
    if (estado.item.ref) return <MediaLazy item={estado.item} onOpen={onOpen} eager />
    const src = estado.item.inline ?? estado.item.url
    // The same reserved box from the grid: see `PostImages` and `dimensoesDaImagem`.
    const d = dimensoesDaImagem(src)
    const imagem = <img src={src} alt={estado.item.name ?? ""} {...(d ? { width: d.largura, height: d.altura } : {})} />
    if (!onOpen) return imagem
    return (
      <button type="button" className="image-open" title={strings.social.viewImage} style={reserva(d)} onClick={() => onOpen(estado.item)}>
        {imagem}
      </button>
    )
  }
  if (!pode) {
    return (
      <span className={className} role="img" aria-label={strings.media.noutroAparelho}>
        {strings.media.noutroAparelho}
      </span>
    )
  }
  if (estado.fase === "falhou") {
    return (
      <span className={`${className} anexo-a-pedido anexo-falhou`}>
        <span role="status">{trazer ? fraseDoTrazerAnexo(estado.motivo, false) : fraseDoMotivo(estado.motivo, false)}</span>
        <TentarOutraVez pedir={pedir} trazer={trazer} />
      </span>
    )
  }
  if (estado.fase === "a-pedir" && cancelar) {
    return (
      <span className={`${className} anexo-a-pedido`} aria-busy="true">
        <span>{strings.media.noutroAparelho}</span>
        <span className="anexo-a-pedido-accao">{aPedirLabel}</span>
        <Cancelar cancelar={cancelar} />
      </span>
    )
  }
  return (
    <button
      type="button"
      className={`${className} anexo-a-pedido`}
      disabled={estado.fase === "a-pedir"}
      onClick={() => void pedir()}
      aria-label={`${strings.media.noutroAparelho} ${pedirLabel}`}
    >
      <span>{strings.media.noutroAparelho}</span>
      <span className="anexo-a-pedido-accao">{estado.fase === "a-pedir" ? aPedirLabel : pedirLabel}</span>
    </button>
  )
}

/**
 * The same for a file: the line shows what it was and offers to request the bytes.
 * When they arrive, save them to disk, like the button always does.
 */
export function FicheiroAPedido({ item, nome }: { item: MediaItem; nome: string }): React.JSX.Element | null {
  const bridge = useContext(BridgeContext)
  const { pode, trazer, estado, pedir, cancelar } = usePedirAnexo(item)
  if (!pode) return null
  const pedirEGravar = (): Promise<void> =>
    pedir().then(async (chegou) => {
      // Fetched into the store: the bytes are asked for by reference.
      if (chegou?.ref) {
        const bytes = await bridge?.media?.bytes(chegou.ref).catch(() => null)
        if (bytes) descarregarBytes(bytes, nome)
        return
      }
      const bytes = chegou?.inline ?? chegou?.url
      if (bytes) {
        try {
          descarregar(bytes, nome)
        } catch {
          // Bytes verified and unreadable: nothing to save.
        }
      }
    })
  if (estado.fase === "falhou") {
    return (
      <>
        <span className="file-meta anexo-falhou" role="status">
          {trazer ? fraseDoTrazerAnexo(estado.motivo, true) : fraseDoMotivo(estado.motivo, true)}
        </span>
        <TentarOutraVez pedir={pedirEGravar} trazer={trazer} />
      </>
    )
  }
  return (
    <>
      <button
        type="button"
        className="file-get anexo-a-pedido"
        disabled={estado.fase === "a-pedir"}
        onClick={() => void pedirEGravar()}
      >
        {estado.fase === "a-pedir" ? (trazer ? strings.media.aTrazer : strings.sincronia.anexoAPedir) : trazer ? strings.media.trazer : strings.sincronia.anexoPedir}
      </button>
      {estado.fase === "a-pedir" && cancelar && <Cancelar cancelar={cancelar} />}
    </>
  )
}
