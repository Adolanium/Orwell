import { fromBase64, toBase64 } from "@enclave/protocol"
import { p256 } from "@noble/curves/nist.js"
import { expand, extract } from "@noble/hashes/hkdf.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/**
 * Web Push message encryption (RFC 8291) and VAPID tokens (RFC 8292).
 *
 * Pure: no network, no clock, no state. `push.ts` does the sending. Kept apart
 * so the test can hold it against the RFC vectors byte for byte, and so a
 * reader auditing what leaves the server reads one short file.
 *
 * Our own code instead of the `web-push` package: the curve (`@noble/curves`)
 * and the KDF (`@noble/hashes`) are already server dependencies, AES-128-GCM is
 * `node:crypto`, and the rest is about sixty lines.
 */

/**
 * The fixed size of every push record before encryption: content, the 0x02
 * delimiter, and zeros. Every push the server sends has the same length on the
 * wire, whatever language it carries.
 */
export const CORPO_DO_PUSH_BYTES = 64

/** The record size announced in the header. One record per message. */
const RS = 4096

const utf8 = (texto: string): Uint8Array => new TextEncoder().encode(texto)
const juntar = (...partes: Uint8Array[]): Uint8Array => {
  const saida = new Uint8Array(partes.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const parte of partes) {
    saida.set(parte, i)
    i += parte.length
  }
  return saida
}

/** Throws unless `ponto` is an uncompressed P-256 point on the curve (65 bytes, 0x04 prefix). */
export function validarP256dh(ponto: Uint8Array): void {
  if (ponto.length !== 65 || ponto[0] !== 0x04) throw new Error("p256dh must be an uncompressed P-256 point")
  // Throws for a point that is not on the curve.
  p256.Point.fromBytes(ponto).assertValidity()
}

/** The key schedule of RFC 8291 section 3.4 and RFC 8188 section 2.2. */
function chaves(
  segredoEcdh: Uint8Array,
  auth: Uint8Array,
  uaPublica: Uint8Array,
  asPublica: Uint8Array,
  sal: Uint8Array,
): { cek: Uint8Array; nonce: Uint8Array } {
  const keyInfo = juntar(utf8("WebPush: info\0"), uaPublica, asPublica)
  const ikm = expand(sha256, extract(sha256, segredoEcdh, auth), keyInfo, 32)
  const prk = extract(sha256, ikm, sal)
  return {
    cek: expand(sha256, prk, utf8("Content-Encoding: aes128gcm\0"), 16),
    nonce: expand(sha256, prk, utf8("Content-Encoding: nonce\0"), 12),
  }
}

/**
 * Encrypt `texto` for one subscription.
 *
 * `opcoes` exist for the RFC vector only: in production the ephemeral key and
 * the salt are always fresh, and the record is always padded to
 * `CORPO_DO_PUSH_BYTES`.
 */
export function cifrarPush(
  texto: Uint8Array,
  destino: { p256dh: Uint8Array; auth: Uint8Array },
  opcoes: { privadaEfemera?: Uint8Array; sal?: Uint8Array; tamanho?: "fixo" | "sem-enchimento" } = {},
): { mensagem: Uint8Array; cek: Uint8Array; nonce: Uint8Array } {
  validarP256dh(destino.p256dh)
  if (destino.auth.length !== 16) throw new Error("auth must be 16 bytes")
  const fixo = (opcoes.tamanho ?? "fixo") === "fixo"
  if (fixo && texto.length > CORPO_DO_PUSH_BYTES - 1) throw new Error("push text does not fit the fixed record")

  const privada = opcoes.privadaEfemera ?? p256.utils.randomSecretKey()
  const asPublica = p256.getPublicKey(privada, false)
  const sal = opcoes.sal ?? new Uint8Array(randomBytes(16))
  // The shared secret is the x coordinate of the ECDH point.
  const segredo = p256.getSharedSecret(privada, destino.p256dh, true).subarray(1)
  const { cek, nonce } = chaves(segredo, destino.auth, destino.p256dh, asPublica, sal)

  // Content, then the last-record delimiter, then zeros up to the fixed size.
  const registo = new Uint8Array(fixo ? CORPO_DO_PUSH_BYTES : texto.length + 1)
  registo.set(texto)
  registo[texto.length] = 0x02

  const cifra = createCipheriv("aes-128-gcm", cek, nonce)
  const cifrado = juntar(cifra.update(registo), cifra.final(), cifra.getAuthTag())

  const cabecalho = new Uint8Array(16 + 4 + 1 + 65)
  cabecalho.set(sal, 0)
  new DataView(cabecalho.buffer).setUint32(16, RS)
  cabecalho[20] = 65
  cabecalho.set(asPublica, 21)
  return { mensagem: juntar(cabecalho, cifrado), cek, nonce }
}

/**
 * The receiving side: what the browser does with a push. Here for the tests and
 * the fake push service, never on a production path. Throws on any mismatch.
 */
export function decifrarPush(mensagem: Uint8Array, receptor: { privada: Uint8Array; auth: Uint8Array }): Uint8Array {
  if (mensagem.length < 21) throw new Error("push message too short")
  const sal = mensagem.subarray(0, 16)
  const idlen = mensagem[20] as number
  const asPublica = mensagem.subarray(21, 21 + idlen)
  const corpo = mensagem.subarray(21 + idlen)
  if (corpo.length < 17) throw new Error("push message has no record")
  const uaPublica = p256.getPublicKey(receptor.privada, false)
  const segredo = p256.getSharedSecret(receptor.privada, asPublica, true).subarray(1)
  const { cek, nonce } = chaves(segredo, receptor.auth, uaPublica, asPublica, sal)
  const decifra = createDecipheriv("aes-128-gcm", cek, nonce)
  decifra.setAuthTag(corpo.subarray(corpo.length - 16))
  const registo = juntar(decifra.update(corpo.subarray(0, corpo.length - 16)), decifra.final())
  // Strip the zero padding, then the delimiter, which must be 0x02 (last record).
  let fim = registo.length - 1
  while (fim >= 0 && registo[fim] === 0) fim -= 1
  if (fim < 0 || registo[fim] !== 0x02) throw new Error("push record has no last-record delimiter")
  return registo.slice(0, fim)
}

export interface ClaimsVapid {
  aud: string
  exp: number
  sub: string
}

/** The JWT header, serialised the way RFC 8292 prints it. */
const CABECALHO_JWT = toBase64(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })))

/** An ES256 JWT over `claims` (RFC 8292 section 2). The signature is r || s, 64 bytes. */
export function jwtVapid(privada: Uint8Array, claims: ClaimsVapid): string {
  // Fixed key order: aud, exp, sub. It is what the RFC example signs.
  const corpo = toBase64(utf8(JSON.stringify({ aud: claims.aud, exp: claims.exp, sub: claims.sub })))
  const entrada = `${CABECALHO_JWT}.${corpo}`
  return `${entrada}.${toBase64(p256.sign(utf8(entrada), privada))}`
}

/** The `Authorization` header value: `vapid t=<jwt>, k=<public key>`. */
export function cabecalhoVapid(privada: Uint8Array, publica: Uint8Array, claims: ClaimsVapid): string {
  return `vapid t=${jwtVapid(privada, claims)}, k=${toBase64(publica)}`
}

/**
 * Verify a VAPID JWT against a public key and return its claims, or `null`.
 * What a push service does with our token; used by the tests and the fake service.
 */
export function lerJwtVapid(jwt: string, publica: Uint8Array): ClaimsVapid | null {
  const partes = jwt.split(".")
  if (partes.length !== 3) return null
  const [cabecalho, corpo, assinatura] = partes as [string, string, string]
  try {
    const cab = JSON.parse(new TextDecoder().decode(fromBase64(cabecalho))) as { alg?: unknown }
    if (cab.alg !== "ES256") return null
    // `lowS: false`: a push service accepts either form of the signature.
    if (!p256.verify(fromBase64(assinatura), utf8(`${cabecalho}.${corpo}`), publica, { lowS: false })) return null
    const claims = JSON.parse(new TextDecoder().decode(fromBase64(corpo))) as ClaimsVapid
    return { aud: claims.aud, exp: claims.exp, sub: claims.sub }
  } catch {
    return null
  }
}
