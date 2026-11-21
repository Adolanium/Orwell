import { fromBase64 } from "@enclave/protocol"
import { Emitter } from "../emitter.js"
import { cifrarBlob, decifrarBlob, type ClasseDoBlob } from "./blob.js"
import type { RefDeMedia } from "./tipos.js"

/**
 * The media store on the device (design §4): the bytes of images and files,
 * encrypted blob by blob, outside the vault. The vault keeps only the
 * reference (`RefDeMedia`), with each blob's key.
 *
 * - **Inventory** in memory, read from the backend on open: `tem` is synchronous.
 * - **Background writes**: `absorver` encrypts at once and marks the sha; the
 *   write goes to a queue. A write that fails removes the sha and emits "falhou".
 * - **Ceiling**: only originals count. After each write, if they exceed the
 *   ceiling, originals leave by last use, skipping the pinned ones (on screen)
 *   and those written less than `protegidoMs` ago. A thumbnail (class "mini")
 *   never leaves.
 *
 * All disk operations (write, touch, delete) go through the same queue, in
 * order: deleting a sha and absorbing it again never arrive swapped.
 */
export const TECTOS_DO_ARMAZEM = {
  /** The default ceiling: 500 MB. */
  omissao: 500_000_000,
  /** The screen options: 250 MB, 500 MB, 1 GB, 2 GB and "No ceiling" (0). */
  opcoes: [250_000_000, 500_000_000, 1_000_000_000, 2_000_000_000, 0],
  /** The longer side of a thumbnail, in pixels. */
  ladoDaMiniatura: 320,
  /** An image up to 320 px and up to this size is its own thumbnail. */
  miniaturaMaxBytes: 40_000,
  /** An original without a thumbnail up to this size becomes class "mini". */
  originalPequeno: 200_000,
  /** A blob written less than this ago never leaves through the ceiling. */
  protegidoMs: 60_000,
  /** The browser gives a quota to the whole origin (the vault lives there too): the effective ceiling sits this margin below it. */
  folgaDaQuota: 50_000_000,
} as const

export interface ArmazemBackend {
  listar(): Promise<{ sha: string; bytes: number; ultimoUso: number; classe: "original" | "mini" }[]>
  ler(sha: string): Promise<Uint8Array | null>
  /** Writes if absent. Idempotent: the same sha is the same blob. */
  escrever(sha: string, blob: Uint8Array, meta: { bytes: number; classe: "original" | "mini"; ultimoUso: number }): Promise<void>
  tocar(sha: string, ultimoUso: number): Promise<void>
  apagar(shas: readonly string[]): Promise<void>
  lerTecto(): Promise<number | null>
  guardarTecto(bytes: number): Promise<void>
  /** Apaga tudo desta conta. */
  destruir(): Promise<void>
  /** Refuses writes from now on (the web, on losing ownership). */
  selar(): void
  /**
   * Lifts `selar` (the web, a tab resumed from the back-forward cache that still
   * owns the vault). Optional: a backend without it stays sealed, and the tab reloads.
   */
  dessselar?(): void
  /**
   * The quota the platform gives, in bytes, or null with no known limit. Only
   * the web has one (`navigator.storage.estimate()`); the desktop writes to
   * disk. Read on open.
   */
  quota?(): Promise<number | null>
}

/** The platform port that makes thumbnails (design §3). Null: a format the platform cannot decode. */
export interface Miniaturista {
  fazer(bytes: Uint8Array, tipo: string): Promise<{ bytes: Uint8Array; tipo: string; w: number; h: number } | null>
}

/** The store errors that reach the screen: Erro 520 and Erro 521. */
export type ErroDoArmazem = "media store is full" | "media store failed"

export interface EventoDoArmazem {
  sha: string
  estado: "guardado" | "saiu" | "falhou"
  /** Only on "falhou": why it did not stay. */
  erro?: ErroDoArmazem
}

/** A backend error, reduced to the two the screen can say. */
function erroDoBackend(e: unknown): ErroDoArmazem {
  return e instanceof Error && e.message === "media store is full" ? "media store is full" : "media store failed"
}

export interface EstadoDoArmazem {
  /** The ceiling chosen on this device. 0 = no ceiling. */
  tecto: number
  /**
   * The ceiling that applies: the chosen one, or the browser quota minus
   * `folgaDaQuota` when that is smaller (design §4). 0 = no ceiling. Different
   * from `tecto`: the screen says why.
   */
  tectoEfectivo: number
  /** Bytes of the originals in the store (thumbnails do not count). */
  usados: number
  /** Bytes of the thumbnails: outside the ceiling, but the screen says how much they take. */
  usadosPelasMinis: number
  originais: number
  minis: number
  /** Originals that did not get in, failed to write or left through the ceiling since opening. */
  emFalta: number
}

interface Entrada {
  bytes: number
  classe: ClasseDoBlob
  ultimoUso: number
  /** When it arrived on this device. Those read from the backend are already past the protection. */
  escritoEm: number
}

export class ArmazemDeMedia {
  readonly #backend: ArmazemBackend
  readonly #agora: () => number
  readonly #eventos = new Emitter<{ media: EventoDoArmazem }>()

  /** Null before opening and after locking: `tem` always says false. */
  #inventario: Map<string, Entrada> | null = null
  /** The encrypted blobs that have not reached the disk yet. */
  #pendentes = new Map<string, Uint8Array>()
  #fixados = new Map<string, number>()
  #emFalta = new Set<string>()
  #tecto: number = TECTOS_DO_ARMAZEM.omissao
  /** The platform quota minus the margin; infinite without a quota. See `#tectoEfectivo`. */
  #limite = Number.POSITIVE_INFINITY
  #fila: Promise<void> = Promise.resolve()
  /** Goes up on each lock: an open that was halfway does not restore the inventory. */
  #geracao = 0
  /**
   * Sealed (Ruling R17): the tab lost ownership of the vault. It reads, but
   * neither writes nor deletes: the owner is the one who writes, and a blob only
   * the owner references must not leave at another's hand.
   */
  #selado = false

  /** The thumbnail port; the one who uses it is whoever absorbs (the vault), not the store. */
  readonly miniaturista: Miniaturista | null

  constructor(backend: ArmazemBackend, miniaturista: Miniaturista | null, agora: () => number = Date.now) {
    this.#backend = backend
    this.miniaturista = miniaturista
    this.#agora = agora
  }

  aoMudar(ouvinte: (e: EventoDoArmazem) => void): () => void {
    return this.#eventos.on("media", ouvinte)
  }

  /** Reads the ceiling and the inventory. Waits first for the writes left in the queue. */
  async abrir(): Promise<void> {
    const geracao = this.#geracao
    await this.#fila
    const [tecto, lista, quota] = await Promise.all([
      this.#backend.lerTecto(),
      this.#backend.listar(),
      // A quota that cannot be read is a quota that is not known: the chosen ceiling applies.
      this.#backend.quota?.().catch(() => null) ?? null,
    ])
    if (geracao !== this.#geracao) return
    // Never 0: 0 is "no ceiling". Below the margin, nothing fits.
    this.#limite = typeof quota === "number" && Number.isFinite(quota) ? Math.max(1, quota - TECTOS_DO_ARMAZEM.folgaDaQuota) : Number.POSITIVE_INFINITY
    const inventario = new Map<string, Entrada>()
    for (const { sha, bytes, ultimoUso, classe } of lista) {
      inventario.set(sha, { bytes, classe, ultimoUso, escritoEm: Number.NEGATIVE_INFINITY })
    }
    this.#tecto = tecto ?? TECTOS_DO_ARMAZEM.omissao
    this.#inventario = inventario
  }

  /**
   * Forgets the inventory and the blobs in memory. The disk stays. What was
   * still in the queue no longer goes to disk (see `#enfileirar`): whoever
   * wants it to get there drains before locking (`drenar`).
   */
  trancar(): void {
    this.#geracao++
    this.#inventario = null
    this.#pendentes.clear()
    this.#fixados.clear()
    this.#emFalta.clear()
  }

  tem(sha: string): boolean {
    return this.#inventario?.has(sha) ?? false
  }

  /** Open: the inventory was read, and `tem` answers. */
  get aberto(): boolean {
    return this.#inventario !== null
  }

  /** Sealed: neither writes nor deletes. See `selar`. */
  get selado(): boolean {
    return this.#selado
  }

  /**
   * Stop writing and deleting, for the rest of this life (the web tab that
   * lost ownership of the vault, Ruling R17). Also seals the backend. What is
   * already in the inventory can still be read.
   */
  selar(): void {
    this.#selado = true
    this.#backend.selar()
  }

  /**
   * Undo `selar`, for a web tab resumed from the back-forward cache that still
   * owns the vault (the host checked that first). `false`, and still sealed, if
   * the backend cannot lift its own seal.
   */
  retomar(): boolean {
    if (!this.#selado) return true
    if (typeof this.#backend.dessselar !== "function") return false
    this.#backend.dessselar()
    this.#selado = false
    return true
  }

  /** Deletes everything for this account (deleting the account, design §9). A sealed store deletes nothing. */
  async destruir(): Promise<void> {
    if (this.#selado) return
    this.trancar()
    await this.#fila
    await this.#backend.destruir()
  }

  /** Encrypts now, marks the sha in the inventory, and writes in the background. */
  absorver(bytes: Uint8Array, ref: RefDeMedia, sha: string): void {
    void this.absorverConfirmado(bytes, ref, sha)
  }

  /**
   * `absorver`, and then says whether THIS blob reached the disk. False when it
   * was not written: already in the inventory (another blob under that sha),
   * a sealed or failing store, or a lock meanwhile. The archive pages wait for
   * true before the vault references them (review of 1.3.18, I2).
   */
  absorverConfirmado(bytes: Uint8Array, ref: RefDeMedia, sha: string): Promise<boolean> {
    const inventario = this.#inventario
    if (inventario?.has(sha)) return Promise.resolve(false)
    // Sealed: the blob is not written, and the reference stays (it comes back from another device).
    if (this.#selado) return Promise.resolve(false)
    let blob: Uint8Array | null = null
    try {
      if (inventario) blob = cifrarBlob(bytes, fromBase64(ref.k), fromBase64(ref.n), sha, ref.c)
    } catch {
      // A key or a nonce with the wrong size: the reference stays, the blob does not.
    }
    if (!inventario || !blob) {
      this.#falhou(sha, "media store failed")
      return Promise.resolve(false)
    }
    const tecto = this.#tectoEfectivo()
    if (ref.c === "original" && tecto > 0 && blob.length > tecto) {
      this.#falhou(sha, "media store is full")
      return Promise.resolve(false)
    }

    const agora = this.#agora()
    const entrada: Entrada = { bytes: blob.length, classe: ref.c, ultimoUso: agora, escritoEm: agora }
    return this.#escrever(sha, blob, entrada).then(
      () => this.#inventario === inventario && inventario.get(sha) === entrada && !this.#pendentes.has(sha),
      () => false,
    )
  }

  /**
   * Changes the class of a blob that is already there (design §3, Ruling R9):
   * the AAD binds the class, so turning an original into "mini" means
   * decrypting with the old reference and re-encrypting with the new one. The
   * new one must bring another nonce: the same key and nonce with another AAD
   * would repeat the Poly1305 key.
   *
   * On disk, it deletes and writes again through the queue, in order, and
   * resolves once the new blob is there (1.3.15). The caller writes the new
   * reference to the vault right after: the disk never holds the new reference
   * over the old blob. False if the sha is not there; throws "media blob is
   * damaged" if the old one does not open.
   */
  async reclassificar(sha: string, refAntiga: RefDeMedia, refNova: RefDeMedia): Promise<boolean> {
    if (refAntiga.k === refNova.k && refAntiga.n === refNova.n) throw new RangeError("a new media class needs a new nonce")
    if (this.#selado) return false
    const inventario = this.#inventario
    const entrada = inventario?.get(sha)
    if (!inventario || !entrada) return false
    const blob = this.#pendentes.get(sha) ?? (await this.#backend.ler(sha))
    if (this.#inventario !== inventario || inventario.get(sha) !== entrada || !blob) return false
    let novo: Uint8Array
    try {
      const bytes = decifrarBlob(blob, fromBase64(refAntiga.k), fromBase64(refAntiga.n), sha, refAntiga.c)
      novo = cifrarBlob(bytes, fromBase64(refNova.k), fromBase64(refNova.n), sha, refNova.c)
    } catch {
      this.#largarEstragado(sha, inventario, entrada, blob)
      throw new Error("media blob is damaged")
    }
    // Only once the new blob is on disk (1.3.15): the caller then writes the new reference to
    // the vault, and a crash in between leaves the old pair (blob and reference), never a mix.
    await this.#escrever(sha, novo, { ...entrada, bytes: novo.length, classe: refNova.c }, true)
    return this.#inventario === inventario && inventario.get(sha)?.classe === refNova.c
  }

  /** The shas in the inventory, plus those still in the queue. Empty before opening. */
  shas(): string[] {
    return [...(this.#inventario?.keys() ?? [])]
  }

  /**
   * Decrypts a blob off this thread (a Worker in the web app, a worker thread on
   * the desktop). Null decrypts here. A 1 MB photo costs ~150 ms on a slow
   * laptop, and it ran right when a channel opened.
   */
  decifrador: ((blob: Uint8Array, k: Uint8Array, n: Uint8Array, sha: string, classe: RefDeMedia["c"]) => Promise<Uint8Array>) | null = null

  /** Decrypts the blob and touches its last use. Null if absent. Throws "media blob is damaged". */
  async obter(sha: string, ref: RefDeMedia): Promise<Uint8Array | null> {
    const inventario = this.#inventario
    const entrada = inventario?.get(sha)
    if (!inventario || !entrada) return null
    const blob = this.#pendentes.get(sha) ?? (await this.#backend.ler(sha))
    if (this.#inventario !== inventario) return null
    if (!blob) {
      // The inventory said it was there and the disk does not have it: fix the inventory.
      if (inventario.get(sha) === entrada) inventario.delete(sha)
      return null
    }
    let bytes: Uint8Array
    try {
      const k = fromBase64(ref.k)
      const n = fromBase64(ref.n)
      // A decrypter that fails (a Worker that stopped) says nothing about the blob: open it here
      // before calling it damaged, because a damaged blob is deleted from disk.
      bytes = this.decifrador
        ? await this.decifrador(blob, k, n, sha, ref.c).catch(() => decifrarBlob(blob, k, n, sha, ref.c))
        : decifrarBlob(blob, k, n, sha, ref.c)
    } catch {
      // A key or a nonce that is not even base64 is also a blob that does not open.
      this.#largarEstragado(sha, inventario, entrada, blob)
      throw new Error("media blob is damaged")
    }
    // Locked while the bytes were on their way: they belong to nobody now.
    if (this.#inventario !== inventario) return null
    const agora = this.#agora()
    entrada.ultimoUso = agora
    // The last use on disk is a hint for the LRU: losing it breaks nothing.
    this.#enfileirar(() => this.#backend.tocar(sha, agora)).catch(() => {})
    return bytes
  }

  /** The encrypted blob as it is on disk, without decrypting (export with the images). Null if absent. */
  async lerEmBruto(sha: string): Promise<Uint8Array | null> {
    return this.#pendentes.get(sha) ?? (await this.#backend.ler(sha))
  }

  /**
   * Writes an encrypted blob that came from outside, as is (import with the
   * images). Idempotent, like the backend's `escrever`. It also runs with the
   * store locked (import locks the vault before writing): it goes through the
   * queue, in order, and resolves when the disk has it. Throws if the backend
   * refuses.
   */
  async guardarEmBruto(sha: string, blob: Uint8Array, classe: ClasseDoBlob): Promise<void> {
    if (this.#selado) throw new Error("media store failed")
    const agora = this.#agora()
    const inventario = this.#inventario
    await this.#enfileirar(() => this.#backend.escrever(sha, blob, { bytes: blob.length, classe, ultimoUso: agora }))
    if (inventario && this.#inventario === inventario && !inventario.has(sha)) {
      inventario.set(sha, { bytes: blob.length, classe, ultimoUso: agora, escritoEm: agora })
      this.#emFalta.delete(sha)
    }
  }

  /** What is on screen does not leave. Counted: each `fixar` needs its `soltar`. */
  fixar(sha: string): void {
    this.#fixados.set(sha, (this.#fixados.get(sha) ?? 0) + 1)
  }

  soltar(sha: string): void {
    const n = this.#fixados.get(sha) ?? 0
    if (n <= 1) this.#fixados.delete(sha)
    else this.#fixados.set(sha, n - 1)
  }

  async apagar(shas: readonly string[]): Promise<void> {
    if (this.#selado) return
    const saidos: string[] = []
    for (const sha of shas) {
      this.#pendentes.delete(sha)
      this.#emFalta.delete(sha)
      if (this.#inventario?.delete(sha)) saidos.push(sha)
    }
    await this.#enfileirar(() => this.#backend.apagar(shas))
    for (const sha of saidos) this.#eventos.emit("media", { sha, estado: "saiu" })
  }

  /** 0 = no ceiling. Lowering the ceiling evicts what is over it at once. */
  async definirTecto(bytes: number): Promise<void> {
    if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError("invalid media store ceiling", { cause: { bytes } })
    if (this.#selado) return
    this.#tecto = bytes
    await this.#enfileirar(() => this.#backend.guardarTecto(bytes))
    this.#despejar()
  }

  estado(): EstadoDoArmazem {
    let usados = 0
    let usadosPelasMinis = 0
    let originais = 0
    let minis = 0
    for (const entrada of this.#inventario?.values() ?? []) {
      if (entrada.classe === "mini") {
        minis++
        usadosPelasMinis += entrada.bytes
      } else {
        originais++
        usados += entrada.bytes
      }
    }
    return { tecto: this.#tecto, tectoEfectivo: this.#tectoEfectivo(), usados, usadosPelasMinis, originais, minis, emFalta: this.#emFalta.size }
  }

  /**
   * "Free up space" (design §8): removes every original that is not on screen,
   * even those just written. Thumbnails always stay. What leaves is marked
   * missing, and comes back with "Fetch". Resolves when the disk deleted them.
   */
  async libertar(): Promise<void> {
    const inventario = this.#inventario
    if (!inventario || this.#selado) return
    const saidos: string[] = []
    for (const [sha, entrada] of inventario) {
      if (entrada.classe !== "original" || this.#fixados.has(sha)) continue
      saidos.push(sha)
    }
    if (saidos.length === 0) return
    this.#tirar(saidos)
    await this.#enfileirar(() => this.#backend.apagar(saidos))
  }

  /** 0 = no ceiling. The smaller of the chosen one and the platform limit. */
  #tectoEfectivo(): number {
    const escolhido = this.#tecto > 0 ? this.#tecto : Number.POSITIVE_INFINITY
    const efectivo = Math.min(escolhido, this.#limite)
    return Number.isFinite(efectivo) ? efectivo : 0
  }

  /**
   * A blob that does not open with the vault's reference (1.3.15): written under
   * another key (another account on the same store, an import over an old store,
   * a write that landed in the next account's folder), or broken. It never heals
   * by itself: `absorver` skips a sha that is already there, and the backends
   * write only if absent, so "Fetch" brought the bytes and the image failed again,
   * forever. Now it leaves the inventory and the disk, and is missing for real:
   * the next absorption writes it with the right key.
   *
   * Only if nothing changed under the reader: a reference taken just before a
   * reclassification reads the old blob, and must not delete the new one. A
   * sealed store deletes nothing (Ruling R17).
   */
  #largarEstragado(sha: string, inventario: Map<string, Entrada>, entrada: Entrada, blob: Uint8Array): void {
    if (this.#selado || this.#inventario !== inventario || inventario.get(sha) !== entrada) return
    const pendente = this.#pendentes.get(sha)
    if (pendente !== undefined && pendente !== blob) return
    this.#tirar([sha])
    this.#enfileirar(() => this.#backend.apagar([sha])).catch(() => {})
  }

  /** Removes from the inventory and from memory, marks missing and emits "saiu". The disk is the caller's job. */
  #tirar(shas: readonly string[]): void {
    for (const sha of shas) {
      this.#inventario?.delete(sha)
      this.#pendentes.delete(sha)
      this.#emFalta.add(sha)
    }
    for (const sha of shas) this.#eventos.emit("media", { sha, estado: "saiu" })
  }

  /** Resolves when the disk queue empties (tests, export, sign out). */
  async drenar(): Promise<void> {
    let fila: Promise<void>
    do {
      fila = this.#fila
      await fila
    } while (fila !== this.#fila)
  }

  /**
   * Marks the sha in the inventory with `entrada` and writes the blob through
   * the queue. With `substituir`, first deletes what the disk has (the backend
   * only writes what does not exist). A write that fails removes the sha and
   * emits "falhou".
   */
  #escrever(sha: string, blob: Uint8Array, entrada: Entrada, substituir = false): Promise<void> {
    const inventario = this.#inventario
    if (!inventario) return Promise.resolve()
    inventario.set(sha, entrada)
    this.#pendentes.set(sha, blob)
    this.#emFalta.delete(sha)
    const geracao = this.#geracao
    return this.#enfileirar(async () => {
      try {
        if (substituir) await this.#backend.apagar([sha])
        // Locked between the delete and the write (1.3.15): on the desktop the folder
        // underneath may already be the next account's. The rest of the task is dropped.
        if (geracao !== this.#geracao) return
        await this.#backend.escrever(sha, blob, { bytes: entrada.bytes, classe: entrada.classe, ultimoUso: entrada.ultimoUso })
      } catch (e) {
        if (this.#pendentes.get(sha) === blob) this.#pendentes.delete(sha)
        if (this.#inventario?.get(sha) !== entrada) return
        this.#inventario.delete(sha)
        this.#emFalta.add(sha)
        this.#eventos.emit("media", { sha, estado: "falhou", erro: erroDoBackend(e) })
        return
      }
      if (this.#pendentes.get(sha) === blob) this.#pendentes.delete(sha)
      if (this.#inventario?.get(sha) !== entrada) return
      this.#eventos.emit("media", { sha, estado: "guardado" })
      this.#despejar()
    })
  }

  /**
   * A queue task only touches the disk if the store has not locked meanwhile.
   * After locking, the backend may already be another account's (the desktop
   * swaps the folder on "Switch account"): a blob of this account written there,
   * with the same sha as a media item of the other, would stay unreadable for
   * it forever (Erro 522) and would never be collected, because its reference
   * holds it.
   */
  #enfileirar(tarefa: () => Promise<void>): Promise<void> {
    const geracao = this.#geracao
    const feita = this.#fila.then(() => (geracao === this.#geracao ? tarefa() : undefined))
    this.#fila = feita.catch(() => {})
    return feita
  }

  /** The "falhou" event goes out through the queue, never inside the caller of `absorver` (the vault mutation). */
  #falhou(sha: string, erro: ErroDoArmazem): void {
    if (this.#inventario) this.#emFalta.add(sha)
    this.#enfileirar(async () => {
      this.#eventos.emit("media", { sha, estado: "falhou", erro })
    })
  }

  /** If the originals exceed the ceiling, they leave by last use; pinned, recent and thumbnails stay. */
  #despejar(): void {
    const inventario = this.#inventario
    const tecto = this.#tectoEfectivo()
    if (!inventario || tecto <= 0 || this.#selado) return
    let usados = this.estado().usados
    if (usados <= tecto) return

    const agora = this.#agora()
    const candidatos = [...inventario]
      .filter(([sha, e]) => e.classe === "original" && !this.#fixados.has(sha) && agora - e.escritoEm >= TECTOS_DO_ARMAZEM.protegidoMs)
      .sort(([, a], [, b]) => a.ultimoUso - b.ultimoUso)
    const saidos: string[] = []
    for (const [sha, entrada] of candidatos) {
      if (usados <= tecto) break
      usados -= entrada.bytes
      saidos.push(sha)
    }
    if (saidos.length === 0) return
    this.#tirar(saidos)
    // A delete that fails leaves the blob on disk; the next open lists it and the ceiling sees it again.
    this.#enfileirar(() => this.#backend.apagar(saidos)).catch(() => {})
  }
}
