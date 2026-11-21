import { ristretto255, ristretto255_hasher } from "@noble/curves/ed25519.js"
import { equalBytes } from "@noble/curves/utils.js"
import { hmac } from "@noble/hashes/hmac.js"
import { sha512 } from "@noble/hashes/sha2.js"

/**
 * CPace, a balanced PAKE, with the cipher suite CPACE-RISTR255-SHA512.
 *
 * Spec: draft-irtf-cfrg-cpace-21 (IRTF CFRG, 23 April 2026). This file is a
 * transcription of that draft and nothing more: every function names the
 * section it implements, and `cpace.test.ts` checks it against the draft's
 * own test vectors (Appendix A.1, A.3 and B.3).
 *
 * The group arithmetic is not here. It is `@noble/curves` 2.0.1 (audited),
 * which implements ristretto255 (RFC 9496), its element derivation
 * (`ristretto255_hasher.deriveToCurve`, RFC 9496 section 4.3.4) and a
 * constant-time byte comparison. SHA-512 and HMAC are `@noble/hashes`.
 * No npm package implements CPace with an audit behind it (checked
 * 21/11/2026: `cpace-ts` 0.1.6 and `@cipherman/pake-js` 0.1.1 are young and
 * unaudited; `spake2` 1.0.2 is unmaintained since 2019), so the protocol
 * layer is this thin file over the audited primitives.
 *
 * Mode: initiator-responder (section 6.3, `transcript_ir`). The initiator A is
 * the NEW device, which makes the code; the responder B is the device with the
 * account, which types it. Fixed roles also rule out the loopback attack
 * (section 10.1.2).
 *
 * Key confirmation: section 10.4, with HMAC-SHA512. Both sides send a tag, and
 * each refuses the session at the first tag that does not verify.
 */

const enc = new TextEncoder()

/** G_Ristretto255.DSI (section 8.3). */
export const CPACE_DSI = enc.encode("CPaceRistretto255")

/** H.s_in_bytes for SHA-512 (section 6.2). */
const SHA512_BLOCK_BYTES = 128

/** G_Ristretto255.field_size_bytes (section 8.3). */
const FIELD_BYTES = 32

/** The size of the session id the initiator picks (section 10.9: fresh random bytes). */
export const CPACE_SID_BYTES = 16

/** prepend_len: LEB128 length, then the data (section 6.3, Appendix A.1.1). */
export function prependLen(data: Uint8Array): Uint8Array {
  const lengthBytes: number[] = []
  let remaining = data.length
  for (;;) {
    if (remaining < 128) lengthBytes.push(remaining)
    else lengthBytes.push((remaining & 0x7f) + 0x80)
    remaining = Math.floor(remaining / 128)
    if (remaining === 0) break
  }
  const out = new Uint8Array(lengthBytes.length + data.length)
  out.set(lengthBytes, 0)
  out.set(data, lengthBytes.length)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** lv_cat (section 6.3, Appendix A.1.3). */
export function lvCat(...args: Uint8Array[]): Uint8Array {
  return concat(...args.map(prependLen))
}

/** transcript_ir (section 6.3, Appendix A.3.4). */
export function transcriptIr(ya: Uint8Array, ada: Uint8Array, yb: Uint8Array, adb: Uint8Array): Uint8Array {
  return concat(lvCat(ya, ada), lvCat(yb, adb))
}

/** generator_string (section 8.1, Appendix A.2), with the DSI of ristretto255 and SHA-512's block size. */
export function generatorString(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Uint8Array {
  const zpad = Math.max(0, SHA512_BLOCK_BYTES - 1 - prependLen(prs).length - prependLen(CPACE_DSI).length)
  return lvCat(CPACE_DSI, prs, new Uint8Array(zpad), ci, sid)
}

type Point = InstanceType<typeof ristretto255.Point>

/**
 * G.calculate_generator (section 8.3): hash the generator string to
 * 2 * field_size_bytes with SHA-512, then the element derivation of RFC 9496.
 */
export function calculateGenerator(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Point {
  const hash = sha512(generatorString(prs, ci, sid))
  if (hash.length !== 2 * FIELD_BYTES) throw new Error("cpace: hash length")
  return ristretto255_hasher.deriveToCurve!(hash)
}

function scalarFromBytes(bytes: Uint8Array): bigint {
  if (bytes.length !== FIELD_BYTES) throw new Error("cpace: scalar length")
  let n = 0n
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i] as number)
  return n
}

/**
 * G.sample_scalar (section 8.3, the RECOMMENDED way): 32 random bytes, the bits
 * above group_size_bits (252) cleared, read little-endian. Zero is not a
 * scalar the group can use, so it is drawn again (probability 2^-252).
 */
export function sampleScalar(): Uint8Array {
  for (;;) {
    const bytes = new Uint8Array(FIELD_BYTES)
    globalThis.crypto.getRandomValues(bytes)
    bytes[31] = (bytes[31] as number) & 0x0f
    if (scalarFromBytes(bytes) !== 0n) return bytes
  }
}

/** G.scalar_mult (section 8.3): y times a decoded point, returned encoded. */
export function scalarMult(y: Uint8Array, g: Point): Uint8Array {
  return g.multiply(scalarFromBytes(y)).toBytes()
}

/**
 * G.scalar_mult_vfy (section 8.3): decode X, multiply, encode. `null` stands
 * for G.I: X does not decode, or the result is the neutral element. The
 * caller MUST abort on `null` (section 7.2).
 */
export function scalarMultVfy(y: Uint8Array, x: Uint8Array): Uint8Array | null {
  if (x.length !== FIELD_BYTES) return null
  let point: Point
  try {
    point = ristretto255.Point.fromBytes(x)
  } catch {
    return null
  }
  if (point.is0()) return null
  const k = point.multiply(scalarFromBytes(y))
  return k.is0() ? null : k.toBytes()
}

/** ISK = H.hash(lv_cat(G.DSI || b"_ISK", sid, K) || transcript) (section 7.2). */
export function computeIsk(sid: Uint8Array, k: Uint8Array, transcript: Uint8Array): Uint8Array {
  return sha512(concat(lvCat(concat(CPACE_DSI, enc.encode("_ISK")), sid, k), transcript))
}

/** mac_key = H.hash(b"CPaceMac" || sid || ISK) (section 10.4). */
export function confirmationKey(sid: Uint8Array, isk: Uint8Array): Uint8Array {
  return sha512(concat(enc.encode("CPaceMac"), sid, isk))
}

/** T = MAC(mac_key, lv_cat(Y, AD)), MAC = HMAC-SHA512 (section 10.4). */
export function confirmationTag(macKey: Uint8Array, y: Uint8Array, ad: Uint8Array): Uint8Array {
  return hmac(sha512, macKey, lvCat(y, ad))
}

// ------------------------------------------------------------ the two roles

/** A's message: its share Ya and the session id it picked. ADa is empty. */
export interface CpaceMessageA {
  sid: Uint8Array
  y: Uint8Array
}

/** B's message: its share Yb. ADb is empty. */
export interface CpaceMessageB {
  y: Uint8Array
}

/** What a side has when its CPace run is over. */
export interface CpaceResult {
  /** The intermediate session key. Never leaves this side; the caller derives from it. */
  isk: Uint8Array
  /** lv_cat(sid) || transcript_ir(Ya, ADa, Yb, ADb): public, the same on both sides. */
  transcript: Uint8Array
  /** This side's confirmation tag, to send. */
  tag: Uint8Array
  /** Constant-time check of the other side's tag. */
  verifyPeerTag: (tag: Uint8Array) => boolean
}

/** A's state between its message and B's answer. Holds the secret scalar: memory only. */
export interface CpaceStateA {
  readonly message: CpaceMessageA
  readonly prs: Uint8Array
  readonly ci: Uint8Array
  readonly scalar: Uint8Array
}

const EMPTY = new Uint8Array()

function finish(sid: Uint8Array, k: Uint8Array, ya: Uint8Array, yb: Uint8Array, role: "a" | "b"): CpaceResult {
  const transcript = transcriptIr(ya, EMPTY, yb, EMPTY)
  const isk = computeIsk(sid, k, transcript)
  const macKey = confirmationKey(sid, isk)
  const tagA = confirmationTag(macKey, ya, EMPTY)
  const tagB = confirmationTag(macKey, yb, EMPTY)
  const mine = role === "a" ? tagA : tagB
  const peers = role === "a" ? tagB : tagA
  return {
    isk,
    transcript: concat(lvCat(sid), transcript),
    tag: mine,
    verifyPeerTag: (tag) => tag.length === peers.length && equalBytes(tag, peers),
  }
}

/** A, step 1 (section 7.2): a fresh sid and scalar, g from PRS, CI and sid, and Ya = ya * g. */
export function cpaceStart(prs: Uint8Array, ci: Uint8Array): CpaceStateA {
  const sid = new Uint8Array(CPACE_SID_BYTES)
  globalThis.crypto.getRandomValues(sid)
  const scalar = sampleScalar()
  const y = scalarMult(scalar, calculateGenerator(prs, ci, sid))
  return { message: { sid, y }, prs, ci, scalar }
}

/**
 * B (section 7.2): g from the same inputs and A's sid, Yb = yb * g, and
 * K = yb * Ya. `null` when K is G.I (Ya invalid) or the sid has the wrong
 * size: B MUST abort.
 */
export function cpaceRespond(
  prs: Uint8Array,
  ci: Uint8Array,
  fromA: CpaceMessageA,
): (CpaceResult & { message: CpaceMessageB }) | null {
  if (fromA.sid.length !== CPACE_SID_BYTES) return null
  const scalar = sampleScalar()
  const yb = scalarMult(scalar, calculateGenerator(prs, ci, fromA.sid))
  const k = scalarMultVfy(scalar, fromA.y)
  if (k === null) return null
  return { ...finish(fromA.sid, k, fromA.y, yb, "b"), message: { y: yb } }
}

/** A, step 2 (section 7.2): K = ya * Yb. `null` when K is G.I: A MUST abort. */
export function cpaceFinish(state: CpaceStateA, fromB: CpaceMessageB): CpaceResult | null {
  const k = scalarMultVfy(state.scalar, fromB.y)
  if (k === null) return null
  return finish(state.message.sid, k, state.message.y, fromB.y, "a")
}
