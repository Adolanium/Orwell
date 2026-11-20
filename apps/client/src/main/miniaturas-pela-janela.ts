/**
 * The thumbnails `nativeImage` cannot make, asked of the window.
 *
 * `nativeImage` decodes only PNG and JPEG (measured in Electron 43: a GIF and
 * a WebP both come out empty, on macOS too). The composer sends photos above
 * 400 KB recoded to WebP, and since 1.3.25 an animated GIF goes intact up to
 * 2 MiB: on the desktop, all of those had no thumbnail. The window's Chromium
 * decodes both, so the main process sends it the bytes and waits for the
 * thumbnail, by `id`, like `PedidosDeEcra`.
 *
 * The window already shows these images: the bytes it receives here are the
 * same it would decode to draw them. What it answers comes from the renderer,
 * so `lerMiniatura` checks every field.
 *
 * No `electron` and no `@enclave/client-core` values here: the preload imports
 * the channel names, and the core would drag the session into it. The side
 * length lives here, and a test pins it to `TECTOS_DO_ARMAZEM.ladoDaMiniatura`.
 */

export const CANAIS_DA_MINIATURA = {
  /** Main to window: `{ id, bytes, tipo }`. */
  pedido: "event:miniatura-pedido",
  /** Window to main: `(id, mini | null)`. */
  resposta: "miniatura:responder",
} as const

export const LADO_DA_MINIATURA_NA_JANELA = 320
/** The web worker gives up at 20 s; the same here, so a window that reloads mid-request does not hold the queue. */
export const PRAZO_DA_MINIATURA_MS = 20_000
/** A 320 px WebP or JPEG is tens of KB. Anything this large is not a thumbnail. */
const MINIATURA_MAX_BYTES = 1024 * 1024

export interface MiniaturaFeita {
  bytes: Uint8Array
  tipo: string
  w: number
  h: number
}

export interface PedidoDeMiniatura {
  id: number
  bytes: Uint8Array
  tipo: string
}

const ladoValido = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= LADO_DA_MINIATURA_NA_JANELA

/** The window's answer, or null if it is not a thumbnail: WebP or JPEG, 1 to 320 px a side, bytes that are bytes. */
export function lerMiniatura(cru: unknown): MiniaturaFeita | null {
  if (!cru || typeof cru !== "object") return null
  const { bytes, tipo, w, h } = cru as Record<string, unknown>
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MINIATURA_MAX_BYTES) return null
  if (tipo !== "image/webp" && tipo !== "image/jpeg") return null
  if (!ladoValido(w) || !ladoValido(h)) return null
  return { bytes, tipo, w, h }
}

interface Aberto {
  resolver: (mini: MiniaturaFeita | null) => void
  rejeitar: (erro: Error) => void
  relogio: ReturnType<typeof setTimeout>
}

export class PedidosDeMiniatura {
  #proximo = 1
  readonly #abertos = new Map<number, Aberto>()

  /**
   * Sends one request and waits for its answer. `enviar` says false when
   * there is no window to ask. No window, the deadline, or `fecharTodos`
   * reject: a platform failure, not a format, so the core tries again on the
   * next opening. Null is the window's answer: it could not decode either.
   */
  pedir(enviar: (pedido: PedidoDeMiniatura) => boolean, bytes: Uint8Array, tipo: string): Promise<MiniaturaFeita | null> {
    const id = this.#proximo++
    return new Promise((resolver, rejeitar) => {
      const relogio = setTimeout(() => this.#fechar(id, new Error("thumbnail: the window did not answer")), PRAZO_DA_MINIATURA_MS)
      relogio.unref?.()
      this.#abertos.set(id, { resolver, rejeitar, relogio })
      let enviado = false
      try {
        enviado = enviar({ id, bytes, tipo })
      } catch {
        enviado = false
      }
      if (!enviado) this.#fechar(id, new Error("thumbnail: no window"))
    })
  }

  /** The window's answer. False for an `id` nobody waits for (late, or never asked). */
  responder(id: unknown, cru: unknown): boolean {
    if (typeof id !== "number") return false
    const aberto = this.#abertos.get(id)
    if (!aberto) return false
    this.#abertos.delete(id)
    clearTimeout(aberto.relogio)
    aberto.resolver(lerMiniatura(cru))
    return true
  }

  /** The window went away: whoever waits is told now, not at the deadline. */
  fecharTodos(): void {
    for (const id of [...this.#abertos.keys()]) this.#fechar(id, new Error("thumbnail: the window closed"))
  }

  #fechar(id: number, erro: Error): void {
    const aberto = this.#abertos.get(id)
    if (!aberto) return
    this.#abertos.delete(id)
    clearTimeout(aberto.relogio)
    aberto.rejeitar(erro)
  }
}
