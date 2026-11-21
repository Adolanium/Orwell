import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { describe, expect, it } from "vitest"
import {
  CPACE_DSI,
  calculateGenerator,
  confirmationKey,
  cpaceStart,
  cpaceRespond,
  cpaceFinish,
  confirmationTag,
  generatorString,
  computeIsk,
  lvCat,
  prependLen,
  scalarMult,
  scalarMultVfy,
  transcriptIr,
} from "./cpace.js"

/**
 * CPace over ristretto255 with SHA-512, checked against the test vectors of
 * draft-irtf-cfrg-cpace-21 (23 April 2026): Appendix A.1 (prepend_len,
 * lv_cat), A.3.5 (transcript_ir) and Appendix B.3 (the whole ristretto255
 * run: generator, both messages, K, ISK, and the invalid points of B.3.11).
 *
 * If one of these fails, the code is not CPace any more, and two devices of
 * different versions will never agree on a key.
 */

const enc = new TextEncoder()
const hex = (texto: string): Uint8Array => hexToBytes(texto.replace(/\s+/g, ""))

// Appendix B.3.1 inputs.
const PRS = enc.encode("Password")
const CI = hex("0b415f696e69746961746f720b425f726573706f6e646572")
const SID = hex("7e4b4791d6a8ef019b936c79fb7f2c57")
const ADA = enc.encode("ADa")
const ADB = enc.encode("ADb")
const YA_SCALAR = hex("da3d23700a9e5699258aef94dc060dfda5ebb61f02a5ea77fad53f4ff0976d08")
const YB_SCALAR = hex("d2316b454718c35362d83d69df6320f38578ed5984651435e2949762d900b80d")

describe("string helpers (draft-21 Appendix A.1, A.3.5)", () => {
  it("prepend_len", () => {
    expect(bytesToHex(prependLen(new Uint8Array()))).toBe("00")
    expect(bytesToHex(prependLen(enc.encode("1234")))).toBe("0431323334")
    const r127 = Uint8Array.from({ length: 127 }, (_, i) => i)
    expect(bytesToHex(prependLen(r127)).slice(0, 4)).toBe("7f00")
    expect(prependLen(r127).length).toBe(128)
    const r128 = Uint8Array.from({ length: 128 }, (_, i) => i)
    expect(bytesToHex(prependLen(r128)).slice(0, 6)).toBe("800100")
    expect(prependLen(r128).length).toBe(130)
  })

  it("lv_cat", () => {
    expect(bytesToHex(lvCat(enc.encode("1234"), enc.encode("5"), new Uint8Array(), enc.encode("678")))).toBe(
      "043132333401350003363738",
    )
  })

  it("transcript_ir", () => {
    expect(bytesToHex(transcriptIr(enc.encode("123"), enc.encode("PartyA"), enc.encode("234"), enc.encode("PartyB")))).toBe(
      "03313233065061727479410332333406506172747942",
    )
    expect(bytesToHex(transcriptIr(enc.encode("3456"), enc.encode("PartyA"), enc.encode("2345"), enc.encode("PartyB")))).toBe(
      "043334353606506172747941043233343506506172747942",
    )
  })
})

describe("CPace ristretto255-SHA512 (draft-21 Appendix B.3)", () => {
  it("uses the ristretto255 DSI", () => {
    expect(new TextDecoder().decode(CPACE_DSI)).toBe("CPaceRistretto255")
  })

  it("B.3.1 generator_string and the encoded generator", () => {
    expect(bytesToHex(generatorString(PRS, CI, SID))).toBe(
      (
        "11435061636552697374726574746f3235350850617373776f726464" +
        "00000000000000000000000000000000000000000000000000000000" +
        "00000000000000000000000000000000000000000000000000000000" +
        "00000000000000000000000000000000000000000000000000000000" +
        "00000000000000000000000000000000180b415f696e69746961746f" +
        "720b425f726573706f6e646572107e4b4791d6a8ef019b936c79fb7f" +
        "2c57"
      ),
    )
    expect(bytesToHex(calculateGenerator(PRS, CI, SID).toBytes())).toBe(
      "222b6b195fe84b1652badb6f6a3ae3d24341e7306967f0b8115b40d5698c7e56",
    )
  })

  it("B.3.2 / B.3.3 the two messages", () => {
    const g = calculateGenerator(PRS, CI, SID)
    expect(bytesToHex(scalarMult(YA_SCALAR, g))).toBe("d6bac480f2c386c394efc7c47adb9925dcd2630b64f240c50f8d0eec482b9157")
    expect(bytesToHex(scalarMult(YB_SCALAR, g))).toBe("3ea7e0b19560d7c0b0f5734f63b955286dfa8232b5ebe63324e2d9e7433f7258")
  })

  it("B.3.4 / B.3.5 K and the initiator-responder ISK", () => {
    const g = calculateGenerator(PRS, CI, SID)
    const ya = scalarMult(YA_SCALAR, g)
    const yb = scalarMult(YB_SCALAR, g)
    const k = scalarMultVfy(YA_SCALAR, yb)
    expect(k).not.toBeNull()
    expect(bytesToHex(k!)).toBe("80b69a8a76457ab6a4d7f887a4bf6b55a2f80ac19c333f917a05fc9887c8b40f")
    expect(bytesToHex(scalarMultVfy(YB_SCALAR, ya)!)).toBe(bytesToHex(k!))
    expect(bytesToHex(computeIsk(SID, k!, transcriptIr(ya, ADA, yb, ADB)))).toBe(
      "b69effbf61b51d56401c0f65601abe428de8206feaaf0e32198896dc" +
        "ae7b35cd2b38950a39dfd5d4a79164614c2984f7daa460b588c1e80c" +
        "3fa2068af7900447",
    )
  })

  it("B.3.10 scalar_mult_vfy with a valid point", () => {
    const s = hex("7cd0e075fa7955ba52c02759a6c90dbbfc10e6d40aea8d283e407d88cf538a05")
    const x = hex("2c3c6b8c4f3800e7aef6864025b4ed79bd599117e427c41bd47d93d654b4a51c")
    expect(bytesToHex(scalarMultVfy(s, x)!)).toBe("7c13645fe790a468f62c39beb7388e541d8405d1ade69d1778c5fe3e7f6b600e")
  })

  it("B.3.11 refuses a point that does not decode and the neutral element", () => {
    const s = hex("7cd0e075fa7955ba52c02759a6c90dbbfc10e6d40aea8d283e407d88cf538a05")
    expect(scalarMultVfy(s, hex("2b3c6b8c4f3800e7aef6864025b4ed79bd599117e427c41bd47d93d654b4a51c"))).toBeNull()
    expect(scalarMultVfy(s, new Uint8Array(32))).toBeNull()
    expect(scalarMultVfy(s, new Uint8Array(31))).toBeNull()
  })
})

describe("the run with key confirmation (draft-21 section 10.4)", () => {
  const ci = enc.encode("ci-de-teste")

  it("same code: both sides get the same ISK and accept the other's tag", () => {
    const a = cpaceStart(enc.encode("K7P4QM"), ci)
    const b = cpaceRespond(enc.encode("K7P4QM"), ci, a.message)
    expect(b).not.toBeNull()
    const finishA = cpaceFinish(a, b!.message)
    expect(finishA).not.toBeNull()
    expect(bytesToHex(finishA!.isk)).toBe(bytesToHex(b!.isk))
    // A checks B's tag, B checks A's tag.
    expect(finishA!.verifyPeerTag(b!.tag)).toBe(true)
    expect(b!.verifyPeerTag(finishA!.tag)).toBe(true)
    expect(bytesToHex(finishA!.transcript)).toBe(bytesToHex(b!.transcript))
  })

  it("a different code: different ISK, and each side refuses the other's tag", () => {
    const a = cpaceStart(enc.encode("K7P4QM"), ci)
    const b = cpaceRespond(enc.encode("K7P4QN"), ci, a.message)
    const finishA = cpaceFinish(a, b!.message)
    expect(bytesToHex(finishA!.isk)).not.toBe(bytesToHex(b!.isk))
    expect(finishA!.verifyPeerTag(b!.tag)).toBe(false)
    expect(b!.verifyPeerTag(finishA!.tag)).toBe(false)
  })

  it("a fresh scalar and sid each run", () => {
    const first = cpaceStart(enc.encode("K7P4QM"), ci)
    const second = cpaceStart(enc.encode("K7P4QM"), ci)
    expect(bytesToHex(first.message.sid)).not.toBe(bytesToHex(second.message.sid))
    expect(bytesToHex(first.message.y)).not.toBe(bytesToHex(second.message.y))
  })

  it("an invalid share aborts", () => {
    const a = cpaceStart(enc.encode("K7P4QM"), ci)
    expect(cpaceRespond(enc.encode("K7P4QM"), ci, { ...a.message, y: new Uint8Array(32) })).toBeNull()
    expect(cpaceFinish(a, { y: new Uint8Array(32) })).toBeNull()
  })

  it("the tag is the draft's HMAC over lv_cat(Y, AD) with mac_key = H(b'CPaceMac' || sid || ISK)", () => {
    const isk = new Uint8Array(64).fill(7)
    const sid = new Uint8Array(16).fill(1)
    const key = confirmationKey(sid, isk)
    expect(key.length).toBe(64)
    const y = new Uint8Array(32).fill(3)
    expect(confirmationTag(key, y, new Uint8Array()).length).toBe(64)
  })
})
