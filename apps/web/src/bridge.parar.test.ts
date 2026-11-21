import { describe, expect, it, vi } from "vitest"

/**
 * A tab that stopped being the owner, or became stale, stops writing.
 *
 * The order is what we lock here: disconnect (which saves the pending batch)
 * BEFORE sealing the vault, and only resolve after the last write finishes.
 * That resolution is what allows `posse-do-separador.ts` to release the latch.
 */

const registo: string[] = []
let terminarEscrita: () => void = () => {}
/** What the fake backend answers to `retomarPosse`, and what the fake session answers to `retomarEscrita`. */
const retoma = { posse: true, escrita: true }

vi.mock("@enclave/client-core", async (original) => ({
  // The real module underneath: a new export of client-core that bridge.ts reads must not break every suite here.
  ...(await original<typeof import("@enclave/client-core")>()),
  Call: class {
    active = false
    on(): () => void {
      return () => {}
    }
    emit(): void {}
  },
  Session: class {
    on(): () => void {
      return () => {}
    }
    flush(): Promise<void> {
      registo.push("flush")
      return Promise.resolve()
    }
    disconnect(): void {
      registo.push("disconnect")
    }
    // The core half: stops writing, seals the media store and disconnects (like the real one).
    pararDeEscrever(): void {
      registo.push("selar-armazem")
      this.disconnect()
    }
    drenarArmazem(): Promise<void> {
      registo.push("drenar-armazem")
      return Promise.resolve()
    }
    connect(): Promise<void> {
      registo.push("connect")
      return Promise.resolve()
    }
    retomarEscrita(): boolean {
      registo.push("retomar-escrita")
      return retoma.escrita
    }
  },
  Vault: class {},
}))

vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
// The media store is born with the bridge; like the vault, without IndexedDB here.
vi.mock("./armazem-backend.js", () => ({ BrowserArmazemBackend: class {} }))
vi.mock("./vault-backend.js", () => ({
  BrowserVaultBackend: class {
    selar(): void {
      registo.push("selar")
    }
    retomarPosse(id: string): Promise<boolean> {
      registo.push(`retomar-posse:${id}`)
      return Promise.resolve(retoma.posse)
    }
    escritasAcabadas(): Promise<void> {
      registo.push("a-esperar-escritas")
      return new Promise<void>((resolve) => {
        terminarEscrita = () => {
          registo.push("escritas-acabadas")
          resolve()
        }
      })
    }
  },
}))

const { createBrowserBridge } = await import("./bridge.js")

describe("pararDeEscrever", () => {
  it("desliga, sela o cofre e o armazém, e só resolve quando a última escrita acaba", async () => {
    registo.length = 0
    const ponte = createBrowserBridge()
    let resolvido = false
    const parado = ponte.pararDeEscrever().then(() => {
      resolvido = true
    })
    await vi.waitFor(() => expect(registo).toContain("a-esperar-escritas"))
    // The second `disconnect` is the one from `Session.pararDeEscrever`: it has nothing left to write.
    expect(registo).toEqual(["disconnect", "drenar-armazem", "selar", "selar-armazem", "disconnect", "a-esperar-escritas"])
    expect(resolvido).toBe(false)
    terminarEscrita()
    await parado
    expect(resolvido).toBe(true)
  })

  it("depois de parado não volta a ligar, nem grava ao sair da página", async () => {
    registo.length = 0
    const ponte = createBrowserBridge()
    const parado = ponte.pararDeEscrever()
    await vi.waitFor(() => expect(registo).toContain("a-esperar-escritas"))
    terminarEscrita()
    await parado
    registo.length = 0

    await expect(ponte.session.connect()).rejects.toThrow("this tab no longer writes")
    window.dispatchEvent(new Event("pagehide"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(registo).not.toContain("connect")
    expect(registo).not.toContain("flush")
  })

  it("sem gravar (posse perdida): sela ANTES de desligar, para o lote do disconnect ser recusado", async () => {
    registo.length = 0
    const ponte = createBrowserBridge()
    const parado = ponte.pararDeEscrever({ gravar: false })
    await vi.waitFor(() => expect(registo).toContain("a-esperar-escritas"))
    // Without writing there is no wait for the store queue: the seal comes first, and the `disconnect` is the session's.
    expect(registo).toEqual(["selar", "selar-armazem", "disconnect", "a-esperar-escritas"])
    terminarEscrita()
    await parado
  })

  it("parar duas vezes desliga uma vez só", async () => {
    registo.length = 0
    const ponte = createBrowserBridge()
    const primeira = ponte.pararDeEscrever()
    await vi.waitFor(() => expect(registo).toContain("a-esperar-escritas"))
    terminarEscrita()
    await primeira
    const depoisDaPrimeira = [...registo]
    const segunda = ponte.pararDeEscrever()
    terminarEscrita()
    await segunda
    // The second one only waits for the disk: it does not disconnect, drain or seal again.
    expect(registo.slice(depoisDaPrimeira.length)).toEqual(["a-esperar-escritas", "escritas-acabadas"])
  })
})

describe("retomarEscrita (resumed from the back-forward cache)", () => {
  async function parada() {
    registo.length = 0
    const ponte = createBrowserBridge()
    const parado = ponte.pararDeEscrever()
    await vi.waitFor(() => expect(registo).toContain("a-esperar-escritas"))
    terminarEscrita()
    await parado
    registo.length = 0
    return ponte
  }

  it("still the owner: the vault and the session write again, and it connects", async () => {
    retoma.posse = true
    retoma.escrita = true
    const ponte = await parada()
    expect(await ponte.retomarEscrita("a")).toBe(true)
    expect(registo).toEqual(["retomar-posse:a", "retomar-escrita", "connect"])
    // No longer stopped: connecting is allowed again.
    await expect(ponte.session.connect()).resolves.toEqual({ ok: true })
  })

  it("someone else owned the vault meanwhile: stays stopped, and does not connect", async () => {
    retoma.posse = false
    retoma.escrita = true
    const ponte = await parada()
    expect(await ponte.retomarEscrita("a")).toBe(false)
    expect(registo).toEqual(["retomar-posse:a"])
    await expect(ponte.session.connect()).rejects.toThrow("this tab no longer writes")
  })

  it("the media store cannot resume: seals the vault again and stays stopped", async () => {
    retoma.posse = true
    retoma.escrita = false
    const ponte = await parada()
    expect(await ponte.retomarEscrita("a")).toBe(false)
    expect(registo).toEqual(["retomar-posse:a", "retomar-escrita", "selar"])
    await expect(ponte.session.connect()).rejects.toThrow("this tab no longer writes")
  })

  it("a bridge that never stopped has nothing to resume", async () => {
    registo.length = 0
    const ponte = createBrowserBridge()
    expect(await ponte.retomarEscrita("a")).toBe(true)
    expect(registo).toEqual([])
  })
})

describe("retomarEscrita overtaken by a new stop", () => {
  it("the page hides again while the record is read: stays stopped, sealed, and does not connect", async () => {
    retoma.posse = true
    retoma.escrita = true
    registo.length = 0
    const ponte = createBrowserBridge()
    const parado = ponte.pararDeEscrever()
    await vi.waitFor(() => expect(registo).toContain("a-esperar-escritas"))
    terminarEscrita()
    await parado
    registo.length = 0
    const retoma1 = ponte.retomarEscrita("a")
    // Hidden again before the record answers.
    const outra = ponte.pararDeEscrever()
    terminarEscrita()
    await outra
    expect(await retoma1).toBe(false)
    expect(registo).not.toContain("connect")
    expect(registo).not.toContain("retomar-escrita")
    await expect(ponte.session.connect()).rejects.toThrow("this tab no longer writes")
  })
})
