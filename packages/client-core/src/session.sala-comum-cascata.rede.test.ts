import type { Payload } from "@enclave/protocol"
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
 * One account joins the common room: how many sends does that cost the room?
 *
 * Measured in production on 12/11/2026, the day ~200 accounts joined `!984`
 * (409 members): every external commit was followed, within the same minute,
 * by 220 to 280 application events. Each online member republished its
 * profile (and the rest of the growth cascade) to the whole room, so a join
 * cost O(online members) sends and a wave of joins cost O(N²). Every member
 * then decrypts, applies and renders every one of them, and every send writes
 * the whole vault before it leaves, in the same per-channel queue that the
 * person's own message waits in. That is the "one minute delay".
 *
 * The newcomer by card asks for the names it lacks (`#pedirPerfisNaSalaComum`):
 * one relay answers with the signed profiles. So in the common room the
 * per-member republication is pure repetition.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

// One server per test: each one counts the members of the common room from zero.
beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(async () => {
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

/** Sends from this account to this channel, by type, from now on. */
function contarEnvios(conta: ContaDeTeste, canal: string): Map<string, number> {
  const contagem = new Map<string, number>()
  const original = conta.session.send.bind(conta.session)
  conta.session.send = async (channel: string, payload: Payload): Promise<void> => {
    if (channel === canal) contagem.set(payload.t, (contagem.get(payload.t) ?? 0) + 1)
    return original(channel, payload)
  }
  const emLote = conta.session.sendBatch.bind(conta.session)
  conta.session.sendBatch = async (channel: string, payloads: readonly Payload[]): Promise<void> => {
    if (channel === canal) for (const payload of payloads) contagem.set(payload.t, (contagem.get(payload.t) ?? 0) + 1)
    return emLote(channel, payloads)
  }
  return contagem
}

const soma = (mapas: Map<string, number>[], tipo: string): number => mapas.reduce((total, mapa) => total + (mapa.get(tipo) ?? 0), 0)

describe("sala comum: o custo de uma entrada", () => {
  it("quem já lá está não republica o perfil a cada entrada, e quem entra fica a saber os nomes", async () => {
    const MEMBROS = 8
    const nomes = Array.from({ length: MEMBROS }, (_, i) => `Membro${i + 1}`)
    const membros = await contasDeTeste(servidor, nomes, { salaComum: true })
    abertas.push(...membros)
    const sala = servidor.sala
    for (const membro of membros) {
      await ate(() => membro.session.channels.includes(sala), `${membro.nome} está na sala comum`, 30_000)
    }
    await ate(() => membros.every((membro) => membro.session.membersOf(sala).length === MEMBROS), "todos se vêem", 30_000)
    // Let the joins of the members settle: their own cascades are not what we measure.
    await new Promise((resolve) => setTimeout(resolve, 8_000))

    const envios = membros.map((membro) => contarEnvios(membro, sala))
    const [novo] = await contasDeTeste(servidor, ["Novata"], { salaComum: true })
    abertas.push(novo!)
    await ate(() => novo!.session.channels.includes(sala), "a Novata entra na sala comum", 30_000)
    await ate(() => membros.every((membro) => membro.session.membersOf(sala).length === MEMBROS + 1), "todos vêem a Novata", 30_000)
    // The cascade, the room shuffle and the profile request all fire within ~10 s.
    await new Promise((resolve) => setTimeout(resolve, 15_000))

    const perfis = soma(envios, "profile")
    const total = envios.reduce((t, mapa) => t + [...mapa.values()].reduce((a, b) => a + b, 0), 0)
    console.log(`entrada na sala comum com ${MEMBROS} membros ligados: ${total} envios dos membros, ${perfis} perfis`, envios.map((m) => Object.fromEntries(m)))

    // And the newcomer still learns every name (the request in the common room).
    await ate(
      () => membros.every((membro) => novo!.vault.contents.directory[membro.address]?.payload["displayName"] === membro.nome),
      "a Novata sabe o nome de todos",
      30_000,
    )
    /*
      Not one per member any more (8 before). The member that relays cannot relay
      itself and says its own profile; on a loaded machine a member whose relay
      came after its short wait says its own too. Measured: 1 alone, 2 in the
      full suite.
    */
    expect(perfis).toBeLessThanOrEqual(2)
  }, 180_000)

  it("depois de uma entrada, só quem entrou publica o cartão da sala, e quem vem a seguir entra com ele", async () => {
    const MEMBROS = 6
    const membros = await contasDeTeste(servidor, Array.from({ length: MEMBROS }, (_, i) => `Membro${i + 1}`), { salaComum: true })
    abertas.push(...membros)
    const sala = servidor.sala
    for (const membro of membros) await ate(() => membro.session.channels.includes(sala), `${membro.nome} está na sala comum`, 30_000)
    await ate(() => membros.every((membro) => membro.session.membersOf(sala).length === MEMBROS), "todos se vêem", 30_000)
    await new Promise((resolve) => setTimeout(resolve, 5_000))

    const store = servidor.enclave.store
    const original = store.putGroupInfo.bind(store)
    let cartoes = 0
    store.putGroupInfo = (channel: string, info: Uint8Array) => {
      if (channel === sala) cartoes += 1
      return original(channel, info)
    }
    const [novo] = await contasDeTeste(servidor, ["Novata"], { salaComum: true })
    abertas.push(novo!)
    await ate(() => membros.every((membro) => membro.session.membersOf(sala).length === MEMBROS + 1), "todos vêem a Novata", 30_000)
    // Past `CARTAO_ATRASO_MS` on every member, with room to spare.
    await new Promise((resolve) => setTimeout(resolve, 6_000))
    console.log(`cartões publicados depois de uma entrada com ${MEMBROS} membros ligados: ${cartoes}`)
    expect(cartoes).toBe(1)

    // And the card left is good: the next account enters by it.
    const [outra] = await contasDeTeste(servidor, ["Outra"], { salaComum: true })
    abertas.push(outra!)
    await ate(() => outra!.session.channels.includes(sala), "a Outra entra na sala comum", 30_000)
    await ate(() => membros.every((membro) => membro.session.membersOf(sala).length === MEMBROS + 2), "todos vêem a Outra", 30_000)
  }, 180_000)

  it("quem entra fica a saber os nomes todos, mesmo com mais de 100 contas sem nome (revisão do 1.3.8, achado 1)", async () => {
    // The `pp` request carries at most `PERFIS_POR_PEDIDO` (100) accounts. With
    // the growth cascade gone, the next request only left on the ten-minute
    // pass: 300 people "Sem nome" in a room of 409.
    //
    // Since 1.3.9 the login request asks only for those online; the names of the
    // others are asked for when someone needs them (`pedirPerfisDe`: the full
    // member list, a message on screen). Here all 104 are offline, so the full
    // list asks for them, and the second hundred goes a minute later.
    const MEMBROS = Number(process.env["MEMBROS_DO_TESTE"] ?? 104)
    const [ana] = await contasDeTeste(servidor, ["Ana"], { salaComum: true })
    abertas.push(ana!)
    const sala = servidor.sala
    await ate(() => ana!.session.channels.includes(sala), "a Ana está na sala comum", 30_000)
    const membros: ContaDeTeste[] = []
    for (let i = 0; i < MEMBROS; i++) {
      const [membro] = await contasDeTeste(servidor, [`Membro${String(i).padStart(3, "0")}`], { salaComum: true })
      await ate(() => membro!.session.channels.includes(sala), `${membro!.nome} entra`, 60_000)
      await ate(() => ana!.vault.contents.directory[membro!.address]?.payload["displayName"] === membro!.nome, `a Ana sabe o nome de ${membro!.nome}`, 60_000)
      membro!.session.disconnect()
      membros.push(membro!)
    }
    const [novo] = await contasDeTeste(servidor, ["Novata"], { salaComum: true })
    abertas.push(novo!)
    await ate(() => novo!.session.channels.includes(sala), "a Novata entra", 60_000)
    await ate(() => novo!.session.membersOf(sala).length >= MEMBROS + 2, "a Novata vê os membros todos", 60_000)
    // Ana, the only one online to answer, must already count the Novata as a
    // member: a request from a leaf she does not know yet is dropped.
    await ate(() => ana!.session.membersOf(sala).includes(novo!.address), "a Ana vê a Novata", 60_000)
    novo!.session.pedirPerfisDe(sala, membros.map((m) => m.address))
    const comNome = (): number => membros.filter((m) => novo!.vault.contents.directory[m.address]?.payload["displayName"] === m.nome).length
    // One request, then the next a minute later: well inside three minutes.
    // The label is read once, before the wait: the count goes in the error, after it.
    await ate(() => comNome() === MEMBROS, `a Novata sabe os ${MEMBROS} nomes`, 180_000, 500).catch((erro: Error) => {
      throw new Error(`${erro.message} (sabe ${comNome()})`)
    })
  }, 900_000)

  it("quem entra pede só os nomes de quem está ligado; os outros, quando alguém precisa deles", async () => {
    const [ana, bruno, carla] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])
    abertas.push(ana!, bruno!, carla!)
    const sala = servidor.sala
    for (const membro of [ana!, bruno!, carla!]) await ate(() => membro.session.channels.includes(sala), `${membro.nome} está na sala comum`, 30_000)
    await ate(() => [ana!, bruno!].every((m) => m.vault.contents.directory[carla!.address]?.payload["displayName"] === "Carla"), "todos sabem o nome da Carla", 30_000)
    carla!.session.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 3_000))

    const [novo] = await contasDeTeste(servidor, ["Novata"])
    abertas.push(novo!)
    const nomeDe = (conta: ContaDeTeste): unknown => novo!.vault.contents.directory[conta.address]?.payload["displayName"]
    await ate(() => nomeDe(ana!) === "Ana" && nomeDe(bruno!) === "Bruno", "a Novata sabe os nomes de quem está ligado", 40_000)
    // Past the login request and its relay turns: Carla, offline, was not asked for.
    await new Promise((resolve) => setTimeout(resolve, 15_000))
    expect(nomeDe(carla!)).toBeUndefined()

    // Someone needs her name now (the full list, a message on screen): it comes.
    novo!.session.pedirPerfisDe(sala, [carla!.address])
    await ate(() => nomeDe(carla!) === "Carla", "a Novata sabe o nome da Carla, a pedido", 90_000)
  }, 240_000)
})
