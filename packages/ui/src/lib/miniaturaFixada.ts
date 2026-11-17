import { PINNED_THUMBNAIL_MAX } from "@enclave/protocol"
import { dataUrlParaBlob } from "./enquadrar.js"
import { compressImage, type CompressDeps } from "./images.js"

/**
 * The budget of the thumbnail a pin carries: 160 px, about 5 KB. It must fit in
 * `PINNED_THUMBNAIL_MAX` after base64, and twenty of them travel to everyone who
 * joins. See `PinnedAttachment` in the protocol.
 */
export const ORCAMENTO_DA_MINIATURA_FIXADA = { maxSide: 160, maxBytes: 5_500 } as const

/**
 * A small image of the first picture of a message, for the copy of a pin (12/11/2026).
 *
 * From the image itself when it travels inline, or from a video's poster. Nothing
 * when the message has no picture, when the bytes were evicted, or when the
 * browser cannot redraw it: the pin then keeps the name of the file, and the core
 * still tries the image itself if it is already small enough.
 */
export async function miniaturaParaFixar(
  anexos: readonly { inline?: string; poster?: string; mediaType?: string; evicted?: boolean }[] | undefined,
  deps: CompressDeps = {},
): Promise<string | undefined> {
  const primeira = anexos?.find(
    (anexo) => !anexo.evicted && (anexo.mediaType?.startsWith("image/") || anexo.mediaType?.startsWith("video/")),
  )
  const fonte = primeira?.mediaType?.startsWith("video/") ? primeira.poster : primeira?.inline
  if (!fonte || !fonte.startsWith("data:image/")) return undefined
  try {
    // `dataUrlParaBlob`, never `fetch`: the desktop security policy limits `fetch`.
    const { dataUrl } = await compressImage(dataUrlParaBlob(fonte), ORCAMENTO_DA_MINIATURA_FIXADA, deps)
    return dataUrl.length <= PINNED_THUMBNAIL_MAX ? dataUrl : undefined
  } catch {
    return undefined
  }
}
