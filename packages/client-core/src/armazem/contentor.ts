import { fromBase64, toBase64 } from "@enclave/protocol"
import { CABECALHO_DO_COFRE } from "../cabecalhoDoCofre.js"

/**
 * The account file with the images (Task 11b, design §9 B and §13 C):
 *
 *     "orwv2\n" ‖ "orwc1\n" ‖ len(JSON) 8 B BE ‖ envelope JSON (with mediaCount: N)
 *     ‖ N × ( raw sha 32 B ‖ len 8 B BE ‖ orwm1 blob as is )
 *
 * The plain file has `{` right after the header; the container has the
 * `orwc1\n` mark. The two are told apart by the first 12 bytes, without reading
 * the rest. The blobs go as they are in the store: they are already encrypted
 * with keys only the vault has, so they are not re-encrypted.
 *
 * The file can be hundreds of MB. So it is read through a `FonteDeBytes`
 * (slices of a `Blob` on the web, positioned reads of a file on the desktop),
 * and written in parts.
 */
export const MARCA_DO_CONTENTOR = "orwc1\n"

const codificador = new TextEncoder()
const PREFIXO = codificador.encode(CABECALHO_DO_COFRE + MARCA_DO_CONTENTOR)
/** The 12 prefix bytes and the 8 of the JSON length. */
const CABECA = PREFIXO.length + 8
/** The raw sha and the blob length. */
const CABECA_DO_REGISTO = 32 + 8

const NAO_E_DE_CONTA = "this is not an enclave account file"

/**
 * The plain file (vault only) is read whole, so it has a ceiling: a file larger
 * than this, without the container mark, is not an account file, and is not
 * even read. Today's vault is 1 to 3 MB; the largest 1.3 vault, with the media
 * inside, was 11 MB.
 */
export const TECTO_DO_FICHEIRO_SIMPLES = 128_000_000

/** A file read in pieces. `ler(inicio, fim)` returns the bytes from `inicio` to `fim` (exclusive). */
export interface FonteDeBytes {
  readonly tamanho: number
  ler(inicio: number, fim: number): Promise<Uint8Array>
}

export function fonteDeBytes(bytes: Uint8Array): FonteDeBytes {
  return { tamanho: bytes.length, ler: async (inicio, fim) => bytes.subarray(inicio, fim) }
}

/** The web: each read is a slice (`Blob.slice`), and the file never enters memory whole. */
export function fonteDeBlob(blob: Blob): FonteDeBytes {
  return { tamanho: blob.size, ler: async (inicio, fim) => new Uint8Array(await blob.slice(inicio, fim).arrayBuffer()) }
}

/** The file is a container: the vault header and the mark. The start of the file is enough. */
export function eContentor(principio: Uint8Array): boolean {
  if (principio.length < PREFIXO.length) return false
  for (let i = 0; i < PREFIXO.length; i++) if (principio[i] !== PREFIXO[i]) return false
  return true
}

/** The 12 + 8 bytes at the start and the JSON. */
export function cabecaDoContentor(json: string): Uint8Array {
  const corpo = codificador.encode(json)
  const saida = new Uint8Array(CABECA + corpo.length)
  saida.set(PREFIXO, 0)
  new DataView(saida.buffer).setBigUint64(PREFIXO.length, BigInt(corpo.length))
  saida.set(corpo, CABECA)
  return saida
}

/** The 32 bytes of the sha and the 8 of the length of the blob that follows. */
export function cabecaDoRegisto(sha: string, bytes: number): Uint8Array {
  const bruto = shaEmBruto(sha)
  if (!bruto) throw new RangeError("a media sha must be 32 bytes", { cause: { sha } })
  const saida = new Uint8Array(CABECA_DO_REGISTO)
  saida.set(bruto, 0)
  new DataView(saida.buffer).setBigUint64(32, BigInt(bytes))
  return saida
}

/** The 32 bytes of a store sha, or null if it does not have them (or does not round-trip to the same text). */
export function shaEmBruto(sha: string): Uint8Array | null {
  try {
    const bruto = fromBase64(sha)
    return bruto.length === 32 && toBase64(bruto) === sha ? bruto : null
  } catch {
    return null
  }
}

export interface RegistoDoContentor {
  sha: string
  /** Where the blob starts in the file. */
  inicio: number
  bytes: number
}

/**
 * Reads the JSON and the position of each blob, and validates the WHOLE
 * container before returning: the JSON `mediaCount`, each record inside the
 * file, and nothing extra at the end. A file cut halfway, or with an absurd
 * length, is "this is not an enclave account file", and the caller never gets
 * to write anything. It does not read the blobs: only the record heads.
 */
export async function lerContentor(fonte: FonteDeBytes): Promise<{ json: string; registos: RegistoDoContentor[] }> {
  if (fonte.tamanho < CABECA || !eContentor(await fonte.ler(0, PREFIXO.length))) throw new Error(NAO_E_DE_CONTA)
  const tamanhoDoJson = comprimento(await fonte.ler(PREFIXO.length, CABECA), fonte.tamanho - CABECA)
  const json = new TextDecoder().decode(await fonte.ler(CABECA, CABECA + tamanhoDoJson))

  let quantos: unknown
  try {
    quantos = (JSON.parse(json) as { mediaCount?: unknown }).mediaCount
  } catch {
    throw new Error(NAO_E_DE_CONTA)
  }
  let pos = CABECA + tamanhoDoJson
  // Each record has at least its head: an N larger than what fits cannot be true.
  if (typeof quantos !== "number" || !Number.isSafeInteger(quantos) || quantos < 0 || quantos > (fonte.tamanho - pos) / CABECA_DO_REGISTO) {
    throw new Error(NAO_E_DE_CONTA)
  }

  const registos: RegistoDoContentor[] = []
  for (let i = 0; i < quantos; i++) {
    if (pos + CABECA_DO_REGISTO > fonte.tamanho) throw new Error(NAO_E_DE_CONTA)
    const cabeca = await fonte.ler(pos, pos + CABECA_DO_REGISTO)
    const inicio = pos + CABECA_DO_REGISTO
    const bytes = comprimento(cabeca.subarray(32), fonte.tamanho - inicio)
    registos.push({ sha: toBase64(cabeca.slice(0, 32)), inicio, bytes })
    pos = inicio + bytes
  }
  if (pos !== fonte.tamanho) throw new Error(NAO_E_DE_CONTA)
  return { json, registos }
}

/** An 8-byte big-endian length, which must fit in what is left of the file. */
function comprimento(oito: Uint8Array, resta: number): number {
  if (oito.length !== 8) throw new Error(NAO_E_DE_CONTA)
  const valor = new DataView(oito.buffer, oito.byteOffset, 8).getBigUint64(0)
  if (valor > BigInt(resta)) throw new Error(NAO_E_DE_CONTA)
  return Number(valor)
}

/**
 * The envelope of an account file, without decrypting: `enclave-vault` at
 * version 1, and inside it a password-protected vault with salt, nonce and
 * ciphertext. The same rules, in the same order, as `Vault.importVault`.
 */
export function envelopeDeContaValido(json: string): boolean {
  let envelope: unknown
  try {
    envelope = JSON.parse(json)
  } catch {
    return false
  }
  if (!registo(envelope) || envelope["format"] !== "enclave-vault" || envelope["formatVersion"] !== 1) return false
  const cofre = envelope["vault"]
  if (!registo(cofre)) return false
  const cheio = (valor: unknown) => typeof valor === "string" && valor.length > 0
  return cofre["protection"] === "passphrase" && cheio(cofre["salt"]) && cheio(cofre["nonce"]) && cheio(cofre["ciphertext"])
}

function registo(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

/**
 * The shape of a chosen file, before the password and without decrypting
 * anything: "conta" (the plain file or the whole container), "beta" (the
 * envelope without the `orwv2` header, from 0.9.x) or "outro". It reads only
 * the container heads, and the plain file only when it starts like one (and
 * fits the ceiling). Never throws: a read that fails is "outro".
 */
export async function formaDoFicheiroDeConta(fonte: FonteDeBytes): Promise<"conta" | "beta" | "outro"> {
  try {
    const principio = await fonte.ler(0, Math.min(fonte.tamanho, PREFIXO.length))
    if (eContentor(principio)) return envelopeDeContaValido((await lerContentor(fonte)).json) ? "conta" : "outro"
    const inicio = new TextDecoder().decode(principio)
    const comCabecalho = inicio.startsWith(CABECALHO_DO_COFRE)
    if (fonte.tamanho > TECTO_DO_FICHEIRO_SIMPLES || (!comCabecalho && !inicio.trimStart().startsWith("{"))) return "outro"
    const texto = new TextDecoder().decode(await fonte.ler(0, fonte.tamanho))
    if (comCabecalho) return envelopeDeContaValido(texto.slice(CABECALHO_DO_COFRE.length)) ? "conta" : "outro"
    return envelopeDeContaValido(texto) ? "beta" : "outro"
  } catch {
    return "outro"
  }
}
