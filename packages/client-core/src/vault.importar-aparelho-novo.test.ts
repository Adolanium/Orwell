import { generateIdentity, identityFromPrivateKey, parseServerName, toBase64, verifyDeviceChain, fromBase64 } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { ERRO_CONTA_CHEIA_NO_IMPORTAR, ERRO_FICHEIRO_SEM_CHAVE_DA_CONTA, type PedidoDePassagem } from "./passagem.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Importing the account file makes a NEW device of the account (1.3.26). What
 * these hold, on the vault side: the new device key is certified by the account
 * key of the file; what belongs to the device that exported it goes, the history
 * stays; every channel becomes a seat to ask; the handover runs BEFORE anything
 * is written, so a refusal leaves this device's vault as it was; and no
 * `assumirPosse` is ever written.
 */

class Disco implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  escritas = 0
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
    this.escritas++
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

const FRASE = "frase-de-viagem"
const CASA = "localhost"

async function contaExportada() {
  const raiz = generateIdentity(parseServerName(CASA))
  const aparelho = identityFromPrivateKey(raiz.signingPrivateKey, parseServerName(CASA))
  const origem = new Vault(new Disco())
  await origem.create(FRASE)
  await origem.update((c) => {
    c.signingPrivateKey = toBase64(raiz.signingPrivateKey)
    c.deviceSigningPrivateKey = toBase64(aparelho.deviceSigningPrivateKey)
    c.homeserver = CASA
    c.groups = { "#sala:localhost": "grupo-do-aparelho-antigo", "#conta:localhost": "grupo-da-conta" }
    c.pendingKeyPackages = [{ wire: "w", initPrivateKey: "i", hpkePrivateKey: "h", signaturePrivateKey: "s" }]
    c.lastSeq = { "#sala:localhost": 41 }
    c.sframeReservas = { "#sala:localhost|1": 9000 }
    c.posseDoAparelho = 3
    c.assumirPosse = "marca-antiga-de-1-3-25"
    c.pendingCommits = { "#sala:localhost": [] }
    c.moradaDaConta = "#conta:localhost"
    c.history = {
      "#sala:localhost": [{ seq: 40, sender: aparelho.address, at: 1, payload: { t: "chat", body: "olá do passado" } }],
      "#antiga:localhost": [{ seq: 2, sender: aparelho.address, at: 1, payload: { t: "chat", body: "arquivada" } }],
    }
    c.canaisArquivados = { "#antiga:localhost": 5 }
    c.deviceManifests = { [aparelho.address]: 7 }
    c.aparelhosConhecidos = [toBase64(aparelho.deviceSigningPublicKey)]
    c.profile.displayName = "Ana"
  })
  return { raiz, aparelho, ficheiro: await origem.exportVault(), origem }
}

describe("importar o ficheiro da conta faz um aparelho novo", () => {
  it("chave nova, certificada pela conta; o que era do aparelho antigo sai; o histórico fica", async () => {
    const { raiz, aparelho, ficheiro } = await contaExportada()
    const pedidos: PedidoDePassagem[] = []
    const destino = new Vault(new Disco())
    await destino.importVault(ficheiro, FRASE, {
      passagem: async (pedido) => {
        pedidos.push({ ...pedido, chaveDaConta: pedido.chaveDaConta.slice(), chaveDoAparelhoAntigo: pedido.chaveDoAparelhoAntigo.slice() })
        return { versao: 8 }
      },
    })
    await destino.unlock(FRASE)
    const c = destino.contents

    // The handover got the OLD device to log in with, and the NEW public key to add.
    expect(pedidos).toHaveLength(1)
    const pedido = pedidos[0]!
    expect(pedido.address).toBe(aparelho.address)
    expect(toBase64(pedido.chaveDoAparelhoAntigo)).toBe(toBase64(aparelho.deviceSigningPrivateKey))
    expect(toBase64(pedido.chaveDaConta)).toBe(toBase64(raiz.signingPrivateKey))
    expect(pedido.posse).toBe(3)
    expect(pedido.versaoVista).toBe(7)

    // A new device key, and it is the one the handover adds.
    expect(c.deviceSigningPrivateKey).not.toBe(toBase64(aparelho.deviceSigningPrivateKey))
    const nova = identityFromPrivateKey(raiz.signingPrivateKey, parseServerName(CASA), fromBase64(c.deviceSigningPrivateKey))
    expect(toBase64(nova.deviceSigningPublicKey)).toBe(toBase64(pedido.chaveNova))
    expect(verifyDeviceChain(nova.credential)).toBe(true)
    expect(c.signingPrivateKey).toBe(toBase64(raiz.signingPrivateKey))

    // What was the old device's is gone: its leaves, keys, counters, anchors and possession.
    expect(c.groups).toEqual({})
    expect(c.pendingKeyPackages).toEqual([])
    expect(c.lastSeq).toEqual({})
    expect(c.sframeReservas).toBeUndefined()
    expect(c.posseDoAparelho).toBeUndefined()
    expect(c.assumirPosse).toBeUndefined()
    expect(c.pendingCommits).toBeUndefined()
    expect(c.aparelhosConhecidos).toBeUndefined()

    // What is the account's stays.
    expect(c.history["#sala:localhost"]?.[0]?.payload["body"]).toBe("olá do passado")
    expect(c.profile.displayName).toBe("Ana")
    expect(c.deviceManifests[aparelho.address]).toBe(7)

    // A seat to ask in each channel, soon; not the account channel, not one the account left.
    expect(Object.keys(c.lugaresPorPedir ?? {}).sort()).toEqual(["#sala:localhost"])
    const lugar = c.lugaresPorPedir?.["#sala:localhost"]
    expect(typeof lugar === "object" && lugar.tentativas).toBe(0)

    // The file was in hand: the account file counts as saved on this device (hotfix 1.3.26-2).
    expect(c.entrouPorFicheiro).toBe(true)
  })

  it("o ficheiro de origem não muda: o aparelho que exportou continua o mesmo", async () => {
    const { aparelho, ficheiro, origem } = await contaExportada()
    await new Vault(new Disco()).importVault(ficheiro, FRASE, { passagem: async () => ({ versao: 8 }) })
    expect(origem.contents.deviceSigningPrivateKey).toBe(toBase64(aparelho.deviceSigningPrivateKey))
    expect(origem.contents.groups["#sala:localhost"]).toBe("grupo-do-aparelho-antigo")
  })

  it("uma recusa na passagem (conta cheia) não toca no cofre deste aparelho", async () => {
    const { ficheiro } = await contaExportada()
    const disco = new Disco()
    disco.bytes = new TextEncoder().encode("conta-local-preciosa")
    await expect(
      new Vault(disco).importVault(ficheiro, FRASE, {
        passagem: async () => {
          throw new Error(ERRO_CONTA_CHEIA_NO_IMPORTAR)
        },
      }),
    ).rejects.toThrow(ERRO_CONTA_CHEIA_NO_IMPORTAR)
    expect(new TextDecoder().decode(disco.bytes!)).toBe("conta-local-preciosa")
    expect(disco.escritas).toBe(0)
  })

  it("a passagem corre antes da escrita", async () => {
    const { ficheiro } = await contaExportada()
    const disco = new Disco()
    let escritasNaPassagem = -1
    await new Vault(disco).importVault(ficheiro, FRASE, {
      passagem: async () => {
        escritasNaPassagem = disco.escritas
        return { versao: 8 }
      },
    })
    expect(escritasNaPassagem).toBe(0)
    expect(disco.escritas).toBe(1)
  })

  it("um ficheiro de um telemóvel sem a chave da conta não entra, e não toca em nada", async () => {
    const raiz = generateIdentity(parseServerName(CASA))
    const origem = new Vault(new Disco())
    await origem.create(FRASE)
    await origem.update((c) => {
      c.deviceSigningPrivateKey = toBase64(identityFromPrivateKey(raiz.signingPrivateKey, parseServerName(CASA)).deviceSigningPrivateKey)
      c.accountPublicKey = toBase64(raiz.signingPublicKey)
      c.deviceCert = "certificado"
      c.homeserver = CASA
    })
    const disco = new Disco()
    let chamou = false
    await expect(
      new Vault(disco).importVault(await origem.exportVault(), FRASE, {
        passagem: async () => {
          chamou = true
          return { versao: 1 }
        },
      }),
    ).rejects.toThrow(ERRO_FICHEIRO_SEM_CHAVE_DA_CONTA)
    expect(chamou).toBe(false)
    expect(disco.bytes).toBeNull()
  })

  it("um cofre sem identidade nenhuma entra como está, sem passagem", async () => {
    const origem = new Vault(new Disco())
    await origem.create(FRASE)
    await origem.update((c) => {
      c.profile.displayName = "Ninguém ainda"
    })
    let chamou = false
    const destino = new Vault(new Disco())
    await destino.importVault(await origem.exportVault(), FRASE, {
      passagem: async () => {
        chamou = true
        return { versao: 1 }
      },
    })
    await destino.unlock(FRASE)
    expect(chamou).toBe(false)
    expect(destino.contents.profile.displayName).toBe("Ninguém ainda")
  })
})
