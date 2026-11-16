import type { ArmazemBackend } from "@enclave/client-core"
import { TECTOS_DO_ARMAZEM } from "@enclave/client-core"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { escreverInteiro, pastaDaConta } from "./vault-backend.js"

/**
 * The media store on the desktop (design §4): files in the account folder.
 *
 *     <pastaDaConta>/media/<sha>.orwm     one encrypted blob, mode 0600
 *     <pastaDaConta>/media/indice.json    { v: 1, tecto, usos: { sha: ultimoUso }, minis: [sha] }
 *
 * The `sha` is base64url (`A-Za-z0-9-_`): a safe file name on all three
 * systems. Any other sha is refused before it becomes a path.
 *
 * The files are the truth: `listar` reads the folder. The index only keeps what
 * the disk does not say: the last use, the class, the ceiling. It is written at
 * most every 10 s and in `descarregar` (when the app closes: Task 9 wires that).
 * A blob with no index entry (the index was lost, or the app died before
 * writing it) takes its last use from `mtime`, and its class from its size: up
 * to the small-original threshold it is "mini". Erring towards "mini" leaves
 * one extra blob outside the ceiling; erring towards "original" could evict a
 * thumbnail, which never leaves.
 *
 * `media store is full` (Erro 520) on a full disk, the same key the web gives
 * for the browser quota.
 */
const SHA_VALIDO = /^[A-Za-z0-9_-]{1,128}$/
const EXTENSAO = ".orwm"
const INDICE = "indice.json"
const INTERVALO_DO_INDICE_MS = 10_000
/** The blob of a small original: the plaintext plus the `orwm1\n` header and the 16-byte tag. */
const LIMIAR_DE_MINI = TECTOS_DO_ARMAZEM.originalPequeno + 6 + 16

interface Indice {
  tecto: number | null
  usos: Map<string, number>
  minis: Set<string>
}

function lerIndice(caminho: string): Indice {
  const vazio: Indice = { tecto: null, usos: new Map(), minis: new Set() }
  if (!existsSync(caminho)) return vazio
  try {
    const bruto = JSON.parse(readFileSync(caminho, "utf8")) as { v?: unknown; tecto?: unknown; usos?: unknown; minis?: unknown }
    if (bruto.v !== 1 || typeof bruto.usos !== "object" || bruto.usos === null) return vazio
    const usos = new Map<string, number>()
    for (const [sha, u] of Object.entries(bruto.usos)) if (SHA_VALIDO.test(sha) && typeof u === "number") usos.set(sha, u)
    const minis = new Set(Array.isArray(bruto.minis) ? bruto.minis.filter((sha): sha is string => typeof sha === "string" && usos.has(sha)) : [])
    return { tecto: typeof bruto.tecto === "number" ? bruto.tecto : null, usos, minis }
  } catch {
    // A broken index is a missing index: it is rebuilt from the files.
    return vazio
  }
}

function disco(erro: unknown): unknown {
  return erro instanceof Error && erro.message === "vault storage is full" ? new Error("media store is full", { cause: erro.cause }) : erro
}

export class DesktopArmazemBackend implements ArmazemBackend {
  readonly #pasta: string
  #indice: Indice | null = null
  #sujo = false
  #relogio: ReturnType<typeof setTimeout> | null = null
  #selado = false

  constructor(pastaDaConta: string) {
    this.#pasta = join(pastaDaConta, "media")
  }

  selar(): void {
    this.#selado = true
  }

  async listar(): Promise<{ sha: string; bytes: number; ultimoUso: number; classe: "original" | "mini" }[]> {
    const indice = this.#lido()
    let nomes: string[]
    try {
      nomes = await readdir(this.#pasta)
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") return []
      throw erro
    }
    const shas = nomes.filter((nome) => nome.endsWith(EXTENSAO)).map((nome) => nome.slice(0, -EXTENSAO.length)).filter((sha) => SHA_VALIDO.test(sha))
    const lidos = await Promise.all(
      shas.map(async (sha) => {
        const info = await stat(this.#ficheiro(sha)).catch(() => null)
        return info ? { sha, info } : null
      }),
    )
    const lista: { sha: string; bytes: number; ultimoUso: number; classe: "original" | "mini" }[] = []
    for (const lido of lidos) {
      if (!lido) continue
      const { sha, info } = lido
      let ultimoUso = indice.usos.get(sha)
      if (ultimoUso === undefined) {
        // No entry: rebuild it, and the entry goes into the next index.
        ultimoUso = Math.round(info.mtimeMs)
        indice.usos.set(sha, ultimoUso)
        if (info.size <= LIMIAR_DE_MINI) indice.minis.add(sha)
        this.#agendar()
      }
      lista.push({ sha, bytes: info.size, ultimoUso, classe: indice.minis.has(sha) ? "mini" : "original" })
    }
    return lista
  }

  async ler(sha: string): Promise<Uint8Array | null> {
    if (!SHA_VALIDO.test(sha)) return null
    try {
      return new Uint8Array(await readFile(this.#ficheiro(sha)))
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") return null
      throw erro
    }
  }

  async escrever(sha: string, blob: Uint8Array, meta: { bytes: number; classe: "original" | "mini"; ultimoUso: number }): Promise<void> {
    this.#podeEscrever()
    if (!SHA_VALIDO.test(sha)) throw new Error("media store failed", { cause: { sha } })
    const caminho = this.#ficheiro(sha)
    // "If absent": the same sha is the same blob, and the first one stays.
    if (existsSync(caminho)) return
    mkdirSync(this.#pasta, { recursive: true })
    try {
      escreverInteiro(caminho, blob)
    } catch (erro) {
      throw disco(erro)
    }
    const indice = this.#lido()
    indice.usos.set(sha, meta.ultimoUso)
    if (meta.classe === "mini") indice.minis.add(sha)
    else indice.minis.delete(sha)
    this.#agendar()
  }

  async tocar(sha: string, ultimoUso: number): Promise<void> {
    this.#podeEscrever()
    // A touch that arrives after a delete does not bring the entry back.
    if (!SHA_VALIDO.test(sha) || !existsSync(this.#ficheiro(sha))) return
    this.#lido().usos.set(sha, ultimoUso)
    this.#agendar()
  }

  async apagar(shas: readonly string[]): Promise<void> {
    this.#podeEscrever()
    const indice = this.#lido()
    for (const sha of shas) {
      if (!SHA_VALIDO.test(sha)) continue
      rmSync(this.#ficheiro(sha), { force: true })
      rmSync(`${this.#ficheiro(sha)}.tmp`, { force: true })
      indice.usos.delete(sha)
      indice.minis.delete(sha)
    }
    this.#agendar()
  }

  async lerTecto(): Promise<number | null> {
    return this.#lido().tecto
  }

  async guardarTecto(bytes: number): Promise<void> {
    this.#podeEscrever()
    this.#lido().tecto = bytes
    this.#sujo = true
    this.descarregar()
  }

  /** Deletes the whole `media/`. An index that was about to be written is no longer written. */
  async destruir(): Promise<void> {
    this.#podeEscrever()
    this.#pararRelogio()
    this.#sujo = false
    this.#indice = { tecto: null, usos: new Map(), minis: new Set() }
    rmSync(this.#pasta, { recursive: true, force: true })
  }

  /** Writes the index now, if it changed. Call it when the app closes. */
  descarregar(): void {
    this.#pararRelogio()
    if (!this.#sujo || !this.#indice) return
    const { tecto, usos, minis } = this.#indice
    const json = JSON.stringify({ v: 1, tecto, usos: Object.fromEntries(usos), minis: [...minis] })
    try {
      mkdirSync(this.#pasta, { recursive: true })
      escreverInteiro(join(this.#pasta, INDICE), new TextEncoder().encode(json))
      this.#sujo = false
    } catch {
      // Full disk: the index stays in memory and is retried. Without it, the
      // worst case is rebuilding from `mtime`.
      this.#agendar()
    }
  }

  #ficheiro(sha: string): string {
    return join(this.#pasta, `${sha}${EXTENSAO}`)
  }

  #lido(): Indice {
    this.#indice ??= lerIndice(join(this.#pasta, INDICE))
    return this.#indice
  }

  #podeEscrever(): void {
    if (this.#selado) throw new Error("media store failed", { cause: { porque: "selado" } })
  }

  #agendar(): void {
    this.#sujo = true
    if (this.#relogio) return
    this.#relogio = setTimeout(() => {
      this.#relogio = null
      this.descarregar()
    }, INTERVALO_DO_INDICE_MS)
    this.#relogio.unref?.()
  }

  #pararRelogio(): void {
    if (this.#relogio) clearTimeout(this.#relogio)
    this.#relogio = null
  }
}

/**
 * The store of the active account ("Switch account"). The main-process session
 * is born once, with a single store; accounts swap underneath it, as the vault
 * swaps in `DesktopVaultBackend.usarConta`.
 *
 * `usarConta` only with the vault locked (`vault.lock()` locks the store first):
 * it writes the index of the leaving account and moves to the other folder. The
 * core queue does not reach the new folder: a task that had not started is
 * dropped when the store locks, and since 1.3.15 so is the second half of a
 * replace (delete, then write) that the lock caught in the middle. A write
 * already started finishes in the folder it began in.
 */
export class ArmazemDaContaActiva implements ArmazemBackend {
  readonly #raiz: string
  #actual: DesktopArmazemBackend
  #selado = false

  constructor(raiz: string, conta: string) {
    this.#raiz = raiz
    this.#actual = new DesktopArmazemBackend(pastaDaConta(raiz, conta))
  }

  usarConta(conta: string): void {
    this.#actual.descarregar()
    this.#actual = new DesktopArmazemBackend(pastaDaConta(this.#raiz, conta))
    if (this.#selado) this.#actual.selar()
  }

  /** Writes the index now. When the app closes. */
  descarregar(): void {
    this.#actual.descarregar()
  }

  selar(): void {
    this.#selado = true
    this.#actual.selar()
  }

  listar(): ReturnType<ArmazemBackend["listar"]> {
    return this.#actual.listar()
  }

  ler(sha: string): Promise<Uint8Array | null> {
    return this.#actual.ler(sha)
  }

  escrever(sha: string, blob: Uint8Array, meta: { bytes: number; classe: "original" | "mini"; ultimoUso: number }): Promise<void> {
    return this.#actual.escrever(sha, blob, meta)
  }

  tocar(sha: string, ultimoUso: number): Promise<void> {
    return this.#actual.tocar(sha, ultimoUso)
  }

  apagar(shas: readonly string[]): Promise<void> {
    return this.#actual.apagar(shas)
  }

  lerTecto(): Promise<number | null> {
    return this.#actual.lerTecto()
  }

  guardarTecto(bytes: number): Promise<void> {
    return this.#actual.guardarTecto(bytes)
  }

  destruir(): Promise<void> {
    return this.#actual.destruir()
  }
}
