import type { MediaItem } from "../types.js"
import { bytesDeDataUrl, descarregarBytes, nomeSeguro } from "./ficheiros.js"
import { strings } from "../strings.js"

/**
 * Copy and save the media of a message, from the bytes already decrypted here.
 *
 * Nothing in this file touches the network: the source is the data URL the
 * message carried, or this device's media store for an item kept by reference
 * (`ref`), and every output is the clipboard, the share sheet, or the
 * download. No `fetch`, no `<a href>` to a remote address.
 */

/** Reads an item kept by reference from this device's media store (`bridge.media.bytes`). */
export type LerDoArmazem = (sha: string) => Promise<Uint8Array | null>

export type ResultadoDaCopia = "copiada" | "sem-suporte" | "recusada"

/** The bytes of a media item, or `null` when they are gone (evicted from the vault). */
export function bytesDoItem(item: MediaItem): string | null {
  const url = item.inline ?? item.url ?? ""
  return item.evicted || url === "" || !url.startsWith("data:") ? null : url
}

/**
 * Whether the item may have bytes on this device: inline, or kept by reference in the media store.
 * A reference is only known to be missing when it is read; then the action says so in one line.
 */
export function temBytes(item: MediaItem, ler?: LerDoArmazem): boolean {
  return bytesDoItem(item) !== null || (Boolean(item.ref) && !item.evicted && ler !== undefined)
}

/** The bytes themselves: the data URL decoded, or the original asked from the media store. */
async function bytesDe(item: MediaItem, ler?: LerDoArmazem): Promise<Uint8Array | null> {
  const url = bytesDoItem(item)
  if (url) return bytesDeDataUrl(url)
  if (!item.ref || item.evicted || !ler) return null
  return ler(item.ref).catch(() => null)
}

/**
 * The picture as PNG, the only type every browser accepts on the clipboard.
 *
 * A PNG goes through untouched. Anything else is drawn on a canvas and read
 * back as PNG, which is lossy only in the sense that animation is lost.
 */
async function paraPng(lidos: Promise<Uint8Array | null>, tipo: string): Promise<Blob> {
  const bytes = await lidos
  // Never shown: `copiarImagem` turns any failure here into "recusada".
  if (!bytes) throw new DOMException()
  if (/^image\/png$/i.test(tipo)) return new Blob([bytes as BlobPart], { type: "image/png" })
  const endereco = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }))
  const imagem = new Image()
  imagem.src = endereco
  await imagem.decode().finally(() => URL.revokeObjectURL(endereco))
  const tela = document.createElement("canvas")
  tela.width = imagem.naturalWidth
  tela.height = imagem.naturalHeight
  const contexto = tela.getContext("2d")
  // Never shown: `copiarImagem` turns any failure here into "recusada".
  if (!contexto) throw new DOMException()
  contexto.drawImage(imagem, 0, 0)
  return new Promise((resolver, rejeitar) =>
    tela.toBlob((blob) => (blob ? resolver(blob) : rejeitar(new DOMException())), "image/png"),
  )
}

/**
 * Put the image on the clipboard.
 *
 * The `ClipboardItem` receives the PROMISE of the blob, not the blob: Safari
 * only allows the write inside the user gesture, and awaiting the conversion
 * first would let the gesture expire.
 */
export async function copiarImagem(item: MediaItem, ler?: LerDoArmazem): Promise<ResultadoDaCopia> {
  if (!temBytes(item, ler)) return "recusada"
  if (typeof navigator === "undefined" || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return "sem-suporte"
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": paraPng(bytesDe(item, ler), item.mediaType ?? "") })])
    return "copiada"
  } catch {
    return "recusada"
  }
}

/** Types the share sheet may be told about. Anything else goes as plain bytes: the type is the sender's claim. */
const TIPOS_DE_IMAGEM = /^image\/(png|jpeg|gif|webp|avif)$/

function ficheiroParaPartilhar(item: MediaItem, bytes: Uint8Array): File {
  const tipo = TIPOS_DE_IMAGEM.test(item.mediaType ?? "") ? (item.mediaType as string) : "application/octet-stream"
  return new File([bytes as BlobPart], nomeSeguro(item.name), { type: tipo })
}

/** Touch screen: the share sheet is how a phone saves a file. */
function ecraDeToque(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches
}

/**
 * Save the item.
 *
 * On a phone, with `navigator.share` able to take the file, it opens the share
 * sheet (which has "Save to Photos" and "Save to Files"). Everywhere else, and
 * if the sheet is not available, it is a normal download. The desktop app has
 * no save-dialog bridge yet, so there it is the browser download too, which
 * Electron already asks the system about.
 *
 * Returns `false` when the bytes are gone. Closing the share sheet is not an
 * error.
 */
export async function guardarMedia(item: MediaItem, ler?: LerDoArmazem): Promise<boolean> {
  const bytes = await bytesDe(item, ler)
  if (!bytes) return false
  if (ecraDeToque() && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
    const ficheiro = ficheiroParaPartilhar(item, bytes)
    if (navigator.canShare({ files: [ficheiro] })) {
      try {
        await navigator.share({ files: [ficheiro] })
        return true
      } catch (erro) {
        if (erro instanceof DOMException && erro.name === "AbortError") return true
        // Any other refusal: fall back to the download below.
      }
    }
  }
  descarregarBytes(bytes, item.name ?? "")
  return true
}

/** What the buttons say after a copy or a save. `toast` is optional: a sheet may have no provider. */
type Aviso = ((texto: string, nivel?: "info" | "error") => void) | null | undefined

/** Copy the image and say what happened, in one line. */
export async function copiarImagemComAviso(item: MediaItem, aviso: Aviso, ler?: LerDoArmazem): Promise<void> {
  const resultado = await copiarImagem(item, ler)
  if (resultado === "copiada") aviso?.(strings.media.imagemCopiada)
  else aviso?.(resultado === "sem-suporte" ? strings.media.imagemSemSuporte : strings.media.imagemRecusada, "error")
}

/** Save the item and say so only when it cannot be done. */
export async function guardarMediaComAviso(item: MediaItem, aviso: Aviso, ler?: LerDoArmazem): Promise<void> {
  try {
    if (!(await guardarMedia(item, ler))) aviso?.(strings.media.semBytes, "error")
  } catch {
    aviso?.(strings.chat.fileBroken, "error")
  }
}
