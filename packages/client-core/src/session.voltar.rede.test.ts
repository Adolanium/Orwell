import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
// The server harness's server, for real, on an ephemeral port, with its accounts.
// The sessions are this package's, from `dist`: the core is what is measured.
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { Session } from "@enclave/client-core"

/**
 * Coming back to the foreground (1.3.15).
 *
 * The Windows app froze for about 5 s when restored from minimized. The
 * return runs the catch-up (`retomar`: the sync pass, the history between
 * devices, a check of the socket), and the interface calls it twice
 * (`visibilitychange` and `focus`). Each vault write is the whole vault,
 * encrypted on the main thread: a catch-up that writes many times is that long.
 *
 * What is pinned: a return, with its two calls and the periodic sync that was
 * overdue, writes the vault at most once; the overdue tick joins the pass that
 * is running instead of queueing a second whole pass; and the session counts
 * its vault writes and late timers for the diagnostic log.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const sincroniaAntes = Session.SINCRONIA_AO_VOLTAR_MS
const relogioAntes = Session.SINCRONIA_MS

beforeAll(async () => {
  servidor = await levantarServidor()
})
afterEach(() => {
  desligarContas(abertas.splice(0))
  Session.SINCRONIA_AO_VOLTAR_MS = sincroniaAntes
  Session.SINCRONIA_MS = relogioAntes
})
afterAll(async () => {
  await servidor.fechar()
})

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  abertas.push(...novas)
  return novas
}

/** Waits until no vault write happened for `quietoMs`, and returns how many happened. */
async function escritasAteAssentar(conta: ContaDeTeste, desde: number, quietoMs = 1_500): Promise<number> {
  let ultima = conta.backend.escritas
  let paradoDesde = Date.now()
  await ate(() => {
    if (conta.backend.escritas !== ultima) {
      ultima = conta.backend.escritas
      paradoDesde = Date.now()
    }
    return Date.now() - paradoDesde >= quietoMs
  }, "o cofre assenta", 30_000)
  return conta.backend.escritas - desde
}

describe("voltar ao primeiro plano", { timeout: 60_000 }, () => {
  it("a volta, com as duas chamadas da interface, grava o cofre no máximo uma vez", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canais = [
      await canalComTodos(servidor, ana!, [bruno!]),
      await canalComTodos(servidor, ana!, [bruno!]),
      await canalComTodos(servidor, ana!, [bruno!]),
    ]
    // While the window was minimized: messages arrive, and the vault takes them.
    for (let i = 0; i < 10; i++) {
      for (const canal of canais) await ana!.session.send(canal, { t: "message", id: `m-${canal}-${i}`, sentAt: Date.now(), body: `olá ${i}` })
    }
    await ate(
      () => canais.every((canal) => (bruno!.vault.contents.history[canal] ?? []).filter((e) => e.payload.t === "message").length >= 10),
      "o Bruno recebe tudo",
    )
    await bruno!.session.flush()
    await escritasAteAssentar(bruno!, bruno!.backend.escritas)

    // The return after a long absence: the sync pass is due.
    Session.SINCRONIA_AO_VOLTAR_MS = 0
    const antes = bruno!.backend.escritas
    bruno!.session.retomar({ escondidaMs: 10 * 60_000 })
    bruno!.session.retomar({ escondidaMs: 0 })
    const escritas = await escritasAteAssentar(bruno!, antes)
    console.info(`[voltar] ${escritas} gravações do cofre`)

    expect(escritas).toBeLessThanOrEqual(1)
  })

  it("o relógio da sincronia que dispara durante a passagem da volta junta-se a ela: uma passagem, e não duas", async () => {
    // A clock that ticks four times while the pass runs: what a throttled page does on the return.
    Session.SINCRONIA_MS = 250
    const [ana, bruno] = await contas("Ana", "Bruno")
    await canalComTodos(servidor, ana!, [bruno!])
    const sessao = bruno!.session
    const real = sessao.syncFriendships.bind(sessao)
    let passagens = 0
    vi.spyOn(sessao, "syncFriendships").mockImplementation(async () => {
      passagens++
      await new Promise((r) => setTimeout(r, 1_000))
      await real()
    })
    // Whatever pass the connection started is over.
    await sessao.sincronizarAgora()
    passagens = 0

    await sessao.sincronizarAgora()

    expect(passagens).toBe(1)
  })

  it("a sessão conta as gravações do cofre e os temporizadores atrasados, para o registo de diagnóstico", async () => {
    Session.SINCRONIA_MS = 200
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const antes = bruno!.session.diagnostico()
    const escritasAntes = bruno!.backend.escritas
    await ana!.session.send(canal, { t: "message", id: "m-contar", sentAt: Date.now(), body: "olá" })
    await ate(() => (bruno!.vault.contents.history[canal] ?? []).some((e) => e.payload.t === "message"), "chega")
    await bruno!.session.flush()
    // A thread held for 1.5 s: the sync clock fires more than a second late.
    const ate1500 = Date.now() + 1_500
    while (Date.now() < ate1500) {
      // busy
    }
    await new Promise((r) => setTimeout(r, 300))
    const depois = bruno!.session.diagnostico()

    expect(depois.gravacoesDoCofre - antes.gravacoesDoCofre).toBe(bruno!.backend.escritas - escritasAntes)
    expect(depois.gravacoesDoCofre).toBeGreaterThan(antes.gravacoesDoCofre)
    expect(depois.temporizadoresAtrasados).toBeGreaterThan(antes.temporizadoresAtrasados)
    expect(depois.maiorAtrasoMs).toBeGreaterThan(1_000)
  })
})
