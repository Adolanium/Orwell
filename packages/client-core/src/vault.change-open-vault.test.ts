import { describe, expect, it } from "vitest"
import { ERRO_APARELHO_ATRASADO } from "./palavraPasseDaConta.js"
import { Vault, type PalavraPasseDaConta, type VaultBackend } from "./vault.js"

/**
 * S4 and S1 of the review of 21/11/2026, in the vault:
 *
 * - "I forgot the current password": an open vault changes its password
 *   without the current one, in one write, with the next version;
 * - a device that saw a newer record than the one that seals it (it did not
 *   adopt it: the write failed) refuses any password change with Erro 142,
 *   until it adopts.
 */

class Disk implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  fail = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    if (this.fail) throw new Error("vault storage is full")
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

async function recordOf(password: string, version: number): Promise<PalavraPasseDaConta> {
  const vault = new Vault(new Disk())
  await vault.create(password)
  return { ...vault.palavraPasseDaConta()!, versao: version }
}

async function opensWith(disk: Disk, password: string): Promise<boolean> {
  return new Vault(disk).unlock(password).then(
    () => true,
    () => false,
  )
}

describe("a change with the open vault (S4)", () => {
  it("needs no current password; the new one opens, the old one no longer does, and the version goes up", async () => {
    const disk = new Disk()
    const vault = new Vault(disk)
    await vault.create("forgotten-password")
    await vault.changePasswordWithOpenVault("brand-new-password", { versao: (current) => current + 1 })
    expect(vault.palavraPasseDaConta()?.versao).toBe(1)
    expect(await opensWith(disk, "brand-new-password")).toBe(true)
    expect(await opensWith(disk, "forgotten-password")).toBe(false)
  })

  it("a locked vault refuses", async () => {
    const vault = new Vault(new Disk())
    await vault.create("forgotten-password")
    vault.lock()
    await expect(vault.changePasswordWithOpenVault("brand-new-password")).rejects.toThrow("vault is locked")
  })
})

describe("a device that is behind refuses to change the password (S1)", () => {
  it("a newer record that failed to adopt blocks both changes with Erro 142; after it adopts, the change goes", async () => {
    const r3 = await recordOf("account-password-v3", 3)
    const disk = new Disk()
    const vault = new Vault(disk)
    await vault.create("device-password")
    disk.fail = true
    await expect(vault.adoptarPalavraPasseDaConta(r3)).rejects.toThrow("vault storage is full")
    disk.fail = false
    expect(vault.palavraPasseDaConta()?.versao).toBe(0)

    await expect(vault.mudarPalavraPasse("device-password", "another-1", { versao: (c) => c + 1 })).rejects.toThrow(ERRO_APARELHO_ATRASADO)
    await expect(vault.changePasswordWithOpenVault("another-2", { versao: (c) => c + 1 })).rejects.toThrow(ERRO_APARELHO_ATRASADO)
    expect(await opensWith(disk, "device-password")).toBe(true)

    // The record comes again (the next connection of the sibling): adopted, no longer behind.
    expect(await vault.adoptarPalavraPasseDaConta(r3)).toBe(true)
    await vault.mudarPalavraPasse("account-password-v3", "account-password-v4", { versao: (c) => c + 1 })
    expect(vault.palavraPasseDaConta()?.versao).toBe(4)
  })

  it("an older record seen does not block", async () => {
    const r1 = await recordOf("old-account-password", 1)
    const vault = new Vault(new Disk())
    await vault.create("device-password")
    await vault.mudarPalavraPasse("device-password", "v1-password", { versao: 1 })
    await vault.mudarPalavraPasse("v1-password", "v2-password", { versao: 2 })
    expect(await vault.adoptarPalavraPasseDaConta(r1, { onlyIf: (current) => (current?.versao ?? 0) < r1.versao })).toBe(false)
    await vault.mudarPalavraPasse("v2-password", "v3-password", { versao: (c) => c + 1 })
    expect(vault.palavraPasseDaConta()?.versao).toBe(3)
  })
})
