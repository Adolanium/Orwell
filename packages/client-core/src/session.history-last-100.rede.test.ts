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
import { entradasDoCanal, HISTORY_PAGE_LINES, TECTOS_DOS_MEMBROS } from "@enclave/client-core"

/**
 * The sync on joining brings the newest 100 lines of a channel (`HISTORY_PAGE_LINES`),
 * not its whole past (history-last-100, 1.3.26).
 *
 * Ana writes 1 000 lines in a channel with Bruno. Carla joins after them. The past
 * comes from a member (D2): on joining she receives the newest 100, and nothing more
 * comes by itself. "Load older" brings the next 100, newest first, and her place in
 * the channel does not move: everything that came sits below it.
 *
 * Each member's vault keeps its newest 400 lines (`HISTORY_MAX_PER_CHANNEL`); the rest
 * is in its archive, which D2 does not serve.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const tectos = { ...TECTOS_DOS_MEMBROS }
const LINHAS = 1_000

beforeAll(async () => {
  // Signal caps rise on the test server: the production ones would take minutes here.
  servidor = await levantarServidor({ sinal: { porMinutoPorLigacao: 100_000, bytesPorCanalPorMinuto: 1024 * 1024 * 1024 } })
  Object.assign(TECTOS_DOS_MEMBROS, {
    passoMs: 200,
    primeiraVoltaMs: 500,
    esperaDoInventarioMs: 3_000,
    esperaDaRespostaMs: 3_000,
    semRespostaMs: 2_000,
  })
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  Object.assign(TECTOS_DOS_MEMBROS, tectos)
  await servidor?.fechar()
})

function linha(n: number): Payload {
  return {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: `linha-${String(n).padStart(4, "0")}`,
    attachments: [],
    links: [],
    mentions: [],
  } as unknown as Payload
}

/** The numbers of the lines this account holds in the vault. */
function numeros(conta: ContaDeTeste, canal: string): number[] {
  return entradasDoCanal(conta.vault.contents, canal)
    .map((e) => /^linha-(\d+)$/.exec(String(e.payload["body"] ?? ""))?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b)
}

const de = (inicio: number, fim: number): number[] => Array.from({ length: fim - inicio + 1 }, (_, i) => inicio + i)

describe("history-last-100: the newest 100 lines on joining, the rest a page at a time", () => {
  it("a new account in a channel with 1 000 lines receives 100, loads 100 more, and its place stays", async () => {
    const [ana, bruno, carla] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"], { salaComum: false })
    abertas.push(ana!, bruno!, carla!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    for (let n = 1; n <= LINHAS; n++) await ana!.session.send(canal, linha(n))
    await ate(() => numeros(bruno!, canal).at(-1) === LINHAS, "o Bruno tem as 1 000", 120_000)

    const recebidas: number[] = []
    carla!.session.on("message", (m) => {
      const n = /^linha-(\d+)$/.exec(String((m.payload as { body?: unknown }).body ?? ""))?.[1]
      if (m.channel === canal && n !== undefined) recebidas.push(Number(n))
    })
    const inicio = Date.now()
    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra no canal")
    await ate(() => carla!.session.lugarEm(canal) !== null, "a Carla tem lugar")
    const lugar = carla!.session.lugarEm(canal)!.seq
    carla!.session.pedirHistoricoDosMembros()

    await ate(() => numeros(carla!, canal).length >= 100, "as 100 mais recentes chegam à Carla", 90_000)
    const aos100 = Date.now() - inicio
    // The clock goes on for a while: nothing older comes by itself.
    await new Promise((resolve) => setTimeout(resolve, 4_000))
    const naEntrada = { ...carla!.session.estatisticasDosMembros }
    expect(HISTORY_PAGE_LINES).toBe(100)
    expect(numeros(carla!, canal)).toEqual(de(LINHAS - 99, LINHAS))
    expect(carla!.session.estadoDaSincronia().find((e) => e.channel === canal)?.passado).toBe(false)
    expect(carla!.session.hasOlderFromMembers(canal)).toBe(true)

    // "Load older": the next 100, newest first, from a member online.
    const pedido = Date.now()
    const resultado = await carla!.session.loadOlderFromMembers(canal)
    const doPedido = Date.now() - pedido
    expect(resultado).toEqual({ outcome: "loaded", lines: 100 })
    await ate(() => numeros(carla!, canal).length >= 200, "as 100 seguintes chegam à Carla", 30_000)
    expect(numeros(carla!, canal)).toEqual(de(LINHAS - 199, LINHAS))
    // The second page came newest first: 900 before 801.
    const segunda = recebidas.filter((n) => n <= LINHAS - 100)
    expect(segunda[0]).toBeGreaterThan(segunda.at(-1)!)

    // The place does not move, and everything that came sits below it.
    expect(carla!.session.lugarEm(canal)!.seq).toBe(lugar)
    for (const e of entradasDoCanal(carla!.vault.contents, canal)) if (/^linha-/.test(String(e.payload["body"] ?? ""))) expect(e.seq).toBeLessThan(lugar)

    const depois = carla!.session.estatisticasDosMembros
    console.log(
      "history-last-100, Carla:",
      JSON.stringify({
        joinMs: aos100,
        joinBytes: naEntrada.bytesRecebidos,
        joinPages: naEntrada.paginasRecebidas,
        joinApplied: naEntrada.aplicados,
        loadOlderMs: doPedido,
        loadOlderBytes: depois.bytesRecebidos - naEntrada.bytesRecebidos,
        loadOlderPages: depois.paginasRecebidas - naEntrada.paginasRecebidas,
      }),
    )
  }, 300_000)

  it("with no member online, Load older says so", async () => {
    const [ana, carla] = await contasDeTeste(servidor, ["Ana", "Carla"], { salaComum: false })
    abertas.push(ana!, carla!)
    const canal = await canalComTodos(servidor, ana!, [])
    for (let n = 1; n <= 5; n++) await ana!.session.send(canal, linha(n))
    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra no canal")
    await ate(() => carla!.session.lugarEm(canal) !== null, "a Carla tem lugar")
    // Ana leaves: no member is online to give the past.
    ana!.session.disconnect()
    const resultado = await carla!.session.loadOlderFromMembers(canal)
    expect(resultado).toEqual({ outcome: "no-member", lines: 0 })
    expect(numeros(carla!, canal)).toEqual([])
  }, 120_000)
})
