import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
// The built package, like the harness: its sessions are the ones whose clocks the test sets.
import { Session } from "@enclave/client-core"

/**
 * A newcomer whose sessions never overlap with a member's still gets that member's
 * profile (1.3.26, security review S1), against a real server.
 *
 * The `pp` request is an ephemeral signal: it reaches only live leaves. With nobody
 * online to answer, the newcomer now asks by F10 at once, a stored request that the
 * member reads in its recovery and answers, past its daily cap, because the member's
 * resend to this newcomer was skipped on purpose.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const antes = Session.PEDIDO_DE_PERFIS_MS

beforeEach(async () => {
  servidor = await levantarServidor()
  Session.PEDIDO_DE_PERFIS_MS = 0
}, 30_000)

afterEach(async () => {
  desligarContas(abertas.splice(0))
  Session.PEDIDO_DE_PERFIS_MS = antes
  await servidor?.fechar()
})

describe("profiles when sessions do not overlap (1.3.26)", () => {
  it("the newcomer asks by F10 when nobody is online, and the member answers when it comes back", async () => {
    const contas = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"], { salaComum: false })
    abertas.push(...contas)
    const [ana, bruno, carla] = contas as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno])
    await ate(() => bruno.vault.contents.directory[ana.address] !== undefined, "Bruno knows Ana")
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    // Bruno answered nobody today: a full day's cap is spent, as after any answer.
    bruno.vault.contents.perfisDadosEm = { [canal]: Date.now() }

    // Bruno leaves; Carla joins, and has no profile of Bruno (as when the Welcome portrait cut it).
    bruno.session.disconnect()
    await ana.session.seat(canal, carla.address)
    await ate(() => carla.session.channels.includes(canal), "Carla joins")
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    delete carla.vault.contents.directory[bruno.address]
    delete carla.vault.contents.perfisPedidos?.[canal]

    // Ana leaves too: nobody online but Carla, who asks.
    ana.session.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 500))
    await carla.session.sincronizarAgora()
    await ate(() => carla.vault.contents.perfisPedidos?.[canal]?.includes(bruno.address) === true, "Carla asks by F10")
    await carla.session.flush()
    await new Promise((resolve) => setTimeout(resolve, 500))
    carla.session.disconnect()

    // Bruno comes back alone, reads the request in his recovery, and answers.
    await bruno.session.connect()
    await ate(() => bruno.vault.contents.perfilPublicadoPara?.[canal]?.includes(carla.address) === true, "Bruno answers Carla")
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    bruno.session.disconnect()

    // Carla comes back alone, and has Bruno's profile.
    await carla.session.connect()
    await ate(() => carla.vault.contents.directory[bruno.address]?.payload["displayName"] === "Bruno", "Carla has Bruno's profile")
    expect(carla.vault.contents.directory[bruno.address]?.parcial).not.toBe(true)
  }, 180_000)
})
