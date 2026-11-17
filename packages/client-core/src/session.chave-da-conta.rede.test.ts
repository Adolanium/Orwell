import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { TECTOS_DA_CHAVE_DA_CONTA } from "./chaveDaConta.js"
// The harness server, for real, on an ephemeral port.
import {
  ate,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * The account key on the phone (1.3.16, "Erro 609").
 *
 * Before: the paired phone did not have the account private key, and a new direct
 * conversation from it failed with Erro 609 ("this device cannot start a new
 * conversation"), because the direct address is the DH of the two account keys.
 * Now pairing passes the key, and a phone paired before gets it through the
 * account channel the first time a device with the key is connected.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const tectos = { ...TECTOS_DA_CHAVE_DA_CONTA }

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

beforeEach(() => {
  Object.assign(TECTOS_DA_CHAVE_DA_CONTA, { primeiroPedidoMs: 200, pedirCadaMs: 1_000 })
})

afterEach(() => {
  Object.assign(TECTOS_DA_CHAVE_DA_CONTA, tectos)
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  abertas.push(...novas)
  return novas
}

describe("a chave da conta no telemóvel", () => {
  it("o emparelhamento passa a chave: o telemóvel abre uma directa nova com o computador desligado", async () => {
    const [ana, carla] = await contas("Ana", "Carla")
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    expect(telemovel.vault.contents.signingPrivateKey).toBe(ana!.vault.contents.signingPrivateKey)
    expect(telemovel.session.temChaveDeConta).toBe(true)
    ana!.session.disconnect()

    const dm = await telemovel.session.openDirect(carla!.address)
    await ate(() => carla!.session.channels.includes(dm), "a Carla recebe a directa aberta no telemóvel", 30_000)
    expect(telemovel.session.tipoDoCanal(dm)).toBe("directa")
    // The same address the computer computes: one direct per pair of accounts.
    await ana!.session.connect()
    await ate(() => ana!.session.channels.includes(dm), "o computador entra na mesma directa", 30_000)
    expect(ana!.session.tipoDoCanal(dm)).toBe("directa")
  }, 120_000)

  it("um telemóvel emparelhado antes da 1.3.16 recebe a chave pelo canal da conta, sem fazer nada", async () => {
    const [ana, carla] = await contas("Ana", "Carla")
    const telemovel = await emparelharAparelho(ana!, "Ana (telemóvel)", { semChaveDaConta: true })
    abertas.push(telemovel)
    await ate(() => telemovel.session.temChaveDeConta, "a chave chega pelo canal da conta", 60_000)
    expect(telemovel.vault.contents.signingPrivateKey).toBe(ana!.vault.contents.signingPrivateKey)
    expect(telemovel.avisos).toContain("account-key-received")
    expect(telemovel.session.estatisticasDaChaveDaConta.recebidas).toBe(1)

    // And Erro 609 is gone: a new direct with the computer off.
    ana!.session.disconnect()
    const dm = await telemovel.session.openDirect(carla!.address)
    await ate(() => carla!.session.channels.includes(dm), "a Carla recebe a directa", 30_000)
    // The vault keeps it: a reload opens with the key.
    expect(telemovel.session.loadIdentity().signingPrivateKey).toBeDefined()
  }, 120_000)
})
