import { afterEach, describe, expect, it, vi } from "vitest"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Deferred vault save (slow-on-entry, 4/11/2026).
 *
 * The session saved the whole vault once per live event: ~115 saves per entry
 * in `!984`, each one O(vault size) on the page thread. `updateEmBreve` batches
 * changes from a window into a single save. What these cases enforce is that
 * batching loses nothing and leaves no one waiting.
 */

class Disco implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = true
  escritas = 0
  recusar = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    if (this.recusar) throw new Error("vault storage is full")
    this.escritas++
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
  async wrapKey(chave: Uint8Array): Promise<Uint8Array> {
    return chave
  }
  async unwrapKey(chave: Uint8Array): Promise<Uint8Array> {
    return chave
  }
}

/** The `lastSeq` that is ON DISK, opening the file with another vault. */
async function ancoraNoDisco(disco: Disco, canal: string): Promise<number | undefined> {
  const outro = new Vault(disco)
  await outro.unlock()
  return outro.contents.lastSeq[canal]
}

afterEach(() => {
  vi.useRealTimers()
})

describe("a gravação adiada do cofre", () => {
  it("cem mudanças numa janela saem numa gravação, com a última no disco", async () => {
    const disco = new Disco()
    const cofre = new Vault(disco)
    await cofre.create(null)
    const antes = disco.escritas
    vi.useFakeTimers()
    const esperas: Promise<void>[] = []
    for (let seq = 0; seq < 100; seq++) esperas.push(cofre.updateEmBreve((c) => void (c.lastSeq["!c"] = seq)))
    // Already in memory; not yet on disk.
    expect(cofre.contents.lastSeq["!c"]).toBe(99)
    expect(disco.escritas).toBe(antes)
    await vi.advanceTimersByTimeAsync(Vault.JANELA_DA_GRAVACAO_MS)
    await Promise.all(esperas)
    vi.useRealTimers()
    expect(disco.escritas - antes).toBe(1)
    expect(await ancoraNoDisco(disco, "!c")).toBe(99)
  })

  it("um update a meio da janela leva o que estava adiado, e não grava duas vezes", async () => {
    const disco = new Disco()
    const cofre = new Vault(disco)
    await cofre.create(null)
    const antes = disco.escritas
    vi.useFakeTimers()
    const adiada = cofre.updateEmBreve((c) => void (c.lastSeq["!c"] = 7))
    await cofre.update((c) => void (c.lastSeq["!d"] = 1))
    await adiada
    expect(cofre.gravacaoAdiada).toBe(false)
    await vi.advanceTimersByTimeAsync(Vault.JANELA_DA_GRAVACAO_MS * 2)
    vi.useRealTimers()
    expect(disco.escritas - antes).toBe(1)
    expect(await ancoraNoDisco(disco, "!c")).toBe(7)
  })

  it("gravarAdiada grava já; sem nada adiado não grava", async () => {
    const disco = new Disco()
    const cofre = new Vault(disco)
    await cofre.create(null)
    const antes = disco.escritas
    await cofre.gravarAdiada()
    expect(disco.escritas).toBe(antes)
    void cofre.updateEmBreve((c) => void (c.lastSeq["!c"] = 3))
    await cofre.gravarAdiada()
    expect(disco.escritas - antes).toBe(1)
    expect(await ancoraNoDisco(disco, "!c")).toBe(3)
  })

  it("trancar com uma gravação adiada não deixa ninguém à espera nem grava sem chave", async () => {
    const disco = new Disco()
    const cofre = new Vault(disco)
    await cofre.create(null)
    const antes = disco.escritas
    const adiada = cofre.updateEmBreve((c) => void (c.lastSeq["!c"] = 3))
    cofre.lock()
    await expect(adiada).resolves.toBeUndefined()
    await new Promise((r) => setTimeout(r, Vault.JANELA_DA_GRAVACAO_MS + 50))
    expect(disco.escritas).toBe(antes)
  })

  it("uma gravação adiada que falha diz-se a quem esperava, e a seguinte leva a mudança", async () => {
    const disco = new Disco()
    const cofre = new Vault(disco)
    await cofre.create(null)
    disco.recusar = true
    const adiada = cofre.updateEmBreve((c) => void (c.lastSeq["!c"] = 5))
    await expect(cofre.gravarAdiada()).rejects.toThrow("vault storage is full")
    await expect(adiada).rejects.toThrow("vault storage is full")
    disco.recusar = false
    await cofre.update(() => {})
    expect(await ancoraNoDisco(disco, "!c")).toBe(5)
  })
})

/*
  Fluidity: the JSON of every batched write runs on the thread that
  draws. When it is slow (a big vault on a slow laptop), the window grows so the
  JSON never takes more than a twentieth of the time: 20 times the last JSON,
  between 1 s and 5 s. What it batches is only what the server gives back, so a
  wider window loses nothing on a crash (see `updateEmBreve`).
*/
describe("a janela da gravação adiada cresce quando o JSON do cofre é lento", () => {
  it("um JSON de ~100 ms dá uma janela de ~2 s; um rápido fica em 1 s", async () => {
    const disco = new Disco()
    const cofre = new Vault(disco)
    await cofre.create(null)
    // A slow field: its JSON takes ~100 ms, like a big vault on a slow laptop.
    const lento = {
      toJSON() {
        const fim = performance.now() + 100
        while (performance.now() < fim) {
          // busy
        }
        return 1
      },
    }
    ;(cofre.contents as unknown as Record<string, unknown>)["lento"] = lento
    await cofre.update(() => {})
    const antes = disco.escritas
    // Only the timers: the slow JSON measures itself with the real clock.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    void cofre.updateEmBreve((c) => void (c.lastSeq["!c"] = 1))
    await vi.advanceTimersByTimeAsync(Vault.JANELA_DA_GRAVACAO_MS)
    expect(disco.escritas).toBe(antes)
    // Up to the widest window: a loaded machine makes the ~100 ms JSON slower, and the window with it.
    await vi.advanceTimersByTimeAsync(Vault.JANELA_MAXIMA_DA_GRAVACAO_MS)
    expect(disco.escritas).toBe(antes + 1)
    vi.useRealTimers()

    // Fast again: back to 1 s.
    delete (cofre.contents as unknown as Record<string, unknown>)["lento"]
    await cofre.update(() => {})
    const depois = disco.escritas
    // Only the timers: the slow JSON measures itself with the real clock.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    void cofre.updateEmBreve((c) => void (c.lastSeq["!c"] = 2))
    await vi.advanceTimersByTimeAsync(Vault.JANELA_DA_GRAVACAO_MS)
    expect(disco.escritas).toBe(depois + 1)
  })
})


/*
  Return from a minimized window: the deferred write that fires on
  its timer first awaits `antesDaGravacaoAdiada` (the session exports its groups
  there, one at a time, yielding to the interface), and only then takes its
  snapshot. A write asked for at once never waits for it.
*/
describe("antes da gravação adiada", () => {
  it("o relógio espera pelo preparo antes de gravar; uma gravação já não espera", async () => {
    const disco = new Disco()
    const cofre = new Vault(disco)
    await cofre.create(null)
    let soltar!: () => void
    let preparos = 0
    cofre.antesDaGravacaoAdiada = () => {
      preparos++
      return new Promise<void>((r) => (soltar = r))
    }
    const antes = disco.escritas
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    void cofre.updateEmBreve((c) => void (c.lastSeq["!c"] = 1))
    await vi.advanceTimersByTimeAsync(Vault.JANELA_DA_GRAVACAO_MS)
    expect(preparos).toBe(1)
    expect(disco.escritas).toBe(antes)
    soltar()
    await vi.advanceTimersByTimeAsync(0)
    expect(disco.escritas).toBe(antes + 1)
    vi.useRealTimers()
    await cofre.update((c) => void (c.lastSeq["!c"] = 2))
    expect(preparos).toBe(1)
    expect(disco.escritas).toBe(antes + 2)
  })
})
