import { ArmazemEmMemoria, type DerivarChaveDoCofre, type Session, type Vault } from "@enclave/client-core"
import { beforeEach, describe, expect, it } from "vitest"
import { createBrowserBridge } from "./bridge.js"
import { BasesFalsas } from "./testes/idb-falso.js"
import { BrowserVaultBackend } from "./vault-backend.js"
// jsdom has no `Blob.arrayBuffer`; the bridge reads the file for it, in slices, like browsers do.
import "../../../packages/ui/src/testes/blobDoJsdom.js"

/**
 * Exporting the account with the images in the browser bridge (Task 11b), with
 * the real parts and only the fake IndexedDB underneath: without the checkbox
 * the usual text comes out; with it a `Blob` (the container) comes out, which
 * another browser imports in slices, and the portrait comes back from the store
 * without needing another device.
 */

const FRASE = "frase-de-teste-da-exportacao"
const rapida: DerivarChaveDoCofre = async () => new Uint8Array(32).fill(7)
const RETRATO = `data:image/png;base64,${"R".repeat(4_000)}`

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new BasesFalsas().indexedDB
  sessionStorage.clear()
  localStorage.clear()
})

async function abrir(criar: boolean) {
  let partes: { session: Session; vault: Vault } | null = null
  const armazem = new ArmazemEmMemoria()
  const ponte = createBrowserBridge({ backend: new BrowserVaultBackend(), derivar: rapida, armazem, miniaturista: null, aoCriar: (criadas) => (partes = criadas) })
  await ponte.assumirPosse("dono-a")
  if (criar) {
    await ponte.vault.create(FRASE)
    await ponte.identity.create("localhost:8448")
  }
  const { vault, session } = partes as unknown as { vault: Vault; session: Session }
  return { ponte, armazem, vault, session }
}

describe("a ponte do browser exporta a conta com as imagens, à escolha", () => {
  it("sem a caixa, o ficheiro de sempre em texto; com a caixa, um Blob que outro browser importa com os blobs", async () => {
    const origem = await abrir(true)
    await origem.ponte.profile.set({ displayName: "Ana", donations: [], avatarDataUrl: RETRATO })
    const sha = origem.vault.contents.profile.avatarRef as string
    expect(sha).toBeTruthy()

    const simples = await origem.ponte.vault.export()
    expect("data" in simples && simples.data.startsWith("orwv2\n{")).toBe(true)

    const comImagens = await origem.ponte.vault.export(undefined, { incluirImagens: true })
    if (!("ficheiro" in comImagens)) throw new Error("esperava o contentor")
    expect(new TextDecoder().decode(await comImagens.ficheiro.slice(0, 12).arrayBuffer())).toBe("orwv2\norwc1\n")

    // Another browser: another database, another store.
    ;(globalThis as { indexedDB?: unknown }).indexedDB = new BasesFalsas().indexedDB
    sessionStorage.clear()
    localStorage.clear()
    const destino = await abrir(false)
    // No server here: the handover that adds the new device to the manifest (1.3.26) answers as one without manifests.
    destino.session.passagemDoImportar = async () => ({ versao: null })
    await destino.ponte.vault.import(comImagens.ficheiro, FRASE)
    expect((await destino.armazem.listar()).map((b) => b.sha)).toContain(sha)
    await destino.ponte.vault.unlock(FRASE)
    expect(await destino.ponte.media?.bytes(sha)).toBeInstanceOf(Uint8Array)
  }, 30_000)
})
