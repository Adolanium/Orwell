import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  levantarServidor,
  recarregar,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import type { Session } from "@enclave/client-core"

/**
 * A device that lost its local MLS state of a channel, in a stable epoch, gets
 * the channel back (hotfix of 22/11/2026).
 *
 * The case measured in production: a channel with weeks without a commit, the
 * device's leaf still in the tree, and the device without a working group for it.
 * Nothing asked for a seat: `lugaresPorPedir` is only filled by an import and by a
 * dead Welcome. Now a channel this device has history or state of, with no group
 * and not left, asks for its seat, signed, until it is seated; a member of another
 * account answers (a named leaf with a valid proof is reseated).
 */

let server: ServidorDeTeste
const open: { session: Session }[] = []

beforeEach(async () => {
  server = await levantarServidor()
}, 30_000)

afterEach(async () => {
  for (const account of open.splice(0)) account.session.disconnect()
  await server?.fechar()
})

function bodies(session: Session, channel: string): string[] {
  return session
    .history(channel)
    .map((entry) => entry.payload["body"])
    .filter((body): body is string => typeof body === "string")
}

describe("a device that lost the group state of a channel", () => {
  it("asks for its seat, signed, and has the whole channel again", async () => {
    const [ana, bruno] = await contasDeTeste(server, ["Ana", "Bruno"], { salaComum: false })
    open.push(ana!, bruno!)
    const channel = await canalComTodos(server, ana!, [bruno!])
    await bruno!.session.send(channel, { t: "message", body: "before", sentAt: Date.now(), id: "m-1-xxxxxxxx" })
    await ate(() => bodies(ana!.session, channel).includes("before"), "Ana reads Bruno")
    const membersBefore = ana!.session.membersOf(channel).map(String).sort()

    // The group state goes, the history stays: the device keeps the channel's past and loses its seat.
    ana!.session.disconnect()
    await ana!.vault.update((contents) => {
      delete contents.groups[channel]
    })
    await ana!.session.flush()
    const reloaded = await recarregar(ana!)
    reloaded.session.loadIdentity()
    await reloaded.session.connect()
    open.push(reloaded)

    await ate(() => reloaded.session.channels.includes(channel), "Ana is seated again", 90_000, 250)
    expect(reloaded.session.membersOf(channel).map(String).sort()).toEqual(membersBefore)
    expect(bodies(reloaded.session, channel)).toContain("before")
    await bruno!.session.send(channel, { t: "message", body: "after", sentAt: Date.now(), id: "m-2-xxxxxxxx" })
    await ate(() => bodies(reloaded.session, channel).includes("after"), "Ana reads a new message", 30_000)
  }, 150_000)
})
