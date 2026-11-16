import type { CSSProperties } from "react"
import type { Dimensoes } from "@enclave/client-core"

/**
 * An image's dimensions live in the core (`@enclave/client-core`,
 * `armazem/dimensoes.ts`): they are read from a `data:` URL or from the raw
 * bytes of the media store. Only the interface part stays here: the reserved
 * box.
 */
export { dimensoesDaImagem, type Dimensoes } from "@enclave/client-core"

/**
 * The natural width and aspect ratio, for the conversation spacer (`screens.css`,
 * `.message-media .post-images .image-open::before`) to ask for the right width
 * before the image decodes. In the wall no rule reads them, and they stay inert.
 */
export function reserva(d: Dimensoes | null): CSSProperties | undefined {
  if (!d) return undefined
  // Custom properties: React's type does not know them by name.
  return { "--imagem-largura": `${d.largura}px`, "--imagem-proporcao": d.largura / d.altura } as CSSProperties
}
