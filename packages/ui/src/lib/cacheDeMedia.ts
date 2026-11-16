/**
 * The URLs of the media store images, per session (design §8).
 *
 * The store gives decrypted bytes (`bridge.media.bytes`); an `<img>` wants a
 * URL. Each `sha` gives a `blob:` once, and it is kept here up to the ceiling
 * (64 MB of bytes). Above it the least recently used leaves, and its URL is
 * revoked. What is on screen stays held (`prender`) and never leaves.
 *
 * In an environment without `URL.createObjectURL` (the tests in jsdom), the
 * URL is a data URL with the same bytes.
 */

type Criar = (bytes: Uint8Array, tipo: string) => string
type Revogar = (url: string) => void

interface Guardado {
  url: string
  peso: number
}

/** The cache ceiling, in bytes. */
export const TECTO_DA_CACHE = 64 * 1024 * 1024

export class CacheDeMedia {
  /** In order of use: the first is the least recently used. */
  readonly #guardados = new Map<string, Guardado>()
  readonly #emCurso = new Map<string, Promise<string | null>>()
  readonly #presos = new Map<string, number>()
  #peso = 0
  /** Goes up on each `esvaziar`: a read from before does not get in afterwards. */
  #geracao = 0

  constructor(
    private readonly tecto: number = TECTO_DA_CACHE,
    private readonly criar: Criar = criarEndereco,
    private readonly revogar: Revogar = revogarEndereco,
  ) {}

  /** The URL already there, without asking for anything. Counts as a use. */
  ja(sha: string): string | null {
    const guardado = this.#guardados.get(sha)
    if (!guardado) return null
    this.#guardados.delete(sha)
    this.#guardados.set(sha, guardado)
    return guardado.url
  }

  /** Is this URL still this `sha`'s (it did not leave through the ceiling nor was revoked)? */
  ainda(sha: string, url: string): boolean {
    return this.#guardados.get(sha)?.url === url
  }

  /** The URL for this `sha`, read by `ler` if it is not there yet. Null if `ler` gives null or fails; null is not kept. */
  obter(sha: string, tipo: string, ler: (sha: string) => Promise<Uint8Array | null>): Promise<string | null> {
    const ja = this.ja(sha)
    if (ja) return Promise.resolve(ja)
    const emCurso = this.#emCurso.get(sha)
    if (emCurso) return emCurso
    const geracao = this.#geracao
    const pedido = ler(sha)
      .catch(() => null)
      .then((bytes) => {
        // Emptied meanwhile (locking, another account): these bytes no longer belong to anyone.
        if (geracao !== this.#geracao) return null
        this.#emCurso.delete(sha)
        if (!bytes) return null
        const url = this.criar(bytes, tipo)
        this.#guardados.set(sha, { url, peso: bytes.byteLength })
        this.#peso += bytes.byteLength
        this.#caber()
        return url
      })
    this.#emCurso.set(sha, pedido)
    return pedido
  }

  /** It is on screen: it does not leave through the ceiling. Each `prender` needs its `soltar`. */
  prender(sha: string): void {
    this.#presos.set(sha, (this.#presos.get(sha) ?? 0) + 1)
  }

  soltar(sha: string): void {
    const n = (this.#presos.get(sha) ?? 0) - 1
    if (n > 0) this.#presos.set(sha, n)
    else this.#presos.delete(sha)
  }

  /** Revokes everything and forgets the reads in progress and the held ones (lock, switch account). */
  esvaziar(): void {
    this.#geracao++
    for (const { url } of this.#guardados.values()) this.revogar(url)
    this.#guardados.clear()
    this.#emCurso.clear()
    this.#presos.clear()
    this.#peso = 0
  }

  #caber(): void {
    for (const [sha, guardado] of this.#guardados) {
      if (this.#peso <= this.tecto) return
      if (this.#presos.has(sha)) continue
      this.#guardados.delete(sha)
      this.#peso -= guardado.peso
      this.revogar(guardado.url)
    }
  }
}

function criarEndereco(bytes: Uint8Array, tipo: string): string {
  if (typeof URL.createObjectURL === "function") return URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }))
  let binario = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${tipo || "application/octet-stream"};base64,${btoa(binario)}`
}

function revogarEndereco(url: string): void {
  if (url.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url)
}

/** The session cache: one for the whole interface. */
export const cacheDeMedia = new CacheDeMedia()
