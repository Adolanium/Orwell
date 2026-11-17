import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { CABECALHO_DO_COFRE } from "./cabecalhoDoCofre.js"

/**
 * The vault file built in ONE buffer (hotfix 1.3.13).
 *
 * **Why.** Up to 1.3.12 a write held the vault many times over: the JSON text,
 * its UTF-8 bytes, the ciphertext, the base64 bytes, the base64 string, the file
 * JSON string, its UTF-8 bytes and the copy with the header. Measured on a loaded
 * account (`scripts/medir-memoria-conta-carregada.mjs`, 1.3.12 memory report):
 * 5 to 11 times the vault in transient memory per write, and six writes in a row
 * stacked up to 343 MB before the collector ran.
 *
 * **What this does.** The JSON text is the only other copy. Its UTF-8 bytes go
 * straight into the final buffer (`encodeInto`), at the place where the
 * ciphertext must end; XChaCha20-Poly1305 encrypts them there, in place; and the
 * base64 is written forward over the same bytes, from the start of the file body.
 * The writer never passes the reader (see `base64NoSitio`), so nothing is
 * overwritten before it is read. The header and the envelope around it are
 * small and written as they are. At most two copies of the vault are alive at
 * once (the JSON text while it is encoded, and this buffer), and the text is no
 * longer referenced once it is encoded.
 *
 * **What does not change.** The bytes. The file is byte for byte what
 * `comCabecalho(JSON.stringify(file))` gave, with the same envelope, the same
 * field order, the same cipher, key and nonce (there is a test that compares
 * them). No format, no migration, nothing for an older client to misread.
 */

const codificador = new TextEncoder()

/** UTF-8 length of a string, exactly as `TextEncoder` encodes it (a lone surrogate becomes U+FFFD, 3 bytes). */
export function bytesEmUtf8(texto: string): number {
  let n = 0
  const fim = texto.length
  for (let i = 0; i < fim; i++) {
    const c = texto.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < fim) {
      const d = texto.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4
        i++
      } else n += 3
    } else n += 3
  }
  return n
}

/** Length of base64url without padding for `n` bytes. */
export function comprimentoEmBase64(n: number): number {
  const resto = n % 3
  return Math.floor(n / 3) * 4 + (resto === 0 ? 0 : resto + 1)
}

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
const CODIGOS = Uint8Array.from(ALFABETO, (letra) => letra.charCodeAt(0))

/**
 * base64url without padding of `buf[de, de + n)`, written from `para` onward in
 * the same buffer. Returns where the writing ended.
 *
 * Safe only when the writer starts at least `comprimentoEmBase64(n) - n` bytes
 * before the reader (`de - para >= comprimentoEmBase64(n) - n`), which is how the
 * selo lays the buffer out: the ciphertext ends exactly where the base64 ends.
 * Group `k` reads `de + 3k .. de + 3k + 2` and then writes `para + 4k .. para + 4k + 3`;
 * with `de - para = L - n >= k + 1` for every full group, the last byte written is
 * always before the first byte not yet read. The tail reads its bytes before
 * writing.
 */
export function base64NoSitio(buf: Uint8Array, de: number, n: number, para: number): number {
  if (de - para < comprimentoEmBase64(n) - n) throw new Error("base64 in place: the writer would pass the reader")
  const inteiros = Math.floor(n / 3)
  let i = de
  let j = para
  for (let k = 0; k < inteiros; k++) {
    const v = ((buf[i] as number) << 16) | ((buf[i + 1] as number) << 8) | (buf[i + 2] as number)
    i += 3
    buf[j] = CODIGOS[v >>> 18] as number
    buf[j + 1] = CODIGOS[(v >>> 12) & 63] as number
    buf[j + 2] = CODIGOS[(v >>> 6) & 63] as number
    buf[j + 3] = CODIGOS[v & 63] as number
    j += 4
  }
  const resto = n % 3
  if (resto > 0) {
    const a = buf[i] as number
    const b = resto === 2 ? (buf[i + 1] as number) : 0
    buf[j++] = CODIGOS[a >>> 2] as number
    buf[j++] = CODIGOS[((a & 3) << 4) | (b >>> 4)] as number
    if (resto === 2) buf[j++] = CODIGOS[(b & 15) << 2] as number
  }
  return j
}

/** Where the ciphertext goes in the envelope, which is written with `ciphertext: ""`. */
const MARCA = '"ciphertext":""'

function partirEnvelope(envelope: string): { prefixo: string; sufixo: string } {
  const i = envelope.indexOf(MARCA)
  if (i < 0 || envelope.indexOf(MARCA, i + 1) >= 0) throw new Error("vault envelope without one empty ciphertext")
  const corte = i + MARCA.length - 1
  return { prefixo: envelope.slice(0, corte), sufixo: envelope.slice(corte) }
}

function ascii(texto: string): Uint8Array {
  const bytes = codificador.encode(texto)
  // The envelope is ASCII by construction (base64url, digits, fixed words): one byte per character.
  if (bytes.length !== texto.length) throw new Error("vault envelope is not ASCII")
  return bytes
}

/** A vault file half built: header, envelope start and base64 ciphertext are in place. */
export interface SeloEmCurso {
  buffer: Uint8Array
  /** Where the base64 ends, and the end of the envelope goes. */
  fim: number
  /** The envelope start, to check the final envelope has the same one. */
  prefixo: string
}

/**
 * The colocation of the plaintext, in its own function on purpose: the JSON text
 * lives only in this frame, so nothing holds it once its bytes are in the buffer.
 */
function textoNoSitio(
  texto: string,
  inicioDoCorpo: number,
  reserva: number,
): { buffer: Uint8Array; de: number; n: number; L: number } {
  const n = bytesEmUtf8(texto)
  const L = comprimentoEmBase64(n + 16)
  const buffer = new Uint8Array(inicioDoCorpo + L + reserva)
  // The ciphertext (n + 16 bytes) ends exactly where its base64 ends.
  const de = inicioDoCorpo + L - (n + 16)
  const r = codificador.encodeInto(texto, buffer.subarray(de, de + n))
  if (r.read !== texto.length || r.written !== n) throw new Error("vault plaintext length does not match its encoding")
  return { buffer, de, n, L }
}

/**
 * Stage 1a, synchronous: serialize and lay the plaintext into the one buffer.
 *
 * This is the snapshot: whatever the contents are now is what the file will
 * hold. It stays on the caller's thread and in the caller's task.
 */
export interface SeloPreparado {
  buffer: Uint8Array
  /** Where the plaintext starts, and its length in bytes. */
  de: number
  n: number
  /** Where the base64 starts (the header and the envelope start are before it). */
  inicio: number
  /** The base64 length of the ciphertext. */
  L: number
  prefixo: string
}

export function prepararSelo(serializar: () => string, envelope: string, reserva: number): SeloPreparado {
  const { prefixo } = partirEnvelope(envelope)
  const cabeca = ascii(CABECALHO_DO_COFRE + prefixo)
  const { buffer, de, n, L } = textoNoSitio(serializar(), cabeca.length, reserva)
  buffer.set(cabeca, 0)
  return { buffer, de, n, inicio: cabeca.length, L, prefixo }
}

/**
 * Stage 1b: encrypt in place and write the base64, in the same buffer.
 *
 * Pure and self-contained, so it can run in a Worker (`selo-worker.ts`): it
 * needs the buffer, the key and the nonce, nothing else.
 */
export function fecharSelo(p: SeloPreparado, key: Uint8Array, nonce: Uint8Array): SeloEmCurso {
  // In place: the output is the plaintext's own bytes plus the 16 that follow for the tag.
  xchacha20poly1305(key, nonce).encrypt(p.buffer.subarray(p.de, p.de + p.n), p.buffer.subarray(p.de, p.de + p.n + 16))
  const fim = base64NoSitio(p.buffer, p.de, p.n + 16, p.inicio)
  if (fim !== p.inicio + p.L) throw new Error("vault base64 length mismatch")
  return { buffer: p.buffer, fim, prefixo: p.prefixo }
}

/**
 * A write to seal elsewhere: the JSON text (the snapshot, already taken), the
 * envelope with `ciphertext: ""`, and the room for the envelope end. A string
 * crosses to a Worker as one copy; the UTF-8 sizing, the encoding, the cipher
 * and the base64 all run there.
 */
export interface SeloPorFazer {
  texto: string
  envelope: string
  reserva: number
}

/** Everything after the snapshot, for a Worker. See `SeloPorFazer`. */
export function selarTexto(p: SeloPorFazer, key: Uint8Array, nonce: Uint8Array): SeloEmCurso {
  return fecharSelo(prepararSelo(() => p.texto, p.envelope, p.reserva), key, nonce)
}

/**
 * Stage 1, synchronous: serialize, encrypt and write the base64, all in one buffer.
 *
 * `serializar` is called here, once, so whoever calls does not hold the JSON text.
 * `envelope` is the file JSON with `ciphertext: ""`; `reserva` is the room left
 * for the envelope end (exact when known, as with a passphrase vault; 0 when it
 * is only known later, as with the wrapped key of an `os` vault).
 */
export function comecarSelo(
  serializar: () => string,
  key: Uint8Array,
  nonce: Uint8Array,
  envelope: string,
  reserva: number,
): SeloEmCurso {
  return fecharSelo(prepararSelo(serializar, envelope, reserva), key, nonce)
}

/**
 * Stage 2: the envelope end. `envelopeFinal` is the file JSON with
 * `ciphertext: ""` and every field (the wrapped key included); its start must be
 * the one stage 1 wrote. Without a copy when the reserve was exact.
 */
export function acabarSelo(selo: SeloEmCurso, envelopeFinal: string): Uint8Array {
  const { prefixo, sufixo } = partirEnvelope(envelopeFinal)
  if (prefixo !== selo.prefixo) throw new Error("vault envelope changed between the two stages")
  const fim = ascii(sufixo)
  const total = selo.fim + fim.length
  if (selo.buffer.length === total) {
    selo.buffer.set(fim, selo.fim)
    return selo.buffer
  }
  // The reserve was not exact (an `os` vault learns its wrapped key only now): one copy, sized right.
  const saida = new Uint8Array(total)
  saida.set(selo.buffer.subarray(0, selo.fim), 0)
  saida.set(fim, selo.fim)
  return saida
}

/** The length of the envelope end, to reserve it in stage 1. */
export function comprimentoDoFim(envelope: string): number {
  return partirEnvelope(envelope).sufixo.length
}
