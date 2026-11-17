import { createContext, useContext, useEffect, useRef, useState } from "react"
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

type Falha = Exclude<DesfechoDoAnexo, { ok: true }>
type Motivo = Falha["motivo"]
type Estado =
  | { fase: "parado" }
  | { fase: "a-pedir" }
  | { fase: "chegou"; item: MediaItem }
  | { fase: "falhou"; motivo: Motivo; autorLigado?: boolean; autor?: string }

/**
 * The message for a request that yielded no bytes. These are limits, not
 * errors, except one: `falhou` is a fault, and is reported with its code (515).
 *
 * "Nobody" has two phrases (12/11/2026): the sender is not connected, or
 * nobody connected has it (the sender included). One phrase for both read as
 * a lie when the sender was online.
 */
export function fraseDoMotivo(motivo: Motivo, ficheiro: boolean, autorLigado?: boolean): string {
  switch (motivo) {
    case "falhou":
      return translateError("the attachment request failed")
    case "recusado":
      return strings.sincronia.anexoRecusado
    case "sem-ligacao":
      return strings.sincronia.anexoSemLigacao
    default:
      if (autorLigado === false) return ficheiro ? strings.sincronia.anexoFicheiroAutorDesligado : strings.sincronia.anexoAutorDesligado
      return ficheiro ? strings.sincronia.anexoFicheiroNinguem : strings.sincronia.anexoNinguem
  }
}

/** After the author connects, wait this long before asking: their device needs a moment to join the channel. */
export const ESPERA_DEPOIS_DO_AUTOR_MS = 3_000
/**
 * Someone else connected: ask again at most this often. Each request is a
 * signal copied to every connected member, and a screen can hold many images
 * that nobody has: one retry each per presence event would spend the signal cap.
 */
export const INTERVALO_ENTRE_TENTATIVAS_MS = 120_000

function estadoDaFalha(desfecho: Falha): Estado {
  return desfecho.motivo === "ninguem"
    ? {
        fase: "falhou",
        motivo: desfecho.motivo,
        ...(desfecho.autorLigado !== undefined ? { autorLigado: desfecho.autorLigado } : {}),
        ...(desfecho.autor !== undefined ? { autor: desfecho.autor } : {}),
      }
    : { fase: "falhou", motivo: desfecho.motivo }
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
export function usePedirAnexo(
  item: MediaItem,
  { voltarAPedir = false }: { voltarAPedir?: boolean } = {},
): {
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
  /*
    `calado`: an automatic retry. The phrase on screen stays while it runs, and
    only an arrival changes it: the screen does not blink to "Asking..." and
    back every time someone connects.
  */
  const pedir = async (calado = false): Promise<MediaItem | null> => {
    if (!bridge || !doItem || indice < 0) return null
    if (!calado) setEstado({ fase: "a-pedir" })
    const id = { channel: doItem.channel, alvo: doItem.alvo, indice }
    if (bridge.media) {
      const trazido = await bridge.media.trazer(id).catch((): DesfechoDoTrazer => ({ ok: false, motivo: "ninguem" }))
      if (!trazido.ok) {
        // "sem-irmao" and "ninguem" say the same (R24). The author's state, when the members were asked.
        const falha: Estado =
          trazido.motivo === "sem-ligacao"
            ? { fase: "falhou", motivo: "sem-ligacao" }
            : trazido.motivo === "ninguem"
              ? estadoDaFalha({ ok: false, motivo: "ninguem", ...(trazido.autorLigado !== undefined ? { autorLigado: trazido.autorLigado } : {}), ...(trazido.autor !== undefined ? { autor: trazido.autor } : {}) })
              : { fase: "falhou", motivo: "ninguem" }
        if (!calado || (falha.fase === "falhou" && falha.motivo === "ninguem")) setEstado(falha)
        return null
      }
      const relido = await itemDaEntrada(bridge, id)
      if (relido) {
        setEstado({ fase: "chegou", item: relido })
        return relido
      }
    }
    if (!bridge.anexo) {
      if (!calado) setEstado({ fase: "falhou", motivo: "ninguem" })
      return null
    }
    const desfecho = await bridge.anexo
      .pedir({ channel: doItem.channel, alvo: doItem.alvo, indice })
      .catch((): DesfechoDoAnexo => ({ ok: false, motivo: "falhou" }))
    if (!desfecho.ok) {
      if (calado) {
        if (desfecho.motivo === "ninguem") setEstado(estadoDaFalha(desfecho))
      } else if (desfecho.motivo === "cancelado" || desfecho.motivo === "por-pedir") setEstado({ fase: "parado" })
      else setEstado(estadoDaFalha(desfecho))
      return null
    }
    const chegou = desfecho.anexo as MediaItem
    setEstado({ fase: "chegou", item: chegou })
    return chegou
  }
  const pedirRef = useRef(pedir)
  pedirRef.current = pedir
  useVoltarAPedir(voltarAPedir ? estado : { fase: "parado" }, pedirRef)
  const cancelar =
    bridge?.anexo?.cancelar && doItem && indice >= 0
      ? (): void => {
          void bridge.anexo?.cancelar?.({ channel: doItem.channel, alvo: doItem.alvo, indice }).catch(() => false)
        }
      : null
  return { pode, trazer, estado, pedir: () => pedir(), cancelar }
}

/**
 * Ask again by itself when someone connects (12/11/2026), while the request
 * ended "nobody". The author connecting: in `ESPERA_DEPOIS_DO_AUTOR_MS`.
 * Anyone else: at most once per `INTERVALO_ENTRE_TENTATIVAS_MS`. Only while
 * the image is on screen (the effect ends with the component).
 */
function useVoltarAPedir(estado: Estado, pedirCalado: React.RefObject<(calado?: boolean) => Promise<unknown>>): void {
  const bridge = useContext(BridgeContext)
  const ninguem = estado.fase === "falhou" && estado.motivo === "ninguem"
  const autor = estado.fase === "falhou" ? estado.autor : undefined
  useEffect(() => {
    const presenca = bridge?.on?.presence
    if (!ninguem || !presenca) return
    let ultima = Date.now()
    let temporizador: ReturnType<typeof setTimeout> | null = null
    const tentar = (): void => {
      temporizador = null
      ultima = Date.now()
      void pedirCalado.current?.(true)
    }
    const largar = presenca((evento) => {
      if (!evento.online) return
      const espera =
        evento.address === autor ? ESPERA_DEPOIS_DO_AUTOR_MS : Math.max(ESPERA_DEPOIS_DO_AUTOR_MS, ultima + INTERVALO_ENTRE_TENTATIVAS_MS - Date.now())
      // The author's turn comes sooner: it replaces a later wait for someone else.
      if (temporizador !== null) {
        if (evento.address !== autor) return
        clearTimeout(temporizador)
      }
      temporizador = setTimeout(tentar, espera)
    })
    return () => {
      largar()
      if (temporizador !== null) clearTimeout(temporizador)
    }
  }, [bridge, ninguem, autor, pedirCalado, estado])
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
  const { pode, trazer, estado, pedir, cancelar } = usePedirAnexo(item, { voltarAPedir: true })
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
        <span role="status">{trazer && estado.autorLigado === undefined ? fraseDoTrazerAnexo(estado.motivo, false) : fraseDoMotivo(estado.motivo, false, estado.autorLigado)}</span>
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
          {trazer && estado.autorLigado === undefined ? fraseDoTrazerAnexo(estado.motivo, true) : fraseDoMotivo(estado.motivo, true, estado.autorLigado)}
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
