import { Session } from "@enclave/client-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ate, Cliente, contasDeTeste, desligarContas, levantarServidor, type ContaDeTeste, type ServidorDeTeste } from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * The common room never stays without a card (hotfix of 22/11/2026).
 *
 * Production, 22/11/2026: `group_infos` had no card for the common room, and
 * newcomers could not enter by the normal path. The card is single-use: whoever
 * takes it must post the next one, and members post one when the epoch moves.
 */

let server: ServidorDeTeste
const open: ContaDeTeste[] = []
beforeEach(async () => {
  server = await levantarServidor()
}, 30_000)
afterEach(async () => {
  desligarContas(open.splice(0))
  await server?.fechar()
})

const hasCard = (): boolean => server.enclave.gateway.store.hasGroupInfo(server.sala)

describe("the common room card", () => {
  it("is posted again by whoever entered with it, with every other member offline", async () => {
    const [ana] = await contasDeTeste(server, ["Ana"])
    open.push(ana!)
    await ana!.session.ensureCommonRoom()
    await ate(() => ana!.session.channels.includes(server.sala), "Ana is in the common room", 30_000)
    await ate(hasCard, "the room has a card", 15_000)
    desligarContas([ana!])

    const [bruno] = await contasDeTeste(server, ["Bruno"])
    open.push(bruno!)
    await bruno!.session.ensureCommonRoom()
    await ate(() => bruno!.session.channels.includes(server.sala), "Bruno enters by the card", 30_000)
    await ate(hasCard, "Bruno posted the next card", Session.CARTAO_ATRASO_MS + 15_000)
    expect(hasCard()).toBe(true)
  }, 120_000)

  it("is posted again by a seated member when a newcomer took it and never entered", async () => {
    const [ana] = await contasDeTeste(server, ["Ana"])
    open.push(ana!)
    await ana!.session.ensureCommonRoom()
    await ate(() => ana!.session.channels.includes(server.sala), "Ana is in the common room", 30_000)
    await ate(hasCard, "the room has a card", 15_000)

    // Someone takes the card and never sends the commit: the room is left with none.
    const gateway = server.enclave.gateway.constructor as unknown as { LUGAR_TEMPORARIO_MS: number }
    const before = gateway.LUGAR_TEMPORARIO_MS
    gateway.LUGAR_TEMPORARIO_MS = 2_000
    const [bruno] = await contasDeTeste(server, ["Bruno"], { salaComum: false })
    open.push(bruno!)
    const raw = await Cliente.ligarComCadeia(server.url, bruno!.session.identity)
    try {
      raw.enviar({ t: "channel.groupinfo.take", channel: server.sala })
      const answer = await raw.proximoDe("channel.groupinfo")
      expect(answer.info).toBeTypeOf("string")
    } finally {
      gateway.LUGAR_TEMPORARIO_MS = before
    }
    expect(hasCard()).toBe(false)

    // Ana is online and seated: she puts one back, without the epoch moving.
    await ate(hasCard, "a seated member restores the card", 60_000, 250)
  }, 120_000)
})
