import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { toBase64 } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { comCabecalho } from "./cabecalhoDoCofre.js"
import { acabarSelo, base64NoSitio, bytesEmUtf8, comecarSelo, comprimentoDoFim, comprimentoEmBase64 } from "./seloDoCofre.js"
import { bytesParaBase64 } from "./vault.js"

/**
 * The vault file built in one buffer is the file of 1.3.12, byte for byte.
 */

const chave = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32))
const nonce = (): Uint8Array => crypto.getRandomValues(new Uint8Array(24))

/** The file as 1.3.12 wrote it, step by step, with all its copies. */
function comoAntes(json: string, key: Uint8Array, n: Uint8Array, campos: Record<string, unknown>, depois: Record<string, unknown> = {}): Uint8Array {
  const ciphertext = xchacha20poly1305(key, n).encrypt(new TextEncoder().encode(json))
  return comCabecalho(JSON.stringify({ ...campos, ciphertext: bytesParaBase64(ciphertext), ...depois }))
}

const TEXTOS: [string, string][] = [
  ["ASCII", JSON.stringify({ a: 1, b: "x".repeat(1000) })],
  ["acentos", JSON.stringify({ corpo: "Olá, já viste a reunião às dez? Ação, coração, pão." })],
  ["emoji e CJK", JSON.stringify({ corpo: "🙂👍🏽 日本語 — “aspas” €" })],
  ["surrogate sozinho (escapado pelo JSON)", JSON.stringify({ corpo: "a\ud800b\udc00c" })],
  ["vazio", JSON.stringify({})],
]

describe("selo do cofre num só buffer", () => {
  for (const [nome, json] of TEXTOS) {
    it(`conta os bytes UTF-8 como o TextEncoder: ${nome}`, () => {
      expect(bytesEmUtf8(json)).toBe(new TextEncoder().encode(json).length)
    })
  }

  it("conta um surrogate sozinho como U+FFFD (3 bytes), como o TextEncoder", () => {
    for (const texto of ["\ud800", "a\udc00", "\ud800\ud800", "x\udbff"]) {
      expect(bytesEmUtf8(texto)).toBe(new TextEncoder().encode(texto).length)
    }
  })

  for (const [nome, json] of TEXTOS) {
    for (const extra of ["", "a", "ab"]) {
      it(`dá o mesmo ficheiro que a 1.3.12, com palavra-passe: ${nome} (+${extra.length})`, () => {
        const texto = json.slice(0, -1) + (json.length > 2 ? "," : "") + `"z":"${extra}"}`
        const key = chave()
        const n = nonce()
        const campos = { version: 2, protection: "passphrase", nonce: toBase64(n) }
        const salt = { salt: toBase64(crypto.getRandomValues(new Uint8Array(16))) }
        const envelope = JSON.stringify({ ...campos, ciphertext: "", ...salt })
        const selo = comecarSelo(() => texto, key, n, envelope, comprimentoDoFim(envelope))
        const bytes = acabarSelo(selo, envelope)
        // No copy at the end: the reserve was exact.
        expect(bytes).toBe(selo.buffer)
        expect(bytes).toEqual(comoAntes(texto, key, n, campos, salt))
      })
    }
  }

  it("dá o mesmo ficheiro com a chave embrulhada, que só se sabe depois (cofre os)", () => {
    const key = chave()
    const n = nonce()
    const campos = { version: 2, protection: "os", nonce: toBase64(n) }
    const texto = JSON.stringify({ corpo: "olá ".repeat(500) })
    const selo = comecarSelo(() => texto, key, n, JSON.stringify({ ...campos, ciphertext: "" }), 0)
    const embrulho = { wrappedKey: toBase64(crypto.getRandomValues(new Uint8Array(61))) }
    const bytes = acabarSelo(selo, JSON.stringify({ ...campos, ciphertext: "", ...embrulho }))
    expect(bytes).toEqual(comoAntes(texto, key, n, campos, embrulho))
  })

  it("recusa um envelope final com outro começo", () => {
    const n = nonce()
    const envelope = JSON.stringify({ version: 2, protection: "passphrase", nonce: toBase64(n), ciphertext: "" })
    const selo = comecarSelo(() => "{}", chave(), n, envelope, 0)
    expect(() => acabarSelo(selo, envelope.replace('"version":2', '"version":3'))).toThrow()
  })

  it("o base64 no sítio é o base64 de sempre, para todos os restos, e recusa um escritor à frente do leitor", () => {
    for (let n = 1; n < 40; n++) {
      const dados = crypto.getRandomValues(new Uint8Array(n))
      const L = comprimentoEmBase64(n)
      const buf = new Uint8Array(L)
      buf.set(dados, L - n)
      expect(base64NoSitio(buf, L - n, n, 0)).toBe(L)
      expect(new TextDecoder().decode(buf)).toBe(bytesParaBase64(dados))
    }
    expect(() => base64NoSitio(new Uint8Array(64), 1, 30, 0)).toThrow()
  })

  it("cifrar no sítio dá o mesmo que cifrar para um buffer novo", () => {
    const key = chave()
    const n = nonce()
    const claro = crypto.getRandomValues(new Uint8Array(65_531))
    const novo = xchacha20poly1305(key, n).encrypt(claro)
    const buf = new Uint8Array(claro.length + 16)
    buf.set(claro)
    xchacha20poly1305(key, n).encrypt(buf.subarray(0, claro.length), buf)
    expect(buf).toEqual(novo)
  })
})
