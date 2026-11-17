// @vitest-environment node
import { describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { buildSync } from "esbuild"
import { Vault, type VaultBackend } from "@enclave/client-core"
import { seladorNoWorker } from "@enclave/client-core/selo-worker"
import { trabalhadorDoSelo } from "./selador.js"

/**
 * The vault sealed in a real worker thread, the way the desktop app runs it:
 * `selo-worker.ts` bundled as its own CommonJS entry (as `electron.vite.config.ts`
 * does), loaded by `trabalhadorDoSelo`. The proof is a round trip: what the
 * vault wrote through the thread opens with the passphrase.
 */
class Disco implements VaultBackend {
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

describe("o selo do cofre numa thread do processo principal", () => {
  it("o cofre selado pela thread abre com a frase, igual", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "orwell-selo-"))
    try {
      const saida = join(pasta, "selo.cjs")
      buildSync({
        entryPoints: [resolve(__dirname, "selo-worker.ts")],
        bundle: true,
        platform: "node",
        format: "cjs",
        outfile: saida,
        logLevel: "silent",
      })
      const disco = new Disco()
      let threads = 0
      const vault = new Vault(disco, undefined, seladorNoWorker(() => (threads++, trabalhadorDoSelo(saida))))
      await vault.create("frase-passe")
      await vault.update((c) => {
        c.deadWelcomes = ["um", "dois ✓"]
      })
      expect(threads).toBe(1)
      const outra = new Vault(disco)
      await outra.unlock("frase-passe")
      expect(outra.contents.deadWelcomes).toEqual(["um", "dois ✓"])
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  }, 30_000)
})
