import { generateIdentity } from "@enclave/protocol"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  canalComTodos,
  Cliente,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { Session } from "./session.js"

/**
 * A ring of key packages stuck at its cap (review of 1.3.19, C2).
 *
 * A private half leaves the ring only when a Welcome spends it. Someone claiming
 * this account's packages in a loop, with no Welcome ever, filled the ring to 200;
 * at the cap the device minted nothing more, the server's pool reached 0, and from
 * then on nobody could invite this device anywhere, not even after a new login.
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

describe("o anel de key packages no tecto", () => {
  it("depois de 220 reclamações sem Welcome e de um login, o aparelho volta a poder ser convidado", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const atacante = await Cliente.ligar(servidor.url, generateIdentity(servidor.casa))
    // One at a time, a little apart, so each nudge has time to become a top-up of 20.
    for (let i = 0; i < 220; i++) {
      atacante.enviar({ t: "keypackage.claim", address: ana!.address })
      await atacante.proximoDe("keypackage.claimed")
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(ana!.session.keyPackagesLocais).toBeLessThanOrEqual(Session.KEY_PACKAGES_LOCAIS_MAX)

    ana!.session.disconnect()
    await ana!.session.connect()
    // Bruno seats Ana in a new channel: that claims one of her packages.
    await canalComTodos(servidor, bruno!, [ana!])
    expect(ana!.session.keyPackagesLocais).toBeLessThanOrEqual(Session.KEY_PACKAGES_LOCAIS_MAX)
  }, 180_000)

  it("an empty pool with a full ring publishes while the recovery of the channels still runs", async () => {
    const [carla, david] = await contasDeTeste(servidor, ["Carla", "David"])
    abertas.push(carla!, david!)
    await canalComTodos(servidor, david!, [carla!])
    const claimer = await Cliente.ligar(servidor.url, generateIdentity(servidor.casa))
    for (let i = 0; i < 220; i++) {
      claimer.enviar({ t: "keypackage.claim", address: carla!.address })
      await claimer.proximoDe("keypackage.claimed")
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    carla!.session.disconnect()
    // Offline, so nothing refills: whoever claims now empties the pool.
    for (let i = 0; i < 25; i++) {
      claimer.enviar({ t: "keypackage.claim", address: carla!.address })
      await claimer.proximoDe("keypackage.claimed")
    }

    // A recovery that does not end: the pages never arrive (22/11/2026, a deaf device in the common room).
    const send = WebSocket.prototype.send
    let recovering = 0
    let published = 0
    // A slow vault: the low-reserve warning arrives while the channels still load.
    // On the instance: the test client loads `Session` from the package, not from this file's module.
    const restore = carla!.session.restore.bind(carla!.session)
    carla!.session.restore = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      return restore()
    }
    let resynced = false
    let pingedTooSoon = false
    WebSocket.prototype.send = function (this: WebSocket, data: Parameters<WebSocket["send"]>[0]) {
      const text = String(data)
      if (text.includes('"t":"keypackage.publish"')) published = Date.now()
      if (text.includes('"t":"welcome.resync"')) resynced = true
      if (text.includes('"t":"ping"') && !resynced) pingedTooSoon = true
      if (text.includes('"t":"channel.backfill"')) {
        if (recovering === 0) recovering = Date.now()
        return
      }
      send.call(this, data)
    }
    try {
      const connecting = carla!.session.connect()
      const until = Date.now() + 25_000
      while (published === 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100))
      // A pong for an earlier ping says nothing about the stored Welcomes: their keys would be dropped.
      expect(pingedTooSoon, "pinged before asking for the stored Welcomes").toBe(false)
      expect(recovering, "the recovery started").toBeGreaterThan(0)
      expect(published, "keys went out").toBeGreaterThan(0)
      expect(published - recovering, "ms the keys waited for the recovery").toBeLessThan(5_000)
      await connecting
    } finally {
      WebSocket.prototype.send = send
      carla!.session.restore = restore
    }
  }, 180_000)
})
