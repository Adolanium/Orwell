import { describe, expect, it, vi } from "vitest"

/**
 * `main.tsx` asks the bridge whether a call is open before releasing the
 * account on `pagehide` (see `pagina-escondida.ts`). The answer is the call
 * engine's channel, read at that instant.
 */

const chamada = { channel: null as string | null }

vi.mock("@enclave/client-core", () => ({
  Call: class {
    on(): () => void {
      return () => {}
    }
    emit(): void {}
    get channel(): string | null {
      return chamada.channel
    }
  },
  Session: class {
    on(): () => void {
      return () => {}
    }
  },
  Vault: class {},
}))

vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("./armazem-backend.js", () => ({ BrowserArmazemBackend: class {} }))
vi.mock("./vault-backend.js", () => ({ BrowserVaultBackend: class {} }))

const { createBrowserBridge } = await import("./bridge.js")

describe("a ponte sabe se há uma chamada aberta", () => {
  it("diz que sim enquanto o motor da chamada tem um canal, e que não depois", () => {
    const ponte = createBrowserBridge()
    expect(ponte.emChamada()).toBe(false)
    chamada.channel = "!geral:enclave.test"
    expect(ponte.emChamada()).toBe(true)
    chamada.channel = null
    expect(ponte.emChamada()).toBe(false)
  })
})
