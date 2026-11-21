import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Session } from "@enclave/client-core"
import { CAPACIDADE_MEMBROS_DO_CANAL } from "@enclave/protocol"
import {
  ate,
  ateQue,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * The member count with a real network (P7, 1.3.26).
 *
 * `membros-certos.test.ts` proves each piece. This battery proves the whole path
 * on real sockets, with the timings the app has:
 *  1. the count is right after someone enters and after someone leaves, and an
 *     account seated after the last roster is never hidden while the roster is old;
 *  2. a departure nobody committed is swept in ONE commit, and both devices of the
 *     same account (plus the other member) end with the same tree;
 *  3. a server without `membros-do-canal` (an older one): the client never asks,
 *     and shows the tree, as before.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const intervaloOriginal = Session.ROSTER_INTERVALO_MS
const validadeOriginal = Session.ROSTER_VALIDADE_MS

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  Session.ROSTER_INTERVALO_MS = intervaloOriginal
  Session.ROSTER_VALIDADE_MS = validadeOriginal
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes, { salaComum: false })
  abertas.push(...novas)
  return novas
}

/** Everybody reads everybody, so no late seat request moves the tree under the test. */
async function todosSeLeem(canal: string, gente: readonly ContaDeTeste[]): Promise<void> {
  for (const quem of gente) {
    await quem.session.send(canal, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: `olá de ${quem.nome}`, attachments: [], mentions: [], links: [] })
  }
  await ate(
    () => gente.every((leitor) => gente.every((autor) => leitor.session.history(canal).some((e) => e.payload["body"] === `olá de ${autor.nome}`))),
    "todos se lêem",
    30_000,
  )
}

/** Waits until this session has a roster for the channel (it asks on read). */
async function comRoster(quem: ContaDeTeste, canal: string): Promise<void> {
  await ateQue(async () => {
    quem.session.membrosVisiveis(canal)
    await new Promise((resolve) => setTimeout(resolve, 200))
    return quem.session.rosterConhecido(canal)
  }, `roster de ${quem.nome}`)
}

describe("the count, with a real network", () => {
  it("is right after someone enters and after someone leaves", async () => {
    const [ana, bruno, carla] = (await contas("Ana", "Bruno", "Carla")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno])
    await todosSeLeem(canal, [ana, bruno])
    await comRoster(ana, canal)
    expect(ana.session.membrosVisiveis(canal)).toEqual([ana.address, bruno.address].sort())

    // Enters: Carla is seated after Ana's roster, and the roster does not refresh
    // (the interval is long). She must count at once, not two minutes later.
    Session.ROSTER_INTERVALO_MS = 60 * 60_000
    await ana.session.seat(canal, carla.address)
    await ate(() => carla.session.channels.includes(canal), "a Carla entra", 30_000)
    await ate(() => ana.session.membersOf(canal).includes(carla.address), "a Carla na árvore da Ana")
    expect(ana.session.membrosVisiveis(canal)).toContain(carla.address)
    expect(ana.session.membrosAfastados(canal)).toEqual([])
    await todosSeLeem(canal, [ana, bruno, carla])
    for (const quem of [ana, bruno, carla]) {
      await ate(() => quem.session.membrosVisiveis(canal).length === 3, `${quem.nome} mostra três`)
    }

    // Leaves without a commit (a deleted vault): the count drops to two on both sides
    // once the roster refreshes, and the account that holds keys is named apart.
    // No commit, so the epoch does not move: without these the roster Bruno read
    // in this epoch stays good for ROSTER_VALIDADE_MS (10 min), as designed.
    Session.ROSTER_INTERVALO_MS = 0
    Session.ROSTER_VALIDADE_MS = 0
    await carla.session.forgetChannel(canal)
    await ate(() => !servidor.enclave.store.isSubscribed(canal, carla.address), "o servidor já não tem a Carla")
    for (const quem of [ana, bruno]) {
      await ateQue(async () => {
        quem.session.membrosVisiveis(canal)
        await new Promise((resolve) => setTimeout(resolve, 200))
        return quem.session.membrosVisiveis(canal).length === 2
      }, `${quem.nome} mostra duas`)
      expect(quem.session.membersOf(canal)).toContain(carla.address)
      expect(quem.session.membrosAfastados(canal)).toEqual([carla.address])
    }
  }, 120_000)

  it("sweeps a departure nobody committed in one commit, the same on both devices", async () => {
    const [ana, bruno, carla] = (await contas("Ana", "Bruno", "Carla")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const telemovel = await emparelharAparelho(ana)
    abertas.push(telemovel)
    const canal = await canalComTodos(servidor, ana, [bruno, carla])
    await ate(() => telemovel.session.channels.includes(canal), "o telemóvel da Ana no canal", 60_000)
    await todosSeLeem(canal, [ana, telemovel, bruno, carla])

    const aparelhos = [ana, telemovel, bruno]
    const epocas = new Map<ContaDeTeste, string[]>()
    for (const quem of aparelhos) {
      const lista: string[] = []
      epocas.set(quem, lista)
      quem.session.on("epoch", (evento) => {
        if (evento.channel === canal) lista.push(evento.epoch)
      })
    }

    // The state of the common room: Carla's `member.left` was heard on every device
    // (`saidasHonradas`), and nobody committed it. Then she is gone from the server.
    await carla.session.forgetChannel(canal)
    for (const quem of aparelhos) {
      await quem.vault.update((contents) => {
        contents.saidasHonradas = { ...contents.saidasHonradas, [`${canal}|${carla.address}`]: Date.now() }
      })
    }
    await ate(() => !servidor.enclave.store.isSubscribed(canal, carla.address), "o servidor já não tem a Carla")

    await ateQue(
      async () => {
        for (const quem of aparelhos) quem.session.membrosVisiveis(canal)
        await new Promise((resolve) => setTimeout(resolve, 200))
        return aparelhos.every((quem) => !quem.session.membersOf(canal).includes(carla.address))
      },
      "a folha da Carla sai em todos",
      45_000,
    )
    // One commit: every device moved exactly one epoch, to the same one.
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const finais = aparelhos.map((quem) => epocas.get(quem)!)
    for (const lista of finais) expect(new Set(lista).size).toBe(1)
    expect(new Set(finais.map((lista) => lista[0])).size).toBe(1)
    for (const quem of aparelhos) {
      expect(quem.session.membersOf(canal)).toEqual([ana.address, bruno.address].sort())
      expect(quem.session.membrosAfastados(canal)).toEqual([])
    }
  }, 180_000)

  it("against a server without membros-do-canal, the client never asks and shows the tree", async () => {
    /*
      An older server: `hello.ok` without the capability. The socket is the real one,
      only that one word is taken out of what the server says, for the sessions
      opened here.
    */
    const Original = globalThis.WebSocket
    class SemCapacidade extends Original {
      override addEventListener(tipo: string, ouvinte: EventListenerOrEventListenerObject | null, opcoes?: boolean | AddEventListenerOptions): void {
        if (tipo !== "message" || ouvinte === null) return super.addEventListener(tipo, ouvinte, opcoes)
        const chamar = (evento: MessageEvent): void => {
          let dados: unknown = evento.data
          if (typeof dados === "string" && dados.includes('"hello.ok"')) {
            const frame = JSON.parse(dados) as { t: string; capabilities?: string[] }
            if (frame.t === "hello.ok") {
              frame.capabilities = (frame.capabilities ?? []).filter((c) => c !== CAPACIDADE_MEMBROS_DO_CANAL)
              dados = JSON.stringify(frame)
            }
          }
          const copia = new MessageEvent("message", { data: dados })
          if (typeof ouvinte === "function") ouvinte.call(this, copia)
          else ouvinte.handleEvent(copia)
        }
        super.addEventListener(tipo, chamar as EventListener, opcoes)
      }
    }
    globalThis.WebSocket = SemCapacidade as typeof WebSocket
    let ana: ContaDeTeste
    let bruno: ContaDeTeste
    let carla: ContaDeTeste
    try {
      ;[ana, bruno, carla] = (await contas("Ana", "Bruno", "Carla")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    } finally {
      globalThis.WebSocket = Original
    }
    expect(ana.session.serverCapabilities).not.toContain(CAPACIDADE_MEMBROS_DO_CANAL)

    Session.ROSTER_INTERVALO_MS = 0
    const canal = await canalComTodos(servidor, ana, [bruno, carla])
    await todosSeLeem(canal, [ana, bruno, carla])
    await carla.session.forgetChannel(canal)
    await ate(() => !servidor.enclave.store.isSubscribed(canal, carla.address), "o servidor já não tem a Carla")
    for (let i = 0; i < 10; i++) {
      ana.session.membrosVisiveis(canal)
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    expect(ana.session.rosterConhecido(canal)).toBe(false)
    expect(ana.session.membrosVisiveis(canal)).toEqual(ana.session.membersOf(canal))
    expect(ana.session.membrosVisiveis(canal)).toContain(carla.address)
    expect(ana.session.membrosAfastados(canal)).toEqual([])
  }, 120_000)
})
