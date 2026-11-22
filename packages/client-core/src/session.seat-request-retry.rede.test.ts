import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  CofreEmMemoria,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { ArmazemEmMemoria, Session, Vault } from "@enclave/client-core"

/**
 * A new device's seat request that reached nobody is asked again on its own
 * back-off, not only at the next reconciliation pass (hotfix of 22/11/2026).
 *
 * A device made by import (or by pairing) has no MLS group yet: it asks for a
 * seat in each channel of the account (`lugaresPorPedir`), and a member online
 * answers. The back-off was written as one minute, two, four, but nothing fired
 * it: the list was read only on connect and in the ten-minute pass. A login while
 * no member was online left the account in the member list and the channel out
 * of the device's list for up to ten minutes (and up to half an hour after a few
 * rounds), even with a member online again a few seconds later.
 */

const PASSPHRASE = "frase-passe-de-teste"

let server: ServidorDeTeste
const open: { session: Session }[] = []

beforeEach(async () => {
  server = await levantarServidor()
}, 30_000)

afterEach(async () => {
  for (const account of open.splice(0)) account.session.disconnect()
  await server?.fechar()
})

async function importOnNewDevice(file: Uint8Array): Promise<ContaDeTeste> {
  const backend = new CofreEmMemoria()
  const vault = new Vault(backend)
  const armazem = new ArmazemEmMemoria()
  const session = new Session(vault, { armazem })
  const avisos: string[] = []
  await vault.importVault(file, PASSPHRASE, { passagem: (request) => session.passagemDoImportar(request) })
  await vault.unlock(PASSPHRASE)
  const identity = session.loadIdentity()
  await session.connect()
  return { nome: "new device", session, vault, backend, armazem, address: identity.address, avisos }
}

describe("seat request of a new device, with no member online at login", () => {
  it("is asked again on its back-off, and the device is seated about a minute after a member comes back", async () => {
    const [ana, bruno] = await contasDeTeste(server, ["Ana", "Bruno"], { salaComum: false })
    open.push(ana!, bruno!)
    const channel = await canalComTodos(server, ana!, [bruno!])
    await ana!.session.flush()
    const file = await ana!.vault.exportVault()
    // Nobody online: the first request at login reaches no one.
    desligarContas([ana!, bruno!])

    const device = await importOnNewDevice(file)
    open.push(device)
    expect(device.session.channels).not.toContain(channel)
    expect(Object.keys(device.vault.contents.lugaresPorPedir ?? {})).toContain(channel)
    // The interface shows it as "joining": the account's channel never leaves the list.
    expect(device.session.seatsPending()).toContain(channel)

    // A member comes back a few seconds after the login.
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await bruno!.session.connect()

    // The next request (one minute after the first) reaches Bruno. Before, nothing
    // asked again until the ten-minute pass.
    await ate(() => device.session.channels.includes(channel), "the new device is seated", 100_000, 250)
    expect(device.vault.contents.lugaresPorPedir?.[channel]).toBeUndefined()
    expect(device.session.seatsPending()).not.toContain(channel)
  }, 150_000)

  it("is asked again as soon as a member of the channel comes online", async () => {
    const [ana, bruno] = await contasDeTeste(server, ["Ana", "Bruno"], { salaComum: false })
    open.push(ana!, bruno!)
    const channel = await canalComTodos(server, ana!, [bruno!])
    await ana!.session.flush()
    const file = await ana!.vault.exportVault()
    desligarContas([ana!, bruno!])

    const device = await importOnNewDevice(file)
    open.push(device)
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    expect(device.session.channels).not.toContain(channel)
    await bruno!.session.connect()

    // Bruno's presence is the moment the request has someone to answer it: well
    // before the one-minute back-off.
    await ate(() => device.session.channels.includes(channel), "the new device is seated when Bruno comes online", 20_000, 250)
  }, 60_000)
})
