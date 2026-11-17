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
const pausa = Session.PAUSA_ENTRE_PASSAGENS_MS

beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(async () => {
  Session.PAGINAS_POR_PASSAGEM = paginas
  Session.EVENTOS_POR_PAGINA = eventos
  Session.PAUSA_ENTRE_PASSAGENS_MS = pausa
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

  /*
    Between two passes the gate is open, and a live frame used to move the
    anchor over everything the next pass had still to read: that pass started
    after the live frame, and what lay between was never asked for again. In
    session.conversa-longa.rede, three live frames in the 2 s pause put the
    anchor from 8 006 to 11 012, and 273 of the 1 000 messages never came.
  */
  it("uma mensagem ao vivo entre duas passagens não faz saltar o que falta ler", async () => {
    const [ana, bruno, carla] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])
    abertas.push(ana!, bruno!, carla!)
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    bruno!.session.disconnect()
    const N = 30
    for (let i = 0; i < N; i++) {
      await ana!.session.send(canal, { t: "message", id: `m-atrasada-${i}`, sentAt: Date.now(), body: `atrasada-${i}`, attachments: [], mentions: [], links: [] })
    }
    // Ana leaves: nobody can hand Bruno what his recovery skips, only the server's backlog.
    ana!.session.disconnect()
    // One pass reads 2 pages of 5, and the next one waits long enough for a live message to land between them.
    Session.PAGINAS_POR_PASSAGEM = 2
    Session.EVENTOS_POR_PAGINA = 5
    Session.PAUSA_ENTRE_PASSAGENS_MS = 3_000
    const textos = (): string[] =>
      (bruno!.vault.contents.history[canal] ?? []).map((m) => String((m.payload as { body?: unknown }).body ?? "")).filter((t) => t.startsWith("atrasada-") || t === "ao-vivo")
    await bruno!.session.connect()
    await ate(() => textos().length > 0, "a primeira passagem do Bruno", 30_000, 20)
    await carla!.session.send(canal, { t: "message", id: "m-ao-vivo", sentAt: Date.now(), body: "ao-vivo", attachments: [], mentions: [], links: [] })
    await ate(() => textos().includes("ao-vivo"), "a mensagem ao vivo chega", 30_000)
    await ate(() => textos().length === N + 1, "o Bruno lê as 30 e a de agora", 30_000)
    expect(new Set(textos()).size).toBe(N + 1)
  }, 90_000)
})
