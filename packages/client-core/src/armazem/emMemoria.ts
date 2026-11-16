import type { ArmazemBackend } from "./armazem.js"

interface BlobGuardado {
  blob: Uint8Array
  bytes: number
  classe: "original" | "mini"
  ultimoUso: number
}

/**
 * An in-memory store backend, for tests. Copies on the way in and out, like a
 * disk: whoever stores and whoever reads never share the same view.
 *
 * `quota` plays the browser quota or the full disk: a write that exceeds it
 * rejects with "media store is full". `falharProxima` fails only the next
 * write.
 */
export class ArmazemEmMemoria implements ArmazemBackend {
  readonly #blobs = new Map<string, BlobGuardado>()
  readonly #quota: number
  #tecto: number | null = null
  #falhas: Error[] = []
  #selado = false

  constructor(opcoes: { quota?: number } = {}) {
    this.#quota = opcoes.quota ?? Number.POSITIVE_INFINITY
  }

  /** The next write rejects with this error ("media store is full" by default). */
  falharProxima(erro: Error = new Error("media store is full")): void {
    this.#falhas.push(erro)
  }

  async listar() {
    return [...this.#blobs].map(([sha, { bytes, ultimoUso, classe }]) => ({ sha, bytes, ultimoUso, classe }))
  }

  async ler(sha: string): Promise<Uint8Array | null> {
    const guardado = this.#blobs.get(sha)
    return guardado ? guardado.blob.slice() : null
  }

  async escrever(sha: string, blob: Uint8Array, meta: { bytes: number; classe: "original" | "mini"; ultimoUso: number }): Promise<void> {
    if (this.#selado) throw new Error("media store failed")
    const falha = this.#falhas.shift()
    if (falha) throw falha
    if (this.#blobs.has(sha)) return
    let ocupado = 0
    for (const { blob: b } of this.#blobs.values()) ocupado += b.length
    if (ocupado + blob.length > this.#quota) throw new Error("media store is full")
    this.#blobs.set(sha, { blob: blob.slice(), ...meta })
  }

  async tocar(sha: string, ultimoUso: number): Promise<void> {
    const guardado = this.#blobs.get(sha)
    if (guardado) guardado.ultimoUso = ultimoUso
  }

  async apagar(shas: readonly string[]): Promise<void> {
    // Sealed (Ruling R17): neither writes nor deletes, like the web.
    if (this.#selado) throw new Error("media store failed")
    for (const sha of shas) this.#blobs.delete(sha)
  }

  async lerTecto(): Promise<number | null> {
    return this.#tecto
  }

  async guardarTecto(bytes: number): Promise<void> {
    this.#tecto = bytes
  }

  async destruir(): Promise<void> {
    if (this.#selado) throw new Error("media store failed")
    this.#blobs.clear()
    this.#tecto = null
  }

  selar(): void {
    this.#selado = true
  }
}
