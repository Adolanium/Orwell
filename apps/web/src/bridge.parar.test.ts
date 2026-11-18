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
