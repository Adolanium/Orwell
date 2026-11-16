import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"

/**
 * The format of a blob in the media store (design §2.3):
 *
 *     "orwm1\n" ‖ XChaCha20-Poly1305(k, n, texto, AAD)
 *     AAD = "orwell-media-v1\0" ‖ sha ‖ "\0" ‖ classe
 *
 * The clear header gives the version without decrypting, like `orwv2` in the vault.
 * The AAD binds the blob to its address and class: a blob moved to another slot,
 * or switched from "original" to "mini" on disk, does not open. The key and nonce
 * live only in the reference, inside the vault: whoever copies the store without
 * the vault cannot read any content. They do see the names, and the address is
 * the digest of the content: they can confirm that a file they already have is
 * on this device, and the index shows sizes, classes and last use (see
 * "The media store on the device's disk" in `docs/THREAT-MODEL.md`).
 */
export const CABECALHO_DO_BLOB = "orwm1\n"

export type ClasseDoBlob = "original" | "mini"

const codificador = new TextEncoder()
const CABECALHO = codificador.encode(CABECALHO_DO_BLOB)

/** The AAD that binds the blob to its `sha` and class. */
export function aad(sha: string, classe: ClasseDoBlob): Uint8Array {
  return codificador.encode(`orwell-media-v1\0${sha}\0${classe}`)
}

export function cifrarBlob(texto: Uint8Array, k: Uint8Array, n: Uint8Array, sha: string, classe: ClasseDoBlob): Uint8Array {
  const cifrado = xchacha20poly1305(k, n, aad(sha, classe)).encrypt(texto)
  const blob = new Uint8Array(CABECALHO.length + cifrado.length)
  blob.set(CABECALHO, 0)
  blob.set(cifrado, CABECALHO.length)
  return blob
}

/** Throws "media blob is damaged" on a wrong header, an AAD that does not match, or an invalid tag. */
export function decifrarBlob(blob: Uint8Array, k: Uint8Array, n: Uint8Array, sha: string, classe: ClasseDoBlob): Uint8Array {
  if (blob.length < CABECALHO.length || CABECALHO.some((byte, i) => blob[i] !== byte)) throw new Error("media blob is damaged")
  try {
    return xchacha20poly1305(k, n, aad(sha, classe)).decrypt(blob.subarray(CABECALHO.length))
  } catch {
    throw new Error("media blob is damaged")
  }
}
