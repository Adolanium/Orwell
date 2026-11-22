import { toBase64 } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  CofreEmMemoria,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { ArmazemEmMemoria, Session, Vault } from "@enclave/client-core"
import { REGRAS_DOS_PEDIDOS } from "./surdez.js"

/**
 * A third device of an account, by importing the account file, in every
 * channel the account has (hotfix 1.3.26-2, 22/11/2026).
 *
 * Seen in production: the imported device showed Erro 390 ("You are not
 * receiving new messages in this room") in the common room, for good. The
 * seat request (signed since 1.3.26) never brought it back. Why, read in the code:
 *
 *  - a device DEAF in the common room has a group there, so `ensureCommonRoom`,
 *    the only path that uses the card, returns at once;
 *  - the account's own devices never repair the common room
 *    (`#repararAparelhosDaConta` returns there: "the common room has its own way in");
 *  - so the request waits for ANOTHER account that is online, not deaf, and whose
 *    turn (address order, `REJOIN_TURN_MS` each) comes. With only the account's own
 *    devices online, or with the members of the room asleep, nobody answers,
 *    whatever the request proves.
 *
 * The fix: in the common room the seat request first takes the card, with the
 * resync of our own dead leaf, as a newcomer enters; the request to the members
 * stays as the second way.
 */

const FRASE = "frase-passe-de-teste"
const PEDIDOS_DE_TESTE = { atrasos: [3_000, 6_000, 12_000], rajada: 3, intervaloMs: 500, adiantamentoMs: 1_000 }

/** What the sockets of ONE device (by its device key, from `auth.begin`) lose, without saying. */
const perda = {
  aparelho: "",
  canal: "",
  /** On: every handshake of `canal` is lost, and its `seq` remembered, live and in recovery, for good. */
  aPerderCommits: false,
  seqsPerdidos: new Set<number>(),
}

const Original = globalThis.WebSocket
const marcados = new WeakSet<object>()

class SocketComPerdas extends Original {
  override send(dados: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof dados === "string" && perda.aparelho !== "") {
      const frame = JSON.parse(dados) as { t?: string; signingKey?: string }
      if (frame.t === "auth.begin" && frame.signingKey === perda.aparelho) marcados.add(this)
    }
    super.send(dados)
  }

  override addEventListener(tipo: string, ouvinte: unknown, opcoes?: unknown): void {
    if (tipo !== "message" || typeof ouvinte !== "function") {
      super.addEventListener(tipo, ouvinte as EventListener, opcoes as AddEventListenerOptions)
      return
    }
    const filtrado = (evento: MessageEvent): void => {
      if (!marcados.has(this)) {
        ;(ouvinte as (e: unknown) => void)(evento)
        return
      }
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(String(evento.data)) as Record<string, unknown>
      } catch {
        ;(ouvinte as (e: unknown) => void)(evento)
        return
      }
      const perdido = (canal: unknown, kind: unknown, seq: unknown): boolean => {
        if (canal !== perda.canal || kind !== "handshake" || typeof seq !== "number") return false
        if (perda.aPerderCommits) perda.seqsPerdidos.add(seq)
        return perda.seqsPerdidos.has(seq)
      }
      if (frame["t"] === "channel.event" && perdido(frame["channel"], frame["kind"], frame["seq"])) return
      if (frame["t"] === "channel.backfill.page" && Array.isArray(frame["events"])) {
        const eventos = (frame["events"] as { seq?: unknown; kind?: unknown }[]).filter((e) => !perdido(frame["channel"], e.kind, e.seq))
        ;(ouvinte as (e: unknown) => void)({ data: JSON.stringify({ ...frame, events: eventos }) })
        return
      }
      ;(ouvinte as (e: unknown) => void)(evento)
    }
    super.addEventListener(tipo, filtrado as EventListener, opcoes as AddEventListenerOptions)
  }
}

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  globalThis.WebSocket = SocketComPerdas as typeof WebSocket
  Session.REGRAS_DOS_PEDIDOS = PEDIDOS_DE_TESTE
  servidor = await levantarServidor()
}, 30_000)
afterEach(() => {
  desligarContas(abertas.splice(0))
  perda.aparelho = ""
  perda.canal = ""
  perda.aPerderCommits = false
  perda.seqsPerdidos.clear()
})
afterAll(async () => {
  globalThis.WebSocket = Original
  Session.REGRAS_DOS_PEDIDOS = REGRAS_DOS_PEDIDOS
  await servidor?.fechar()
})

/** A new device that imports `ficheiro`; `antesDeLigar` sees its device key before the first connection. */
async function importar(ficheiro: Uint8Array, nome: string, antesDeLigar?: (aparelho: string) => void): Promise<ContaDeTeste> {
  const backend = new CofreEmMemoria()
  const vault = new Vault(backend)
  const armazem = new ArmazemEmMemoria()
  const session = new Session(vault, { armazem })
  const avisos: string[] = []
  session.on("status", (evento) => {
    if (evento.code) avisos.push(evento.code)
  })
  await vault.importVault(ficheiro, FRASE, { passagem: (pedido) => session.passagemDoImportar(pedido) })
  await vault.unlock(FRASE)
  const identidade = session.loadIdentity()
  antesDeLigar?.(toBase64(identidade.deviceSigningPublicKey))
  await session.connect()
  return { nome, session, vault, backend, armazem, address: identidade.address, avisos }
}

function corpos(conta: ContaDeTeste, canal: string): string[] {
  return conta.session
    .history(canal)
    .map((entrada) => entrada.payload["body"])
    .filter((corpo): corpo is string => typeof corpo === "string")
}

let contador = 0
async function dizer(conta: ContaDeTeste, canal: string, corpo: string): Promise<void> {
  contador += 1
  await conta.session.send(canal, { t: "message", body: corpo, sentAt: Date.now(), id: `m-${contador}-${"x".repeat(10)}` })
}

/**
 * Ana with two devices (computer and phone) in two rooms and the common room,
 * with Bruno and Carla, and the file exported from the computer.
 */
async function contaComDoisAparelhos(): Promise<{
  ana: ContaDeTeste
  telemovel: ContaDeTeste
  bruno: ContaDeTeste
  carla: ContaDeTeste
  canais: string[]
  ficheiro: Uint8Array
}> {
  const [ana, bruno, carla] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])
  abertas.push(ana!, bruno!, carla!)
  const comum = servidor.sala
  for (const conta of [ana!, bruno!, carla!]) {
    await conta.session.ensureCommonRoom()
    await ate(() => conta.session.channels.includes(comum), `${conta.nome} is in the common room`, 30_000)
  }
  const telemovel = await emparelharAparelho(ana!)
  abertas.push(telemovel)
  const c1 = await canalComTodos(servidor, ana!, [bruno!])
  const c2 = await canalComTodos(servidor, bruno!, [ana!, carla!])
  const canais = [c1, c2, comum]
  await ate(() => canais.every((canal) => telemovel.session.channels.includes(canal)), "the phone is in every channel", 60_000, 250)
  // The card of the last entry is on the server, as in a room that has been still for a while.
  await new Promise((resolve) => setTimeout(resolve, Session.CARTAO_ATRASO_MS + 2_000))
  await ana!.session.flush()
  const ficheiro = await ana!.vault.exportVault()
  return { ana: ana!, telemovel, bruno: bruno!, carla: carla!, canais, ficheiro }
}

describe("a third device of the account, by import, in every channel", () => {
  it("every channel opens on the imported device: it reads and writes, and the others read it", async () => {
    const { ana, bruno, canais, ficheiro } = await contaComDoisAparelhos()
    const novo = await importar(ficheiro, "Ana (imported)")
    abertas.push(novo)
    await ate(() => canais.every((canal) => novo.session.channels.includes(canal)), "the imported device is in every channel", 90_000, 250)
    for (const [i, canal] of canais.entries()) {
      await dizer(bruno, canal, `bruno ${i}`)
      await ate(() => corpos(novo, canal).includes(`bruno ${i}`), `the imported device reads channel ${i}`, 30_000)
      await dizer(novo, canal, `novo ${i}`)
      await ate(() => corpos(bruno, canal).includes(`novo ${i}`), `Bruno reads the imported device in channel ${i}`, 30_000)
      await ate(() => corpos(ana, canal).includes(`novo ${i}`), `the computer reads the imported device in channel ${i}`, 30_000)
    }
    expect(novo.session.canaisSurdos()).toEqual([])
  }, 300_000)

  it("deaf in the common room with only the account's own devices online: it comes back by the card", async () => {
    const { ana, bruno, carla, canais, ficheiro } = await contaComDoisAparelhos()
    const comum = servidor.sala
    const novo = await importar(ficheiro, "Ana (imported)", (aparelho) => {
      perda.aparelho = aparelho
      perda.canal = comum
    })
    abertas.push(novo)
    await ate(() => canais.every((canal) => novo.session.channels.includes(canal)), "the imported device is in every channel", 90_000, 250)
    await dizer(bruno, comum, "before")
    await ate(() => corpos(novo, comum).includes("before"), "the imported device reads the common room", 30_000)

    // The imported device loses, for good, the commit of Dora's entry: deaf there.
    perda.aPerderCommits = true
    const [dora] = await contasDeTeste(servidor, ["Dora"])
    abertas.push(dora!)
    await dora!.session.ensureCommonRoom()
    await ate(() => dora!.session.channels.includes(comum), "Dora is in the common room", 30_000)
    await ate(() => perda.seqsPerdidos.size > 0, "the imported device lost a commit", 15_000)
    perda.aPerderCommits = false
    // Everybody else goes to sleep: only the account's own devices stay online.
    await new Promise((resolve) => setTimeout(resolve, Session.CARTAO_ATRASO_MS + 1_000))
    for (const conta of [bruno, carla, dora!]) conta.session.disconnect()

    // The computer keeps talking in the room, so the imported device sees frames it cannot open.
    let i = 0
    const falar = setInterval(() => void dizer(ana, comum, `ana ${i++}`).catch(() => {}), 3_000)
    try {
      await ate(() => novo.avisos.includes("channel-deaf"), "the imported device knows it is deaf", 90_000, 250)
      const marca = `after ${Date.now()}`
      await ate(
        () => {
          if (!corpos(ana, comum).includes(marca)) void dizer(ana, comum, marca).catch(() => {})
          return corpos(novo, comum).includes(marca)
        },
        "the imported device reads the common room again",
        120_000,
        3_000,
      )
    } finally {
      clearInterval(falar)
    }
    expect(novo.session.canaisSurdos()).not.toContain(comum)
    // And it writes there, and the account's other device reads it.
    await dizer(novo, comum, "back")
    await ate(() => corpos(ana, comum).includes("back"), "the computer reads the imported device in the common room", 30_000)
  }, 420_000)
})
