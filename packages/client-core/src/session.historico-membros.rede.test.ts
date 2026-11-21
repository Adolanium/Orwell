import type { Payload } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  type ContaDeTeste,
  type ServidorDeTeste,
  levantarServidor,
} from "../../../apps/server/testes/cliente-de-teste.js"
// From `dist`, like the sessions of the harness: the caps that come down are theirs.
import { _membrosParaTestes, entradasDoCanal, TECTOS_DOS_MEMBROS } from "@enclave/client-core"

/**
 * A channel's past, served by other members (D2, 20/11/2026).
 *
 * An account that joins late reads what was said before it joined, except the
 * rooms it may not see. One member answers, device to device, over the
 * channel's ephemeral signals; the newcomer checks every item as anti-entropy
 * does (authorship, device, tombstone).
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const tectos = { ...TECTOS_DOS_MEMBROS }

beforeAll(async () => {
  // Signal caps rise on the test server: the production ones would take minutes here.
  servidor = await levantarServidor({ sinal: { porMinutoPorLigacao: 100_000, bytesPorCanalPorMinuto: 1024 * 1024 * 1024 } })
  Object.assign(TECTOS_DOS_MEMBROS, {
    passoMs: 200,
    primeiraVoltaMs: 500,
    esperaDoInventarioMs: 3_000,
    esperaDaRespostaMs: 3_000,
    semRespostaMs: 2_000,
    // Small pages and buckets: the past comes in many, and the cursor has to work.
    itensPorPagina: 3,
    seqPorBalde: 8,
  })
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
  _membrosParaTestes.adulterarPagina = null
  _membrosParaTestes.primeiro = null
})

afterAll(async () => {
  Object.assign(TECTOS_DOS_MEMBROS, tectos)
  await servidor?.fechar()
})

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes, { salaComum: false })
  abertas.push(...novas)
  return novas
}

function mensagem(corpo: string, sala?: string): Payload {
  return {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: corpo,
    ...(sala ? { room: sala } : {}),
    attachments: [],
    links: [],
    mentions: [],
  } as unknown as Payload
}

const TODAS_ANTES = Array.from({ length: 8 }, (_, i) => `antes-${i + 1}`)

/** The message bodies as the screen shows them: a message its author deleted is gone. */
function corpos(conta: ContaDeTeste, canal: string): string[] {
  const entradas = conta.session.history(canal)
  const apagadas = new Set(
    entradas.filter((e) => e.payload.t === "redact").map((e) => `${String(e.sender)}|${String(e.payload["target"])}`),
  )
  return entradas
    .filter((e) => e.payload.t === "message" && !apagadas.has(`${String(e.sender)}|${String(e.payload["id"])}`))
    .map((e) => String(e.payload["body"] ?? ""))
}

const temLapide = (conta: ContaDeTeste, canal: string, alvo: string): boolean =>
  entradasDoCanal(conta.vault.contents, canal).some((e) => e.payload.t === "redact" && e.payload["target"] === alvo)

/** A channel with a past: Ana and Bruno talk, a closed room, a deleted message. Then Carla joins. */
async function canalComPassado(ana: ContaDeTeste, bruno: ContaDeTeste): Promise<{ canal: string; apagada: string }> {
  const canal = await canalComTodos(servidor, ana, [bruno])
  await ana.session.upsertCategory(canal, { category: "Direccao", roles: ["chefe"] })
  await ana.session.upsertRoom(canal, { room: "secreta", name: "secreta", category: "Direccao" })
  for (let i = 1; i <= 8; i++) await ana.session.send(canal, mensagem(`antes-${i}`))
  await bruno.session.send(canal, mensagem("do-bruno"))
  await ana.session.send(canal, mensagem("segredo", "secreta"))
  const apagar = mensagem("apagada")
  const apagadaId = (apagar as { id: string }).id
  await ana.session.send(canal, apagar)
  await ate(() => entradasDoCanal(bruno.vault.contents, canal).some((e) => e.payload["id"] === apagadaId), "a apagada chega ao Bruno")
  await ana.session.deleteMessage(canal, apagadaId)
  await ate(
    () => corpos(bruno, canal).includes("segredo") && corpos(bruno, canal).includes("antes-8") && temLapide(bruno, canal, apagadaId),
    "o Bruno tem o passado",
  ).catch((erro: unknown) => {
    console.log("Bruno vê:", JSON.stringify(corpos(bruno, canal)), "Ana vê:", JSON.stringify(corpos(ana, canal)))
    throw erro
  })
  await ate(() => corpos(ana, canal).includes("do-bruno"), "a Ana tem a do Bruno")
  return { canal, apagada: apagadaId }
}

async function entrar(ana: ContaDeTeste, carla: ContaDeTeste, canal: string): Promise<void> {
  await ana.session.seat(canal, carla.address)
  await ate(() => carla.session.channels.includes(canal), "a Carla entra no canal")
  await ate(() => carla.session.lugarEm(canal) !== null, "a Carla tem lugar")
  carla.session.pedirHistoricoDosMembros()
}

describe("o passado de um canal, servido pelos membros", () => {
  it("quem entrou depois lê o passado, sem a sala fechada e sem a apagada", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const { canal, apagada } = await canalComPassado(ana!, bruno!)
    expect(corpos(carla!, canal)).toEqual([])
    // The "syncing" marker: only while the past is arriving.
    const aSincronizar: boolean[] = []
    carla!.session.on("sincronia", (estado) => {
      if (estado.channel === canal) aSincronizar.push(estado.passado === true)
    })
    await entrar(ana!, carla!, canal)

    await ate(
      () => [...TODAS_ANTES, "do-bruno"].every((corpo) => corpos(carla!, canal).includes(corpo)),
      "o passado chega à Carla",
      90_000,
    )
    const vistas = corpos(carla!, canal)
    for (let i = 1; i <= 8; i++) expect(vistas).toContain(`antes-${i}`)
    // The closed room: Carla has no role, and whoever answered knows it.
    expect(vistas).not.toContain("segredo")
    expect(entradasDoCanal(carla!.vault.contents, canal).some((e) => e.payload["body"] === "segredo")).toBe(false)
    // The deleted one never comes back, and its tombstone comes.
    expect(vistas).not.toContain("apagada")
    expect(entradasDoCanal(carla!.vault.contents, canal).some((e) => e.payload["body"] === "apagada")).toBe(false)
    await ate(() => temLapide(carla!, canal, apagada), "a lápide chega à Carla")
    // The past is placed before the seat.
    const lugar = carla!.session.lugarEm(canal)!.seq
    const doPassado = entradasDoCanal(carla!.vault.contents, canal).filter((e) => String(e.payload["body"] ?? "").startsWith("antes-"))
    for (const entrada of doPassado) expect(entrada.seq).toBeLessThan(lugar)
    expect(aSincronizar).toContain(true)
    await ate(() => carla!.session.estadoDaSincronia().find((e) => e.channel === canal)?.passado === false, "o marcador sai quando nada falta")
    const estatisticas = carla!.session.estatisticasDosMembros
    console.log("Carla, D2:", JSON.stringify(estatisticas))
    expect(estatisticas.paginasRecebidas).toBeGreaterThan(1)

    // Asking again brings nothing twice.
    const antes = entradasDoCanal(carla!.vault.contents, canal).length
    carla!.session.pedirHistoricoDosMembros()
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    expect(entradasDoCanal(carla!.vault.contents, canal).length).toBe(antes)
  }, 180_000)

  it("quem tem o cargo da sala fechada recebe-a", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const { canal } = await canalComPassado(ana!, bruno!)
    await ana!.session.defineRole(canal, { role: "chefe", name: "Chefe", powers: [] })
    await ana!.session.assignRoles(canal, carla!.address, ["chefe"])
    await ate(() => bruno!.session.rolesFor(canal, carla!.address).includes("chefe"), "o Bruno sabe o cargo da Carla")
    await entrar(ana!, carla!, canal)
    await ate(() => corpos(carla!, canal).includes("segredo"), "a sala fechada chega a quem tem o cargo", 90_000)
  }, 180_000)

  it("uma mensagem forjada por quem responde é recusada", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const { canal } = await canalComPassado(ana!, bruno!)
    _membrosParaTestes.adulterarPagina = (_canal, itens) =>
      itens.map((item) => (item.p["body"] === "antes-3" ? { ...item, p: { ...item.p, body: "forjada" } } : item))
    await entrar(ana!, carla!, canal)
    await ate(() => TODAS_ANTES.filter((corpo) => corpo !== "antes-3").every((corpo) => corpos(carla!, canal).includes(corpo)), "o resto do passado chega", 90_000)
    await ate(() => (carla!.session.estatisticasDosMembros.recusados["autoria"] ?? 0) > 0, "a forjada é recusada")
    expect(corpos(carla!, canal)).not.toContain("forjada")
    expect(corpos(carla!, canal)).not.toContain("antes-3")
  }, 180_000)

  it("quem entrou depois recebe as votações, o fecho e os votos, mesmo de quem está desligado", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const votacao = (pergunta: string): Payload =>
      ({ ...mensagem(`${pergunta}\n1. Sim\n2. Não`), poll: { question: pergunta, options: ["Sim", "Não"] } }) as unknown as Payload
    const aberta = votacao("Aberta?")
    const fechada = votacao("Fechada?")
    const abertaId = (aberta as { id: string }).id
    const fechadaId = (fechada as { id: string }).id
    await ana!.session.send(canal, aberta)
    await ana!.session.send(canal, fechada)
    await ate(() => [abertaId, fechadaId].every((id) => corpos(bruno!, canal).some((c) => c.startsWith(id === abertaId ? "Aberta?" : "Fechada?"))), "o Bruno tem as votações")
    await ana!.session.voteOnPoll(canal, abertaId, 0)
    await bruno!.session.voteOnPoll(canal, abertaId, 1)
    await bruno!.session.voteOnPoll(canal, fechadaId, 0)
    await ana!.session.editMessage(canal, fechadaId, String((fechada as { body: string }).body), { closePoll: true })
    const votosEm = (conta: ContaDeTeste, alvo: string): Map<string, number> =>
      new Map(
        entradasDoCanal(conta.vault.contents, canal)
          .filter((e) => e.payload.t === "post.reaction" && e.payload["target"] === alvo && typeof e.payload["vote"] === "number")
          .map((e) => [String(e.sender), Number(e.payload["vote"])]),
      )
    const fecho = (conta: ContaDeTeste): boolean =>
      entradasDoCanal(conta.vault.contents, canal).some(
        (e) => e.payload.t === "edit" && e.payload["target"] === fechadaId && e.payload["closePoll"] === true && String(e.sender) === ana!.address,
      )
    await ate(() => votosEm(ana!, abertaId).size === 2 && votosEm(ana!, fechadaId).size === 1 && fecho(bruno!), "a Ana tem os votos e o Bruno o fecho")

    // Bruno, a voter, goes away: his votes can only come from another member's vault.
    desligarContas([bruno!])
    await entrar(ana!, carla!, canal)

    await ate(
      () => {
        const temAsVotacoes = carla!.session.history(canal).filter((e) => e.payload["poll"] !== undefined).length === 2
        return temAsVotacoes && fecho(carla!) && votosEm(carla!, abertaId).size === 2 && votosEm(carla!, fechadaId).size === 1
      },
      "as votações, o fecho e os votos chegam à Carla",
      90_000,
    ).catch((erro: unknown) => {
      console.log("Carla tem:", JSON.stringify(entradasDoCanal(carla!.vault.contents, canal).map((e) => [e.payload.t, String(e.sender).slice(0, 12), e.seq])))
      throw erro
    })
    // Each vote under its own author, as it was cast.
    expect(votosEm(carla!, abertaId)).toEqual(new Map([[ana!.address, 0], [bruno!.address, 1]]))
    expect(votosEm(carla!, fechadaId)).toEqual(new Map([[bruno!.address, 0]]))
    // The polls are read as polls (their author holds `votacoes`), placed before the seat.
    const lugar = carla!.session.lugarEm(canal)!.seq
    for (const id of [abertaId, fechadaId]) {
      const entrada = entradasDoCanal(carla!.vault.contents, canal).find((e) => e.payload.t === "message" && e.payload["id"] === id)
      expect(entrada?.semVotacao).toBeUndefined()
      expect(entrada!.seq).toBeLessThan(lugar)
    }
  }, 180_000)

  it("um membro calado não pára nada: outro membro responde", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const { canal } = await canalComPassado(ana!, bruno!)
    // Ana answers nothing (like a client before D2), and is the one asked first.
    ana!.session.historicoDosMembrosLigado = false
    _membrosParaTestes.primeiro = ana!.address
    await entrar(ana!, carla!, canal)
    await ate(() => TODAS_ANTES.every((corpo) => corpos(carla!, canal).includes(corpo)), "o Bruno dá o passado", 90_000)
    expect(carla!.session.estatisticasDosMembros.semResposta).toBeGreaterThanOrEqual(1)
    expect(ana!.session.estatisticasDosMembros.sessoesServidas).toBe(0)
    expect(bruno!.session.estatisticasDosMembros.paginasServidas).toBeGreaterThan(0)
  }, 180_000)
})

/**
 * A channel with many connections, with the production signal caps (21/11/2026).
 * Before `para` reached the server, every page went to every connection in the
 * channel, and the server counted its bytes times all of them.
 */
describe("o passado numa sala com muitas ligações", () => {
  it("chega com os tectos de produção do servidor", async () => {
    const grande = await levantarServidor()
    const todas: ContaDeTeste[] = []
    try {
      const nomes = Array.from({ length: 24 }, (_, i) => `Membro${i}`)
      const [ana, carla, ...outros] = await contasDeTeste(grande, ["Ana", "Carla", ...nomes], { salaComum: false })
      todas.push(ana!, carla!, ...outros)
      const canal = await canalComTodos(grande, ana!, outros)
      for (let i = 1; i <= 8; i++) await ana!.session.send(canal, mensagem(`antes-${i}`))
      await ate(() => outros.every((o) => corpos(o, canal).includes("antes-8")), "todos têm o passado", 120_000)
      const inicio = Date.now()
      await ana!.session.seat(canal, carla!.address)
      await ate(() => carla!.session.channels.includes(canal), "a Carla entra", 60_000)
      await ate(() => carla!.session.lugarEm(canal) !== null, "a Carla tem lugar")
      carla!.session.pedirHistoricoDosMembros()
      await ate(() => TODAS_ANTES.every((corpo) => corpos(carla!, canal).includes(corpo)), "o passado chega à Carla", 120_000)
      const servidas = [ana!, ...outros].reduce((soma, o) => soma + o.session.estatisticasDosMembros.paginasServidas, 0)
      console.log(`sala com ${outros.length + 2} ligações: passado em ${Date.now() - inicio} ms, ${servidas} páginas servidas`, JSON.stringify(carla!.session.estatisticasDosMembros))
    } finally {
      desligarContas(todas)
      await grande.fechar()
    }
  }, 600_000)
})

/**
 * The common room (21/11/2026): the channel every account can join, by its card,
 * with no invite. A new account gets what was said there before it joined.
 */
describe("o passado da sala comum", () => {
  it("uma conta nova recebe o passado da sala comum", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const comum = servidor.sala
    await ana!.session.ensureCommonRoom()
    await ate(() => ana!.session.channels.includes(comum), "a Ana está na sala comum", 30_000)
    await bruno!.session.ensureCommonRoom()
    await ate(() => bruno!.session.channels.includes(comum), "o Bruno entra na sala comum", 30_000)
    const antes = Array.from({ length: 6 }, (_, i) => `comum-${i + 1}`)
    for (const corpo of antes) await ana!.session.send(comum, mensagem(corpo))
    await bruno!.session.send(comum, mensagem("comum-do-bruno"))
    await ate(() => [...antes].every((c) => corpos(bruno!, comum).includes(c)), "o Bruno tem o passado da sala comum")
    await ate(() => corpos(ana!, comum).includes("comum-do-bruno"), "a Ana tem a do Bruno")

    // Carla registers now, and joins the common room by its card.
    const [carla] = await contasDeTeste(servidor, ["Carla"])
    abertas.push(carla!)
    await carla!.session.ensureCommonRoom()
    await ate(() => carla!.session.channels.includes(comum), "a Carla entra na sala comum", 30_000)
    await ate(() => carla!.session.lugarEm(comum) !== null, "a Carla tem lugar na sala comum")
    expect(corpos(carla!, comum).filter((c) => c.startsWith("comum-"))).toEqual([])
    carla!.session.pedirHistoricoDosMembros()

    await ate(
      () => [...antes, "comum-do-bruno"].every((c) => corpos(carla!, comum).includes(c)),
      "o passado da sala comum chega à Carla",
      90_000,
    ).catch((erro: unknown) => {
      console.log("Carla vê:", JSON.stringify(corpos(carla!, comum)), JSON.stringify(carla!.session.estatisticasDosMembros))
      throw erro
    })
    const lugar = carla!.session.lugarEm(comum)!.seq
    for (const entrada of entradasDoCanal(carla!.vault.contents, comum).filter((e) => String(e.payload["body"] ?? "").startsWith("comum-"))) {
      expect(entrada.seq).toBeLessThan(lugar)
    }
    const estatisticas = carla!.session.estatisticasDosMembros
    console.log("Carla, sala comum, D2:", JSON.stringify(estatisticas))
    expect(estatisticas.paginasRecebidas).toBeGreaterThan(0)
  }, 180_000)
})
