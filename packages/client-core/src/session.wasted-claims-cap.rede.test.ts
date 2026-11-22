import { Session } from "@enclave/client-core"
import { moradaDeSala } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { ate, contasDeTeste, desligarContas, levantarServidor, type ContaDeTeste, type ServidorDeTeste } from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * A cap on wasted key-package claims per target device (hotfix of 22/11/2026).
 *
 * Production, 21-22/11/2026: 171 commits refused for epoch in a day, each a few
 * seconds after a key-package claim on the same connection, and two devices of one
 * account at zero packages. Layer A keeps a package a refused commit left unspent,
 * but a kept package that is never used (the device was seated by someone else)
 * expires, and it was spent for nothing. Past `WASTED_CLAIMS_MAX` of those for one
 * device in the window, this session claims that device no more until the window
 * ends: the seat says "no keys", and nothing is spent.
 */

let server: ServidorDeTeste
const open: ContaDeTeste[] = []
beforeAll(async () => {
  server = await levantarServidor()
}, 30_000)
afterAll(async () => {
  await server?.fechar()
})
afterEach(() => {
  desligarContas(open.splice(0))
})

const served = (): number => server.enclave.gateway.lugares.contagem().contagens.pacotesServidos.ultimaHora

async function newChannel(founder: ContaDeTeste, member: ContaDeTeste): Promise<string> {
  const channel = moradaDeSala(server.casa)
  await founder.session.createSpaceChannel(channel)
  await ate(() => founder.session.founderOf(channel) === founder.address, "the channel is founded")
  await founder.session.seat(channel, member.address)
  await ate(() => member.session.channels.includes(channel), "the member is in the channel", 15_000)
  return channel
}

describe("wasted key-package claims", () => {
  it("past the cap, a session does not claim that device again in the window", async () => {
    const [bruno, carla, dora] = await contasDeTeste(server, ["Bruno", "Carla", "Dora"], { salaComum: false })
    open.push(bruno!, carla!, dora!)

    // The race, until it happens: both claim Dora, one commit wins, the loser keeps a package.
    let loser: ContaDeTeste | null = null
    for (let round = 0; round < 6 && loser === null; round++) {
      const channel = await newChannel(bruno!, carla!)
      await Promise.allSettled([bruno!.session.seat(channel, dora!.address), carla!.session.seat(channel, dora!.address)])
      await ate(() => dora!.session.channels.includes(channel), "Dora is in the channel", 15_000)
      if (bruno!.session.pacotesPorGastar(dora!.address) === 1) loser = bruno!
      else if (carla!.session.pacotesPorGastar(dora!.address) === 1) loser = carla!
    }
    expect(loser).not.toBeNull()

    const keepMs = Session.PACOTE_POR_GASTAR_MS
    const max = Session.WASTED_CLAIMS_MAX
    try {
      // The kept package expires unused: one wasted claim, and the cap is one here.
      Session.PACOTE_POR_GASTAR_MS = 1
      Session.WASTED_CLAIMS_MAX = 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(loser!.session.pacotesPorGastar(dora!.address)).toBe(0)

      const channel = await newChannel(bruno!, carla!)
      const before = served()
      await expect(loser!.session.seat(channel, dora!.address)).rejects.toThrow("that person has no invite keys")
      expect(served()).toBe(before)
      expect(dora!.session.channels).not.toContain(channel)
    } finally {
      Session.PACOTE_POR_GASTAR_MS = keepMs
      Session.WASTED_CLAIMS_MAX = max
    }
  }, 180_000)
})
