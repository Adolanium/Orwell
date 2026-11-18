import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { mensagemAEnviar } from "./mensagemAEnviar.js"
// The harness server, for real, on an ephemeral port.
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  recarregar,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
// From `dist`, like the harness sessions.
import { dobrarVotos, entradasDoCanal, TECTOS_DO_ESTADO, type VaultContents } from "@enclave/client-core"

/**
 * Poll votes stay remembered, between real clients (17/11/2026).
 *
 * Ana and Bruno vote; the vote survives a reload, reaches Ana's second device as
 * hers, and reaches Bruno. Then the channel gets busy like the common room, with
 * more chat reactions than the ledger's "gosto" cap: before, the votes left the
 * vault with the oldest reactions and the poll came back empty after a reload.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

const VOTACAO = "votacao-do-bruno-0001"
const votosEm = (contents: VaultContents, canal: string): Map<string, number> =>
  dobrarVotos(entradasDoCanal(contents, canal)).get(VOTACAO) ?? new Map()

describe("os votos ficam memorizados, entre clientes reais", () => {
  it("sobrevivem a recarregar, chegam ao outro aparelho e à outra conta, e ao tráfego de uma sala comum", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    await ate(() => telemovel.session.channels.includes(canal), "o telemóvel da Ana entra no canal", 30_000)

    await bruno!.session.send(
      canal,
      mensagemAEnviar("Pizza ou sushi?", undefined, { poll: { question: "Pizza ou sushi?", options: ["Pizza", "Sushi"] } } as never, {
        id: VOTACAO,
        sentAt: Date.now(),
      }),
    )
    await ate(() => entradasDoCanal(ana!.vault.contents, canal).some((e) => e.payload["id"] === VOTACAO), "a Ana recebe a votação", 30_000)

    await ana!.session.voteOnPoll(canal, VOTACAO, 0)
    // She changes her mind: the latest vote is the one that counts.
    await ana!.session.voteOnPoll(canal, VOTACAO, 1)
    await bruno!.session.voteOnPoll(canal, VOTACAO, 0)

    const esperado = new Map([
      [ana!.address, 1],
      [bruno!.address, 0],
    ])
    for (const conta of [ana!, bruno!, telemovel]) {
      await ate(() => votosEm(conta.vault.contents, canal).size === 2 && votosEm(conta.vault.contents, canal).get(ana!.address) === 1, `${conta.nome} vê os dois votos`, 30_000)
      expect(votosEm(conta.vault.contents, canal)).toEqual(esperado)
    }

    // A reload: the votes come back from the disk.
    const anaRecarregada = await recarregar(ana!)
    expect(votosEm(anaRecarregada.vault.contents, canal)).toEqual(esperado)

    // A busy channel: more chat reactions than the "gosto" cap, after the votes.
    const ALVOS = 40
    for (let i = 0; i < ALVOS; i++) {
      await bruno!.session.send(canal, mensagemAEnviar(`m${i}`, undefined, undefined, { id: `alvo-mensagem-${i}`, sentAt: Date.now() }))
    }
    const reaccoes = TECTOS_DO_ESTADO.gosto + 100
    for (let i = 0; i < reaccoes; i++) {
      await bruno!.session.reactToMessage(canal, `alvo-mensagem-${i % ALVOS}`, "👍", Math.floor(i / ALVOS) % 2 === 1)
    }
    const naAna = (): number => entradasDoCanal(ana!.vault.contents, canal).filter((e) => e.payload.t === "reaction").length
    await ate(() => naAna() >= TECTOS_DO_ESTADO.gosto - 100, "a Ana recebe as reacções", 600_000, 500)
    await ate(() => entradasDoCanal(ana!.vault.contents, canal).length > 0 && naAna() >= TECTOS_DO_ESTADO.gosto - 2, "o livro da Ana enche", 120_000, 500)
    // The poll is still in the conversation: only reactions and 40 messages came after it.
    expect(entradasDoCanal(ana!.vault.contents, canal).some((e) => e.payload["id"] === VOTACAO)).toBe(true)

    for (const conta of [ana!, bruno!]) {
      const recarregada = await recarregar(conta)
      expect(votosEm(recarregada.vault.contents, canal)).toEqual(esperado)
    }
  }, 900_000)
})
