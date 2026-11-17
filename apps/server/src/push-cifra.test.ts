import { fromBase64, toBase64 } from "@enclave/protocol"
import { p256 } from "@noble/curves/nist.js"
import { describe, expect, it } from "vitest"
import {
  CORPO_DO_PUSH_BYTES,
  cabecalhoVapid,
  cifrarPush,
  decifrarPush,
  jwtVapid,
  lerJwtVapid,
} from "./push-cifra.js"

/**
 * The Web Push cipher (RFC 8291) and the VAPID token (RFC 8292), against the
 * vectors printed in the RFCs themselves.
 *
 * The values below are copied from the RFC text, whitespace removed. If our
 * implementation is wrong by one byte anywhere (the info strings, the HKDF
 * order, the header, the padding delimiter), the final message does not match.
 */
const b = (texto: string): Uint8Array => fromBase64(texto.replace(/\s+/g, ""))

// RFC 8291, section 5 and Appendix A.
const RFC8291 = {
  texto: "When I grow up, I want to be a watermelon",
  asPublica: b("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"),
  asPrivada: b("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
  uaPublica: b("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
  uaPrivada: b("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"),
  sal: b("DGv6ra1nlYgDCS1FRnbzlw"),
  auth: b("BTBZMqHH6r4Tts7J_aSIgg"),
  cek: b("oIhVW04MRdy2XN9CiKLxTg"),
  nonce: b("4h_95klXJ5E_qnoN"),
  cabecalho: b(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
    mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8`),
  mensagem: b(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
    mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
    pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`),
}

// RFC 8292, section 2.4.
const RFC8292 = {
  jwt: `eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL3
    B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1ha
    Wx0bzpwdXNoQGV4YW1wbGUuY29tIn0.i3CYb7t4xfxCDquptFOepC9GAu_H
    LGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA`.replace(/\s+/g, ""),
  chave: "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs",
  claims: { aud: "https://push.example.net", exp: 1453523768, sub: "mailto:push@example.com" },
}

const iguais = (a: Uint8Array, b: Uint8Array): void => expect(toBase64(a)).toBe(toBase64(b))

describe("RFC 8291: a cifra do push", () => {
  it("os vectores batem com as próprias chaves do RFC", () => {
    // The vector's key pairs are consistent: our curve library derives the same publics.
    iguais(p256.getPublicKey(RFC8291.asPrivada, false), RFC8291.asPublica)
    iguais(p256.getPublicKey(RFC8291.uaPrivada, false), RFC8291.uaPublica)
  })

  it("a mensagem do Apêndice A sai igual, byte a byte", () => {
    const { mensagem, cek, nonce } = cifrarPush(
      new TextEncoder().encode(RFC8291.texto),
      { p256dh: RFC8291.uaPublica, auth: RFC8291.auth },
      // The RFC example is unpadded: only the 0x02 delimiter.
      { privadaEfemera: RFC8291.asPrivada, sal: RFC8291.sal, tamanho: "sem-enchimento" },
    )
    iguais(cek, RFC8291.cek)
    iguais(nonce, RFC8291.nonce)
    iguais(mensagem.subarray(0, 86), RFC8291.cabecalho)
    expect(mensagem.length).toBe(RFC8291.mensagem.length)
    iguais(mensagem, RFC8291.mensagem)
  })

  it("o receptor do RFC decifra a mensagem do RFC", () => {
    const texto = decifrarPush(RFC8291.mensagem, { privada: RFC8291.uaPrivada, auth: RFC8291.auth })
    expect(new TextDecoder().decode(texto)).toBe(RFC8291.texto)
  })

  it("o corpo do Orwell tem sempre o mesmo tamanho, e o receptor lê a língua", () => {
    const privada = p256.utils.randomSecretKey()
    const publica = p256.getPublicKey(privada, false)
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const tamanhos = new Set<number>()
    for (const lingua of ["pt", "en", ""]) {
      const { mensagem } = cifrarPush(new TextEncoder().encode(lingua), { p256dh: publica, auth })
      tamanhos.add(mensagem.length)
      expect(new TextDecoder().decode(decifrarPush(mensagem, { privada, auth }))).toBe(lingua)
    }
    // 86 bytes of header, the padded record, the 16-byte tag.
    expect([...tamanhos]).toEqual([86 + CORPO_DO_PUSH_BYTES + 16])
  })

  it("duas cifras do mesmo texto não se parecem (sal e chave efémera novos)", () => {
    const privada = p256.utils.randomSecretKey()
    const destino = { p256dh: p256.getPublicKey(privada, false), auth: new Uint8Array(16).fill(7) }
    const um = cifrarPush(new TextEncoder().encode("pt"), destino).mensagem
    const dois = cifrarPush(new TextEncoder().encode("pt"), destino).mensagem
    expect(toBase64(um)).not.toBe(toBase64(dois))
  })

  it("recusa um p256dh que não é um ponto da curva, e um auth com o tamanho errado", () => {
    const auth = new Uint8Array(16)
    const mau = new Uint8Array(65).fill(1)
    mau[0] = 4
    expect(() => cifrarPush(new Uint8Array([1]), { p256dh: mau, auth })).toThrow()
    const bom = p256.getPublicKey(p256.utils.randomSecretKey(), false)
    expect(() => cifrarPush(new Uint8Array([1]), { p256dh: bom, auth: new Uint8Array(15) })).toThrow()
  })

  it("um texto que não cabe no corpo fixo é recusado, não cortado", () => {
    const privada = p256.utils.randomSecretKey()
    const destino = { p256dh: p256.getPublicKey(privada, false), auth: new Uint8Array(16) }
    expect(() => cifrarPush(new Uint8Array(CORPO_DO_PUSH_BYTES), destino)).toThrow()
  })
})

describe("RFC 8292: o VAPID", () => {
  it("o cabeçalho e o corpo do JWT do RFC saem iguais, byte a byte", () => {
    const privada = p256.utils.randomSecretKey()
    const nosso = jwtVapid(privada, RFC8292.claims)
    const [cab, corpo] = nosso.split(".")
    const [cabRfc, corpoRfc] = RFC8292.jwt.split(".")
    expect(cab).toBe(cabRfc)
    expect(corpo).toBe(corpoRfc)
  })

  it("a assinatura do RFC verifica com a chave do RFC, e lê os claims", () => {
    expect(lerJwtVapid(RFC8292.jwt, fromBase64(RFC8292.chave))).toEqual(RFC8292.claims)
  })

  it("a nossa assinatura verifica com a nossa chave e falha com outra", () => {
    const privada = p256.utils.randomSecretKey()
    const publica = p256.getPublicKey(privada, false)
    const jwt = jwtVapid(privada, RFC8292.claims)
    expect(jwt.split(".")[2]?.length).toBe(86) // 64 bytes, r || s
    expect(lerJwtVapid(jwt, publica)).toEqual(RFC8292.claims)
    expect(lerJwtVapid(jwt, fromBase64(RFC8292.chave))).toBeNull()
    // A changed claim breaks the signature.
    const [c, , s] = jwt.split(".")
    const outro = toBase64(new TextEncoder().encode(JSON.stringify({ ...RFC8292.claims, exp: 1 })))
    expect(lerJwtVapid(`${c}.${outro}.${s}`, publica)).toBeNull()
  })

  it("o Authorization tem a forma do RFC: vapid t=..., k=...", () => {
    const privada = p256.utils.randomSecretKey()
    const publica = p256.getPublicKey(privada, false)
    const cabecalho = cabecalhoVapid(privada, publica, RFC8292.claims)
    const m = /^vapid t=([A-Za-z0-9_.-]+), k=([A-Za-z0-9_-]+)$/.exec(cabecalho)
    expect(m).not.toBeNull()
    expect(m?.[2]).toBe(toBase64(publica))
    expect(lerJwtVapid(m?.[1] as string, publica)).toEqual(RFC8292.claims)
  })
})
