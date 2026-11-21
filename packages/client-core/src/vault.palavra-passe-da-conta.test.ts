import { describe, expect, it } from "vitest"
import { ERRO_COFRE_POR_SELAR, ERRO_NAO_E_A_PALAVRA_PASSE_DA_CONTA, venceAPalavraPasse } from "./palavraPasseDaConta.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * One password on every device of the account (1.3.26), on the vault side: the
 * record a vault gives; adopting another device's record (one write, a failure
 * changes nothing); and the pairing vault that has no password until the
 * account's is typed and checked.
 */

class Disco implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  falhar = false
  escritas = 0
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    if (this.falhar) throw new Error("vault storage is full")
    this.bytes = bytes
    this.escritas++
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

async function aberto(frase: string, nome: string) {
  const disco = new Disco()
  const vault = new Vault(disco)
  await vault.create(frase)
  await vault.update((c) => {
    c.profile.displayName = nome
  })
  return { disco, vault }
}

describe("o registo da palavra-passe da conta", () => {
  it("um aparelho adopta o registo de outro: abre com a palavra-passe da conta, não com a sua", async () => {
    const a = await aberto("palavra-do-a-1", "A")
    const b = await aberto("palavra-do-b-2", "B")
    await a.vault.mudarPalavraPasse("palavra-do-a-1", "palavra-nova-3", { versao: 1 })
    const registo = a.vault.palavraPasseDaConta()!
    expect(registo.versao).toBe(1)

    await b.vault.adoptarPalavraPasseDaConta(registo)
    expect(b.vault.contents.profile.displayName).toBe("B")
    await expect(new Vault(b.disco).unlock("palavra-do-b-2")).rejects.toThrow("wrong passphrase, or the vault is damaged")
    const reaberto = new Vault(b.disco)
    await reaberto.unlock("palavra-nova-3")
    expect(reaberto.contents.profile.displayName).toBe("B")
    expect(reaberto.contents.palavraPasseDaConta).toEqual({ versao: 1 })
    expect(reaberto.palavraPasseDaConta()).toEqual(registo)
  })

  it("uma escrita que falha a meio deixa o cofre com a palavra-passe dele, e a versão de antes", async () => {
    const a = await aberto("palavra-do-a-1", "A")
    const b = await aberto("palavra-do-b-2", "B")
    await a.vault.mudarPalavraPasse("palavra-do-a-1", "palavra-nova-3", { versao: 1 })
    b.disco.falhar = true
    await expect(b.vault.adoptarPalavraPasseDaConta(a.vault.palavraPasseDaConta()!)).rejects.toThrow("vault storage is full")
    b.disco.falhar = false
    expect(b.vault.contents.palavraPasseDaConta).toBeUndefined()
    await b.vault.update((c) => {
      c.profile.displayName = "B depois"
    })
    const lido = new Vault(b.disco)
    await lido.unlock("palavra-do-b-2")
    expect(lido.contents.profile.displayName).toBe("B depois")
  })

  it("antes de qualquer mudança o registo é a versão 0, com o sal e a chave do próprio cofre", async () => {
    const a = await aberto("palavra-do-a-1", "A")
    const registo = a.vault.palavraPasseDaConta()!
    expect(registo.versao).toBe(0)
    expect(registo.sal).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(registo.chave).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe("o cofre do emparelhamento, sem palavra-passe até à da conta", () => {
  it("não vai ao disco sem a palavra-passe; a errada recusa; a da conta sela e grava", async () => {
    const anfitriao = await aberto("palavra-da-conta-1", "Conta")
    const registo = anfitriao.vault.palavraPasseDaConta()!
    const disco = new Disco()
    const novo = new Vault(disco)
    novo.criarProvisorioPorSelar()
    expect(novo.porSelar).toBe(true)
    await expect(novo.confirmarProvisorio()).rejects.toThrow(ERRO_COFRE_POR_SELAR)
    expect(disco.bytes).toBeNull()

    await expect(novo.selarComPalavraPasseDaConta("outra-qualquer", registo)).rejects.toThrow(ERRO_NAO_E_A_PALAVRA_PASSE_DA_CONTA)
    expect(novo.porSelar).toBe(true)
    expect(disco.bytes).toBeNull()

    await novo.selarComPalavraPasseDaConta("palavra-da-conta-1", registo)
    expect(novo.porSelar).toBe(false)
    expect(disco.bytes).toBeNull()
    await novo.confirmarProvisorio()
    const reaberto = new Vault(disco)
    await reaberto.unlock("palavra-da-conta-1")
    expect(reaberto.palavraPasseDaConta()?.chave).toBe(registo.chave)
  })

  it("sem registo do anfitrião, escolhe-se uma nova", async () => {
    const disco = new Disco()
    const novo = new Vault(disco)
    novo.criarProvisorioPorSelar()
    await novo.selarComPalavraPasseNova("uma-palavra-nova")
    await novo.confirmarProvisorio()
    await new Vault(disco).unlock("uma-palavra-nova")
  })
})

describe("qual registo vence", () => {
  const r = (versao: number, chave: string) => ({ versao, sal: "s".repeat(22), chave: chave.padEnd(43, "x") })
  it("a versão mais alta vence; na mesma versão, a chave mais baixa, em todos os aparelhos", () => {
    expect(venceAPalavraPasse(r(2, "b"), r(1, "a"))).toBe(true)
    expect(venceAPalavraPasse(r(1, "a"), r(2, "b"))).toBe(false)
    expect(venceAPalavraPasse(r(2, "a"), r(2, "b"))).toBe(true)
    expect(venceAPalavraPasse(r(2, "b"), r(2, "a"))).toBe(false)
    expect(venceAPalavraPasse(r(1, "a"), null)).toBe(true)
  })
})

describe("join another account: the account password is checked before anything changes", () => {
  it("verifyAccountPassword accepts the account's password and refuses another, leaving this vault as it was", async () => {
    const main = await aberto("main-password-1", "Main")
    const other = await aberto("other-password-2", "Other")
    const record = main.vault.palavraPasseDaConta()!
    await expect(other.vault.verifyAccountPassword("main-password-1", record)).resolves.toBeUndefined()
    await expect(other.vault.verifyAccountPassword("other-password-2", record)).rejects.toThrow(ERRO_NAO_E_A_PALAVRA_PASSE_DA_CONTA)
    expect(other.vault.contents.profile.displayName).toBe("Other")
    expect(other.disco.escritas).toBe(2)
  })
})
