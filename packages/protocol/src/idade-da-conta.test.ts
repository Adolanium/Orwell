import { ed25519 } from "@noble/curves/ed25519.js"
import { describe, expect, it } from "vitest"
import { toBase64 } from "./canonical.js"
import {
  CORTE_DA_1_0,
  criadaEmAtestada,
  IDADE_PARA_VOTAR_MS,
  mensagemDaAtestacao,
  podeVotar,
  type AtestacaoDeIdade,
} from "./idade-da-conta.js"

/** Only accounts created 5 days ago or more vote, by an age their homeserver signs (17/11/2026). */
const privada = ed25519.utils.randomSecretKey()
const publica = ed25519.getPublicKey(privada)
const KEY_ID = "ed25519:AAAA"
const ENDERECO = "@ana-bela-casa-azul:orwell.pt"

function assinar(a: Omit<AtestacaoDeIdade, "assinatura">, chave = privada): AtestacaoDeIdade {
  return { ...a, assinatura: toBase64(ed25519.sign(mensagemDaAtestacao(a), chave)) }
}
const base = { address: ENDERECO, criadaEm: Date.UTC(2026, 10, 1), servidor: "orwell.pt", keyId: KEY_ID }

describe("a atestação da idade da conta", () => {
  it("verdadeira: dá o instante da criação", () => {
    expect(criadaEmAtestada(assinar(base), ENDERECO, { [KEY_ID]: publica })).toBe(base.criadaEm)
  })

  it("forjada: assinada por outra chave, não conta", () => {
    const outra = ed25519.utils.randomSecretKey()
    expect(criadaEmAtestada(assinar(base, outra), ENDERECO, { [KEY_ID]: publica })).toBeNull()
  })

  it("forjada: a data mexida depois de assinada, não conta", () => {
    const verdadeira = assinar(base)
    expect(criadaEmAtestada({ ...verdadeira, criadaEm: base.criadaEm - 30 * 86_400_000 }, ENDERECO, { [KEY_ID]: publica })).toBeNull()
  })

  it("de outro servidor sobre esta conta, mesmo bem assinada, não conta", () => {
    const deFora = assinar({ ...base, servidor: "outro.pt" })
    expect(criadaEmAtestada(deFora, ENDERECO, { [KEY_ID]: publica })).toBeNull()
  })

  it("de outra conta não serve para esta", () => {
    expect(criadaEmAtestada(assinar(base), "@outra-conta-de-gente:orwell.pt", { [KEY_ID]: publica })).toBeNull()
  })

  it("lixo não conta e não rebenta", () => {
    expect(criadaEmAtestada({ address: ENDERECO }, ENDERECO, { [KEY_ID]: publica })).toBeNull()
    expect(criadaEmAtestada(null, ENDERECO, { [KEY_ID]: publica })).toBeNull()
  })
})

describe("a regra dos 5 dias", () => {
  const criada = Date.UTC(2026, 10, 10, 12)
  it("4 dias e 23 horas: não vota", () => {
    expect(podeVotar(criada, criada + 4 * 86_400_000 + 23 * 3_600_000)).toBe(false)
  })
  it("5 dias: vota", () => {
    expect(podeVotar(criada, criada + IDADE_PARA_VOTAR_MS)).toBe(true)
  })
  it("idade desconhecida: não vota", () => {
    expect(podeVotar(null, Date.now())).toBe(false)
  })
  it("o corte da 1.0 já passa os 5 dias hoje", () => {
    expect(podeVotar(CORTE_DA_1_0, Date.UTC(2026, 10, 17))).toBe(true)
  })
})
