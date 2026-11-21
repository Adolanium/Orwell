import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { mensagemAEnviar } from "./mensagemAEnviar.js"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
// From `dist`, like the sessions of the harness.
import { entradasDoCanal } from "@enclave/client-core"

/**
 * Poll votes over anti-entropy (S4) follow the room's permissions (21/11/2026).
 *
 * A vote has no time window: S4 serves it to a member who joined late, so the
 * count is right for everyone. Before this, it served every vote, also the votes
 * of a poll in a room the requester may not read. The responder now decides
 * alone, with the D2 rule (`leSala`): it computes the requester's permissions
 * from its own vault, and never asks the requester.
 *
 * The control is a poll in an open room: its votes do reach the late member,
 * so S4 ran and the silence about the closed room is the filter, not a stall.
 * Dora, with the role, joins at the same time: the report Ana gives her travels
 * in MLS to Carla too, and Carla drops it with her own permissions.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

function poll(question: string, room: string, id: string) {
  return mensagemAEnviar(`${question}\n1. Yes\n2. No`, room || undefined, { poll: { question, options: ["Yes", "No"] } } as never, {
    id,
    sentAt: Date.now(),
  })
}

const votesOn = (conta: ContaDeTeste, canal: string, pollId: string): number =>
  entradasDoCanal(conta.vault.contents, canal).filter(
    (e) => e.payload.t === "post.reaction" && e.payload["target"] === pollId && typeof e.payload["vote"] === "number",
  ).length

describe("S4: poll votes follow the room's permissions", () => {
  it("a late member without the room's role gets the open poll's votes and none of the closed poll's", async () => {
    const [ana, bruno, carla, dora] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla", "Dora"], { salaComum: false })
    abertas.push(ana!, bruno!, carla!, dora!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.upsertCategory(canal, { category: "Board", roles: ["chief"] })
    await ana!.session.upsertRoom(canal, { room: "secret", name: "secret", category: "Board" })
    await ana!.session.defineRole(canal, { role: "chief", name: "Chief", powers: [] })
    await ana!.session.assignRoles(canal, bruno!.address, ["chief"])
    await ate(() => bruno!.session.rolesFor(canal, bruno!.address).includes("chief"), "Bruno knows his role")

    const OPEN = "poll-open-room-0001"
    const CLOSED = "poll-closed-room-0001"
    await ana!.session.send(canal, poll("Open?", "", OPEN))
    await ana!.session.send(canal, poll("Closed?", "secret", CLOSED))
    await ate(
      () => [OPEN, CLOSED].every((id) => entradasDoCanal(bruno!.vault.contents, canal).some((e) => e.payload["id"] === id)),
      "Bruno has both polls",
    )
    // Only Bruno votes, and then he goes offline: his own resend to newcomers
    // (S1, `republishEngagement`) cannot run, so his votes can only reach a newcomer
    // through Ana, by S4.
    for (const id of [OPEN, CLOSED]) await bruno!.session.voteOnPoll(canal, id, 1)
    await ate(() => votesOn(ana!, canal, CLOSED) === 1 && votesOn(ana!, canal, OPEN) === 1, "Ana has Bruno's two votes")

    // Dora has the role: the same responder gives her the closed poll's vote.
    await ana!.session.assignRoles(canal, dora!.address, ["chief"])
    await ate(() => ana!.session.rolesFor(canal, dora!.address).includes("chief"), "Ana knows Dora's role")
    bruno!.session.disconnect()

    // Both join after the votes.
    await ana!.session.seat(canal, carla!.address)
    await ana!.session.seat(canal, dora!.address)
    await ate(() => carla!.session.channels.includes(canal) && dora!.session.channels.includes(canal), "Carla and Dora join")

    await ate(() => votesOn(carla!, canal, OPEN) === 1, "the open poll's vote reaches Carla", 90_000)
    await ate(() => votesOn(dora!, canal, CLOSED) === 1, "the closed poll's vote reaches Dora, who has the role", 90_000)
    // A few more S4 rounds: what did not come, does not come late either.
    await new Promise((resolve) => setTimeout(resolve, 8_000))
    expect(votesOn(carla!, canal, CLOSED)).toBe(0)
    expect(votesOn(dora!, canal, OPEN)).toBe(1)
    // They came by S4: reported, with the origin seq the reporter stated.
    const reported = entradasDoCanal(carla!.vault.contents, canal).filter((e) => e.payload["target"] === OPEN)
    expect(reported.length).toBe(1)
    expect(reported.every((e) => e.relatada === true)).toBe(true)
  }, 240_000)
})
