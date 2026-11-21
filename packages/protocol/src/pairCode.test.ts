import { describe, expect, it } from "vitest"
import { toBase64 } from "./canonical.js"
import { cpaceStart, cpaceRespond, cpaceFinish } from "./cpace.js"
import { palavrasDoSas } from "./pair.js"
import {
  PAIR_CODE_ALPHABET,
  PAIR_CODE_LENGTH,
  PAIR_CODE_NAMEPLATE_PATTERN,
  PAIR_CODE_TTL_MS,
  pairCodeBoxKey,
  pairCodeCi,
  decodePake,
  encodePake,
  formatPairingCode,
  generatePairingCode,
  nameplateOf,
  normalizePairingCode,
  pairCodeSasWords,
  pairCodePrs,
} from "./pairCode.js"

describe("the short code", () => {
  it("has no ambiguous characters: no 0/O, no 1/I/L", () => {
    for (const ambiguous of ["0", "O", "1", "I", "L"]) expect(PAIR_CODE_ALPHABET).not.toContain(ambiguous)
    expect(new Set(PAIR_CODE_ALPHABET).size).toBe(PAIR_CODE_ALPHABET.length)
    expect(PAIR_CODE_ALPHABET.length).toBe(31)
  })

  it("is 6 characters from the alphabet, drawn fresh each time", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const code = generatePairingCode()
      expect(code).toHaveLength(PAIR_CODE_LENGTH)
      for (const c of code) expect(PAIR_CODE_ALPHABET).toContain(c)
      seen.add(code)
    }
    expect(seen.size).toBeGreaterThan(195)
  })

  it("is uniform over the alphabet (rejection sampling, no modulo bias)", () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 3000; i++) for (const c of generatePairingCode()) counts.set(c, (counts.get(c) ?? 0) + 1)
    // 18000 draws over 31 symbols: about 580 each. A biased modulo would skew the first 8 symbols by +12%.
    for (const c of PAIR_CODE_ALPHABET) {
      expect(counts.get(c) ?? 0).toBeGreaterThan(450)
      expect(counts.get(c) ?? 0).toBeLessThan(720)
    }
  })

  it("shows as two groups of three", () => {
    expect(formatPairingCode("K7P4QM")).toBe("K7P · 4QM")
  })

  it("reads what a person types: lower case, spaces, the dot, dashes", () => {
    expect(normalizePairingCode("K7P · 4QM")).toBe("K7P4QM")
    expect(normalizePairingCode(" k7p-4qm ")).toBe("K7P4QM")
    expect(normalizePairingCode("k7p4qm")).toBe("K7P4QM")
  })

  it("refuses anything that is not a code", () => {
    expect(normalizePairingCode("K7P4Q")).toBeNull()
    expect(normalizePairingCode("K7P4QMX")).toBeNull()
    expect(normalizePairingCode("K7P4Q0")).toBeNull()
    expect(normalizePairingCode("K1P4QM")).toBeNull()
    expect(normalizePairingCode("")).toBeNull()
  })

  it("the server sees the first two characters, never the rest", () => {
    expect(nameplateOf("K7P4QM")).toBe("K7")
    expect(PAIR_CODE_NAMEPLATE_PATTERN.test("K7")).toBe(true)
    expect(PAIR_CODE_NAMEPLATE_PATTERN.test("K0")).toBe(false)
    expect(PAIR_CODE_NAMEPLATE_PATTERN.test("K7P")).toBe(false)
  })

  it("expires in five minutes", () => {
    expect(PAIR_CODE_TTL_MS).toBe(5 * 60_000)
  })
})

describe("the key and the words after CPace", () => {
  const pairId = "AAAAAAAAAAAAAAAAAAAAAA"

  function run(codeA: string, codeB: string) {
    const a = cpaceStart(pairCodePrs(codeA), pairCodeCi())
    const b = cpaceRespond(pairCodePrs(codeB), pairCodeCi(), a.message)!
    const finishA = cpaceFinish(a, b.message)!
    return { finishA, b }
  }

  it("the same code gives the same 32-byte box key on both sides", () => {
    const { finishA, b } = run("K7P4QM", "K7P4QM")
    const keyA = pairCodeBoxKey(finishA.isk, pairId)
    expect(keyA).toHaveLength(32)
    expect(toBase64(keyA)).toBe(toBase64(pairCodeBoxKey(b.isk, pairId)))
  })

  it("the box key is bound to the box", () => {
    const { finishA } = run("K7P4QM", "K7P4QM")
    expect(toBase64(pairCodeBoxKey(finishA.isk, pairId))).not.toBe(toBase64(pairCodeBoxKey(finishA.isk, "BBBBBBBBBBBBBBBBBBBBBB")))
  })

  it("the words take the CPace transcript too: another run, other words, same device keys", () => {
    const host = new Uint8Array(32).fill(1)
    const guest = new Uint8Array(32).fill(2)
    const first = run("K7P4QM", "K7P4QM").finishA.transcript
    const second = run("K7P4QM", "K7P4QM").finishA.transcript
    const p1 = pairCodeSasWords(pairId, host, guest, first)
    expect(p1.split("-")).toHaveLength(6)
    expect(p1).not.toBe(pairCodeSasWords(pairId, host, guest, second))
    // And never the words of the long-code pairing for the same keys.
    expect(p1).not.toBe(palavrasDoSas(pairId, host, guest))
  })
})

describe("the CPace messages in the box", () => {
  it("go and come back", () => {
    const sid = new Uint8Array(16).fill(9)
    const y = new Uint8Array(32).fill(4)
    const tag = new Uint8Array(64).fill(5)
    for (const message of [
      { t: "pake-a", sid, y },
      { t: "pake-b", y, tag },
      { t: "pake-tag", tag },
    ] as const) {
      const back = decodePake(encodePake(message))
      expect(back).toEqual(message)
    }
  })

  it("garbage is null, never a throw", () => {
    expect(decodePake("not base64 !")).toBeNull()
    expect(decodePake(42)).toBeNull()
    expect(decodePake(toBase64(new TextEncoder().encode('{"t":"pake-a","sid":"AA","y":"AA"}')))).toBeNull()
    expect(decodePake("x".repeat(9000))).toBeNull()
  })
})
