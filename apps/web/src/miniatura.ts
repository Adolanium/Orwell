/**
 * The thumbnail itself (design §3): decode, scale the longer side to 320 px,
 * encode. Its own file so the desktop window can make thumbnails with the
 * same code (`apps/client/src/renderer/miniaturas.ts`) without pulling in the
 * web worker that `miniaturista.ts` starts. No values from
 * `@enclave/client-core`, for the reason in `miniaturista.ts`.
 */
export const LADO_DA_MINIATURA = 320
export const QUALIDADE_DA_MINIATURA = 0.8

export interface ImagemDescodificada {
  readonly width: number
  readonly height: number
  close(): void
}

/** The two browser ports, swappable in tests (jsdom has neither). */
export interface PortasDaMiniatura {
  /** Null: the browser cannot decode this format. */
  descodificar(bytes: Uint8Array, tipo: string): Promise<ImagemDescodificada | null>
  /** Draws at w x h and encodes. The returned `tipo` is what the browser did, which may not be what was asked. */
  codificar(imagem: ImagemDescodificada, w: number, h: number, tipo: string, qualidade: number): Promise<{ bytes: Uint8Array; tipo: string }>
}

export const portasDoBrowser: PortasDaMiniatura = {
  descodificar: async (bytes, tipo) => {
    try {
      return await createImageBitmap(new Blob([bytes as BlobPart], { type: tipo }))
    } catch {
      return null
    }
  },
  codificar: async (imagem, w, h, tipo, qualidade) => {
    const tela = new OffscreenCanvas(w, h)
    const contexto = tela.getContext("2d")
    if (!contexto) throw new Error("no 2d context")
    contexto.drawImage(imagem as ImageBitmap, 0, 0, w, h)
    const feito = await tela.convertToBlob({ type: tipo, quality: qualidade })
    return { bytes: new Uint8Array(await feito.arrayBuffer()), tipo: feito.type }
  },
}

/** The longer side at `lado`, the aspect ratio intact, never larger than the original, never 0. */
export function dimensoesDaMiniatura(largura: number, altura: number, lado: number): { w: number; h: number } {
  const escala = Math.min(1, lado / Math.max(largura, altura))
  return { w: Math.max(1, Math.round(largura * escala)), h: Math.max(1, Math.round(altura * escala)) }
}

/** WebP at 0.8; Safari, which does not encode WebP and returns PNG, falls back to JPEG at 0.8. Null on any failure. */
export async function fazerMiniatura(
  bytes: Uint8Array,
  tipo: string,
  portas: PortasDaMiniatura = portasDoBrowser,
): Promise<{ bytes: Uint8Array; tipo: string; w: number; h: number } | null> {
  const imagem = await portas.descodificar(bytes, tipo).catch(() => null)
  if (!imagem) return null
  try {
    if (!(imagem.width > 0 && imagem.height > 0)) return null
    const { w, h } = dimensoesDaMiniatura(imagem.width, imagem.height, LADO_DA_MINIATURA)
    let feito = await portas.codificar(imagem, w, h, "image/webp", QUALIDADE_DA_MINIATURA)
    if (feito.tipo !== "image/webp") feito = await portas.codificar(imagem, w, h, "image/jpeg", QUALIDADE_DA_MINIATURA)
    if (feito.tipo !== "image/webp" && feito.tipo !== "image/jpeg") return null
    return { bytes: feito.bytes, tipo: feito.tipo, w, h }
  } catch {
    return null
  } finally {
    imagem.close()
  }
}
