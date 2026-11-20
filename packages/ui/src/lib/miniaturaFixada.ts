import { PINNED_THUMBNAIL_MAX } from "@enclave/protocol"
import { dataUrlParaBlob } from "./enquadrar.js"
import { compressImage, type CompressDeps } from "./images.js"

/**
 * The budget of the thumbnail a pin carries: 160 px, about 5 KB. It must fit in
 * `PINNED_THUMBNAIL_MAX` after base64, and twenty of them travel to everyone who
 * joins. See `PinnedAttachment` in the protocol.
 */
export const ORCAMENTO_DA_MINIATURA_FIXADA = { maxSide: 160, maxBytes: 5_500 } as const

/** What the store gives for a `sha`: `bridge.media.bytes`. */
type LerBytes = (sha: string) => Promise<Uint8Array | null>

/** The image type by its first bytes: a thumbnail's `sha` does not say it. Empty when unknown. */
function tipoPelosBytes(bytes: Uint8Array): string {
  const b = (i: number): number => bytes[i] ?? -1
  if (b(0) === 0xff && b(1) === 0xd8) return "image/jpeg"
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "image/png"
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return "image/gif"
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50)
    return "image/webp"
  return ""
}

const refDe = (valor: unknown): string | undefined =>
  typeof valor === "object" && valor !== null && typeof (valor as { ref?: unknown }).ref === "string" ? (valor as { ref: string }).ref : undefined

/**
 * A small image of the first picture of a message, for the copy of a pin (12/11/2026).
 *
 * From the image itself when it travels inline, or from a video's poster.
 * Since the media store (13/11) an image the vault holds comes as `{ ref, mini }`
 * and a poster as `{ ref }`: then the bytes come from the store (`lerBytes`,
 * the thumbnail first). Nothing when the message has no picture, when the
 * bytes were evicted or are not on this device, or when the browser cannot
 * redraw it: the pin then keeps the name of the file, and the core still tries
 * the image itself if it is already small enough.
 */
export async function miniaturaParaFixar(
  anexos:
    | readonly { inline?: string; poster?: unknown; mediaType?: string; evicted?: boolean; ref?: string; mini?: string }[]
    | undefined,
  deps: CompressDeps = {},
  lerBytes?: LerBytes,
): Promise<string | undefined> {
  const primeira = anexos?.find(
    (anexo) => !anexo.evicted && (anexo.mediaType?.startsWith("image/") || anexo.mediaType?.startsWith("video/")),
  )
  if (!primeira) return undefined
  const video = primeira.mediaType?.startsWith("video/") === true
  const texto = video ? primeira.poster : primeira.inline
  try {
    let blob: Blob | undefined
    if (typeof texto === "string" && texto.startsWith("data:image/")) {
      // `dataUrlParaBlob`, never `fetch`: the desktop security policy limits `fetch`.
      blob = dataUrlParaBlob(texto)
    } else {
      const sha = video ? refDe(primeira.poster) : (primeira.mini ?? primeira.ref)
      const bytes = sha && lerBytes ? await lerBytes(sha) : null
      const tipo = bytes ? tipoPelosBytes(bytes) : ""
      if (bytes && tipo) blob = new Blob([bytes as BlobPart], { type: tipo })
    }
    if (!blob) return undefined
    const { dataUrl } = await compressImage(blob, ORCAMENTO_DA_MINIATURA_FIXADA, deps)
    return dataUrl.length <= PINNED_THUMBNAIL_MAX ? dataUrl : undefined
  } catch {
    return undefined
  }
}
