import { afterEach, describe, expect, it } from "vitest"
import { ate, contasDeTeste, desligarContas, levantarServidor, type ContaDeTeste, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/**
 * A member that came in by a Welcome does not publish the card again when its
 * old join retry fires (found with `session.sala-comum-cascata.rede`, 20/11/2026).
 *
 * The order of events: the member asks for a seat (no card on the server at
 * that moment), the retry is armed for 15 s (`REJOIN_RETRY_MS`), and the
 * Welcome comes before it. The member publishes the card of its own entry.
 * Another account then joins by that card. When the old retry fires, the member
 * runs `ensureCommonRoom`, finds itself inside, and read in its `hello.ok` that
 * the room had no card: so it published a card for the new epoch, and every
 * member that came in the same way did the same. Measured: 6 cards for 1 entry
 * in a room of 6, each one the whole tree. The card is already there: the one
 * who joined by it published it.
 */
let servidor: ServidorDeTeste | undefined
const abertas: ContaDeTeste[] = []
afterEach(async () => {
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
  servidor = undefined
})

describe("o cartão da sala comum e o reenvio antigo do pedido de lugar", () => {
  it("quem entrou por Welcome não volta a publicar o cartão quando o reenvio dispara", async () => {
    servidor = await levantarServidor()
    const sala = servidor.sala
    const [fundadora] = await contasDeTeste(servidor, ["Fundadora"], { salaComum: true })
    abertas.push(fundadora!)
    await ate(() => fundadora!.session.channels.includes(sala), "a sala existe", 30_000)
    await ate(() => servidor!.enclave.store.hasGroupInfo(sala), "o cartão da fundadora", 15_000)
    // No card on the server: the next account asks the founder for a seat, and gets a Welcome.
    servidor.enclave.store.takeGroupInfo(sala)
    const [membro] = await contasDeTeste(servidor, ["Membro"], { salaComum: true })
    abertas.push(membro!)
    await ate(() => membro!.session.channels.includes(sala), "o membro entra por Welcome", 30_000)
    expect(servidor.enclave.store.hasWelcomeFor(sala, membro!.address)).toBe(true)
    await ate(() => servidor!.enclave.store.hasGroupInfo(sala), "o cartão da entrada do membro", 15_000)
    // Another account joins by that card, before the member's old retry fires.
    const [novata] = await contasDeTeste(servidor, ["Novata"], { salaComum: true })
    abertas.push(novata!)
    await ate(() => fundadora!.session.membersOf(sala).length === 3 && membro!.session.membersOf(sala).length === 3, "todos vêem a Novata", 30_000)
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    // And one more, so the member's last card is from an epoch the room already left.
    const [outra] = await contasDeTeste(servidor, ["Outra"], { salaComum: true })
    abertas.push(outra!)
    await ate(() => fundadora!.session.membersOf(sala).length === 4 && membro!.session.membersOf(sala).length === 4, "todos vêem a Outra", 30_000)
    await new Promise((resolve) => setTimeout(resolve, 2_500))

    const store = servidor.enclave.store
    const original = store.putGroupInfo.bind(store)
    let cartoes = 0
    store.putGroupInfo = (channel: string, info: Uint8Array) => {
      if (channel === sala) cartoes += 1
      return original(channel, info)
    }
    /*
      What the old retry does when it fires (`#insistirNaSalaComum`): the front gate
      again. Called here, so the test does not depend on the Welcome arriving after
      the request's receipt, which is what arms the retry and which a quiet machine
      rarely shows.
    */
    await membro!.session.ensureCommonRoom()
    // Past the card delay (`CARTAO_ATRASO_MS`, 1.5 s).
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    expect(cartoes).toBe(0)
  }, 90_000)
})
