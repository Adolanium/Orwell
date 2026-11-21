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
// The built package, like the harness: its sessions are the ones whose clocks the test sets.
import { CAPACIDADE_PEDE_PERFIS, Session } from "@enclave/client-core"

/**
 * Each guard on the F10 answer, on its own (third security review, N3-N1 and N3-S2),
 * against a real server. Only Bruno has a portrait, so each whole profile in the
 * channel is one of his answers.
 *
 * - the end of a catch-up: newcomers of three joins read in one catch-up, one answer;
 * - the membership marker: two newcomers of the same growth, one answer;
 * - `perfilPublicadoPara` and the daily cap: the same account again after a growth;
 * - the per-account cap: the same account again, with the other two guards undone.
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

function publicacoesDoBruno(canal: string, desde: number): number {
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

const esperar = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const pedirF10 = (conta: ContaDeTeste, canal: string): Promise<void> =>
  conta.session.send(canal, { t: "typing", until: 0, capacidades: [CAPACIDADE_PEDE_PERFIS] })

/** Ana founds a channel with Bruno (portrait, repair round spent, daily cap spent), and these accounts to join later. */
async function preparar(nomes: readonly string[]): Promise<{ ana: ContaDeTeste; bruno: ContaDeTeste; outras: ContaDeTeste[]; canal: string }> {
  const contas = await contasDeTeste(servidor, ["Ana", "Bruno", ...nomes], { salaComum: false })
  abertas.push(...contas)
  const [ana, bruno, ...outras] = contas as [ContaDeTeste, ContaDeTeste, ...ContaDeTeste[]]
  await bruno.session.updateProfile({ displayName: "Bruno", donations: [], avatarDataUrl: retrato() })
  await bruno.session.publicarPerfilPendente()
  const canal = await canalComTodos(servidor, ana, [bruno])
  await ate(() => bruno.vault.contents.publishedProfileAt[canal] === bruno.session.profile.updatedAt, "Bruno published here")
  // Once per device, the profile repair round forces a publish on connection: spent here.
  bruno.session.disconnect()
  await bruno.session.connect()
  await ate(() => bruno.vault.contents.profileRepairRound !== undefined, "Bruno's repair round is done")
  await esperar(1_500)
  bruno.vault.contents.perfisDadosEm = { [canal]: Date.now() }
  return { ana, bruno, outras, canal }
}

async function entrar(ana: ContaDeTeste, canal: string, conta: ContaDeTeste): Promise<void> {
  await ana.session.seat(canal, conta.address)
  await ate(() => conta.session.channels.includes(canal), `${conta.nome} joins`)
  await esperar(1_000)
}

describe("each guard on the F10 answer (N3-N1, N3-S2)", () => {
  it("three newcomer accounts joined in three commits while Bruno was away: one answer at the end of his catch-up", async () => {
    const { ana, bruno, outras, canal } = await preparar(["Carla", "Dora", "Eva"])
    bruno.session.disconnect()
    const marca = ultimoSeq(canal)
    for (const conta of outras) {
      await entrar(ana, canal, conta)
      await pedirF10(conta, canal)
    }
    Session.PEDIDO_DE_PERFIS_MS = 0
    await bruno.session.connect()
    await ate(() => publicacoesDoBruno(canal, marca) >= 1, "Bruno answers", 20_000)
    await esperar(4_000)
    expect(publicacoesDoBruno(canal, marca)).toBe(1)
  }, 240_000)

  it("the membership marker: two newcomers of the same growth, live, one answer", async () => {
    const { ana, bruno, outras, canal } = await preparar(["Carla", "Dora"])
    for (const conta of outras) await entrar(ana, canal, conta)
    Session.PEDIDO_DE_PERFIS_MS = 0
    const marca = ultimoSeq(canal)
    // Together, so the second reaches Bruno while his first answer is still in flight:
    // only the marker stands between them then (the record changes after the send).
    await Promise.all(outras.map((conta) => pedirF10(conta, canal)))
    await ate(() => publicacoesDoBruno(canal, marca) >= 1, "Bruno answers", 20_000)
    await esperar(3_000)
    expect(publicacoesDoBruno(canal, marca)).toBe(1)
    void bruno
  }, 240_000)

  it("perfilPublicadoPara and the daily cap: the same account again after a growth gets no second answer", async () => {
    const { ana, bruno, outras, canal } = await preparar(["Carla", "Dora"])
    const [carla, dora] = outras as [ContaDeTeste, ContaDeTeste]
    await entrar(ana, canal, carla)
    Session.PEDIDO_DE_PERFIS_MS = 0
    const marca = ultimoSeq(canal)
    await pedirF10(carla, canal)
    await ate(() => publicacoesDoBruno(canal, marca) === 1, "Bruno answers Carla", 20_000)
    await ate(() => bruno.vault.contents.perfilPublicadoPara?.[canal]?.includes(carla.address) === true, "Carla is recorded")
    // A growth moves the marker; Carla asks again.
    await entrar(ana, canal, dora)
    await pedirF10(carla, canal)
    await esperar(3_000)
    expect(publicacoesDoBruno(canal, marca)).toBe(1)
  }, 240_000)

  it("the per-account cap: the same account again, with the record and the daily cap undone", async () => {
    const { ana, bruno, outras, canal } = await preparar(["Carla", "Dora"])
    const [carla, dora] = outras as [ContaDeTeste, ContaDeTeste]
    await entrar(ana, canal, carla)
    const marca = ultimoSeq(canal)
    await pedirF10(carla, canal)
    await ate(() => publicacoesDoBruno(canal, marca) === 1, "Bruno answers Carla", 20_000)
    await entrar(ana, canal, dora)
    // Only the per-account cap is left: Carla out of the record again, the daily cap forgotten.
    bruno.vault.contents.perfilPublicadoPara = { [canal]: [ana.address, bruno.address, dora.address] }
    delete bruno.vault.contents.perfisDadosEm?.[canal]
    await pedirF10(carla, canal)
    await esperar(3_000)
    expect(publicacoesDoBruno(canal, marca)).toBe(1)
  }, 240_000)
})
