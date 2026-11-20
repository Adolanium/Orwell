import { DatabaseSync } from "node:sqlite"
import { CANAL_SURDO, Session as SessionDoHarness } from "@enclave/client-core"
import type { Payload } from "@enclave/protocol"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { REGRAS_DOS_PEDIDOS } from "./surdez.js"

/**
 * A device that loses a commit, against a real server (1.3.25, P2, P3, P5).
 *
 * Measured in production on 20/11/2026: devices stuck for days in an old epoch
 * of a channel. They kept sending in it (the server took it, nobody read it),
 * they never read the new epoch, and they asked for a seat once per session;
 * after a `reseat-failed` (the answerer found no key package of theirs) never
 * again until the app restarted.
 *
 * Here Bento loses for good the commit that seats Carla: his socket drops it
 * live and in every recovery page. His key packages are all claimed, and the
 * ones he publishes do not reach the server, so whoever answers his request
 * fails with "no invite keys". Then the keys come back. It must:
 *  - say he is deaf (`canaisSurdos`, the line in the room) after a minute;
 *  - not send into the void: `send` throws `CANAL_SURDO` and no frame leaves;
 *  - ask for a seat again and again while deaf, also after the failures;
 *  - be seated when the keys come back, read the room again, and send.
 *
 * Expected before this branch: red at "pede lugar outra vez" (one request in
 * the session) and at "não envia para o vazio" (the message goes out).
 */

const SAIDAS_DE_TESTE = { atrasos: [3_000, 6_000, 12_000], rajada: 3, intervaloMs: 500, adiantamentoMs: 1_000 }

/** What Bento's sockets lose and do not say. Set by the test. */
const perda = {
  /** The address whose sockets this applies to. */
  conta: "",
  canal: "",
  /** On: every handshake of `canal` is lost, and its `seq` remembered. */
  aPerderCommits: false,
  /** The `seq` of each commit lost: lost for good, live and in recovery. */
  seqsPerdidos: new Set<number>(),
  /** On: the key packages Bento publishes never reach the server. */
  semChaves: false,
}
/** Every frame Bento's sockets sent, in order. */
const enviadosPeloBento: { t: string; channel?: string; kind?: string }[] = []

const Original = globalThis.WebSocket
const donos = new WeakMap<object, string>()

class SocketComPerdas extends Original {
  override send(dados: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof dados === "string" && donos.get(this) === perda.conta && perda.conta !== "") {
      const frame = JSON.parse(dados) as { t: string; channel?: string; kind?: string }
      enviadosPeloBento.push({ t: frame.t, ...(frame.channel ? { channel: frame.channel } : {}), ...(frame.kind ? { kind: frame.kind } : {}) })
      if (frame.t === "keypackage.publish" && perda.semChaves) return
    }
    super.send(dados)
  }

  override addEventListener(tipo: string, ouvinte: unknown, opcoes?: unknown): void {
    if (tipo !== "message" || typeof ouvinte !== "function") {
      super.addEventListener(tipo, ouvinte as EventListener, opcoes as AddEventListenerOptions)
      return
    }
    const filtrado = (evento: MessageEvent): void => {
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(String(evento.data)) as Record<string, unknown>
      } catch {
        ;(ouvinte as (e: unknown) => void)(evento)
        return
      }
      if (frame["t"] === "auth.ok" && typeof frame["address"] === "string") donos.set(this, frame["address"])
      if (donos.get(this) !== perda.conta || perda.conta === "") {
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

function texto(corpo: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: corpo, attachments: [], mentions: [], links: [] }
}

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
beforeAll(async () => {
  globalThis.WebSocket = SocketComPerdas as typeof WebSocket
  SessionDoHarness.REGRAS_DOS_PEDIDOS = SAIDAS_DE_TESTE
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  globalThis.WebSocket = Original
  SessionDoHarness.REGRAS_DOS_PEDIDOS = REGRAS_DOS_PEDIDOS
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

describe("um aparelho que perde um commit", () => {
  it("fica surdo, não envia para o vazio, pede lugar outra vez até ser sentado (também depois de ficar sem chaves), e volta a ouvir", async () => {
    const [ana, bento, carla] = await contasDeTeste(servidor, ["Ana", "Bento", "Carla"], { salaComum: false })
    abertas.push(ana!, bento!, carla!)
    const canal = await canalComTodos(servidor, ana!, [bento!])
    perda.conta = bento!.address
    perda.canal = canal

    // No key package of Bento's on the server, and none of the new ones arrives.
    perda.semChaves = true
    const base = new DatabaseSync(servidor.baseDeDados)
    base.prepare("UPDATE key_packages SET claimed = 1 WHERE address = ?").run(bento!.address)
    base.close()

    // The commit that seats Carla never reaches Bento, not even in recovery.
    perda.aPerderCommits = true
    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra no canal")
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    perda.aPerderCommits = false
    expect(perda.seqsPerdidos.size).toBeGreaterThan(0)

    // The room goes on talking in the epoch Bento does not have.
    let aFalar = true
    const conversa = (async () => {
      for (let i = 0; aFalar; i++) {
        await ana!.session.send(canal, texto(`ana ${i}`)).catch(() => {})
        await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
    })()
    try {
      // P5: deaf for a minute, and said.
      await ate(() => bento!.session.canaisSurdos().includes(canal), "o Bento fica surdo, e diz-se", 150_000, 250)
      expect(bento!.avisos).toContain("channel-deaf")

      // P2: nothing goes into the void.
      const antes = enviadosPeloBento.filter((f) => f.t === "channel.send" && f.channel === canal && f.kind === "application").length
      await expect(bento!.session.send(canal, texto("estão aí?"))).rejects.toThrow(CANAL_SURDO)
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(enviadosPeloBento.filter((f) => f.t === "channel.send" && f.channel === canal && f.kind === "application").length).toBe(antes)

      // P3: asks again and again while no one can seat him.
      const pedidos = (): number => enviadosPeloBento.filter((f) => f.t === "channel.rejoin.request" && f.channel === canal).length
      await ate(() => pedidos() >= 3, "o Bento pede lugar outra vez", 60_000, 250)
      expect([...ana!.avisos, ...carla!.avisos]).toContain("reseat-failed")

      // The keys come back. The next request must be answered.
      perda.semChaves = false
      await bento!.session.topUpKeyPackages(20)
      await ate(() => bento!.session.canaisSurdos().length === 0 && bento!.session.deafChannels().length === 0, "o Bento volta a ouvir", 120_000, 250)
    } finally {
      aFalar = false
      await conversa
    }

    // He reads the room again, and what he sends is read.
    const vistas: string[] = []
    bento!.session.on("message", ({ channel, payload }) => {
      if (channel === canal && payload.t === "message") vistas.push(String(payload.body))
    })
    await ana!.session.send(canal, texto("bem-vindo de volta"))
    await ate(() => vistas.includes("bem-vindo de volta"), "o Bento lê a Ana", 20_000)
    const lidasPelaAna: string[] = []
    ana!.session.on("message", ({ channel, payload }) => {
      if (channel === canal && payload.t === "message") lidasPelaAna.push(String(payload.body))
    })
    await bento!.session.send(canal, texto("voltei"))
    await ate(() => lidasPelaAna.includes("voltei"), "a Ana lê o Bento", 20_000)

    // And with a seat, no more requests.
    const depois = enviadosPeloBento.filter((f) => f.t === "channel.rejoin.request" && f.channel === canal).length
    await new Promise((resolve) => setTimeout(resolve, 15_000))
    expect(enviadosPeloBento.filter((f) => f.t === "channel.rejoin.request" && f.channel === canal).length).toBe(depois)
  }, 600_000)
})
