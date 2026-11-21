import type { ArmazemBackend } from "@enclave/client-core"
import { CONTA_PRINCIPAL } from "@enclave/client-core/contas"
import { RECUSA_DE_ESCRITA, nomeDaBaseDeMedia } from "./vault-backend.js"

/**
 * The media store on the web (design §4): an IndexedDB database separate from
 * `enclave`, `enclave-media` or `enclave-media:<id>`, version 1.
 *
 * Three stores:
 * - `blobs`: sha → the encrypted blob (`ArrayBuffer`);
 * - `indice`: sha → `{ b, u, k }` (bytes, last use, class);
 * - `meta`: `tecto`.
 *
 * The design put `b`, `u` and `k` next to the blob. They live in a separate
 * store because of cost: `listar` runs when the vault opens and reads only
 * `indice` (a few bytes per blob), not the 500 MB of blobs; `tocar` rewrites a
 * small record, not the whole blob.
 *
 * No ownership token (design §9): the blobs are immutable and content
 * addressed, and the reference that counts is the vault's. The seal is enough:
 * shared with the vault through `pararDeEscrever`, from then on it refuses
 * everything that writes (write, touch, delete, the ceiling, destroy). Reading
 * goes on.
 */
const VERSAO = 1
const BLOBS = "blobs"
const INDICE = "indice"
const META = "meta"
const STORES = [BLOBS, INDICE, META] as const

interface RegistoDoIndice {
  b: number
  u: number
  k: "original" | "mini"
}

function ehRegisto(valor: unknown): valor is RegistoDoIndice {
  const r = valor as Partial<RegistoDoIndice> | null
  return typeof r === "object" && r !== null && typeof r.b === "number" && typeof r.u === "number" && (r.k === "original" || r.k === "mini")
}

/** A full quota with the key the core knows (Erro 520); anything else, with the browser's name in `cause`. */
function falhaDoArmazem(erro: DOMException | null, passo: string): Error {
  if (erro instanceof DOMException && erro.name === "QuotaExceededError") return new Error("media store is full")
  return new Error("local storage failed", { cause: { passo, nome: erro?.name, detalhe: erro?.message } })
}

function recusa(): Promise<never> {
  return Promise.reject(new Error(RECUSA_DE_ESCRITA, { cause: { porque: "selado" } }))
}

export class BrowserArmazemBackend implements ArmazemBackend {
  readonly #nome: string
  #db: IDBDatabase | null = null
  #aAbrir: Promise<IDBDatabase> | null = null
  #selado = false

  constructor(opcoes: { conta?: string } = {}) {
    this.#nome = nomeDaBaseDeMedia(opcoes.conta ?? CONTA_PRINCIPAL)
  }

  selar(): void {
    this.#selado = true
  }

  /** A tab resumed from the back-forward cache that still owns the vault writes again. */
  dessselar(): void {
    this.#selado = false
  }

  /**
   * The quota the browser gives this origin (design §4), or null if it does
   * not say. The core subtracts the margin and keeps the smaller of the two
   * ceilings. The quota is for the whole origin: the vault and the other
   * accounts live there too.
   */
  async quota(): Promise<number | null> {
    try {
      const { quota } = (await navigator.storage?.estimate?.()) ?? {}
      return typeof quota === "number" && Number.isFinite(quota) ? quota : null
    } catch {
      return null
    }
  }

  listar(): Promise<{ sha: string; bytes: number; ultimoUso: number; classe: "original" | "mini" }[]> {
    return this.#emTransacao("readonly", (tx) => {
      const indice = tx.objectStore(INDICE)
      const chaves = indice.getAllKeys()
      const registos = indice.getAll()
      return () => {
        const lista: { sha: string; bytes: number; ultimoUso: number; classe: "original" | "mini" }[] = []
        const shas = chaves.result as IDBValidKey[]
        ;(registos.result as unknown[]).forEach((registo, i) => {
          const sha = shas[i]
          if (typeof sha === "string" && ehRegisto(registo)) lista.push({ sha, bytes: registo.b, ultimoUso: registo.u, classe: registo.k })
        })
        return lista
      }
    })
  }

  ler(sha: string): Promise<Uint8Array | null> {
    return this.#emTransacao("readonly", (tx) => {
      const pedido = tx.objectStore(BLOBS).get(sha)
      return () => (pedido.result instanceof ArrayBuffer ? new Uint8Array(pedido.result) : null)
    })
  }

  escrever(sha: string, blob: Uint8Array, meta: { bytes: number; classe: "original" | "mini"; ultimoUso: number }): Promise<void> {
    if (this.#selado) return recusa()
    // A copy with only the blob: a view into a larger buffer would take the
    // whole buffer to disk.
    const copia = blob.slice().buffer
    const registo: RegistoDoIndice = { b: meta.bytes, u: meta.ultimoUso, k: meta.classe }
    return this.#emTransacao("readwrite", (tx) => {
      const indice = tx.objectStore(INDICE)
      const existe = indice.get(sha)
      // "If absent": the same sha is the same blob, and the first one stays.
      existe.onsuccess = () => {
        if (existe.result !== undefined) return
        tx.objectStore(BLOBS).put(copia, sha)
        indice.put(registo, sha)
      }
      return () => undefined
    })
  }

  tocar(sha: string, ultimoUso: number): Promise<void> {
    if (this.#selado) return recusa()
    return this.#emTransacao("readwrite", (tx) => {
      const indice = tx.objectStore(INDICE)
      const pedido = indice.get(sha)
      // A touch that arrives after a delete (a get running alongside an
      // eviction) does not bring the record back.
      pedido.onsuccess = () => {
        if (ehRegisto(pedido.result)) indice.put({ ...pedido.result, u: ultimoUso }, sha)
      }
      return () => undefined
    })
  }

  apagar(shas: readonly string[]): Promise<void> {
    if (this.#selado) return recusa()
    if (shas.length === 0) return Promise.resolve()
    return this.#emTransacao("readwrite", (tx) => {
      const blobs = tx.objectStore(BLOBS)
      const indice = tx.objectStore(INDICE)
      for (const sha of shas) {
        blobs.delete(sha)
        indice.delete(sha)
      }
      return () => undefined
    })
  }

  lerTecto(): Promise<number | null> {
    return this.#emTransacao("readonly", (tx) => {
      const pedido = tx.objectStore(META).get("tecto")
      return () => (typeof pedido.result === "number" ? pedido.result : null)
    })
  }

  guardarTecto(bytes: number): Promise<void> {
    if (this.#selado) return recusa()
    return this.#emTransacao("readwrite", (tx) => {
      tx.objectStore(META).put(bytes, "tecto")
      return () => undefined
    })
  }

  /** Deletes this account's whole database. The connection closes first, or this tab itself would block. */
  async destruir(): Promise<void> {
    if (this.#selado) return recusa()
    const aAbrir = this.#aAbrir
    if (aAbrir) await aAbrir.catch(() => undefined)
    this.#db?.close()
    this.#db = null
    await new Promise<void>((resolve, reject) => {
      const pedido = indexedDB.deleteDatabase(this.#nome)
      pedido.onsuccess = () => resolve()
      pedido.onerror = () => reject(falhaDoArmazem(pedido.error, "delete"))
      // `onblocked`: another tab with the database open. It closes it in
      // `onversionchange` and the request goes on by itself; nothing to do here.
    })
  }

  #ligacao(): Promise<IDBDatabase> {
    if (this.#db) return Promise.resolve(this.#db)
    this.#aAbrir ??= new Promise<IDBDatabase>((resolve, reject) => {
      const pedido = indexedDB.open(this.#nome, VERSAO)
      pedido.onupgradeneeded = () => {
        const db = pedido.result
        for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
      }
      pedido.onsuccess = () => {
        const db = pedido.result
        // Another tab deleting the database (`destruir`) or changing the schema:
        // drop the connection, and the next request opens another.
        db.onversionchange = () => {
          db.close()
          if (this.#db === db) this.#db = null
        }
        db.onclose = () => {
          if (this.#db === db) this.#db = null
        }
        this.#db = db
        this.#aAbrir = null
        resolve(db)
      }
      pedido.onerror = () => {
        this.#aAbrir = null
        reject(falhaDoArmazem(pedido.error, "open"))
      }
    })
    return this.#aAbrir
  }

  /**
   * A transaction over the three stores that only resolves on `oncomplete`: a
   * write that aborts (the quota) is never taken as done, and leaves nothing
   * half done.
   */
  async #emTransacao<T>(modo: IDBTransactionMode, trabalho: (tx: IDBTransaction) => () => T): Promise<T> {
    const correr = (db: IDBDatabase): Promise<T> => {
      const tx = db.transaction([...STORES], modo)
      return new Promise<T>((resolve, reject) => {
        let ler: () => T
        try {
          ler = trabalho(tx)
        } catch (erro) {
          try {
            tx.abort()
          } catch {
            // Já tinha acabado.
          }
          reject(erro)
          return
        }
        tx.oncomplete = () => resolve(ler())
        tx.onabort = () => reject(falhaDoArmazem(tx.error, "request"))
      })
    }
    const db = await this.#ligacao()
    try {
      return await correr(db)
    } catch (erro) {
      // The stored connection closed in the meantime (`InvalidStateError` when
      // creating the transaction): open another, once.
      if (!(erro instanceof DOMException && erro.name === "InvalidStateError")) throw erro
      if (this.#db === db) this.#db = null
      return correr(await this.#ligacao())
    }
  }
}
