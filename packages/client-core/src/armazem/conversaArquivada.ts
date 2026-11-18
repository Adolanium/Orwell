import { sha256 } from "@noble/hashes/sha2.js"
import { toBase64 } from "@enclave/protocol"
import type { RefDeMedia, StoredChatMessage, VaultContents } from "../vault.js"
import type { ArmazemDeMedia } from "./armazem.js"
import { shasDoPayload } from "./referencias.js"

/**
 * The conversation past the vault cap, kept on the device (17/11/2026).
 *
 * The vault keeps the last `HISTORY_MAX_PER_CHANNEL` visible messages of each
 * channel, because it is one encrypted file written whole on every change. What
 * the cap pushed out used to be thrown away, and MLS had already spent the key
 * that opened it: the server's copy of the event never opens again on this
 * device. A busy common room (11 000 to 16 000 events a day) left someone away
 * for a few hours with the last 400 messages and nothing before them.
 *
 * Now what the cap pushes out waits in `porArquivar` until it fills a page, and
 * the page goes to the media store as one encrypted blob, class "mini" (the store
 * never evicts it for room). The vault keeps the page's key in `media`, like any
 * blob, and the index in `arquivoDaConversa`. The JSON the vault writes on each
 * change grows by one index line per page, not by the messages.
 */

/** One archived page of a channel's conversation, in the vault index. */
export interface PaginaDoArquivo {
  /** The blob in the media store; its reference is `contents.media[sha]`. */
  sha: string
  /** How many entries the page holds. */
  n: number
  /** The `at` of the first and last entries, for the interface to place it. */
  de: number
  ate: number
  /** The media the page's messages reference: alive while the page is, so the collection keeps them. */
  media: string[]
}

/** Entries per page: one blob per hundred messages, about 30 to 60 kB of JSON. */
export const ENTRADAS_POR_PAGINA = 100

/**
 * Pages kept per channel: 20 000 messages past the vault. More than the busiest
 * channel measured says in the server's thirty days of retention, at about
 * 6 MB of store per full channel. The oldest page leaves first.
 */
export const PAGINAS_POR_CANAL = 200

/** The MIME type of an archive page, so nothing mistakes it for an attachment. */
export const TIPO_DA_PAGINA = "application/x-orwell-conversa+json"

const codificador = new TextEncoder()
const descodificador = new TextDecoder()
const aleatorio = (n: number): string => toBase64(crypto.getRandomValues(new Uint8Array(n)))

/** A page written to the store, not yet in the vault: its entries still wait in `porArquivar`. */
export interface PaginaEmCurso {
  canal: string
  ref: RefDeMedia
  /** The first entry of the page, by identity: the page still fits only if `porArquivar` still starts with it. */
  primeira: StoredChatMessage
  pagina: PaginaDoArquivo
}

/**
 * Seal every full page waiting in `porArquivar`, in two phases (review of 1.3.18, I2).
 *
 * Here, inside the vault write (`aoSerializar`, synchronous), each full page is
 * encrypted and handed to the store, and its entries STAY in `porArquivar`. The
 * vault is written without the page. Only once the store says the blob is on
 * disk does `confirmarPagina` move the entries out and write the reference and
 * the index, in the next vault write. A crash in between leaves the entries
 * where they were, and an orphan blob the collection deletes; never an index
 * pointing at a blob that is not there, nor a reference with a key that does
 * not open the blob under its sha.
 *
 * Each page carries a random salt, so a page formed again from the same
 * entries (after such a crash) has another sha, and never meets the old blob.
 *
 * `emCurso` holds the pages written and not yet confirmed: their entries are
 * not cut again. With the store closed or sealed nothing moves.
 */
export function selarPaginas(
  contents: VaultContents,
  armazem: ArmazemDeMedia,
  agora: number,
  emCurso: Map<string, PaginaEmCurso>,
  aoConfirmar: (sha: string, escrito: boolean) => void,
): void {
  const porArquivar = contents.porArquivar
  if (!porArquivar || !armazem.aberto || armazem.selado) return
  for (const [canal, entradas] of Object.entries(porArquivar)) {
    let ocupadas = 0
    for (const emVoo of emCurso.values()) if (emVoo.canal === canal) ocupadas += emVoo.pagina.n
    while (entradas.length - ocupadas >= ENTRADAS_POR_PAGINA) {
      const pagina = entradas.slice(ocupadas, ocupadas + ENTRADAS_POR_PAGINA)
      ocupadas += pagina.length
      const bytes = codificador.encode(JSON.stringify({ sal: aleatorio(16), entradas: pagina }))
      const sha = toBase64(sha256(bytes))
      const ref: RefDeMedia = { v: 1, k: aleatorio(32), n: aleatorio(24), b: bytes.length, t: TIPO_DA_PAGINA, f: "texto", c: "mini", at: agora }
      const media = [...new Set(pagina.flatMap((entrada) => (entrada?.payload ? shasDoPayload(entrada.payload) : [])))]
      emCurso.set(sha, {
        canal,
        ref,
        primeira: pagina[0] as StoredChatMessage,
        pagina: { sha, n: pagina.length, de: pagina[0]?.at ?? agora, ate: pagina.at(-1)?.at ?? agora, media },
      })
      void armazem.absorverConfirmado(bytes, ref, sha).then((escrito) => aoConfirmar(sha, escrito))
    }
  }
}

/**
 * The second phase: the store answered for the page `sha`. Written, and the
 * entries still at the head of `porArquivar` (same channel, same first entry),
 * they leave it, and the reference and the index enter the vault. True when the
 * vault changed and needs writing. Otherwise the page is dropped: its entries
 * stay and are sealed again in another page; the blob, if any, is an orphan.
 */
export function confirmarPagina(contents: VaultContents, emCurso: Map<string, PaginaEmCurso>, sha: string, escrito: boolean): boolean {
  const emVoo = emCurso.get(sha)
  if (!emVoo) return false
  emCurso.delete(sha)
  const entradas = contents.porArquivar?.[emVoo.canal]
  if (!escrito || !entradas || entradas[0] !== emVoo.primeira || entradas.length < emVoo.pagina.n) {
    // The pages after this one in the same channel no longer start where they thought: drop them too.
    for (const [outro, seguinte] of [...emCurso]) if (seguinte.canal === emVoo.canal) emCurso.delete(outro)
    return false
  }
  entradas.splice(0, emVoo.pagina.n)
  if (entradas.length === 0) delete contents.porArquivar![emVoo.canal]
  contents.media ??= {}
  contents.media[sha] = emVoo.ref
  contents.arquivoDaConversa ??= {}
  const indice = (contents.arquivoDaConversa[emVoo.canal] ??= [])
  indice.push(emVoo.pagina)
  // The oldest page leaves the index; the collection deletes its blob.
  if (indice.length > PAGINAS_POR_CANAL) indice.splice(0, indice.length - PAGINAS_POR_CANAL)
  return true
}

/** The `sha` values the archive keeps alive: the pages and what their messages reference. */
export function shasDoArquivo(contents: VaultContents): string[] {
  const vivos: string[] = []
  for (const indice of Object.values(contents.arquivoDaConversa ?? {})) {
    for (const pagina of indice) vivos.push(pagina.sha, ...pagina.media)
  }
  return vivos
}

/** A page read back. Throws "conversation archive page is missing" if the store does not have it, or it does not open. */
export async function lerPagina(contents: VaultContents, armazem: ArmazemDeMedia, canal: string, indice: number): Promise<StoredChatMessage[]> {
  const pagina = contents.arquivoDaConversa?.[canal]?.[indice]
  const ref = pagina ? contents.media?.[pagina.sha] : undefined
  if (!pagina || !ref) throw new Error("conversation archive page is missing", { cause: { channel: canal } })
  let bytes: Uint8Array | null
  try {
    bytes = await armazem.obter(pagina.sha, ref)
  } catch {
    bytes = null
  }
  if (!bytes) throw new Error("conversation archive page is missing", { cause: { channel: canal } })
  const lidas = JSON.parse(descodificador.decode(bytes)) as unknown
  // A page is `{ sal, entradas }`; the first 1.3.18 builds wrote the bare array.
  const entradas = Array.isArray(lidas) ? lidas : (lidas as { entradas?: unknown } | null)?.entradas
  if (!Array.isArray(entradas)) throw new Error("conversation archive page is missing", { cause: { channel: canal } })
  return entradas as StoredChatMessage[]
}
