import { randomBytes } from "node:crypto"
import { Payload } from "@enclave/protocol"
import { describe, expect, it, vi } from "vitest"
import type { Miniaturista } from "./armazem/armazem.js"
import { ArmazemEmMemoria } from "./armazem/emMemoria.js"
import { Session } from "./session.js"
import { appendHistory, Vault, type StoredPayload, type VaultBackend } from "./vault.js"

/**
 * An image that got no thumbnail asks again on the next opening.
 *
 * Before 1.3.25 the desktop thumbnailer could not read GIF or WebP, and an
 * image above 200 KB stayed with no `mini`. `pedirMiniatura` leaves such an
 * image as it was, and every opening (`restore`) queues each image reference
 * still without `mini`, once, and works them one at a time. So the images sent
 * before the fix get their thumbnail on the first opening after it, with no
 * migration. This test pins that: if the retry ever moves behind a mark, the
 * old images lose their thumbnail for good.
 */
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

const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

/** A PNG header with these sides, then noise: 300 KB, above the 200 KB that would make it its own thumbnail. */
function pngGrande(): Uint8Array {
  const bytes = Uint8Array.from(randomBytes(300_000))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(1600), ...be32(1200), 8, 6, 0, 0, 0], 0)
  return bytes
}

function mensagemComImagem(): StoredPayload {
  const inline = `data:image/png;base64,${Buffer.from(pngGrande()).toString("base64")}`
  return Payload.parse({
    t: "post",
    id: "p-imagem-antiga-001",
    postedAt: 1,
    caption: "antiga",
    media: [{ name: "foto.png", mediaType: "image/png", byteLength: inline.length, kind: "image", inline }],
    links: [],
    tags: [],
  }) as StoredPayload
}

const MINI = { bytes: new Uint8Array([0xff, 0xd8, 1, 2]), tipo: "image/jpeg", w: 320, h: 240 }

async function abrir(cofre: MemoryBackend, armazem: ArmazemEmMemoria, miniaturista: Miniaturista, criar: boolean) {
  const vault = new Vault(cofre)
  if (criar) await vault.create("frase-passe-longa")
  else await vault.unlock("frase-passe-longa")
  const session = new Session(vault, { armazem, miniaturista })
  return { vault, session }
}

const semMini = (vault: Vault): string[] =>
  Object.entries(vault.contents.media ?? {})
    .filter(([, ref]) => ref.t.startsWith("image/") && ref.mini === undefined)
    .map(([sha]) => sha)

describe("miniaturas em falta: cada abertura pede outra vez", () => {
  it("uma imagem de 300 KB que ficou sem miniatura ganha-a na abertura seguinte", async () => {
    const cofre = new MemoryBackend()
    const armazem = new ArmazemEmMemoria()

    // First opening: the thumbnailer cannot read the format (the old desktop with WebP or GIF).
    const cego = { fazer: vi.fn(async () => null) }
    const primeira = await abrir(cofre, armazem, cego, true)
    // An entry from before the store, marked to migrate: the opening moves its image to the store.
    await primeira.vault.update((c) => {
      appendHistory(c, "!feed:s", { seq: 1, sender: "@ana:s", at: 1, payload: mensagemComImagem() })
      c.armazem = { ...c.armazem, porMigrar: true }
    })
    await primeira.session.restore()
    await vi.waitFor(() => expect(cego.fazer).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(semMini(primeira.vault)).toHaveLength(1))
    const [sha] = semMini(primeira.vault)
    await primeira.session.drenarArmazem()
    await primeira.vault.update(() => {})
    primeira.vault.lock()

    // Next opening, with a thumbnailer that reads it: the thumbnail comes, with no new message.
    const capaz = { fazer: vi.fn(async () => MINI) }
    const segunda = await abrir(cofre, armazem, capaz, false)
    await segunda.session.restore()
    await vi.waitFor(() => expect(capaz.fazer).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(segunda.vault.contents.media?.[sha!]?.mini).toBeDefined())
    expect(semMini(segunda.vault)).toEqual([])
  }, 60_000)
})
