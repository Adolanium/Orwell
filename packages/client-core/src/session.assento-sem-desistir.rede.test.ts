import { Session as SessionDoHarness } from "@enclave/client-core"
import { friendsOfTies } from "@enclave/protocol"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * The main device does not give up on a new device with no key packages (1.3.20).
 *
 * Under load the new device's top-up came after the main device's seven tries
 * (~85 s with the claims' own retries): it logged `reseat-failed` and moved on, and
 * the next try was a pass ten minutes later, behind a five-minute brake per channel.
 * In e2e-membros-aparelho-novo the second new device lacked the directs and feeds of
 * the four friends who were offline (13 and 11 of 14): in a friend's channel with the
 * friend online, the friend seats the device too and hid the loss. Here the top-ups
 * are held 100 s, the friend is offline, and the device must still get every channel.
 */

const ATRASO_DA_REPOSICAO_MS = 100_000

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const original = SessionDoHarness.prototype.topUpKeyPackages
beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  SessionDoHarness.prototype.topUpKeyPackages = original
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

describe("assentar um aparelho novo sem desistir", () => {
  it("com as reposições 100 s atrasadas e a amiga desligada, o aparelho novo fica em todos os canais, a directa e o mural dela incluídos", async () => {
    const [dono, eva] = await contasDeTeste(servidor, ["Dono", "Eva"])
    abertas.push(dono!, eva!)
    const directa = await eva!.session.openDirect(dono!.address)
    await ate(() => dono!.session.channels.includes(directa), "a directa chega ao dono")
    await eva!.session.sendFriendRequest(directa)
    await ate(() => dono!.session.friendTies().get(eva!.address)?.link === "pedido-recebido", "o pedido chega ao dono")
    await dono!.session.acceptFriend(directa, eva!.address)
    await ate(() => friendsOfTies(dono!.session.friendTies()).includes(eva!.address), "amigos")
    const mural = eva!.session.feedChannel
    await ate(() => dono!.session.channels.includes(mural), "o dono no mural da Eva", 30_000)
    // Past the 20 key packages of the new device's first pool.
    for (let i = 0; i < 24; i++) await canalComTodos(servidor, dono!, [])
    eva!.session.disconnect()

    SessionDoHarness.prototype.topUpKeyPackages = async function (this: SessionDoHarness, count: number, replace = false) {
      if (this !== dono!.session && !replace) await new Promise((resolve) => setTimeout(resolve, ATRASO_DA_REPOSICAO_MS))
      return original.call(this, count, replace)
    }
    const telemovel = await emparelharAparelho(dono!)
    abertas.push(telemovel)
    await ate(
      () => dono!.session.channels.every((canal) => telemovel.session.channels.includes(canal)),
      "o telemóvel em todos os canais do computador",
      240_000,
      500,
    ).catch(() => {})
    SessionDoHarness.prototype.topUpKeyPackages = original
    const faltam = dono!.session.channels.filter((canal) => !telemovel.session.channels.includes(canal))
    expect(faltam.map((canal) => (canal === directa ? "directa" : canal === mural ? "mural" : "sala"))).toEqual([])
    expect(dono!.avisos).not.toContain("reseat-failed")
  }, 400_000)
})
