import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import type { StoredChatMessage } from "./vault.js"

/**
 * "Load older" and the amendments the ledger let go (review of 1.3.18, I3): a
 * deleted message never shows, an edited one comes with its last edit, and a
 * tombstone from someone who could not delete hides nothing.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

describe("o arquivo e as emendas fora do livro", () => {
  it("esconde a apagada pelo autor, traz a última edição, e ignora a lápide de quem não podia", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"])
    abertas.push(ana!)
    // A real room, founded by Ana: a stranger has no power in it.
    const canal = await canalComTodos(servidor, ana!, [])
    const BRUNO = `@bruno:${servidor.casa}`
    const mensagem = (id: string, sender: string): StoredChatMessage =>
      ({ seq: 1, sender, at: 1, payload: { t: "message", id, body: `texto ${id}`, sentAt: 1 } }) as StoredChatMessage
    const edicao = { seq: 2, sender: BRUNO, at: 2, payload: { t: "edit", id: "e1", target: "m1", body: "texto novo", editedAt: 2 } } as StoredChatMessage
    await ana!.vault.update((contents) => {
      contents.porArquivar = { [canal]: [mensagem("m0", BRUNO), mensagem("m1", BRUNO), mensagem("m2", BRUNO)] }
      contents.emendasArquivadas = {
        [canal]: {
          // m0 deleted by its author; m2 "deleted" by someone with no say over it.
          apagadas: { m0: BRUNO, m2: `@estranho:${servidor.casa}` },
          edicoes: { m1: edicao },
        },
      }
    })
    const { entradas } = await ana!.session.conversaArquivada(canal)
    const ids = entradas.map((e) => e.payload["id"])
    expect(ids).not.toContain("m0")
    expect(ids).toContain("m1")
    expect(ids).toContain("m2")
    expect(entradas.find((e) => e.payload["id"] === "e1")?.payload["body"]).toBe("texto novo")
  }, 60_000)
})
