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
 * A recovery writes the vault once per channel, not once per page (12/11/2026).
 *
 * A recording of the owner's Safari during a slow start (3 to 10 minutes):
 * almost all the CPU was `Vault.update`, the whole vault as JSON, ciphered and
 * put in IndexedDB, 0.5 to 1 s each, once per page of 100 events, with the
 * thread idle in between while IndexedDB finished the write.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const eventos = Session.EVENTOS_POR_PAGINA

beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(async () => {
  Session.EVENTOS_POR_PAGINA = eventos
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

describe("gravações do cofre na recuperação", () => {
  it("a recuperação não grava o cofre inteiro a cada página (12/11/2026)", async () => {
    // A recording of the owner's Safari: almost all the CPU of the slow start
    // was `Vault.update` (JSON of the whole vault, cipher, IndexedDB), once per
    // page of the recovery, 0.5 to 1 s each on a big vault.
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    bruno!.session.disconnect()
    const N = 60
    for (let i = 0; i < N; i++) {
      await ana!.session.send(canal, { t: "message", id: `m-pagina-${i}`, sentAt: Date.now(), body: `pagina-${i}`, attachments: [], mentions: [], links: [] })
    }
    // Twelve pages of five.
    Session.EVENTOS_POR_PAGINA = 5
    const antes = bruno!.backend.escritas
    await bruno!.session.connect()
    const textos = (): number =>
      (bruno!.vault.contents.history[canal] ?? []).filter((m) => String((m.payload as { body?: unknown }).body ?? "").startsWith("pagina-")).length
    await ate(() => textos() === N, "o Bruno lê as 60", 30_000)
    await bruno!.vault.gravarAdiada()
    const escritas = bruno!.backend.escritas - antes
    console.log(`gravações do cofre numa recuperação de 12 páginas: ${escritas}`)
    // Measured: 18 before (one per page, plus the connection's own), 6 after: the
    // connection's own sends (they must write before they leave) and one at the end.
    expect(escritas).toBeLessThanOrEqual(6)
    // And what reached the disk is the whole recovery: the anchor of the last event.
    expect(bruno!.vault.contents.lastSeq[canal]).toBeGreaterThan(N)
  }, 90_000)

  it("quatro canais em paralelo com muito atraso não batem no tecto de histórico do servidor", async () => {
    // Since the catch-up runs four channels at once (1.3.8), the pages per minute
    // per account reach the server's history cap sooner, and above it the server
    // answers nothing: the page wait dies after 10 s and the channel is cut.
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canais: string[] = []
    for (let c = 0; c < 4; c++) canais.push(await canalComTodos(servidor, ana!, [bruno!]))
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    bruno!.session.disconnect()
    const POR_CANAL = 100
    await Promise.all(
      canais.map(async (canal, c) => {
        for (let i = 0; i < POR_CANAL; i++) {
          await ana!.session.send(canal, { t: "message", id: `m-tecto-${c}-${i}`, sentAt: Date.now(), body: `tecto-${c}-${i}`, attachments: [], mentions: [], links: [] })
        }
      }),
    )
    // 4 channels × 25 pages of 4: 100 pages, above 60 a minute.
    Session.EVENTOS_POR_PAGINA = 4
    const partiu = Date.now()
    await bruno!.session.connect()
    const lidas = (canal: string): number =>
      (bruno!.vault.contents.history[canal] ?? []).filter((m) => String((m.payload as { body?: unknown }).body ?? "").startsWith("tecto-")).length
    await ate(() => canais.every((canal) => lidas(canal) === POR_CANAL), "o Bruno lê os quatro canais inteiros na mesma ligação", 30_000)
    console.log(`quatro canais, 100 páginas: tudo lido em ${Date.now() - partiu} ms`)
  }, 180_000)

  it("numa recuperação lenta, o cofre também não se grava de 1,5 em 1,5 s (revisão do 1.3.8, achado 6)", async () => {
    // The 12-page test above ends in under 1.5 s on localhost, so it never saw the
    // `flush` timer (`FLUSH_MS`) write the whole vault in the middle of a recovery.
    // Here every history page arrives 400 ms late: a recovery of ~5 s, as on a phone.
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    bruno!.session.disconnect()
    const N = 60
    for (let i = 0; i < N; i++) {
      await ana!.session.send(canal, { t: "message", id: `m-lenta-${i}`, sentAt: Date.now(), body: `lenta-${i}`, attachments: [], mentions: [], links: [] })
    }
    Session.EVENTOS_POR_PAGINA = 5
    const Original = globalThis.WebSocket
    class Lenta extends Original {
      override addEventListener(tipo: string, ouvinte: unknown, opcoes?: unknown): void {
        if (tipo !== "message" || typeof ouvinte !== "function") return super.addEventListener(tipo as "message", ouvinte as never, opcoes as never)
        const atrasado = (evento: MessageEvent): void => {
          const pagina = typeof evento.data === "string" && evento.data.includes('"t":"channel.backfill.page"')
          if (pagina) setTimeout(() => (ouvinte as (e: MessageEvent) => void).call(this, evento), 400)
          else (ouvinte as (e: MessageEvent) => void).call(this, evento)
        }
        super.addEventListener("message", atrasado as never, opcoes as never)
      }
    }
    globalThis.WebSocket = Lenta as typeof WebSocket
    try {
      const antes = bruno!.backend.escritas
      const partiu = Date.now()
      await bruno!.session.connect()
      const lidas = (): number =>
        (bruno!.vault.contents.history[canal] ?? []).filter((m) => String((m.payload as { body?: unknown }).body ?? "").startsWith("lenta-")).length
      await ate(() => lidas() === N, "o Bruno lê as 60", 60_000)
      const duracao = Date.now() - partiu
      await bruno!.vault.gravarAdiada()
      const escritas = bruno!.backend.escritas - antes
      console.log(`recuperação lenta de ${duracao} ms: ${escritas} gravações do cofre`)
      expect(duracao).toBeGreaterThan(3_000)
      // The connection's own (about 5) and the end of the channel: none per 1.5 s.
      expect(escritas).toBeLessThanOrEqual(6)
    } finally {
      globalThis.WebSocket = Original
    }
  }, 120_000)

  it("uma mensagem escrita durante uma recuperação longa espera por ela e sai na epoch certa (revisão do 1.3.8, achado 5)", async () => {
    // The wait had a 10 s cap. A message written in the first seconds after
    // opening went out in whatever epoch the recovery had reached and, with the
    // channel three commits ahead, nobody could read it.
    const [ana, bruno, ...outras] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla", "Dora", "Eva"])
    abertas.push(ana!, bruno!, ...outras)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    bruno!.session.disconnect()
    for (let i = 0; i < 40; i++) {
      await ana!.session.send(canal, { t: "message", id: `m-antes-${i}`, sentAt: Date.now(), body: `antes-${i}`, attachments: [], mentions: [], links: [] })
    }
    // Three commits at the end of what Bruno has to read.
    for (const outra of outras) {
      await ana!.session.seat(canal, outra.address)
      await ate(() => outra.session.channels.includes(canal), `${outra.nome} entra`, 30_000)
    }
    Session.EVENTOS_POR_PAGINA = 2
    const Original = globalThis.WebSocket
    class Lenta extends Original {
      override addEventListener(tipo: string, ouvinte: unknown, opcoes?: unknown): void {
        if (tipo !== "message" || typeof ouvinte !== "function") return super.addEventListener(tipo as "message", ouvinte as never, opcoes as never)
        const atrasado = (evento: MessageEvent): void => {
          const pagina = typeof evento.data === "string" && evento.data.includes('"t":"channel.backfill.page"')
          if (pagina) setTimeout(() => (ouvinte as (e: MessageEvent) => void).call(this, evento), 600)
          else (ouvinte as (e: MessageEvent) => void).call(this, evento)
        }
        super.addEventListener("message", atrasado as never, opcoes as never)
      }
    }
    globalThis.WebSocket = Lenta as typeof WebSocket
    try {
      const ligacao = bruno!.session.connect()
      await ate(() => bruno!.session.aRecuperar(canal), "a recuperação do canal começa", 30_000, 10)
      // The person writes at once, as the app is already on screen.
      const envio = bruno!.session.send(canal, { t: "message", id: "m-escrita-cedo", sentAt: Date.now(), body: "escrita cedo", attachments: [], mentions: [], links: [] }, { daPessoa: true })
      // It goes out only after the channel caught up, and never in an epoch the room already left.
      let aRecuperarQuandoSaiu: boolean | null = null
      void envio.then(() => (aRecuperarQuandoSaiu = bruno!.session.aRecuperar(canal)))
      await ligacao
      await envio
      expect(aRecuperarQuandoSaiu).toBe(false)
      await ate(
        () => (ana!.vault.contents.history[canal] ?? []).some((m) => (m.payload as { id?: string }).id === "m-escrita-cedo"),
        "a Ana lê a mensagem escrita durante a recuperação",
        30_000,
      )
    } finally {
      globalThis.WebSocket = Original
    }
  }, 180_000)

  it("uma reacção da pessoa durante uma recuperação longa também espera por ela (re-revisão, R2)", async () => {
    // Only the message and the edit waited; a reaction from the interface went
    // out at once, in whatever epoch the recovery had reached.
    const [ana, bruno, ...outras] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla", "Dora", "Eva"])
    abertas.push(ana!, bruno!, ...outras)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.send(canal, { t: "message", id: "m-alvo-da-reaccao", sentAt: Date.now(), body: "alvo", attachments: [], mentions: [], links: [] })
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    bruno!.session.disconnect()
    for (let i = 0; i < 40; i++) {
      await ana!.session.send(canal, { t: "message", id: `m-r-antes-${i}`, sentAt: Date.now(), body: `r-antes-${i}`, attachments: [], mentions: [], links: [] })
    }
    for (const outra of outras) {
      await ana!.session.seat(canal, outra.address)
      await ate(() => outra.session.channels.includes(canal), `${outra.nome} entra`, 30_000)
    }
    Session.EVENTOS_POR_PAGINA = 2
    const Original = globalThis.WebSocket
    class Lenta extends Original {
      override addEventListener(tipo: string, ouvinte: unknown, opcoes?: unknown): void {
        if (tipo !== "message" || typeof ouvinte !== "function") return super.addEventListener(tipo as "message", ouvinte as never, opcoes as never)
        const atrasado = (evento: MessageEvent): void => {
          const pagina = typeof evento.data === "string" && evento.data.includes('"t":"channel.backfill.page"')
          if (pagina) setTimeout(() => (ouvinte as (e: MessageEvent) => void).call(this, evento), 600)
          else (ouvinte as (e: MessageEvent) => void).call(this, evento)
        }
        super.addEventListener("message", atrasado as never, opcoes as never)
      }
    }
    globalThis.WebSocket = Lenta as typeof WebSocket
    try {
      const ligacao = bruno!.session.connect()
      await ate(() => bruno!.session.aRecuperar(canal), "a recuperação do canal começa", 30_000, 10)
      let aRecuperarQuandoSaiu: boolean | null = null
      const reaccao = bruno!.session.reactToPost(canal, "m-alvo-da-reaccao", "+1").then(() => (aRecuperarQuandoSaiu = bruno!.session.aRecuperar(canal)))
      await ligacao
      await reaccao
      expect(aRecuperarQuandoSaiu).toBe(false)
    } finally {
      globalThis.WebSocket = Original
    }
  }, 180_000)
})
