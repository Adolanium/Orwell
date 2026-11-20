import {
  addMembers,
  createChannel,
  decodeKeyPackage,
  encryptPayload,
  memberLeaves,
  removeMembers,
  rotateEpoch,
  type GroupSession,
} from "@enclave/crypto"
import { fromBase64, generateIdentity, parseServerName, toBase64, type Identity, type Payload, type UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CANAL_SURDO, Session } from "./session.js"
import { REGRAS_DOS_PEDIDOS } from "./surdez.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * A device that lost a commit (1.3.25, P2, P3, P5). Measured in production on
 * 20/11/2026: devices stuck in an old epoch for days, sending in it (nobody
 * reads), never reading the new one, and asking for a seat once per session.
 *
 * Here, as in `session.surdez.test.ts`: Ana is only cryptography, Bento is a
 * real `Session` against a script server.
 *
 *  - P2: a deaf channel holds what is said, and a healthy one never does.
 *  - P3: the seat request repeats with backoff until the new seat, also after
 *    the keys ran out and came back (`keypackage.low`).
 *  - P5: the `surdez` event says which rooms are deaf, and stops saying it.
 */

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

interface Sent {
  t: string
  [key: string]: unknown
}

class FakeSocket {
  static last: FakeSocket | null = null
  static reply: (frame: Sent) => unknown[] | undefined = () => undefined

  readyState = 0
  readonly sent: Sent[] = []
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.last = this
    setTimeout(() => {
      this.readyState = 1
      this.#fire("open", {})
    }, 0)
  }

  addEventListener(kind: string, handler: (event: unknown) => void, options?: { once?: boolean }): void {
    const wrapped = options?.once
      ? (event: unknown): void => {
          this.removeEventListener(kind, wrapped)
          handler(event)
        }
      : handler
    this.#listeners.set(kind, [...(this.#listeners.get(kind) ?? []), wrapped])
  }

  removeEventListener(kind: string, handler: (event: unknown) => void): void {
    this.#listeners.set(kind, (this.#listeners.get(kind) ?? []).filter((item) => item !== handler))
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as Sent
    this.sent.push(frame)
    for (const reply of FakeSocket.reply(frame) ?? []) {
      setTimeout(() => this.#fire("message", { data: JSON.stringify(reply) }), 0)
    }
  }

  /** Push a frame from the server without anyone asking for it. */
  empurrar(frame: unknown): void {
    setTimeout(() => this.#fire("message", { data: JSON.stringify(frame) }), 0)
  }

  close(): void {
    this.readyState = 3
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

const CANAL = "!lagar:localhost:8448"
const CASA = parseServerName("localhost:8448")

function texto(corpo: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: 1, body: corpo, attachments: [], mentions: [], links: [] }
}

/** Normal responses to a handshake, plus the echo from the writer. */
function respostaBase(frame: Sent): unknown[] | undefined {
  if (frame.t === "hello") return [{ t: "hello.ok", version: 1, capabilities: [] }]
  if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
  if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost:8448" }]
  if (frame.t === "channel.send") {
    // The relay returns what was given to it, with the reference of who wrote it: without
    // this, each `send` sits for ten seconds waiting for a receipt that never comes.
    return [
      {
        t: "channel.event",
        channel: frame.channel,
        seq: 900 + Math.floor(Math.random() * 90),
        kind: frame.kind,
        ciphertext: frame.ciphertext,
        receivedAtMinute: 0,
        ...(frame.ref !== undefined ? { ref: frame.ref } : {}),
      },
    ]
  }
  return undefined
}

let abertas: Session[] = []

async function bentoLigado(): Promise<{ session: Session; socket: FakeSocket }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await assentar(20)
  const socket = FakeSocket.last
  if (!socket) throw new Error("sem socket")
  return { session, socket }
}

/** The first key package Bento published, which is how Ana invites him. */
function keyPackagePublicado(socket: FakeSocket): Uint8Array {
  const publicacao = socket.sent.find((frame) => frame.t === "keypackage.publish")
  const wire = (publicacao?.packages as string[] | undefined)?.[0]
  if (!wire) throw new Error("o Bento não publicou key packages")
  return fromBase64(wire)
}

async function assentar(vezes = 60): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  FakeSocket.reply = respostaBase
  FakeSocket.last = null
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  vi.useRealTimers()
  // A session does not die with the test that created it: timers keep running.
  // See the same trap in `session.corrida.test.ts`.
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})


/** Every key package Bento published, in order. Ana invites with one, and reseats with the next. */
function keyPackagesPublicados(socket: FakeSocket): Uint8Array[] {
  return socket.sent
    .filter((frame) => frame.t === "keypackage.publish")
    .flatMap((frame) => (frame.packages as string[]).map((wire) => fromBase64(wire)))
}

function respostaComRecuperacaoVazia(frame: Sent): unknown[] | undefined {
  const base = respostaBase(frame)
  if (base) return base
  if (frame.t === "channel.backfill") return [{ t: "channel.backfill.page", channel: frame.channel, more: false, events: [] }]
  return undefined
}

let seq = 100
function empurrarEvento(socket: FakeSocket, kind: string, bytes: Uint8Array): void {
  socket.empurrar({ t: "channel.event", channel: CANAL, seq: seq++, kind, ciphertext: toBase64(bytes), receivedAtMinute: 0 })
}

/** Bento seated in Ana's channel, with nothing said before. */
async function bentoSentado(): Promise<{ session: Session; socket: FakeSocket; ana: Identity; grupo: GroupSession }> {
  const { session, socket } = await bentoLigado()
  FakeSocket.reply = respostaComRecuperacaoVazia
  const ana = generateIdentity(CASA)
  const criado = await createChannel(ana, CANAL)
  const convite = await addMembers(criado, [decodeKeyPackage(keyPackagesPublicados(socket)[0] as Uint8Array)])
  empurrarEvento(socket, "welcome", convite.welcome)
  await assentar(200)
  expect(session.channels).toContain(CANAL)
  return { session, socket, ana, grupo: convite.session }
}

/**
 * The channel moves on without Bento: two commits that never reach him, then
 * `quantas` messages in the new epoch. Returns Ana's group after them.
 */
async function canalSegueSemEle(socket: FakeSocket, grupo: GroupSession, quantas: number): Promise<GroupSession> {
  let depois = grupo
  for (let i = 0; i < 2; i++) depois = (await rotateEpoch(depois)).session
  for (let i = 0; i < quantas; i++) {
    const dito = await encryptPayload(depois, texto(`depois ${i}`))
    depois = dito.session
    empurrarEvento(socket, "application", dito.ciphertext)
  }
  await assentar(200)
  return depois
}

/** Bento deaf for over a minute: the failures, the clock a minute and a bit later, and one more. */
async function bentoSurdo(): Promise<{ session: Session; socket: FakeSocket; grupo: GroupSession; surdez: string[][] }> {
  const { session, socket, grupo } = await bentoSentado()
  const surdez: string[][] = []
  session.on("surdez", ({ canais }) => surdez.push(canais))
  let depois = await canalSegueSemEle(socket, grupo, 6)
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(Date.now() + 61_000)
  const dito = await encryptPayload(depois, texto("e mais uma"))
  depois = dito.session
  empurrarEvento(socket, "application", dito.ciphertext)
  await assentar(200)
  return { session, socket, grupo: depois, surdez }
}

const mensagensQueSairam = (socket: FakeSocket): number =>
  socket.sent.filter((frame) => frame.t === "channel.send" && frame.kind === "application").length
const pedidos = (socket: FakeSocket): number => socket.sent.filter((frame) => frame.t === "channel.rejoin.request").length
const esperar = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const REGRAS_RAPIDAS = { atrasos: [40, 40], rajada: 3, intervaloMs: 10, adiantamentoMs: 20 }

afterEach(() => {
  Session.REGRAS_DOS_PEDIDOS = REGRAS_DOS_PEDIDOS
})

describe("canal surdo: não envia para o vazio (P2)", () => {
  it("surdo há mais de um minuto, a mensagem não sai e o envio diz porquê", async () => {
    const { session, socket, surdez } = await bentoSurdo()
    expect(session.deafChannels()).toContain(CANAL)

    const antes = mensagensQueSairam(socket)
    await expect(session.send(CANAL, texto("para ninguém"))).rejects.toThrow(CANAL_SURDO)
    // Typing is dropped without a word: nothing leaves, nothing throws.
    await expect(session.send(CANAL, { t: "typing", room: "geral" } as unknown as Payload)).resolves.toBeUndefined()
    await assentar(60)
    expect(mensagensQueSairam(socket)).toBe(antes)

    // P5: the room is told.
    expect(surdez.at(-1)).toEqual([CANAL])
    expect(session.canaisSurdos()).toEqual([CANAL])
  }, 120_000)

  it("um canal são nunca fica preso: as épocas antigas de quem ficou para trás não contam, e meia dúzia de falhas recentes também não", async () => {
    const { session, socket, grupo } = await bentoSentado()
    // Ana's commit reaches Bento: he moves on. Then a stuck device (Ana's old
    // state stands for it) keeps sending in the epoch he left.
    const rodado = await rotateEpoch(grupo)
    for (const commit of rodado.commits) empurrarEvento(socket, "handshake", commit)
    await assentar(200)
    let velho = grupo
    for (let i = 0; i < 8; i++) {
      const dito = await encryptPayload(velho, texto(`época velha ${i}`))
      velho = dito.session
      empurrarEvento(socket, "application", dito.ciphertext)
    }
    await assentar(200)
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + 5 * 60_000)

    let antes = mensagensQueSairam(socket)
    await session.send(CANAL, texto("ouvida"))
    expect(mensagensQueSairam(socket)).toBe(antes + 1)
    expect(session.canaisSurdos()).toEqual([])

    // Now five frames ahead that do not open, just now: deaf for the seat
    // request maybe later, but not for sending. Under a minute, nothing is held.
    await canalSegueSemEle(socket, rodado.session, 5)
    antes = mensagensQueSairam(socket)
    await session.send(CANAL, texto("ainda sai"))
    expect(mensagensQueSairam(socket)).toBe(antes + 1)
  }, 120_000)
})

describe("canal surdo: o pedido de lugar repete-se até haver lugar (P3)", () => {
  it("pede outra vez com recuo, e pára quando chega o lugar novo; aí a mensagem sai e a sala deixa de avisar", async () => {
    Session.REGRAS_DOS_PEDIDOS = REGRAS_RAPIDAS
    const { session, socket, grupo, surdez } = await bentoSurdo()
    expect(pedidos(socket)).toBeGreaterThanOrEqual(1)
    await esperar(300)
    // Before 1.3.25: one request in the session, and never again.
    expect(pedidos(socket)).toBeGreaterThanOrEqual(3)

    // Ana reseats him: his old leaf out, a new one in, with his next key package.
    const bento = session.identity.address as UserAddress
    const sem = await removeMembers(grupo, memberLeaves(grupo, bento))
    const novo = await addMembers(sem.session, [decodeKeyPackage(keyPackagesPublicados(socket)[1] as Uint8Array)])
    empurrarEvento(socket, "welcome", novo.welcome)
    await assentar(300)

    expect(surdez.at(-1)).toEqual([])
    expect(session.canaisSurdos()).toEqual([])
    const depoisDoLugar = pedidos(socket)
    await esperar(300)
    expect(pedidos(socket)).toBe(depoisDoLugar)

    const antes = mensagensQueSairam(socket)
    await session.send(CANAL, texto("já se ouve"))
    expect(mensagensQueSairam(socket)).toBe(antes + 1)
  }, 120_000)

  it("sem chaves e com chaves novas: o keypackage.low traz o pedido seguinte para já", async () => {
    Session.REGRAS_DOS_PEDIDOS = { atrasos: [150, 600_000], rajada: 3, intervaloMs: 10, adiantamentoMs: 20 }
    const { socket } = await bentoSurdo()
    await esperar(400)
    // The first, and the one after 150 ms. The next is ten minutes away.
    expect(pedidos(socket)).toBe(2)

    // The answerer had no key package of Bento's (`reseat-failed`). The server
    // says his pool is low (P4 of the other branch, or the claim): he tops up,
    // and asks again now instead of in ten minutes.
    socket.empurrar({ t: "keypackage.low", remaining: 3 })
    await esperar(200)
    expect(socket.sent.filter((frame) => frame.t === "keypackage.publish").length).toBeGreaterThan(1)
    expect(pedidos(socket)).toBe(3)
  }, 120_000)
})
