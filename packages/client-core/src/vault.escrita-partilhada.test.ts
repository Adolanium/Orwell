import { describe, expect, it } from "vitest"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Whole-vault writes never overlap, and callers that arrive during one share
 * the next (hotfix 1.3.10).
 *
 * Each write is the entire vault: JSON, the cipher, base64 and a copy for the
 * disk. Several in flight at once hold several copies of the vault in memory,
 * and a phone browser kills the page for that. A caller that arrives while a
 * write is running cannot ride it (its change came after the snapshot), but it
 * can ride the next one, which has not started yet and so includes it.
 */

class DiscoLento implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  escritas = 0
  emCurso = 0
  maximoEmCurso = 0
  /** How many of the next writes fail. */
  falhas = 0
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.escritas++
    const falha = this.falhas > 0
    if (falha) this.falhas--
    this.emCurso++
    this.maximoEmCurso = Math.max(this.maximoEmCurso, this.emCurso)
    try {
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (falha) throw new Error("disk full")
      this.bytes = bytes
    } finally {
      this.emCurso--
    }
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

async function cofre(): Promise<{ vault: Vault; disco: DiscoLento }> {
  const disco = new DiscoLento()
  const vault = new Vault(disco)
  await vault.create("frase-passe")
  disco.escritas = 0
  disco.maximoEmCurso = 0
  return { vault, disco }
}

async function relido(disco: DiscoLento): Promise<string[]> {
  const outro = new Vault(disco)
  await outro.unlock("frase-passe")
  return outro.contents.deadWelcomes
}

describe("a escrita do cofre inteiro", () => {
  it("vinte updates ao mesmo tempo dão duas escritas, uma de cada vez, e o disco fica com todas", async () => {
    const { vault, disco } = await cofre()
    await Promise.all(
      Array.from({ length: 20 }, (_, indice) =>
        vault.update((contents) => {
          contents.deadWelcomes = [...contents.deadWelcomes, `m${indice}`]
        }),
      ),
    )
    expect(disco.maximoEmCurso).toBe(1)
    expect(disco.escritas).toBeLessThanOrEqual(2)
    expect((await relido(disco)).sort()).toEqual(Array.from({ length: 20 }, (_, indice) => `m${indice}`).sort())
  })

  it("quem chega durante uma escrita só fica resolvido quando a sua mudança está no disco", async () => {
    const { vault, disco } = await cofre()
    const primeira = vault.update((contents) => {
      contents.deadWelcomes = ["a"]
    })
    // The first write is now in flight with "a" only.
    await new Promise((resolve) => setTimeout(resolve, 1))
    await vault.update((contents) => {
      contents.deadWelcomes = [...contents.deadWelcomes, "b"]
    })
    expect(await relido(disco)).toEqual(["a", "b"])
    await primeira
    expect(disco.maximoEmCurso).toBe(1)
  })

  it("uma escrita que falha rejeita quem a esperava, e a seguinte ainda sai", async () => {
    const { vault, disco } = await cofre()
    disco.falhas = 1
    const falhada = vault.update((contents) => {
      contents.deadWelcomes = ["a"]
    })
    await new Promise((resolve) => setTimeout(resolve, 1))
    const seguinte = vault.update((contents) => {
      contents.deadWelcomes = [...contents.deadWelcomes, "b"]
    })
    await expect(falhada).rejects.toThrow("disk full")
    await seguinte
    expect(await relido(disco)).toEqual(["a", "b"])
  })
})

describe("fechar o cofre com uma escrita à espera", () => {
  it("a mudança que esperava chega ao disco, e quem a esperava fica resolvido", async () => {
    const { vault, disco } = await cofre()
    const primeira = vault.update((contents) => {
      contents.deadWelcomes = ["a"]
    })
    await new Promise((resolve) => setTimeout(resolve, 1))
    const segunda = vault.update((contents) => {
      contents.deadWelcomes = [...contents.deadWelcomes, "b"]
    })
    vault.lock()
    await primeira
    await segunda
    expect(await relido(disco)).toEqual(["a", "b"])
  })
})
