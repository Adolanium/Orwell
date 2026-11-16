import type { Payload } from "@enclave/protocol"
import { Session } from "@enclave/client-core"
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
 * The common-room cascade an admin says at the end of its own recovery
 * (hotfix 1.3.14).
 *
 * Measured in production on 13/11/2026: the owner logs in, and of the 277
 * frames of that minute 199 went to the common room `!984`, most of them the
 * cascade for joins by the card that nobody covered while the owner was away
 * (`#dizerAQuemEntrou` at the end of the recovery, from 1.3.12). It went out in
 * the same seconds as the login, and the Windows app froze 3 to 4 s. It now
 * waits for the login to end, goes in pieces, and the newcomer still gets it.
 */

const TIPOS_DE_ESTADO = new Set(["room.created", "role.define", "role.assign", "channel.meta", "channel.category", "space.meta"])

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(async () => {
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

const esperar = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The state sends of this account to this channel: when, and how many frames each. */
function vigiarCascata(conta: ContaDeTeste, canal: string): { em: number; frames: number }[] {
  const envios: { em: number; frames: number }[] = []
  const original = conta.session.send.bind(conta.session)
  conta.session.send = async (channel: string, payload: Payload, opcoes?: { daPessoa?: boolean }): Promise<void> => {
    if (channel === canal && TIPOS_DE_ESTADO.has(payload.t)) envios.push({ em: Date.now(), frames: 1 })
    return original(channel, payload, opcoes)
  }
  const emLote = conta.session.sendBatch.bind(conta.session)
  conta.session.sendBatch = async (channel: string, payloads: readonly Payload[]): Promise<void> => {
    const deEstado = payloads.filter((payload) => TIPOS_DE_ESTADO.has(payload.t)).length
    if (channel === canal && deEstado > 0) envios.push({ em: Date.now(), frames: deEstado })
    return emLote(channel, payloads)
  }
  return envios
}

/** The worst lateness of a 20 ms timer from now on: the longest a click would have waited. */
function sondaDoAtraso(): { parar: () => number; piorEntre: (de: number, ate: number) => number; piores: (desde: number) => string } {
  const atrasos: [number, number][] = []
  let esperado = Date.now() + 20
  const relogio = setInterval(() => {
    const agora = Date.now()
    atrasos.push([agora, agora - esperado])
    esperado = agora + 20
  }, 20)
  return {
    parar: () => {
      clearInterval(relogio)
      return Math.max(0, ...atrasos.map(([, atraso]) => atraso))
    },
    piorEntre: (de, ate) => Math.max(0, ...atrasos.filter(([em]) => em >= de && em <= ate).map(([, atraso]) => atraso)),
    // The three worst, as "ms after `desde`: ms late", to tell the login from the cascade.
    piores: (desde) =>
      [...atrasos]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([em, atraso]) => `${em - desde}:${atraso}`)
        .join(" "),
  }
}

describe("a cascata da sala comum no login de um administrador", () => {
  it("sai depois do arranque e em pedaços, o canal fica utilizável logo, e quem entrou pelo cartão fica com o estado", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const comum = servidor.sala
    await ana!.session.ensureCommonRoom()
    await ate(() => ana!.session.channels.includes(comum), "a Ana está na sala comum", 30_000)
    if (!ana!.session.founderOf(comum)) await ana!.session.claimFounder(comum)
    await ate(() => ana!.session.founderOf(comum) === ana!.address, "a Ana funda a sala comum")
    await ana!.session.updateSpaceMeta(comum, { name: "Praça", topic: "a sala de todos" })
    await ana!.session.defineRole(comum, { role: "guarda", name: "Guarda", powers: ["convidar"] })
    await ana!.session.upsertCategory(comum, { category: "Adega", position: 1 })
    for (let i = 0; i < 6; i++) await ana!.session.upsertRoom(comum, { room: `sala-${i}`, name: `sala ${i}`, category: "Adega" })
    // Many role assignments, as in `!984`: past the real members they go to addresses with no account.
    const atribuicoes: Payload[] = []
    for (let i = 0; i < 100; i++) {
      atribuicoes.push({ t: "role.assign", subject: `@sem-conta-${i}:${servidor.casa}`, roles: ["guarda"], assignedAt: Date.now() + i })
    }
    await ana!.session.sendBatch(comum, atribuicoes)
    await bruno!.session.ensureCommonRoom()
    await ate(() => bruno!.session.channels.includes(comum), "o Bruno entra", 30_000)
    await ate(() => servidor.enclave.store.hasGroupInfo(comum), "o cartão está no servidor", 30_000)
    await esperar(2_000)

    // Ana away; Eva joins by the card with no admin online.
    ana!.session.disconnect()
    await esperar(500)
    const [eva] = await contasDeTeste(servidor, ["Eva"])
    abertas.push(eva!)
    await eva!.session.ensureCommonRoom()
    await ate(() => eva!.session.channels.includes(comum), "a Eva entra pelo cartão", 30_000)
    await esperar(1_500)
    expect(eva!.session.founderOf(comum)).toBeNull()

    // Ana logs in.
    const cascata = vigiarCascata(ana!, comum)
    const sonda = sondaDoAtraso()
    const inicio = Date.now()
    await ana!.session.connect()
    await ate(() => !ana!.session.aRecuperar(comum), "a Ana recupera a sala comum", 30_000)
    const recuperou = Date.now()
    // The room is usable: a message from the person goes out at once, before any cascade.
    await ana!.session.send(comum, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: "bom dia", attachments: [], links: [], mentions: [] }, { daPessoa: true })
    const mensagemSaiu = Date.now()
    expect(cascata).toEqual([])

    await ate(() => eva!.session.founderOf(comum) === ana!.address, "a Eva sabe quem fundou", 40_000)
    await ate(() => eva!.session.spaceMeta(comum)?.name === "Praça", "a Eva vê o nome", 30_000)
    await ate(() => eva!.session.roomsOf(comum).length === ana!.session.roomsOf(comum).length, "a Eva vê as salas", 30_000)
    await ate(() => eva!.session.rolesOf(comum).some((papel) => papel.role === "guarda"), "a Eva conhece o cargo", 30_000)
    const fim = Date.now()
    const piorAtraso = sonda.parar()

    const primeiro = cascata[0]!.em
    // The cascade's own window. The login before it is measured in the browser (`scripts/medir-sala-carregada.mjs`):
    // here three sessions and the server share one Node process, and Eva's own work lands in the same timer.
    const piorNaCascata = sonda.piorEntre(primeiro, fim)
    const frames = cascata.reduce((soma, envio) => soma + envio.frames, 0)
    const maiorPedaco = Math.max(...cascata.map((envio) => envio.frames))
    console.log(
      `login: ${recuperou - inicio} ms até a sala estar recuperada, a mensagem saiu em ${mensagemSaiu - recuperou} ms; ` +
        `a cascata começou ${primeiro - recuperou} ms depois, ${frames} tramas em ${cascata.length} envios (maior: ${maiorPedaco}); ` +
        `pior espera de um clique: ${piorNaCascata} ms na cascata, ${piorAtraso} ms em todo o login (piores, ms depois da recuperação:atraso: ${sonda.piores(recuperou)})`,
    )
    expect(primeiro - recuperou).toBeGreaterThanOrEqual(Session.ARRUMACAO_DEPOIS_DO_ARRANQUE_MS - 200)
    expect(maiorPedaco).toBeLessThanOrEqual(Session.PEDACO_DA_CASCATA)
    expect(frames).toBeGreaterThan(Session.PEDACO_DA_CASCATA)
    expect(mensagemSaiu - recuperou).toBeLessThan(2_000)
    expect(piorNaCascata).toBeLessThan(200)
    expect(ana!.session.estatisticasDaArrumacao.cascatas).toBeGreaterThanOrEqual(1)
    expect(ana!.session.estatisticasDaArrumacao.cascatas).toBeLessThanOrEqual(2)
  }, 180_000)

  it("se outro administrador a disser durante a espera, esta app não a diz", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const comum = servidor.sala
    await ana!.session.ensureCommonRoom()
    await ate(() => ana!.session.channels.includes(comum), "a Ana está na sala comum", 30_000)
    if (!ana!.session.founderOf(comum)) await ana!.session.claimFounder(comum)
    await ate(() => ana!.session.founderOf(comum) === ana!.address, "a Ana funda a sala comum")
    await ana!.session.upsertCategory(comum, { category: "Adega", position: 1 })
    await ana!.session.upsertRoom(comum, { room: "prensa", name: "prensa", category: "Adega" })
    await bruno!.session.ensureCommonRoom()
    await ate(() => bruno!.session.channels.includes(comum), "o Bruno entra", 30_000)
    await ana!.session.assignRoles(comum, bruno!.address, ["admin"])
    await ate(() => bruno!.session.mayEditChannel(comum), "o Bruno manda", 30_000)
    await ate(() => servidor.enclave.store.hasGroupInfo(comum), "o cartão está no servidor", 30_000)
    await esperar(2_000)

    ana!.session.disconnect()
    bruno!.session.disconnect()
    await esperar(500)
    const [eva] = await contasDeTeste(servidor, ["Eva"])
    abertas.push(eva!)
    await eva!.session.ensureCommonRoom()
    await ate(() => eva!.session.channels.includes(comum), "a Eva entra pelo cartão, sozinha", 30_000)
    await esperar(1_500)

    // Both come back; Bruno's turn is in the same window as Ana's wait.
    const cascataDaAna = vigiarCascata(ana!, comum)
    await ana!.session.connect()
    await ate(() => !ana!.session.aRecuperar(comum), "a Ana recupera", 30_000)
    await bruno!.session.connect()
    await ate(() => !bruno!.session.aRecuperar(comum), "o Bruno recupera", 30_000)
    // Bruno says it now, inside Ana's wait (what a 1.3.10 admin or a quicker device does).
    await bruno!.session.republishAuthority(comum)
    await bruno!.session.republishRooms(comum)
    await esperar(Session.ARRUMACAO_DEPOIS_DO_ARRANQUE_MS + Session.ARRUMACAO_OCIOSA_TECTO_MS + 2_000)
    expect(cascataDaAna).toEqual([])
    expect(ana!.session.estatisticasDaArrumacao.cascatas).toBe(0)
  }, 180_000)
})
