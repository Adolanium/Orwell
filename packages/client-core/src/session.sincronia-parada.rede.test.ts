import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * The sync pass with nothing to do writes nothing (hotfix 1.3.14).
 *
 * Measured with two devices of one account and a friend, all idle
 * (`session.dois-aparelhos-parados.rede.test.ts`): the ten-minute pass
 * (`SINCRONIA_MS`) wrote the whole vault 7 times on the computer, 14 on the phone
 * and 7 on the friend, in the same second, with nothing changed. The same pass
 * runs when the window comes back to the front (`retomar`, at most once a
 * minute). With a 20 MB vault that is one to three seconds with the app not
 * answering: the owner's "every 5 minutes the app does not respond" and "2 s
 * after coming back from minimized".
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(async () => {
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

describe("a passagem de sincronia sem nada para fazer", () => {
  it("não grava o cofre mais do que uma vez em cada aparelho", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    for (let c = 0; c < 4; c++) await canalComTodos(servidor, ana!, [bruno!])
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    // Settle: pairing, history, the first passes.
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    const contas = [ana!, telemovel, bruno!]
    for (const conta of contas) await conta.session.sincronizarAgora()
    await new Promise((resolve) => setTimeout(resolve, 3_000))

    const antes = contas.map((conta) => conta.backend.escritas)
    for (const conta of contas) await conta.session.sincronizarAgora()
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const escritas = contas.map((conta, i) => conta.backend.escritas - antes[i]!)
    console.log(`escritas do cofre numa passagem sem nada para fazer: Ana ${escritas[0]}, telemóvel ${escritas[1]}, Bruno ${escritas[2]}`)
    for (const n of escritas) expect(n).toBeLessThanOrEqual(1)
  }, 180_000)
})
