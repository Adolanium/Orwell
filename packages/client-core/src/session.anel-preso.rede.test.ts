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
})
