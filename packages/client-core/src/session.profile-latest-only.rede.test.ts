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
// The built package, like the harness: its sessions are the ones whose clocks the test shortens.
import { AntiEntropia, Session } from "@enclave/client-core"

/**
 * Whoever joins or catches up gets the latest version of each person's profile, once
 * (1.3.26), against a real server.
 *
 * Until 1.3.25 every member resent its whole profile (portrait included, ~124 KB)
 * into every channel that grew, as an MLS message the server keeps 30 days: each
 * join cost one portrait per member, and each device catching up downloaded all of
 * them. Now a newcomer that declares `EXTENSAO_PERFIS_A_PEDIDO` asks for what the
 * Welcome portrait did not bring (`pp`, in any channel), and only a real change of a
 * profile goes out by MLS.
 *
 * Each account has a portrait of its own size, so the server's `events` table says
 * whose portrait each application event carries, without decrypting anything.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const antes = {
  intervalo: AntiEntropia.INTERVALO_DOS_PEDIDOS_DE_PERFIS_MS,
  repetir: Session.REPETIR_PEDIDO_DE_PERFIS_MS,
}

beforeEach(async () => {
  servidor = await levantarServidor()
  AntiEntropia.INTERVALO_DOS_PEDIDOS_DE_PERFIS_MS = 1_000
  Session.REPETIR_PEDIDO_DE_PERFIS_MS = 1_500
}, 30_000)

afterEach(async () => {
  desligarContas(abertas.splice(0))
  AntiEntropia.INTERVALO_DOS_PEDIDOS_DE_PERFIS_MS = antes.intervalo
  Session.REPETIR_PEDIDO_DE_PERFIS_MS = antes.repetir
  await servidor?.fechar()
})

/** Portrait bytes per account, far enough apart that the event sizes never overlap. */
const RETRATOS: Record<string, number> = { Ana: 48_000, Bruno: 6_000, Carla: 36_000, Dora: 24_000, Eva: 12_000 }

const retratoDe = (nome: string): string =>
  `data:image/png;base64,${Buffer.from(randomBytes(RETRATOS[nome] ?? 0)).toString("base64")}`

/** The base64 length of a portrait: what a profile carrying it adds to the event. */
const caracteres = (nome: string): number => Math.ceil((RETRATOS[nome] ?? 0) / 3) * 4

async function comRetrato(contas: readonly ContaDeTeste[]): Promise<void> {
  for (const conta of contas) {
    await conta.session.updateProfile({ displayName: conta.nome, donations: [], avatarDataUrl: retratoDe(conta.nome) })
  }
}

/** The application events of a channel after `desde`, as the server stores them. */
function eventosDepois(canal: string, desde: number): { seq: number; bytes: number }[] {
  const base = new DatabaseSync(servidor.baseDeDados)
  try {
    return base
      .prepare("SELECT seq, length(ciphertext) AS bytes FROM events WHERE channel = ? AND kind = 'application' AND seq > ? ORDER BY seq")
      .all(canal, desde) as { seq: number; bytes: number }[]
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

/** Whose whole profile (with the portrait) each big event carries, counted per account. */
function perfisInteirosPorConta(eventos: readonly { bytes: number }[]): Record<string, number> {
  const contagem: Record<string, number> = {}
  for (const { bytes } of eventos) {
    const nome = Object.keys(RETRATOS).find((n) => bytes >= caracteres(n) && bytes < caracteres(n) + 6_000)
    if (nome) contagem[nome] = (contagem[nome] ?? 0) + 1
  }
  return contagem
}

const nomeEm = (conta: ContaDeTeste, de: ContaDeTeste): unknown => conta.vault.contents.directory[de.address]?.payload["displayName"]

describe("profiles: the latest version only (1.3.26)", () => {
  it("joins in a row cost no resent profile: a device that catches up gets one version of each person", async () => {
    const contas = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla", "Dora", "Eva"], { salaComum: false })
    abertas.push(...contas)
    const [ana, bruno, carla, dora, eva] = contas as [ContaDeTeste, ContaDeTeste, ContaDeTeste, ContaDeTeste, ContaDeTeste]
    await comRetrato(contas)
    const canal = await canalComTodos(servidor, ana, [bruno])
    await ate(() => nomeEm(bruno, ana) === "Ana" && nomeEm(ana, bruno) === "Bruno", "Ana and Bruno know each other")
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    // Bruno goes away; while he is away Ana changes her profile once, and three people join one after the other.
    bruno.session.disconnect()
    const marca = ultimoSeq(canal)
    await ana.session.updateProfile({ displayName: "Ana", statusText: "v2", donations: [], avatarDataUrl: retratoDe("Ana") })
    const versaoDaAna = ana.session.profile.updatedAt
    for (const novo of [carla, dora, eva]) {
      await ana.session.seat(canal, novo.address)
      await ate(() => novo.session.channels.includes(canal), `${novo.nome} joins`)
      await new Promise((resolve) => setTimeout(resolve, 1_500))
    }
    // The last newcomer has everyone's latest profile, Bruno's included, with nobody resending.
    await ate(
      () =>
        nomeEm(eva, ana) === "Ana" &&
        eva.vault.contents.directory[ana.address]?.payload["updatedAt"] === versaoDaAna &&
        nomeEm(eva, bruno) === "Bruno" &&
        nomeEm(eva, carla) === "Carla" &&
        nomeEm(eva, dora) === "Dora",
      "Eva has the latest profile of everyone",
    )
    await new Promise((resolve) => setTimeout(resolve, 3_000))

    const eventos = eventosDepois(canal, marca)
    const inteiros = perfisInteirosPorConta(eventos)
    const bytes = eventos.reduce((soma, e) => soma + e.bytes, 0)
    console.log(`catch-up after 1 change and 3 joins: ${eventos.length} events, ${bytes} bytes; whole profiles ${JSON.stringify(inteiros)}`)
    // One whole profile per person: Ana's change, and each newcomer's first one in this channel.
    expect(inteiros).toEqual({ Ana: 1, Carla: 1, Dora: 1, Eva: 1 })

    // And Bruno, catching up, ends with the latest version of each person.
    await bruno.session.connect()
    await ate(
      () =>
        bruno.vault.contents.directory[ana.address]?.payload["updatedAt"] === versaoDaAna &&
        nomeEm(bruno, carla) === "Carla" &&
        nomeEm(bruno, dora) === "Dora" &&
        nomeEm(bruno, eva) === "Eva",
      "Bruno catches up with everyone's latest profile",
    )

    // No resend, and still proof of life: the newcomer heard every member's seal
    // (the device signal on growth), so `seat` says "live" instead of re-seating.
    const ouviu = (quem: ContaDeTeste, de: ContaDeTeste): boolean => quem.vault.contents.transmitters?.[canal]?.includes(de.address) === true
    await ate(() => ouviu(eva, ana) && ouviu(eva, carla) && ouviu(eva, dora) && ouviu(eva, bruno), "Eva heard every member")
    expect(await eva.session.seat(canal, carla.address)).toBe("live")
    expect(await eva.session.seat(canal, bruno.address)).toBe("live")
  }, 180_000)

  it("a member missing a profile pulls it in a channel: the name by relay, the portrait from its owner only", async () => {
    const contas = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"], { salaComum: false })
    abertas.push(...contas)
    const [ana, bruno, carla] = contas as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    await comRetrato(contas)
    const canal = await canalComTodos(servidor, ana, [bruno, carla])
    await ate(
      () => nomeEm(bruno, ana) === "Ana" && nomeEm(bruno, carla) === "Carla" && nomeEm(carla, ana) === "Ana",
      "everyone knows everyone",
    )
    await new Promise((resolve) => setTimeout(resolve, 3_000))

    // Bruno lost Ana's profile, and has Carla's without the portrait.
    const daCarla = bruno.vault.contents.directory[carla.address]!
    delete bruno.vault.contents.directory[ana.address]
    bruno.vault.contents.directory[carla.address] = { ...daCarla, parcial: true }
    const marca = ultimoSeq(canal)
    bruno.session.pedirPerfisDe(canal, [ana.address, carla.address])

    await ate(
      () =>
        nomeEm(bruno, ana) === "Ana" &&
        bruno.vault.contents.directory[ana.address]?.parcial !== true &&
        bruno.vault.contents.directory[carla.address]?.parcial !== true,
      "Bruno has Ana's profile back and Carla's portrait",
      30_000,
    )
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const eventos = eventosDepois(canal, marca)
    const inteiros = perfisInteirosPorConta(eventos)
    console.log(`pull in a channel: ${eventos.length} events, ${eventos.reduce((s, e) => s + e.bytes, 0)} bytes; whole profiles ${JSON.stringify(inteiros)}`)
    // Ana's name came relayed and light, then her portrait from her; Carla's portrait from her.
    // Each owner once, and no other member resent anything.
    expect(inteiros).toEqual({ Ana: 1, Carla: 1 })

    // What the requests left in memory goes with a lock (N7, N-N4): disconnect, then reset, as the bridges do.
    for (const conta of [bruno, carla]) {
      expect(conta.session.pedidosDePerfisEmMemoria).toBeGreaterThan(0)
      conta.session.disconnect()
      conta.session.reset()
      expect(conta.session.pedidosDePerfisEmMemoria).toBe(0)
    }
  }, 120_000)
})
