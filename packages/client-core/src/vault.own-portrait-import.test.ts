import { randomBytes } from "node:crypto"
import { Payload, toBase64 } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { ArmazemDeMedia } from "./armazem/armazem.js"
import { TECTO_DO_FICHEIRO_SIMPLES, fonteDeBlob, fonteDeBytes, type FonteDeBytes } from "./armazem/contentor.js"
import { ArmazemEmMemoria } from "./armazem/emMemoria.js"
import { absorverRetrato, inflarRef } from "./armazem/referencias.js"
import { CABECALHO_DO_COFRE, semCabecalho } from "./cabecalhoDoCofre.js"
import { upsertSpaceMeta, newVaultContents, recoverOwnPortrait, appendHistory, Vault, type RefDeMedia, type StoredPayload, type VaultBackend } from "./vault.js"

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

const FRASE = "frase-de-viagem"
const CANAL = "!feed:s"

const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
function png(largura: number, altura: number, tamanho = 2_000): Uint8Array {
  const bytes = Uint8Array.from(randomBytes(tamanho))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(largura), ...be32(altura), 8, 6, 0, 0, 0], 0)
  return bytes
}
const dataUrl = (bytes: Uint8Array): string => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`


describe("our own portrait on a device that came in by the account file", () => {
  it("comes in the file, without \"Include the images\"", async () => {
    const vault = new Vault(new MemoryBackend())
    await vault.create(FRASE)
    const armazem = new ArmazemDeMedia(new ArmazemEmMemoria(), null)
    vault.ligarArmazem(armazem)
    await vault.armazemPronto()
    const portrait = dataUrl(png(128, 128))
    let sha = ""
    await vault.update((c) => {
      sha = absorverRetrato(c, portrait, armazem)
      c.profile = { displayName: "Ana", donations: [], avatarRef: sha, updatedAt: 1000 }
    })
    await armazem.drenar()
    const file = await vault.exportVault()

    const imported = new Vault(new MemoryBackend())
    const empty = new ArmazemDeMedia(new ArmazemEmMemoria(), null)
    await imported.importVault(file, FRASE, { armazem: empty })
    await imported.unlock(FRASE)
    imported.ligarArmazem(empty)
    await imported.armazemPronto()
    expect(imported.contents.profile.avatarDataUrl).toBe(portrait)
    expect(imported.contents.armazem?.porMigrar).toBe(true)

    // The exporting vault keeps its reference.
    expect(JSON.stringify(vault.contents)).not.toContain(portrait)
  }, 30_000)
})

describe("a community's icon on a device that came in by the account file", () => {
  it("comes in the file, without \"Include the images\"", async () => {
    const vault = new Vault(new MemoryBackend())
    await vault.create(FRASE)
    const armazem = new ArmazemDeMedia(new ArmazemEmMemoria(), null)
    vault.ligarArmazem(armazem)
    await vault.armazemPronto()
    const portrait = dataUrl(png(128, 128))
    let sha = ""
    await vault.update((c) => {
      sha = absorverRetrato(c, portrait, armazem)
      upsertSpaceMeta(c, "!club:s", { t: "space.meta", name: "Club", icon: { name: "icon", mediaType: "image/png", ref: sha } }, 1000)
    })
    await armazem.drenar()
    const file = await vault.exportVault()

    const imported = new Vault(new MemoryBackend())
    const empty = new ArmazemDeMedia(new ArmazemEmMemoria(), null)
    await imported.importVault(file, FRASE, { armazem: empty })
    await imported.unlock(FRASE)
    imported.ligarArmazem(empty)
    await imported.armazemPronto()
    expect(JSON.stringify(imported.contents.spaceMeta["!club:s"])).toContain(portrait)
    expect(imported.contents.armazem?.porMigrar).toBe(true)

    // The exporting vault keeps its reference.
    expect(JSON.stringify(vault.contents)).not.toContain(portrait)
  }, 30_000)
})

describe("a device that already lost its portrait", () => {
  const copy = { displayName: "Ana", donations: [], avatarDataUrl: "data:image/png;base64,AA", updatedAt: 1000 }
  const lost = () => {
    const contents = newVaultContents()
    contents.profile = { displayName: "Ana", donations: [], avatarRef: "sha", updatedAt: 1000 }
    return contents
  }

  it("takes it from the same version, and only then", () => {
    const healed = lost()
    expect(recoverOwnPortrait(healed, copy, () => false)).toBe(true)
    expect(healed.profile.avatarDataUrl).toBe(copy.avatarDataUrl)
    expect(recoverOwnPortrait(lost(), copy, () => true)).toBe(false)
    expect(recoverOwnPortrait(lost(), { ...copy, updatedAt: 999 }, () => false)).toBe(false)
  })
})
