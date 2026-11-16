import type { Miniaturista } from "@enclave/client-core"
import { TECTOS_DO_ARMAZEM } from "@enclave/client-core"
import { nativeImage } from "electron"

/**
 * The desktop thumbnailer (design §3): Electron's `nativeImage`, in the main
 * process. It only does JPEG and PNG; the thumbnail is JPEG at 80 (the web's
 * WebP at 0.8 does not exist here). What `nativeImage` cannot decode (an empty
 * image) gives null, and the core treats the image as an unknown format.
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

export function miniaturistaDaSecretaria(porta: PortaNativeImage | undefined = nativeImage as PortaNativeImage | undefined): Miniaturista {
  return {
    fazer: async (bytes, tipo) => {
      if (!porta || !tipo.startsWith("image/")) return null
      try {
        let imagem = porta.createFromBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
        if (imagem.isEmpty()) return null
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
    },
  }
}
