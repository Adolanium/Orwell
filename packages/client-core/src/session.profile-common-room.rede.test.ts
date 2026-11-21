import { randomBytes } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ate,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * The common room keeps its profile resend as in 1.3.25 (1.3.26, decision on N1 of
 * the security review), against a real server.
 *
 * No device signal goes to the common room, so a member's resend at the end of its
 * catch-up is how a newcomer hears that a silent member is alive. `seat` (the "add
 * now" repair) reads that proof: without it, it would re-seat a healthy member.
 * Outside the common room the resend stays cut (`session.profile-latest-only.rede.test.ts`).
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

/** Application events of the channel after `desde` that carry a whole profile (bigger than the portrait). */
function perfisInteiros(canal: string, desde: number): { eventos: number; bytes: number } {
  const base = new DatabaseSync(servidor.baseDeDados)
  try {
    const linhas = base
      .prepare("SELECT length(ciphertext) AS bytes FROM events WHERE channel = ? AND kind = 'application' AND seq > ?")
      .all(canal, desde) as { bytes: number }[]
    const grandes = linhas.filter(({ bytes }) => bytes > (RETRATO * 4) / 3)
    return { eventos: grandes.length, bytes: grandes.reduce((soma, { bytes }) => soma + bytes, 0) }
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

describe("the common room keeps its profile resend (1.3.26, N1)", () => {
  it("a newcomer hears a silent member after the member's catch-up, and seat says live", async () => {
    const [ana, bruno] = (await contasDeTeste(servidor, ["Ana", "Bruno"])) as [ContaDeTeste, ContaDeTeste]
    abertas.push(ana, bruno)
    await bruno.session.updateProfile({ displayName: "Bruno", donations: [], avatarDataUrl: retrato() })
    await bruno.session.publicarPerfilPendente()
    const sala = servidor.sala
    await ate(() => ana.session.channels.includes(sala) && bruno.session.channels.includes(sala), "both in the common room")
    // Once per device, the profile repair round forces a publish on connection: spent here, before the measure.
    bruno.session.disconnect()
    await bruno.session.connect()
    await ate(() => bruno.vault.contents.profileRepairRound !== undefined, "Bruno's repair round is done")
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    // Bruno goes away; Carla joins the common room by the card while he is away.
    bruno.session.disconnect()
    const marca = ultimoSeq(sala)
    const [carla] = (await contasDeTeste(servidor, ["Carla"])) as [ContaDeTeste]
    abertas.push(carla)
    await ate(() => carla.session.channels.includes(sala), "Carla joins the common room")
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(carla.vault.contents.transmitters?.[sala]?.includes(bruno.address) ?? false).toBe(false)
    // Carla already has Bruno's profile (from another channel, say): no `pp` names him,
    // so only his resend can tell her that his seat is alive.
    const doBruno = ana.vault.contents.directory[bruno.address]
    expect(doBruno).toBeDefined()
    carla.vault.contents.directory[bruno.address] = structuredClone(doBruno!)

    // Bruno comes back: at the end of his catch-up he resends his profile there, and Carla hears him.
    await bruno.session.connect()
    await ate(() => carla.vault.contents.transmitters?.[sala]?.includes(bruno.address) === true, "Carla hears Bruno", 20_000)
    expect(await carla.session.seat(sala, bruno.address)).toBe("live")

    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const custo = perfisInteiros(sala, marca)
    console.log(`common room, one join while a member was away: ${custo.eventos} whole profiles, ${custo.bytes} bytes`)
    expect(custo.eventos).toBeGreaterThanOrEqual(1)
    // The device inventory of the room is never kept: nothing reads it there (N-N2).
    expect(bruno.vault.contents.perfilPublicadoParaAparelhos?.[sala]).toBeUndefined()
  }, 180_000)
})
