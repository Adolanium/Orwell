import { describe, expect, it } from "vitest"
import { Vault, type VaultBackend } from "./vault.js"
import { seladorNoWorker, servirSelo, type EscopoDoSelo, type PedidoDeSelo, type RespostaDeSelo, type TrabalhadorDoSelo } from "./selo-worker.js"

/**
 * The page side and the Worker side of the vault seal, joined by a fake
 * message channel that clones like a real one (`structuredClone` with the
 * transfer list). The proof is a round trip: what the vault wrote through the
 * Worker opens with the passphrase.
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

function trabalhadorFalso(estado: { criados: number; morre?: boolean }): TrabalhadorDoSelo {
  estado.criados++
  const pagina: TrabalhadorDoSelo = {
    onmessage: null,
    onerror: null,
    terminate: () => {},
    postMessage: (mensagem: PedidoDeSelo, transferir: Transferable[]) => {
      const copia = structuredClone(mensagem, { transfer: transferir })
      setTimeout(() => {
        if (estado.morre) return pagina.onerror?.(new Error("morreu"))
        escopo.onmessage?.({ data: copia })
      }, 1)
    },
  }
  const escopo: EscopoDoSelo = {
    onmessage: null,
    postMessage: (resposta: RespostaDeSelo, transferir?: Transferable[]) => {
      const copia = structuredClone(resposta, { transfer: transferir ?? [] })
      setTimeout(() => pagina.onmessage?.({ data: copia }), 1)
    },
  }
  servirSelo(escopo)
  return pagina
}

describe("o selador no Worker", () => {
  it("o cofre gravado pelo Worker abre com a frase, com o mesmo conteúdo", async () => {
    const estado = { criados: 0 }
    const disco = new Disco()
    const vault = new Vault(disco, undefined, seladorNoWorker(() => trabalhadorFalso(estado)))
    await vault.create("frase-passe")
    await vault.update((c) => {
      c.deadWelcomes = ["um", "dois", "três ✓"]
    })
    expect(estado.criados).toBe(1)
    const outro = new Vault(disco)
    await outro.unlock("frase-passe")
    expect(outro.contents.deadWelcomes).toEqual(["um", "dois", "três ✓"])
  })

  it("um Worker que morre: a escrita em voo falha, e as seguintes selam na página", async () => {
    const estado = { criados: 0, morre: true }
    const disco = new Disco()
    const vault = new Vault(disco, undefined, seladorNoWorker(() => trabalhadorFalso(estado)))
    // `create` writes synchronously (a key change): it does not use the Worker.
    await vault.create("frase-passe")
    await expect(vault.update((c) => void (c.deadWelcomes = ["perdida"]))).rejects.toThrow()
    await vault.update((c) => void (c.deadWelcomes = ["na página"]))
    expect(estado.criados).toBe(1)
    const outro = new Vault(disco)
    await outro.unlock("frase-passe")
    expect(outro.contents.deadWelcomes).toEqual(["na página"])
  })
})

describe("o decifrador de media no Worker", () => {
  it("abre um blob do armazém pelo Worker, igual ao que se abre na página", async () => {
    const { cifrarBlob, decifrarBlob } = await import("./armazem/blob.js")
    const { decifradorNoWorker } = await import("./selo-worker.js")
    const k = crypto.getRandomValues(new Uint8Array(32))
    const n = crypto.getRandomValues(new Uint8Array(24))
    const bytes = crypto.getRandomValues(new Uint8Array(5000))
    const blob = cifrarBlob(bytes, k, n, "sha-de-teste", "original")
    const decifrar = decifradorNoWorker(() => trabalhadorFalso({ criados: 0 }))
    expect(await decifrar(blob, k, n, "sha-de-teste", "original")).toEqual(decifrarBlob(blob, k, n, "sha-de-teste", "original"))
    await expect(decifrar(blob, k, n, "outro-sha", "original")).rejects.toThrow()
  })
})
