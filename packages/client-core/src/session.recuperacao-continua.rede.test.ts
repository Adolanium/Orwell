import { afterEach, beforeEach, describe, expect, it } from "vitest"
// The harness builds sessions from the package (dist), so the statics are set there.
import { Session } from "@enclave/client-core"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * A long backlog is read in the same connection, pass after pass (12/11/2026).
 *
 * A recovery pass reads at most `PAGINAS_POR_PASSAGEM` pages, and what was left
 * waited for the next connection. On 10/11 the common room had 53 437 events in
 * one day: someone a day away needed ~13 connections to reach the present, and
 * in the meantime every live frame was from an epoch it had not read.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const paginas = Session.PAGINAS_POR_PASSAGEM
const eventos = Session.EVENTOS_POR_PAGINA

beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(async () => {
  Session.PAGINAS_POR_PASSAGEM = paginas
  Session.EVENTOS_POR_PAGINA = eventos
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

describe("recuperação em várias passagens", () => {
  it("quem volta lê tudo o que ficou para trás na mesma ligação, mesmo acima do que cabe numa passagem", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    bruno!.session.disconnect()
    const N = 30
    for (let i = 0; i < N; i++) {
      await ana!.session.send(canal, { t: "message", id: `m-atrasada-${i}`, sentAt: Date.now(), body: `atrasada-${i}`, attachments: [], mentions: [], links: [] })
    }
    // One pass reads 2 pages of 5: a third of what is waiting.
    Session.PAGINAS_POR_PASSAGEM = 2
    Session.EVENTOS_POR_PAGINA = 5
    await bruno!.session.connect()
    const textos = (): string[] =>
      (bruno!.vault.contents.history[canal] ?? []).map((m) => String((m.payload as { body?: unknown }).body ?? "")).filter((t) => t.startsWith("atrasada-"))
    await ate(() => textos().length === N, "o Bruno lê as 30 na mesma ligação", 30_000)
    expect(new Set(textos()).size).toBe(N)
  }, 90_000)
})
