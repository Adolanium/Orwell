import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { Session } from "./session.js"

/**
 * The private halves of this device's key packages (review of 1.3.18, I1).
 *
 * Each `keypackage.low` mints 20 more, and the private halves stay on the device
 * until a Welcome spends them. Someone claiming this account's packages in a
 * loop made it mint without end: the vault grew, and every Welcome tried them all.
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

describe("o anel local de key packages", () => {
  it("não passa do tecto, por mais reposições que haja", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"])
    abertas.push(ana!)
    for (let i = 0; i < 15; i++) await ana!.session.topUpKeyPackages(20)
    expect(ana!.session.keyPackagesLocais).toBeLessThanOrEqual(Session.KEY_PACKAGES_LOCAIS_MAX)
    expect(ana!.session.keyPackagesLocais).toBe(Session.KEY_PACKAGES_LOCAIS_MAX)
  }, 60_000)
})
