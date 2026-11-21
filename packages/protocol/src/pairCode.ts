import { hkdf } from "@noble/hashes/hkdf.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { z } from "zod"
import { fromBase64, toBase64 } from "./canonical.js"
import { CPACE_SID_BYTES, lvCat } from "./cpace.js"
import { encodeName } from "./names.js"
import { PAIR_ID_PATTERN, PAIR_PAYLOAD_MAX_CHARS } from "./pair.js"

/**
 * Pairing with a short code (1.3.26): "K7P · 4QM".
 *
 * ## The gesture
 *
 * The NEW device makes the code, opens a box on the server under the code's
 * first two characters (the nameplate), and shows the code and a QR. The
 * device with the account types the code (or reads the QR) in Settings ›
 * Join a device, and joins the box by the nameplate. Then both run CPace
 * (`cpace.ts`) with the whole code as the password, confirm the key, and the
 * key that comes out replaces the 32-byte secret of the QR pairing
 * (`chaveDeEmparelhamento`). From there the protocol of `pair.ts` is the same:
 * device keys, the words, the certificate, the snapshot.
 *
 * ## Why a PAKE, and not the code as the secret
 *
 * Six characters of 31 symbols are 29.7 bits. As a direct secret (hash it, use
 * it as the AEAD key), whoever relays the box (the server, or anyone who
 * copied the traffic) tries all 887 million codes offline in seconds. With
 * CPace a wrong guess costs an online run, and a run is one guess: the box
 * dies at the first tag that does not verify, and the nameplate is gone from
 * the server at the first join.
 *
 * ## The split, and what the server sees
 *
 * The server must find the box from what the person types, so part of the
 * code has to reach it in the clear: the first two characters (961
 * nameplates). The other four (31^4 = 923,521, 19.8 bits) are what the server
 * and an attacker do not see. The whole code is CPace's password, but only
 * those 19.8 bits are secret. See `docs/THREAT-MODEL.md`.
 */

/** No 0/O, no 1/I/L. Digits 2-9 and the letters left: 31 symbols. */
export const PAIR_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

export const PAIR_CODE_LENGTH = 6

/** How many leading characters reach the server, to find the box. */
export const PAIR_CODE_NAMEPLATE_LENGTH = 2

/** A nameplate on the wire: two characters of the alphabet. */
export const PAIR_CODE_NAMEPLATE_PATTERN = /^[2-9A-HJKMNP-Z]{2}$/

/** A code is good for five minutes and one join. */
export const PAIR_CODE_TTL_MS = 5 * 60_000

const PAIR_CODE_PATTERN = /^[2-9A-HJKMNP-Z]{6}$/

/**
 * A fresh code, from the CSPRNG. Rejection sampling: a byte counts only below
 * 248 (8 * 31), so each symbol is exactly as likely as the others.
 */
export function generatePairingCode(): string {
  let code = ""
  const bytes = new Uint8Array(16)
  while (code.length < PAIR_CODE_LENGTH) {
    globalThis.crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte >= 248) continue
      code += PAIR_CODE_ALPHABET[byte % 31]
      if (code.length === PAIR_CODE_LENGTH) break
    }
  }
  return code
}

/** "K7P4QM" as the screens show it: "K7P · 4QM". */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 3)} · ${code.slice(3)}`
}

/**
 * What the person typed, as a code: upper case, without spaces, dots, the
 * middle dot or dashes. `null` when it is not six characters of the alphabet.
 * No guessing: a 0 or an O is refused, never read as something else.
 */
export function normalizePairingCode(text: string): string | null {
  const cleaned = text.toUpperCase().replace(/[\s.·\-_]/g, "")
  return PAIR_CODE_PATTERN.test(cleaned) ? cleaned : null
}

/** The part of the code the server sees. */
export function nameplateOf(code: string): string {
  return code.slice(0, PAIR_CODE_NAMEPLATE_LENGTH)
}

const enc = new TextEncoder()

/** CPace's PRS: the code, in UTF-8 (all ASCII, so RFC 8265 changes nothing). */
export function pairCodePrs(code: string): Uint8Array {
  return enc.encode(code)
}

/**
 * CPace's CI (draft-21 section 10.1.1): the protocol and version, then the
 * initiator's role and the responder's role, in that order.
 */
export function pairCodeCi(): Uint8Array {
  return lvCat(enc.encode("orwell:pair-code:v1"), enc.encode("new-device"), enc.encode("account-device"))
}

/**
 * The box key, from CPace's ISK: `HKDF-SHA256(ISK, salt = pairId, info =
 * "orwell:pair-code-key:v1")`, as draft-21 section 10.3 asks (a KDF over ISK
 * before use). It takes the place of `chaveDeEmparelhamento(segredo, pairId)`.
 */
export function pairCodeBoxKey(isk: Uint8Array, pairId: string): Uint8Array {
  if (isk.length !== 64) throw new Error("cpace ISK of the wrong size")
  if (!PAIR_ID_PATTERN.test(pairId)) throw new Error("pairId of the wrong shape")
  return hkdf(sha256, isk, enc.encode(pairId), enc.encode("orwell:pair-code-key:v1"), 32)
}

const PAIR_SAS_CONTEXT_V2 = "orwell:pair-sas:v2\0"

/**
 * The words of a code pairing:
 * `sha256("orwell:pair-sas:v2\0" || pairId || pubHost || pubGuest || cpaceTranscript)`.
 *
 * The same as `palavrasDoSas` plus the CPace transcript (sid, Ya, Yb). A
 * server in the middle that won both CPace runs still has two different
 * transcripts, so the two screens show different words. A defence on top of
 * the PAKE, not instead of it.
 */
export function pairCodeSasWords(
  pairId: string,
  hostKey: Uint8Array,
  guestKey: Uint8Array,
  cpaceTranscript: Uint8Array,
): string {
  if (hostKey.length !== 32 || guestKey.length !== 32) throw new Error("device key of the wrong size")
  const context = enc.encode(PAIR_SAS_CONTEXT_V2)
  const id = enc.encode(pairId)
  const message = new Uint8Array(context.length + id.length + 64 + cpaceTranscript.length)
  let at = 0
  for (const part of [context, id, hostKey, guestKey, cpaceTranscript]) {
    message.set(part, at)
    at += part.length
  }
  return encodeName(sha256(message).subarray(0, 15), 6)
}

// ------------------------------------------------- the CPace messages in the box

const Bytes = (n: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]*$/)
    .transform((text) => fromBase64(text))
    .refine((bytes) => bytes.length === n)

/** On the wire, before there is a box key: base64url of JSON, never encrypted (there is nothing secret in it). */
const PakeWire = z.discriminatedUnion("t", [
  /** A (new device) to B: the session id and Ya. */
  z.object({ t: z.literal("pake-a"), sid: Bytes(CPACE_SID_BYTES), y: Bytes(32) }),
  /** B to A: Yb and B's confirmation tag. */
  z.object({ t: z.literal("pake-b"), y: Bytes(32), tag: Bytes(64) }),
  /** A to B: A's confirmation tag. */
  z.object({ t: z.literal("pake-tag"), tag: Bytes(64) }),
])

export type PakeMessage =
  | { t: "pake-a"; sid: Uint8Array; y: Uint8Array }
  | { t: "pake-b"; y: Uint8Array; tag: Uint8Array }
  | { t: "pake-tag"; tag: Uint8Array }

export function encodePake(message: PakeMessage): string {
  const json =
    message.t === "pake-a"
      ? { t: message.t, sid: toBase64(message.sid), y: toBase64(message.y) }
      : message.t === "pake-b"
        ? { t: message.t, y: toBase64(message.y), tag: toBase64(message.tag) }
        : { t: message.t, tag: toBase64(message.tag) }
  return toBase64(enc.encode(JSON.stringify(json)))
}

/** The reverse. `null`, never a throw: what comes through the box is from a connection anyone may hold. */
export function decodePake(wire: unknown): PakeMessage | null {
  if (typeof wire !== "string" || wire.length > PAIR_PAYLOAD_MAX_CHARS || !/^[A-Za-z0-9_-]*$/.test(wire)) return null
  try {
    const parsed = PakeWire.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64(wire))))
    return parsed.success ? (parsed.data as PakeMessage) : null
  } catch {
    return null
  }
}
