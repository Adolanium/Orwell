import { randomBytes } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
// The built package, like the harness: its sessions are the ones whose clocks the test sets.
import { CAPACIDADE_PEDE_PERFIS, Session } from "@enclave/client-core"

/**
 * F10 answers to a newcomer are idempotent (second security review, N-B1), against
 * a real server.
 *
 * A newcomer our profile never reached is answered past the daily cap (S1). Without
 * a guard before the publish, each F10 signal read in one catch-up was one more
 * whole profile (~124 KB with the portrait, kept 30 days), from every member. Now
 * one answer per channel and epoch, and one per requesting account.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const antes = Session.PEDIDO_DE_PERFIS_MS
const RETRATO = 30_000
const retrato = (): string => `data:image/png;base64,${Buffer.from(randomBytes(RETRATO)).toString("base64")}`

beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(async () => {
  desligarContas(abertas.splice(0))
  Session.PEDIDO_DE_PERFIS_MS = antes
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

describe("F10 answers to a newcomer are idempotent (N-B1)", () => {
  it("twenty F10 signals from a newcomer with three devices, read in one catch-up, give one whole profile", async () => {
    const contas = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"], { salaComum: false })
    abertas.push(...contas)
    const [ana, bruno, carla] = contas as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const segundo = await emparelharAparelho(carla, "Carla (2)")
    const terceiro = await emparelharAparelho(carla, "Carla (3)")
    abertas.push(segundo, terceiro)
    // Only Bruno has a portrait: each whole profile in the channel is his.
    await bruno.session.updateProfile({ displayName: "Bruno", donations: [], avatarDataUrl: retrato() })
    await bruno.session.publicarPerfilPendente()
    const canal = await canalComTodos(servidor, ana, [bruno])
    await ate(() => bruno.vault.contents.publishedProfileAt[canal] === bruno.session.profile.updatedAt, "Bruno published here")
    // Once per device, the profile repair round forces a publish on connection: spent here, before the measure.
    bruno.session.disconnect()
    await bruno.session.connect()
    await ate(() => bruno.vault.contents.profileRepairRound !== undefined, "Bruno's repair round is done")
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    bruno.session.disconnect()
    // Bruno answered today: only the newcomer path (past the daily cap) can make him publish.
    bruno.vault.contents.perfisDadosEm = { [canal]: Date.now() }

    await ana.session.seat(canal, carla.address)
    const aparelhos = [carla, segundo, terceiro]
    await ate(() => aparelhos.every((aparelho) => aparelho.session.channels.includes(canal)), "Carla's three devices join")
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    // Ana leaves, so only Bruno could answer; then twenty F10 signals, from three devices.
    ana.session.disconnect()
    const marca = ultimoSeq(canal)
    for (let i = 0; i < 20; i++) {
      const aparelho = aparelhos[i % 3]!
      await aparelho.session.send(canal, { t: "typing", until: 0, capacidades: [CAPACIDADE_PEDE_PERFIS] })
    }
    for (const aparelho of aparelhos) await aparelho.session.flush()

    Session.PEDIDO_DE_PERFIS_MS = 0
    await bruno.session.connect()
    await ate(() => perfisInteiros(canal, marca) >= 1, "Bruno answers", 20_000)
    await new Promise((resolve) => setTimeout(resolve, 4_000))
    const publicados = perfisInteiros(canal, marca)
    console.log(`twenty F10 signals from three devices: ${publicados} whole profiles from Bruno`)
    expect(publicados).toBe(1)
    expect(bruno.vault.contents.perfilPublicadoPara?.[canal]).toContain(carla.address)
  }, 240_000)
})
