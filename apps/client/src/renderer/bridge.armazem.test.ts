import { describe, expect, it, vi } from "vitest"

/**
 * The media store reaches the interface through both bridges, with the same keys.
 *
 * `bridge.paridade.test.ts` already compares the whole bridges; this file names
 * what Task 9 adds (`media.*` and `on.media`), and pins the desktop half the
 * parity test does not see: the REAL `preload` asks for each thing on the right
 * channel, and the event arrives from `event:media`. The channel names must
 * match `tratar(...)` in `src/main/index.ts`.
 */

const pedidos: { canal: string; argumentos: unknown[] }[] = []
const ouvintes = new Map<string, (evento: unknown, payload: unknown) => void>()

vi.mock("@enclave/client-core", () => ({
  Call: class {
    readonly audio = { ligarPreferencias: () => () => {} }
    on(): () => void {
      return () => {}
    }
    emit(): void {}
  },
  Session: class {
    on(): () => void {
      return () => {}
    }
  },
  Vault: class {},
}))
vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("@enclave/ui", () => ({ registerSystemNoticeHost: () => {} }))
vi.mock("mediasoup-client", () => ({ Device: class {} }))
vi.mock("../../../web/src/vault-backend.js", () => ({ BrowserVaultBackend: class {} }))
vi.mock("../../../web/src/armazem-backend.js", () => ({ BrowserArmazemBackend: class {} }))

let anfitriaoDoPreload: Record<string, unknown> = {}
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_nome: string, valor: Record<string, unknown>) => {
      anfitriaoDoPreload = valor
    },
  },
  ipcRenderer: {
    invoke: async (canal: string, ...argumentos: unknown[]) => {
      pedidos.push({ canal, argumentos })
      if (canal === "media:bytes") return new Uint8Array([1, 2, 3])
      if (canal === "media:trazer") return { ok: false, motivo: "sem-ligacao" }
      return undefined
    },
    sendSync: () => ({ ok: true, valor: [] }),
    on: (canal: string, ouvinte: (evento: unknown, payload: unknown) => void) => {
      ouvintes.set(canal, ouvinte)
    },
    removeListener: () => {},
  },
}))

await import("../preload/index.js")
Object.defineProperty(window, "enclaveHost", { value: anfitriaoDoPreload, writable: true })

const { createDesktopBridge } = await import("./bridge.js")
const { createBrowserBridge } = await import("../../../web/src/bridge.js")

const CHAVES_DO_MEDIA = ["bytes", "definirTecto", "estado", "fixar", "libertar", "soltar", "trazer"]

describe("o armazém de media nas duas pontes", () => {
  it("as duas expõem as mesmas chaves em `media`, e as duas têm `on.media`", () => {
    const browser = createBrowserBridge()
    const secretaria = createDesktopBridge()
    expect(Object.keys(browser.media ?? {}).sort(), "apps/web/src/bridge.ts").toEqual(CHAVES_DO_MEDIA)
    expect(Object.keys(secretaria.media ?? {}).sort(), "apps/client: preload e renderer").toEqual(CHAVES_DO_MEDIA)
    expect(typeof browser.on.media).toBe("function")
    expect(typeof secretaria.on.media).toBe("function")
  })

  it("a secretária pede cada coisa pelo seu canal, e os bytes chegam como Uint8Array", async () => {
    const media = createDesktopBridge().media
    pedidos.length = 0
    expect(await media?.bytes("abc")).toEqual(new Uint8Array([1, 2, 3]))
    await media?.fixar("abc")
    await media?.soltar("abc")
    await media?.estado()
    await media?.definirTecto(250_000_000)
    await media?.libertar()
    expect(await media?.trazer({ channel: "c", alvo: "m", indice: 2 })).toEqual({ ok: false, motivo: "sem-ligacao" })
    await media?.trazer({ a: "@ana:servidor" })
    await media?.trazer({ sha: "abc" })
    expect(pedidos).toEqual([
      { canal: "media:bytes", argumentos: ["abc"] },
      { canal: "media:fixar", argumentos: ["abc"] },
      { canal: "media:soltar", argumentos: ["abc"] },
      { canal: "media:estado", argumentos: [] },
      { canal: "media:tecto", argumentos: [250_000_000] },
      { canal: "media:libertar", argumentos: [] },
      { canal: "media:trazer", argumentos: [{ channel: "c", alvo: "m", indice: 2 }] },
      { canal: "media:trazer", argumentos: [{ a: "@ana:servidor" }] },
      { canal: "media:trazer", argumentos: [{ sha: "abc" }] },
    ])
  })

  it("o evento `media` chega de `event:media`", () => {
    const recebidos: unknown[] = []
    createDesktopBridge().on.media?.((evento) => recebidos.push(evento))
    ouvintes.get("event:media")?.({}, { sha: "abc", estado: "guardado" })
    expect(recebidos).toEqual([{ sha: "abc", estado: "guardado" }])
  })
})
