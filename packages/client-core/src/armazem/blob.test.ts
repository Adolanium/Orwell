import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { aad, CABECALHO_DO_BLOB, cifrarBlob, decifrarBlob } from "./blob.js"

/**
 * The store blob: "orwm1\n" followed by the ciphertext with
 * XChaCha20-Poly1305. The AAD binds the blob to the address and the class; the
 * key and the nonce never go in the blob.
 */
const SHA = "q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c"
const OUTRO_SHA = "Z1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c"

function material() {
  return {
    texto: Uint8Array.from(randomBytes(4096)),
    k: Uint8Array.from(randomBytes(32)),
    n: Uint8Array.from(randomBytes(24)),
  }
}

/** Where the needle appears in the haystack, or -1. */
function indiceDe(palheiro: Uint8Array, agulha: Uint8Array): number {
  return Buffer.from(palheiro).indexOf(Buffer.from(agulha))
}

describe("o blob do armazém (orwm1)", () => {
  it("decifra o que cifrou", () => {
    const { texto, k, n } = material()
    const blob = cifrarBlob(texto, k, n, SHA, "original")
    expect(decifrarBlob(blob, k, n, SHA, "original")).toEqual(texto)
  })

  it("um texto vazio também dá a volta", () => {
    const { k, n } = material()
    const blob = cifrarBlob(new Uint8Array(0), k, n, SHA, "mini")
    expect(decifrarBlob(blob, k, n, SHA, "mini")).toEqual(new Uint8Array(0))
  })

  it("começa pelo cabeçalho em claro orwm1\\n, e só tem o cifrado e a etiqueta a seguir", () => {
    const { texto, k, n } = material()
    const blob = cifrarBlob(texto, k, n, SHA, "original")
    expect(CABECALHO_DO_BLOB).toBe("orwm1\n")
    expect(new TextDecoder().decode(blob.subarray(0, 6))).toBe("orwm1\n")
    expect(blob.length).toBe(6 + texto.length + 16)
  })

  it("a AAD é orwell-media-v1\\0 sha \\0 classe", () => {
    expect(new TextDecoder().decode(aad(SHA, "mini"))).toBe(`orwell-media-v1\0${SHA}\0mini`)
  })

  it("com outro sha na AAD não abre", () => {
    const { texto, k, n } = material()
    const blob = cifrarBlob(texto, k, n, SHA, "original")
    expect(() => decifrarBlob(blob, k, n, OUTRO_SHA, "original")).toThrow("media blob is damaged")
  })

  it("com a classe trocada não abre", () => {
    const { texto, k, n } = material()
    const blob = cifrarBlob(texto, k, n, SHA, "original")
    expect(() => decifrarBlob(blob, k, n, SHA, "mini")).toThrow("media blob is damaged")
  })

  it("um byte mudado, no cifrado, na etiqueta ou no cabeçalho, não abre", () => {
    const { texto, k, n } = material()
    const blob = cifrarBlob(texto, k, n, SHA, "original")
    for (const i of [0, 5, 6, 6 + 2000, blob.length - 1]) {
      const estragado = blob.slice()
      estragado[i] ^= 0x01
      expect(() => decifrarBlob(estragado, k, n, SHA, "original")).toThrow("media blob is damaged")
    }
  })

  it("um blob mais curto do que o cabeçalho não abre", () => {
    const { k, n } = material()
    expect(() => decifrarBlob(new TextEncoder().encode("orw"), k, n, SHA, "original")).toThrow("media blob is damaged")
  })

  it("o blob não leva a chave nem o nonce", () => {
    const { texto, k, n } = material()
    const blob = cifrarBlob(texto, k, n, SHA, "original")
    expect(indiceDe(blob, k)).toBe(-1)
    expect(indiceDe(blob, n)).toBe(-1)
  })
})
