import { describe, expect, it } from "vitest"
import { sha256 } from "@noble/hashes/sha2.js"
import { toBase64 } from "./canonical.js"
import {
  chaveDaProvaDoConvite,
  provarCodigoDoConvite,
  provarConviteNoRegisto,
  verificarConviteNoRegisto,
  verificarProvaDoConvite,
} from "./prova-do-convite.js"
import { ClientFrame } from "./wire.js"

/**
 * The proof of an invite code (1.0 "Arca", slice 2). What is pinned: the key
 * comes from the code and only the code; the proof is valid for THIS request and
 * this account and no other; and what sits in the database (the hash and public
 * key) does not sign anything.
 */

const CODIGO = "c2VncmVkby1kby1jb252aXRlLWRlLXRlc3Rl"
const CODE_HASH = toBase64(sha256(new TextEncoder().encode(CODIGO)))
const PEDIDO = { codeHash: CODE_HASH, address: "@bruno:orwell.pt", keyPackage: toBase64(new Uint8Array([1, 2, 3])) }

describe("a prova do código do convite", () => {
  it("a chave é a mesma para o mesmo código, outra para outro, e não é o hash", () => {
    const a = chaveDaProvaDoConvite(CODIGO)
    expect(toBase64(chaveDaProvaDoConvite(CODIGO).publica)).toBe(toBase64(a.publica))
    expect(toBase64(chaveDaProvaDoConvite(`${CODIGO}x`).publica)).not.toBe(toBase64(a.publica))
    expect(toBase64(a.publica)).not.toBe(CODE_HASH)
  })

  it("quem tem o código prova; a prova confere com a chave pública", () => {
    const codeKey = toBase64(chaveDaProvaDoConvite(CODIGO).publica)
    const prova = provarCodigoDoConvite(CODIGO, PEDIDO)
    expect(verificarProvaDoConvite(codeKey, prova, PEDIDO)).toBe(true)
  })

  it("a prova não serve a outra conta, a outro key package, nem a outro convite", () => {
    const codeKey = toBase64(chaveDaProvaDoConvite(CODIGO).publica)
    const prova = provarCodigoDoConvite(CODIGO, PEDIDO)
    expect(verificarProvaDoConvite(codeKey, prova, { ...PEDIDO, address: "@carla:orwell.pt" })).toBe(false)
    expect(verificarProvaDoConvite(codeKey, prova, { ...PEDIDO, keyPackage: toBase64(new Uint8Array([9])) })).toBe(false)
    expect(verificarProvaDoConvite(codeKey, prova, { ...PEDIDO, codeHash: toBase64(new Uint8Array(32)) })).toBe(false)
  })

  it("o que está na base não chega: sem o código, nenhuma assinatura confere", () => {
    const codeKey = toBase64(chaveDaProvaDoConvite(CODIGO).publica)
    // A caller with only the hash and public key tries what they can: the hash as
    // code, the key as proof, garbage.
    expect(verificarProvaDoConvite(codeKey, provarCodigoDoConvite(CODE_HASH, PEDIDO), PEDIDO)).toBe(false)
    expect(verificarProvaDoConvite(codeKey, codeKey, PEDIDO)).toBe(false)
    expect(verificarProvaDoConvite(codeKey, "lixo", PEDIDO)).toBe(false)
  })
})

describe("a prova do convite no registo (1.3.26)", () => {
  const REGISTO = { codeHash: CODE_HASH, address: "@nova:orwell.pt" }
  const codeKey = toBase64(chaveDaProvaDoConvite(CODIGO).publica)

  it("vale para esta conta e este convite, e para nenhum outro", () => {
    const prova = provarConviteNoRegisto(CODIGO, REGISTO)
    expect(verificarConviteNoRegisto(codeKey, prova, REGISTO)).toBe(true)
    expect(verificarConviteNoRegisto(codeKey, prova, { ...REGISTO, address: "@outra:orwell.pt" })).toBe(false)
    expect(verificarConviteNoRegisto(codeKey, prova, { ...REGISTO, codeHash: "outro" })).toBe(false)
    expect(verificarConviteNoRegisto(codeKey, "lixo", REGISTO)).toBe(false)
  })

  it("não troca com a prova do resgate: domínios diferentes", () => {
    const pedido = { ...PEDIDO, address: REGISTO.address }
    expect(verificarConviteNoRegisto(codeKey, provarCodigoDoConvite(CODIGO, pedido), REGISTO)).toBe(false)
    expect(verificarProvaDoConvite(codeKey, provarConviteNoRegisto(CODIGO, REGISTO), pedido)).toBe(false)
  })

  it("viaja no auth.finish, e só com hash e prova", () => {
    const prova = provarConviteNoRegisto(CODIGO, REGISTO)
    const base = { t: "auth.finish", signature: "AAAA" }
    expect(ClientFrame.safeParse({ ...base, conviteDeComunidade: { codeHash: CODE_HASH, prova } }).success).toBe(true)
    expect(ClientFrame.safeParse({ ...base, conviteDeComunidade: { codeHash: CODE_HASH } }).success).toBe(false)
    expect(ClientFrame.safeParse({ ...base, conviteDeComunidade: { codeHash: "x".repeat(65), prova } }).success).toBe(false)
  })
})
