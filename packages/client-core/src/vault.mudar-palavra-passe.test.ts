import { describe, expect, it } from "vitest"
import { Vault, type MemoriaDaSessao, type VaultBackend } from "./vault.js"

/**
 * "Change password" in Settings (1.3.26). What these hold: the current password
 * is proven first; the new one opens the vault and the old one no longer does;
 * a write that fails halfway leaves the vault on disk with the OLD password and
 * the open vault still working; an account file saved before keeps opening with
 * the password of its day; and a remembered session follows the new key.
 */

class Disco implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  falhar = false
  memoria?: MemoriaDaSessao
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    if (this.falhar) throw new Error("vault storage is full")
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

class Memoria implements MemoriaDaSessao {
  readonly via = "webcrypto" as const
  chave: Uint8Array | null = null
  async disponivel(): Promise<boolean> {
    return true
  }
  async existe(): Promise<boolean> {
    return this.chave !== null
  }
  async guardar(chave: Uint8Array): Promise<void> {
    this.chave = chave.slice()
  }
  async ler(): Promise<Uint8Array | null> {
    return this.chave
  }
  async apagar(): Promise<void> {
    this.chave = null
  }
}

async function cofreAberto(frase = "antiga-123") {
  const disco = new Disco()
  const vault = new Vault(disco)
  await vault.create(frase)
  await vault.update((c) => {
    c.profile.displayName = "Ana"
  })
  return { disco, vault }
}

describe("mudar a palavra-passe", () => {
  it("a nova abre o cofre, a antiga deixa de abrir, e o conteúdo fica", async () => {
    const { disco, vault } = await cofreAberto()
    await vault.mudarPalavraPasse("antiga-123", "nova-456789")
    expect(vault.unlocked).toBe(true)
    expect(vault.contents.profile.displayName).toBe("Ana")

    await expect(new Vault(disco).unlock("antiga-123")).rejects.toThrow("wrong passphrase, or the vault is damaged")
    const outra = new Vault(disco)
    await outra.unlock("nova-456789")
    expect(outra.contents.profile.displayName).toBe("Ana")
    // And later writes keep the new one.
    await vault.update((c) => {
      c.profile.displayName = "Ana Maria"
    })
    const depois = new Vault(disco)
    await depois.unlock("nova-456789")
    expect(depois.contents.profile.displayName).toBe("Ana Maria")
  })

  it("a palavra-passe actual errada recusa e não muda nada", async () => {
    const { disco, vault } = await cofreAberto()
    const antes = disco.bytes
    await expect(vault.mudarPalavraPasse("errada", "nova-456789")).rejects.toThrow("the current passphrase is not right")
    expect(disco.bytes).toBe(antes)
    await new Vault(disco).unlock("antiga-123")
  })

  it("uma escrita que falha a meio deixa a conta com a palavra-passe antiga, e o cofre aberto a funcionar", async () => {
    const { disco, vault } = await cofreAberto()
    disco.falhar = true
    await expect(vault.mudarPalavraPasse("antiga-123", "nova-456789")).rejects.toThrow("vault storage is full")
    disco.falhar = false
    // The disk still opens with the old one, never the new one.
    await new Vault(disco).unlock("antiga-123")
    await expect(new Vault(disco).unlock("nova-456789")).rejects.toThrow("wrong passphrase, or the vault is damaged")
    // The open vault is on the old key: its next write is still readable with the old password.
    await vault.update((c) => {
      c.profile.displayName = "Ana depois da falha"
    })
    const lido = new Vault(disco)
    await lido.unlock("antiga-123")
    expect(lido.contents.profile.displayName).toBe("Ana depois da falha")
  })

  it("um ficheiro de conta guardado antes continua a abrir com a palavra-passe antiga", async () => {
    const { vault } = await cofreAberto()
    const ficheiro = await vault.exportVault()
    await vault.mudarPalavraPasse("antiga-123", "nova-456789")
    const noutro = new Vault(new Disco())
    await expect(noutro.importVault(ficheiro, "nova-456789")).rejects.toThrow("wrong passphrase, or the vault is damaged")
    await noutro.importVault(ficheiro, "antiga-123")
    await noutro.unlock("antiga-123")
    expect(noutro.contents.profile.displayName).toBe("Ana")
    // And a file saved now opens with the new one.
    const novo = await vault.exportVault()
    const outro = new Vault(new Disco())
    await outro.importVault(novo, "nova-456789")
  })

  it("a sessão lembrada passa a ter a chave nova", async () => {
    const { disco, vault } = await cofreAberto()
    const memoria = new Memoria()
    disco.memoria = memoria
    await vault.memorizar()
    await vault.mudarPalavraPasse("antiga-123", "nova-456789")
    const aberto = new Vault(disco)
    expect(await aberto.abrirMemorizada()).toBe(true)
    expect(aberto.contents.profile.displayName).toBe("Ana")
  })

  it("um cofre trancado ou sem palavra-passe não muda", async () => {
    const { vault } = await cofreAberto()
    vault.lock()
    await expect(vault.mudarPalavraPasse("antiga-123", "nova-456789")).rejects.toThrow("vault is locked")
  })
})
