import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * A page of the archive that does not open, on the first read (review of
 * 1.3.18, M2). The first read has no cursor; it used to throw without saying
 * where the next page was, so each tap read the same broken page again.
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

describe("uma página do arquivo que não abre", () => {
  it("volta vazia, marcada, e com o cursor da anterior: o toque seguinte passa por ela", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"])
    abertas.push(ana!)
    const canal = "!sala-de-teste:localhost"
    const pagina = (sha: string) => ({ sha, n: 100, de: 1, ate: 2, media: [] })
    await ana!.vault.update((contents) => {
      contents.arquivoDaConversa = { [canal]: [pagina("pagina-velha"), pagina("pagina-nova")] }
      contents.media ??= {}
      for (const sha of ["pagina-velha", "pagina-nova"]) {
        contents.media[sha] = { v: 1, k: "A".repeat(44), n: "A".repeat(32), b: 10, t: "application/x-orwell-conversa+json", f: "texto", c: "mini", at: 1 }
      }
    })

    const primeira = await ana!.session.conversaArquivada(canal)
    expect(primeira).toEqual({ entradas: [], seguinte: 0, falhou: true })
    const segunda = await ana!.session.conversaArquivada(canal, primeira.seguinte)
    expect(segunda).toEqual({ entradas: [], seguinte: null, falhou: true })
  }, 60_000)
})

describe("recomeçar todos os canais (M1)", () => {
  it("leva também o arquivo, o que espera por ele e as emendas, de canais sem grupo vivo", async () => {
    const [bruno] = await contasDeTeste(servidor, ["Bruno"])
    abertas.push(bruno!)
    const arquivado = "!canal-arquivado:localhost"
    await bruno!.vault.update((contents) => {
      contents.arquivoDaConversa = { [arquivado]: [{ sha: "uma-pagina", n: 100, de: 1, ate: 2, media: [] }] }
      contents.porArquivar = { [arquivado]: [] }
      contents.emendasArquivadas = { [arquivado]: { apagadas: { m1: bruno!.address }, edicoes: {} } }
    })
    await bruno!.session.forgetAllChannels()
    expect(bruno!.vault.contents.arquivoDaConversa?.[arquivado]).toBeUndefined()
    expect(bruno!.vault.contents.porArquivar?.[arquivado]).toBeUndefined()
    expect(bruno!.vault.contents.emendasArquivadas?.[arquivado]).toBeUndefined()
  }, 60_000)
})
