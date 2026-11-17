import { describe, expect, it } from "vitest"
import { Vault, type VaultBackend } from "./vault.js"
import { selarTexto, type SeloPorFazer, type SeloEmCurso } from "./seloDoCofre.js"

/**
 * The seal of a batched write runs off the page thread.
 *
 * Each write is the whole vault: JSON, XChaCha20-Poly1305 and base64. On a slow
 * laptop with a heavy account's vault that was 95 ms at full speed, every second
 * while messages arrive. The JSON snapshot is still taken at once, on the
 * thread (the snapshot is the guarantee); the cipher and the base64 go to a
 * `SeladorDoCofre` (a Worker in the web app).
 *
 * The vault rules stay, and these tests hold them:
 *   - what reaches the disk opens, with the same contents (round trip);
 *   - a synchronous write (`pagehide`, a tab handoff) does not wait for the
 *     seal in flight, and the older write never lands on top of the newer;
 *   - a vault destroyed while a seal was in flight stays destroyed;
 *   - `lock` in the middle does not spoil the seal: it took its own key copy.
 */
class Disco implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  escritas = 0
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.escritas++
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

/** A sealer that holds each job until the test lets it go. */
function seladorPreso(): {
  selador: (p: SeloPorFazer, key: Uint8Array, nonce: Uint8Array) => Promise<SeloEmCurso>
  pedidos: number
  soltar: () => Promise<void>
} {
  const fila: (() => void)[] = []
  const estado = {
    pedidos: 0,
    selador: (p: SeloPorFazer, key: Uint8Array, nonce: Uint8Array) =>
      new Promise<SeloEmCurso>((resolver) => {
        estado.pedidos++
        // The vault must hand over a copy: zero it at the source and this still has it.
        const copia = key.slice()
        fila.push(() => resolver(selarTexto(p, copia, nonce)))
      }),
    soltar: async () => {
      while (fila.length) fila.shift()?.()
      for (let i = 0; i < 10; i++) await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
    },
  }
  return estado
}

async function relido(disco: Disco): Promise<string[] | null> {
  if (!disco.bytes) return null
  const outro = new Vault(disco)
  await outro.unlock("frase-passe")
  return outro.contents.deadWelcomes
}

async function cofre(): Promise<{ vault: Vault; disco: Disco; selo: ReturnType<typeof seladorPreso> }> {
  const disco = new Disco()
  const selo = seladorPreso()
  const vault = new Vault(disco, undefined, selo.selador)
  await vault.create("frase-passe")
  disco.escritas = 0
  return { vault, disco, selo }
}

describe("o selo do cofre fora da thread", () => {
  it("uma gravação em lote passa pelo selador, e o que chega ao disco abre igual", async () => {
    const { vault, disco, selo } = await cofre()
    const gravada = vault.update((c) => {
      c.deadWelcomes = ["a", "b"]
    })
    await Promise.resolve()
    expect(selo.pedidos).toBe(1)
    expect(disco.escritas).toBe(0)
    await selo.soltar()
    await gravada
    expect(disco.escritas).toBe(1)
    expect(await relido(disco)).toEqual(["a", "b"])
  })

  it("sem fundo (pagehide), grava já e não espera pelo selo em voo; o mais velho nunca escreve por cima", async () => {
    const { vault, disco, selo } = await cofre()
    const velha = vault.update((c) => {
      c.deadWelcomes = ["velha"]
    })
    await Promise.resolve()
    expect(selo.pedidos).toBe(1)
    vault.semFundo = true
    const nova = vault.update((c) => {
      c.deadWelcomes = ["velha", "nova"]
    })
    // Synchronous to the disk: the write started in this same task, before anything was awaited.
    expect(disco.escritas).toBe(1)
    await nova
    expect(await relido(disco)).toEqual(["velha", "nova"])
    // The old seal comes back late: it must not land.
    await selo.soltar()
    await velha
    expect(disco.escritas).toBe(1)
    expect(await relido(disco)).toEqual(["velha", "nova"])
  })

  it("um cofre destruído com um selo em voo fica destruído", async () => {
    const { vault, disco, selo } = await cofre()
    const gravada = vault.update((c) => {
      c.deadWelcomes = ["x"]
    })
    await Promise.resolve()
    await vault.destroy()
    expect(disco.bytes).toBeNull()
    await selo.soltar()
    await gravada.catch(() => {})
    expect(disco.bytes).toBeNull()
  })

  it("trancar a meio não estraga o selo: a mudança chega ao disco e abre", async () => {
    const { vault, disco, selo } = await cofre()
    const gravada = vault.update((c) => {
      c.deadWelcomes = ["antes de trancar"]
    })
    await Promise.resolve()
    vault.lock()
    await selo.soltar()
    await gravada
    expect(await relido(disco)).toEqual(["antes de trancar"])
  })

  it("trancar com um selo em voo grava já, síncrono, e o selo velho não chega ao disco", async () => {
    // The desktop backend reads the account folder at the call: a seal that came back after a
    // lock and an account switch would land in the other account. Lock writes now and overtakes it.
    const { vault, disco, selo } = await cofre()
    const gravada = vault.update((c) => {
      c.deadWelcomes = ["da conta que tranca"]
    })
    await Promise.resolve()
    vault.lock()
    expect(disco.escritas).toBe(1)
    disco.bytes = null // the account switched: whatever lands now lands in the wrong place
    await selo.soltar()
    await gravada
    expect(disco.escritas).toBe(1)
    expect(disco.bytes).toBeNull()
  })

  it("trancar com uma escrita em espera grava-a já, síncrona, e não a manda ao selador", async () => {
    /*
      The write in flight is already on the disk (a slow disk), and another waits
      behind it. `lock` takes the waiting one's snapshot while the key is still
      here; sent to the sealer, it would reach the disk after the lock, and on the
      desktop after an account switch, in the other account's folder.
    */
    const { vault, disco, selo } = await cofre()
    let soltarDisco!: () => void
    const portao = new Promise<void>((r) => (soltarDisco = r))
    const escrever = disco.write.bind(disco)
    disco.write = async (bytes) => {
      const esta = disco.escritas + 1
      await escrever(bytes)
      if (esta === 1) await portao
    }
    vault.semFundo = true
    const primeira = vault.update((c) => {
      c.deadWelcomes = ["primeira"]
    })
    vault.semFundo = false
    const segunda = vault.update((c) => {
      c.deadWelcomes = ["primeira", "segunda"]
    })
    vault.lock()
    expect(selo.pedidos).toBe(0)
    expect(disco.escritas).toBe(2)
    soltarDisco()
    await primeira
    await segunda
    expect(await relido(disco)).toEqual(["primeira", "segunda"])
  })

  it("sem selador, tudo como antes: síncrono até ao disco", async () => {
    const disco = new Disco()
    const vault = new Vault(disco)
    await vault.create("frase-passe")
    disco.escritas = 0
    const gravada = vault.update((c) => {
      c.deadWelcomes = ["z"]
    })
    expect(disco.escritas).toBe(1)
    await gravada
    expect(await relido(disco)).toEqual(["z"])
  })
})
