import { randomBytes } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
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

/**
 * A profile request makes an owner publish its whole profile at most once per
 * channel, epoch and version, whoever asks (security reviews B1 and N-S1), against a
 * real server, in the common room.
 *
 * Two members ask for the same owner at the same time and nobody can relay it: the
 * owner publishes once, after the relay turns, and the second request is held by the
 * cap. Until the fix the cap was per requester, and each request was one more
 * whole profile.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const RETRATO = 30_000
const retrato = (): string => `data:image/png;base64,${Buffer.from(randomBytes(RETRATO)).toString("base64")}`

beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(async () => {
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

function perfisInteiros(canal: string, desde: number): number {
  const base = new DatabaseSync(servidor.baseDeDados)
  try {
    const linhas = base
      .prepare("SELECT length(ciphertext) AS bytes FROM events WHERE channel = ? AND kind = 'application' AND seq > ?")
      .all(canal, desde) as { bytes: number }[]
    return linhas.filter(({ bytes }) => bytes > (RETRATO * 4) / 3).length
  } finally {
    base.close()
  }
}

function ultimoSeq(canal: string): number {
  const base = new DatabaseSync(servidor.baseDeDados)
  try {
    return (base.prepare("SELECT coalesce(max(seq), 0) AS seq FROM events WHERE channel = ?").get(canal) as { seq: number }).seq
  } finally {
    base.close()
  }
}

describe("the cap on republishes a profile request causes (B1, N-S1)", () => {
  it("two members ask for the same owner at once in the common room: one whole profile, after the relay turns", async () => {
    const [ana, bruno, carla] = (await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    abertas.push(ana, bruno, carla)
    await carla.session.updateProfile({ displayName: "Carla", donations: [], avatarDataUrl: retrato() })
    await carla.session.publicarPerfilPendente()
    const sala = servidor.sala
    await ate(
      () => [ana, bruno].every((conta) => conta.vault.contents.directory[carla.address]?.payload["avatar"] !== undefined),
      "Ana and Bruno have Carla's portrait",
    )
    await new Promise((resolve) => setTimeout(resolve, 3_000))

    // Ana and Bruno lose Carla's profile: no relayer has it, only Carla can answer.
    delete ana.vault.contents.directory[carla.address]
    delete bruno.vault.contents.directory[carla.address]
    const marca = ultimoSeq(sala)
    ana.session.pedirPerfisDe(sala, [carla.address])
    bruno.session.pedirPerfisDe(sala, [carla.address])

    await ate(
      () => ana.vault.contents.directory[carla.address] !== undefined && bruno.vault.contents.directory[carla.address] !== undefined,
      "both have Carla's profile again",
      20_000,
    )
    await new Promise((resolve) => setTimeout(resolve, 4_000))
    const publicados = perfisInteiros(sala, marca)
    console.log(`two requests for the same owner in the common room: ${publicados} whole profiles`)
    expect(publicados).toBe(1)
  }, 120_000)

  it("a commit that adds nobody does not open a new slot (N3-S1)", async () => {
    const contas = (await contasDeTeste(servidor, ["Ana", "Bruno", "Carla", "Dora"], { salaComum: false })) as ContaDeTeste[]
    abertas.push(...contas)
    const [ana, bruno, carla, dora] = contas as [ContaDeTeste, ContaDeTeste, ContaDeTeste, ContaDeTeste]
    await carla.session.updateProfile({ displayName: "Carla", donations: [], avatarDataUrl: retrato() })
    await carla.session.publicarPerfilPendente()
    const canal = await canalComTodos(servidor, ana, [bruno, carla, dora])
    await ate(
      () => [ana, bruno].every((conta) => conta.vault.contents.directory[carla.address]?.payload["avatar"] !== undefined),
      "Ana and Bruno have Carla's portrait",
    )
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const marca = ultimoSeq(canal)
    const perder = (): void => {
      for (const conta of [ana, bruno, dora]) delete conta.vault.contents.directory[carla.address]
    }

    // Ana asks for Carla, whom nobody can relay: Carla publishes once.
    perder()
    ana.session.pedirPerfisDe(canal, [carla.address])
    await ate(() => perfisInteiros(canal, marca) === 1, "Carla publishes for Ana", 20_000)

    // A new epoch that adds nobody (Dora is removed), then Bruno asks: no second publish.
    await ana.session.expel(canal, dora.address)
    await ate(() => !carla.session.membersOf(canal).map(String).includes(dora.address), "Dora is out")
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    perder()
    bruno.session.pedirPerfisDe(canal, [carla.address])
    await new Promise((resolve) => setTimeout(resolve, 8_000))
    const publicados = perfisInteiros(canal, marca)
    console.log(`two requests around a commit that adds nobody: ${publicados} whole profiles`)
    expect(publicados).toBe(1)
  }, 120_000)
})
