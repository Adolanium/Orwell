import { describe, expect, it } from "vitest"
import { Vault, type PalavraPasseDaConta, type VaultBackend } from "./vault.js"

/**
 * Every change of the vault key runs in one queue (S2, review of 21/11/2026).
 *
 * Records adopted back to back (v1, v2 and v3 after a recovery) were not
 * serialized. When the v1 write failed after v2 and v3 had already set the
 * key, the v1 rollback put the OLD key back, and the next write sealed the
 * vault with the old password. These hold the fix: each change derives and
 * writes in turn, the check of "does this record win" sees the record after
 * the changes before it, and only a change's own key is rolled back.
 */

class Disk implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  /** How many of the next writes fail. */
  failNext = 0
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    // A real disk answers later: the other changes run in the meantime.
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (this.failNext > 0) {
      this.failNext--
      throw new Error("vault storage is full")
    }
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

/** The account password record of `password`, as a sibling sends it, at `version`. */
async function recordOf(password: string, version: number): Promise<PalavraPasseDaConta> {
  const vault = new Vault(new Disk())
  await vault.create(password)
  const record = vault.palavraPasseDaConta()
  if (!record) throw new Error("no record")
  return { ...record, versao: version }
}

async function opensWith(disk: Disk, password: string): Promise<boolean> {
  const other = new Vault(disk)
  return other.unlock(password).then(
    () => true,
    () => false,
  )
}

describe("the vault key queue", () => {
  it("v1, v2 and v3 adopted at once, the v1 write fails: the vault ends on v3, never on the old key", async () => {
    const [r1, r2, r3] = await Promise.all([recordOf("password-one", 1), recordOf("password-two", 2), recordOf("password-three", 3)])
    const disk = new Disk()
    const vault = new Vault(disk)
    await vault.create("password-zero")
    disk.failNext = 1

    const results = await Promise.allSettled([
      vault.adoptarPalavraPasseDaConta(r1!),
      vault.adoptarPalavraPasseDaConta(r2!),
      vault.adoptarPalavraPasseDaConta(r3!),
    ])
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"])
    expect(vault.palavraPasseDaConta()).toMatchObject({ versao: 3, chave: r3!.chave, sal: r3!.sal })

    // The next write seals with v3 too.
    await vault.update((contents) => {
      contents.profile.displayName = "Ana"
    })
    expect(await opensWith(disk, "password-three")).toBe(true)
    expect(await opensWith(disk, "password-zero")).toBe(false)
  })

  it("`onlyIf` sees the record after the changes queued before it: an older record that arrives late is not adopted", async () => {
    const [r2, r1] = await Promise.all([recordOf("password-two", 2), recordOf("password-one", 1)])
    const vault = new Vault(new Disk())
    await vault.create("password-zero")
    const seen: (number | null)[] = []
    const onlyIf = (record: PalavraPasseDaConta) => (current: PalavraPasseDaConta | null) => {
      seen.push(current?.versao ?? null)
      return current === null || record.versao > current.versao
    }
    const [second, first] = await Promise.all([
      vault.adoptarPalavraPasseDaConta(r2!, { onlyIf: onlyIf(r2!) }),
      vault.adoptarPalavraPasseDaConta(r1!, { onlyIf: onlyIf(r1!) }),
    ])
    expect([second, first]).toEqual([true, false])
    expect(seen).toEqual([0, 2])
    expect(vault.palavraPasseDaConta()?.versao).toBe(2)
  })

  it("a change typed while a record comes in waits for it, and takes the version after it", async () => {
    const r4 = await recordOf("password-four", 4)
    const disk = new Disk()
    const vault = new Vault(disk)
    await vault.create("password-zero")
    const adopted = vault.adoptarPalavraPasseDaConta(r4)
    // Typed with the password this device had: the record came first, so it is no longer right.
    const change = vault.mudarPalavraPasse("password-zero", "password-five", { versao: (current) => current + 1 })
    await adopted
    await expect(change).rejects.toThrow("the current passphrase is not right")
    // Typed again with the account password now: the next version is 5.
    await vault.mudarPalavraPasse("password-four", "password-five", { versao: (current) => current + 1 })
    expect(vault.palavraPasseDaConta()?.versao).toBe(5)
    expect(await opensWith(disk, "password-five")).toBe(true)
  })

  it("a lock during a failed write leaves the vault locked: the rollback does not bring a key back", async () => {
    const r1 = await recordOf("password-one", 1)
    const disk = new Disk()
    const vault = new Vault(disk)
    await vault.create("password-zero")
    disk.failNext = 1
    const adopted = vault.adoptarPalavraPasseDaConta(r1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    vault.lock()
    await expect(adopted).rejects.toThrow()
    expect(vault.unlocked).toBe(false)
    expect(await opensWith(disk, "password-zero")).toBe(true)
  })
})
