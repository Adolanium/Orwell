import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Session } from "@enclave/client-core"
import { CAPACIDADE_MEMBROS_DO_CANAL, generateIdentity } from "@enclave/protocol"
import {
  Cliente,
  ate,
  ateQue,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * The member count of a channel, against what is true (P7 of 20/11/2026).
 *
 * The report: "the number of users in a community does not match". The count
 * came from the ratchet tree alone, and the tree keeps the leaf of an account
 * that stopped tracking the channel without a `member.left` committed by
 * anybody. In the common room: 765 accounts in the tree, 735 subscribed.
 *
 * What these tests measure:
 *  1. the cause, with real accounts: a forgotten channel leaves the leaf, and
 *     the tree counts it on every device;
 *  2. the fix for the count: the list the app shows leaves out accounts the
 *     server roster says are gone, the same on every device, and the tree
 *     answer stays apart (`membrosAfastados`), so nobody holding keys is hidden;
 *  3. the cleanup: a departure that this device saw (`saidasHonradas`) and that
 *     nobody committed is committed now, but only when the server agrees the
 *     account is gone.
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

/**
 * Everybody in the channel reads everybody: each sends a line, each sees all.
 *
 * Without it a test raced the joins: a device that had not opened the last epoch
 * asked for its seat again, and the answer (a remove and an add) moved the tree
 * under the test.
 */
async function todosSeLeem(canal: string, gente: readonly ContaDeTeste[]): Promise<void> {
  for (const quem of gente) {
    await quem.session.send(canal, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: `olá de ${quem.nome}`, attachments: [], mentions: [], links: [] })
  }
  await ate(
    () => gente.every((leitor) => gente.every((autor) => leitor.session.history(canal).some((e) => e.payload["body"] === `olá de ${autor.nome}`))),
    "todos se lêem",
  )
}

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes, { salaComum: false })
  abertas.push(...novas)
  return novas
}

describe("the member count follows the accounts that are really in the channel", () => {
  it("an account that forgot the channel stays in the tree, and leaves the list the app shows", async () => {
    const [ana, bruno, carla] = (await contas("Ana", "Bruno", "Carla")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno, carla])
    await ate(
      () => [ana, bruno, carla].every((quem) => quem.session.membersOf(canal).length === 3),
      "três na árvore",
    )
    await todosSeLeem(canal, [ana, bruno, carla])

    // Carla forgets the channel here, with no `member.left`: what an old client,
    // a deleted vault or a lost device leaves behind.
    await carla.session.forgetChannel(canal)
    await ate(() => !servidor.enclave.store.isSubscribed(canal, carla.address), "o servidor já não tem a Carla")

    // The cause: the tree still has Carla, on both devices that stay.
    expect(ana.session.membersOf(canal)).toContain(carla.address)
    expect(bruno.session.membersOf(canal)).toContain(carla.address)

    // The fix: the list the app shows has two people, the same on both sides.
    for (const quem of [ana, bruno]) {
      await ate(() => {
        quem.session.membrosVisiveis(canal)
        return quem.session.membrosVisiveis(canal).length === 2
      }, `${quem.nome} mostra duas pessoas`)
      expect(quem.session.membrosVisiveis(canal)).toEqual([ana.address, bruno.address].sort())
      // Not hidden: who still holds keys is said apart.
      expect(quem.session.membrosAfastados(canal)).toEqual([carla.address])
    }
  }, 60_000)

  it("tells the interface when the shown list changes, so the count refreshes", async () => {
    const [ana, bruno, carla] = (await contas("Ana", "Bruno", "Carla")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno, carla])
    await ate(
      () => [ana, bruno, carla].every((quem) => quem.session.membersOf(canal).length === 3),
      "três na árvore",
    )
    await todosSeLeem(canal, [ana, bruno, carla])
    const avisos: string[] = []
    ana.session.on("members", (evento) => avisos.push(evento.channel))
    await carla.session.forgetChannel(canal)
    await ate(() => !servidor.enclave.store.isSubscribed(canal, carla.address), "o servidor já não tem a Carla")
    await ate(() => {
      ana.session.membrosVisiveis(canal)
      return avisos.includes(canal)
    }, "aviso de membros")
  }, 60_000)

  it("an invited account that has not connected yet is not hidden", async () => {
    const [ana, bruno] = (await contas("Ana", "Bruno")) as [ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno])
    // Carla is invited while offline: a leaf, no subscription until her device opens the Welcome.
    const [carla] = (await contas("Carla")) as [ContaDeTeste]
    carla.session.disconnect()
    await ana.session.seat(canal, carla.address)
    await ate(() => ana.session.membersOf(canal).includes(carla.address), "a Carla tem folha")
    expect(servidor.enclave.store.isSubscribed(canal, carla.address)).toBe(false)
    // Give the roster time to arrive, then check Carla is still shown.
    await ateQue(async () => {
      ana.session.membrosVisiveis(canal)
      await new Promise((resolve) => setTimeout(resolve, 200))
      return ana.session.rosterConhecido(canal)
    }, "roster da Ana")
    expect(ana.session.membrosVisiveis(canal)).toContain(carla.address)
    expect(ana.session.membrosAfastados(canal)).toEqual([])
  }, 60_000)
})

describe("a departure nobody committed is committed, with brakes", () => {
  it("removes the leaf of an account that asked to leave and that the server says is gone", async () => {
    const [ana, bruno, carla] = (await contas("Ana", "Bruno", "Carla")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno, carla])
    await ate(
      () => [ana, bruno, carla].every((quem) => quem.session.membersOf(canal).length === 3),
      "três na árvore",
    )
    await todosSeLeem(canal, [ana, bruno, carla])

    // The state the common room has: Carla asked to leave, Ana and Bruno heard it
    // (`saidasHonradas`), and no commit happened (the turn never came, the app closed).
    await carla.session.forgetChannel(canal)
    for (const quem of [ana, bruno]) {
      await quem.vault.update((contents) => {
        contents.saidasHonradas = { ...contents.saidasHonradas, [`${canal}|${carla.address}`]: Date.now() }
      })
    }
    await ate(() => !servidor.enclave.store.isSubscribed(canal, carla.address), "o servidor já não tem a Carla")

    await ate(
      () => {
        ana.session.membrosVisiveis(canal)
        bruno.session.membrosVisiveis(canal)
        return !ana.session.membersOf(canal).includes(carla.address) && !bruno.session.membersOf(canal).includes(carla.address)
      },
      "a folha da Carla sai da árvore",
      30_000,
    )
    expect(ana.session.membersOf(canal)).toEqual([ana.address, bruno.address].sort())
  }, 60_000)

  it("never removes an account that asked to leave but is subscribed again", async () => {
    const [ana, bruno, carla] = (await contas("Ana", "Bruno", "Carla")) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno, carla])
    await ate(() => ana.session.membersOf(canal).length === 3, "três na árvore")
    // An old departure record, for someone who came back: the server still has Carla.
    await ana.vault.update((contents) => {
      contents.saidasHonradas = { ...contents.saidasHonradas, [`${canal}|${carla.address}`]: Date.now() - 86_400_000 }
    })
    await ateQue(async () => {
      ana.session.membrosVisiveis(canal)
      await new Promise((resolve) => setTimeout(resolve, 200))
      return ana.session.rosterConhecido(canal)
    }, "roster da Ana")
    await new Promise((resolve) => setTimeout(resolve, 8_000))
    expect(ana.session.membersOf(canal)).toContain(carla.address)
  }, 60_000)

  it("does not sweep the same channel twice inside the interval", () => {
    expect(Session.VARREDURA_INTERVALO_MS).toBeGreaterThanOrEqual(30 * 60_000)
    expect(Session.VARREDURA_LOTE).toBeLessThanOrEqual(16)
  })
})

describe("the server roster (channel.members)", () => {
  it("is announced, and only answers a connection subscribed to the channel", async () => {
    const [ana, bruno] = (await contas("Ana", "Bruno")) as [ContaDeTeste, ContaDeTeste]
    const canal = await canalComTodos(servidor, ana, [bruno])
    expect(ana.session.serverCapabilities).toContain(CAPACIDADE_MEMBROS_DO_CANAL)

    // A stranger who knows the address learns nothing: no list, not even "empty".
    const estranho = await Cliente.ligar(servidor.url, generateIdentity(servidor.casa))
    try {
      estranho.enviar({ t: "channel.members.get", channel: canal })
      const resposta = await estranho.proximoDe("channel.members")
      expect(resposta.contas).toBeUndefined()
      expect(resposta.convidados).toBeUndefined()
    } finally {
      estranho.fechar()
    }
  }, 60_000)

  it("an account that joined and left is not 'invited', and a new Welcome makes it invited again", () => {
    const store = servidor.enclave.store
    const canal = `!sala-de-teste-${Date.now()}:${servidor.casa}`
    const conta = "@conta-de-teste:" + servidor.casa
    const minuto = Math.floor(Date.now() / 60_000) - 60
    store.appendEvent({ channel: canal, kind: "welcome", ciphertext: new Uint8Array([1]), recipient: conta }, { refundavel: false })
    expect(store.convidadosPorEntrar(canal, minuto)).toEqual([conta])
    store.subscribe(canal, conta)
    expect(store.convidadosPorEntrar(canal, minuto)).toEqual([])
    store.unsubscribe(canal, conta)
    expect(store.convidadosPorEntrar(canal, minuto)).toEqual([])
    store.appendEvent({ channel: canal, kind: "welcome", ciphertext: new Uint8Array([2]), recipient: conta }, { refundavel: false })
    expect(store.convidadosPorEntrar(canal, minuto)).toEqual([conta])
  })
})
