import { fazerMiniatura } from "../../../web/src/miniatura.js"

/**
 * The window makes the thumbnails `nativeImage` cannot (GIF, WebP): the main
 * process asks (`main/miniaturas-pela-janela.ts`), this answers with the same
 * `id`. The thumbnail comes from the web's code, `fazerMiniatura`: Chromium's
 * `createImageBitmap` (the first frame of a GIF) and an `OffscreenCanvas`,
 * WebP at 0.8. The main process checks the answer again; this side only
 * keeps a malformed request from reaching the decoder.
 */
export interface AnfitriaoDasMiniaturas {
  miniatura?: { responder: (id: number, mini: Awaited<ReturnType<typeof fazerMiniatura>>) => Promise<unknown> }
  on: { miniaturaPedido?: (handler: (carga: unknown) => void) => () => void }
}

export function servirMiniaturasAoAnfitriao(
  host: AnfitriaoDasMiniaturas,
  fazer: (bytes: Uint8Array, tipo: string) => ReturnType<typeof fazerMiniatura> = fazerMiniatura,
): void {
  const miniatura = host.miniatura
  if (!miniatura || !host.on.miniaturaPedido) return
  host.on.miniaturaPedido((carga) => {
    const { id, bytes, tipo } = (carga ?? {}) as { id?: unknown; bytes?: unknown; tipo?: unknown }
    if (typeof id !== "number" || !(bytes instanceof Uint8Array) || typeof tipo !== "string") return
    void fazer(bytes, tipo)
      .catch(() => null)
      .then((mini) => miniatura.responder(id, mini))
      .catch(() => {})
  })
}
