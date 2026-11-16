import { describe, expect, it, vi } from "vitest"

/**
 * Exporting and importing the account with the images, on the desktop (Task 11b).
 *
 * The REAL `preload`: the checkbox reaches the main process as `{ incluirImagens:
 * true }`, and the account file is chosen in the main process (`vault:escolher-
 * ficheiro`): the renderer never sends a path, only the mark `{ escolhido:
 * true }`. The channel names must match `tratar(...)` in
 * `src/main/index.ts`.
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

describe("a conta com as imagens, pelo preload da secretária", () => {
  it("exportar leva a caixa ao principal só quando está marcada", async () => {
    const vault = createDesktopBridge().vault
    pedidos.length = 0
    await vault.export()
    await vault.export("frase", { incluirImagens: true })
    expect(pedidos).toEqual([
      { canal: "vault:export", argumentos: [undefined, undefined] },
      { canal: "vault:export", argumentos: ["frase", { incluirImagens: true }] },
    ])
  })

  it("escolher pede ao principal; importar manda a marca, nunca um caminho; um Blob vai em bytes; o texto como sempre", async () => {
    const vault = createDesktopBridge().vault
    const semDialogo = new Blob([new Uint8Array([1, 2, 3])])
    ;(semDialogo as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer ??= async () => new Uint8Array([1, 2, 3]).buffer
    pedidos.length = 0
    await vault.escolherFicheiroDeConta?.()
    await vault.import({ escolhido: true }, "f")
    await vault.import(semDialogo, "f")
    await vault.import("orwv2\n{}", "f")
    expect(pedidos).toEqual([
      { canal: "vault:escolher-ficheiro", argumentos: [] },
      { canal: "vault:import", argumentos: [{ escolhido: true }, "f"] },
      { canal: "vault:import", argumentos: [new Uint8Array([1, 2, 3]), "f"] },
      { canal: "vault:import", argumentos: ["orwv2\n{}", "f"] },
    ])
  })
})
