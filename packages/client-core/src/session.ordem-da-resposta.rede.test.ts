import type { Payload } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { mensagemAEnviar } from "./mensagemAEnviar.js"
import type { ReceivedMessage } from "./session.js"
import { entradasDoCanal, type VaultContents } from "./vault.js"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  recarregar,
  type ContaDeTeste,
  type ServidorDeTeste,
  levantarServidor,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * A quick reply keeps server order, between real clients (ordem-resposta, 20/11/2026).
 *
 * The exact race (the question numbered first reaches this device after our reply)
 * is in `session.ordem-da-resposta.test.ts`, with a fake server. Here, on the real
 * server: a reply sent from inside the `message` handler (well under 1 s), with the
 * asker's clock 30 s off either way, and both sending at the same instant, ten
 * times. Each vault, and each vault after a reload, must list the conversation in
 * ascending `seq`, and both must agree.
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

type Mensagem = Extract<Payload, { t: "message" }>

/** The harness hands out the built `Vault`: only its contents are read here. */
type Cofre = { contents: VaultContents }

function ditas(vault: Cofre, canal: string): { id: string; seq: number }[] {
  return entradasDoCanal(vault.contents, canal)
    .filter((entrada) => entrada.payload.t === "message")
    .map((entrada) => ({ id: String(entrada.payload["id"]), seq: entrada.seq }))
}

function confirmadas(vault: Cofre, canal: string, ids: readonly string[]): boolean {
  const lista = ditas(vault, canal)
  return ids.every((id) => lista.some((dita) => dita.id === id && dita.seq >= 0))
}

function emOrdem(vault: Cofre, canal: string): void {
  const seqs = ditas(vault, canal).map((dita) => dita.seq)
  expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
}

describe("a resposta rápida fica pela ordem do servidor, entre dois clientes", () => {
  it.each([30_000, -30_000])("resposta dentro do evento, relógio de quem pergunta desviado %i ms", async (desvio) => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const PERGUNTA = `pergunta-${desvio}`
    const RESPOSTA = `resposta-${desvio}`
    bruno!.session.on("message", (evento: ReceivedMessage) => {
      if (evento.channel !== canal || (evento.payload as Mensagem).id !== PERGUNTA) return
      void bruno!.session.send(canal, mensagemAEnviar("Sim.", undefined, undefined, { id: RESPOSTA, sentAt: Date.now() }))
    })
    await ana!.session.send(canal, mensagemAEnviar("Vens?", undefined, undefined, { id: PERGUNTA, sentAt: Date.now() + desvio }))
    await ate(() => confirmadas(bruno!.vault, canal, [PERGUNTA, RESPOSTA]), "o Bruno tem as duas com seq", 30_000)
    await ate(() => confirmadas(ana!.vault, canal, [PERGUNTA, RESPOSTA]), "a Ana tem as duas com seq", 30_000)
    const ordemDoBruno = ditas(bruno!.vault, canal).map((dita) => dita.id)
    expect(ordemDoBruno.indexOf(PERGUNTA)).toBeLessThan(ordemDoBruno.indexOf(RESPOSTA))
    emOrdem(bruno!.vault, canal)
    emOrdem(ana!.vault, canal)
    const reaberto = await recarregar(bruno!)
    expect(ditas(reaberto.vault, canal).map((dita) => dita.id)).toEqual(ordemDoBruno)
  }, 120_000)

  it("os dois enviam no mesmo instante, dez vezes: cada cofre fica pela ordem do servidor", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const ids: string[] = []
    for (let volta = 0; volta < 10; volta++) {
      const daAna = `ana-volta-${volta}`
      const doBruno = `bruno-volta-${volta}`
      ids.push(daAna, doBruno)
      await Promise.all([
        ana!.session.send(canal, mensagemAEnviar("a", undefined, undefined, { id: daAna, sentAt: Date.now() })),
        bruno!.session.send(canal, mensagemAEnviar("b", undefined, undefined, { id: doBruno, sentAt: Date.now() })),
      ])
    }
    await ate(() => confirmadas(ana!.vault, canal, ids) && confirmadas(bruno!.vault, canal, ids), "as vinte com seq nos dois", 60_000)
    emOrdem(ana!.vault, canal)
    emOrdem(bruno!.vault, canal)
    expect(ditas(bruno!.vault, canal)).toEqual(ditas(ana!.vault, canal))
    const reaberto = await recarregar(bruno!)
    expect(ditas(reaberto.vault, canal)).toEqual(ditas(ana!.vault, canal))
  }, 180_000)
})
