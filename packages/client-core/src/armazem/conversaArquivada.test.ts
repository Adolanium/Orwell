import { describe, expect, it } from "vitest"
import type { StoredChatMessage, VaultContents } from "../vault.js"
import { ArmazemDeMedia } from "./armazem.js"
import * as arquivo from "./conversaArquivada.js"
import { ArmazemEmMemoria } from "./emMemoria.js"

/**
 * Sealing an archive page is two writes: the blob to the store, and the vault
 * that references it. A crash can land between them, in either order (review of
 * 1.3.18, I2). After the restart, every page the vault indexes must open.
 *
 * The "disk vault" below is what the last vault write that completed held. The
 * page is re-formed after the restart from what that vault still had waiting.
 */

const CANAL = "!sala:servidor.example"

const entrada = (i: number): StoredChatMessage =>
  ({ id: `m${i}`, at: 1_000 + i, sender: "@ana:servidor.example", channel: CANAL, payload: { t: "message", body: `m${i}` } }) as unknown as StoredChatMessage

const comEntradas = (n: number): VaultContents =>
  ({ porArquivar: { [CANAL]: Array.from({ length: n }, (_, i) => entrada(i)) } }) as unknown as VaultContents

async function armazemSobre(backend: ArmazemEmMemoria): Promise<ArmazemDeMedia> {
  const armazem = new ArmazemDeMedia(backend, null)
  await armazem.abrir()
  return armazem
}

/** One vault write: seal what is full. Returns once the store has answered for every page, and the vault took them. */
async function escreverCofre(contents: VaultContents, armazem: ArmazemDeMedia): Promise<void> {
  const emCurso = new Map<string, arquivo.PaginaEmCurso>()
  const respostas: Promise<void>[] = []
  arquivo.selarPaginas(contents, armazem, 5_000, emCurso, (sha, escrito) => {
    respostas.push(Promise.resolve())
    arquivo.confirmarPagina?.(contents, emCurso, sha, escrito)
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  await Promise.all(respostas)
}

const clonar = (contents: VaultContents): VaultContents => structuredClone(contents)

async function primeiraPagina(contents: VaultContents, armazem: ArmazemDeMedia): Promise<string[]> {
  const entradas = await arquivo.lerPagina(contents, armazem, CANAL, 0)
  return entradas.map((e) => String((e.payload as { body?: unknown }).body))
}

describe("selar uma página do arquivo, com uma interrupção a meio", () => {
  it("o blob chega ao disco e o cofre não: depois de reabrir, a página volta a formar-se e abre", async () => {
    const backend = new ArmazemEmMemoria()
    const antes = await armazemSobre(backend)
    const contents = comEntradas(120)
    const cofreNoDisco = clonar(contents) // the write that would have carried the page never completes
    await escreverCofre(contents, antes) // the blob reaches the store
    antes.trancar()

    const depois = await armazemSobre(backend) // same disk: the orphan blob is in the inventory
    const reaberto = clonar(cofreNoDisco)
    await escreverCofre(reaberto, depois)
    expect(await primeiraPagina(reaberto, depois)).toEqual(Array.from({ length: 100 }, (_, i) => `m${i}`))
    expect(reaberto.porArquivar?.[CANAL]).toHaveLength(20)
  })

  it("o cofre chega ao disco e o blob não: o índice nunca aponta para um blob que não existe", async () => {
    const backend = new ArmazemEmMemoria()
    const antes = await armazemSobre(backend)
    const contents = comEntradas(120)
    backend.falharProxima(new Error("the tab closed")) // the blob write never lands
    arquivo.selarPaginas(contents, antes, 5_000, new Map(), () => {})
    const cofreNoDisco = clonar(contents) // the vault write that runs the seal completes
    await new Promise((resolve) => setTimeout(resolve, 50))
    antes.trancar()

    const depois = await armazemSobre(backend)
    const reaberto = clonar(cofreNoDisco)
    await escreverCofre(reaberto, depois)
    for (let i = 0; i < (reaberto.arquivoDaConversa?.[CANAL]?.length ?? 0); i++) {
      await expect(arquivo.lerPagina(reaberto, depois, CANAL, i)).resolves.toHaveLength(100)
    }
    expect(await primeiraPagina(reaberto, depois)).toEqual(Array.from({ length: 100 }, (_, i) => `m${i}`))
  })

  it("a mesma página formada duas vezes tem outro sha: nunca encontra o blob antigo", async () => {
    const armazem = await armazemSobre(new ArmazemEmMemoria())
    const shas = new Set<string>()
    for (let volta = 0; volta < 2; volta++) {
      const emCurso = new Map<string, arquivo.PaginaEmCurso>()
      arquivo.selarPaginas(comEntradas(100), armazem, 5_000, emCurso, () => {})
      for (const sha of emCurso.keys()) shas.add(sha)
    }
    expect(shas.size).toBe(2)
  })
})
