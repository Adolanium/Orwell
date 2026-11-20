import type { Miniaturista } from "@enclave/client-core"
import { TECTOS_DO_ARMAZEM } from "@enclave/client-core"
import { nativeImage } from "electron"

/**
 * The desktop thumbnailer (design §3): Electron's `nativeImage`, in the main
 * process. It only does JPEG and PNG; the thumbnail is JPEG at 80 (the web's
 * WebP at 0.8 does not exist here).
 *
 * What `nativeImage` cannot decode (an empty image: GIF and WebP among them)
 * goes to `naJanela`, the window's Chromium, which makes the thumbnail the way
 * the web does (`miniaturas-pela-janela.ts`). Its null is the core's "unknown
 * format"; its rejection (no window, no answer) passes through, and the core
 * tries again on the next opening. Without `naJanela`, null.
 */
const QUALIDADE_JPEG = 80

/** The part of `nativeImage` in use: swappable in tests, where Electron does not exist. */
export interface PortaNativeImage {
  createFromBuffer(buffer: Buffer): ImagemNativa
}

interface ImagemNativa {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(opcoes: { width?: number; height?: number; quality?: "good" | "better" | "best" }): ImagemNativa
  toJPEG(qualidade: number): Buffer
}

export function miniaturistaDaSecretaria(
  porta: PortaNativeImage | undefined = nativeImage as PortaNativeImage | undefined,
  naJanela?: Miniaturista["fazer"],
): Miniaturista {
  return {
    fazer: async (bytes, tipo) => {
      if (!tipo.startsWith("image/")) return null
      const feita = porta ? comNativeImage(porta, bytes) : null
      if (feita !== "nao-descodifica") return feita
      return naJanela ? naJanela(bytes, tipo) : null
    },
  }
}

/** The thumbnail from `nativeImage`; `"nao-descodifica"` when it cannot read the format (an empty image). */
function comNativeImage(porta: PortaNativeImage, bytes: Uint8Array): MiniaturaJpeg | null | "nao-descodifica" {
  try {
    let imagem = porta.createFromBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    if (imagem.isEmpty()) return "nao-descodifica"
    const { width, height } = imagem.getSize()
    if (!(width > 0 && height > 0)) return null
    const lado = TECTOS_DO_ARMAZEM.ladoDaMiniatura
    const escala = Math.min(1, lado / Math.max(width, height))
    const w = Math.max(1, Math.round(width * escala))
    const h = Math.max(1, Math.round(height * escala))
    if (escala < 1) imagem = imagem.resize({ width: w, height: h, quality: "good" })
    const jpeg = imagem.toJPEG(QUALIDADE_JPEG)
    if (jpeg.length === 0) return null
    return { bytes: new Uint8Array(jpeg), tipo: "image/jpeg", w, h }
  } catch {
    return null
  }
}

interface MiniaturaJpeg {
  bytes: Uint8Array
  tipo: string
  w: number
  h: number
}
