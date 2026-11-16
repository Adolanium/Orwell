import { addMembers, createChannel, decodeKeyPackage, encryptPayload } from "@enclave/crypto"
import { fromBase64, generateIdentity, parseServerName, toBase64, type Payload } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The catch-up on connect runs channels side by side (12/11/2026).
 *
 * It ran one channel after another: one round trip per page, per channel, in
 * series, and the phone start waited for all of it (`scripts/medir-arranque-telemovel.mjs`:
 * 1.8 s for five channels on slow 4G, and one more round trip for every channel
 * more). Waits pair by channel tag (`#await` with `etiqueta`), so pages of two
 * channels in flight at once never cross.
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

const CASA = parseServerName("localhost:8448")

function texto(corpo: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: 1, body: corpo, attachments: [], mentions: [], links: [] }
}

function respostaBase(frame: Sent): unknown[] | undefined {
  if (frame.t === "hello") return [{ t: "hello.ok", version: 1, capabilities: [] }]
  if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
  if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost:8448" }]
  if (frame.t === "channel.send") {
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

async function bentoLigado(): Promise<{ session: Session; vault: Vault; socket: FakeSocket }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await assentar(20)
  const socket = FakeSocket.last
  if (!socket) throw new Error("sem socket")
  return { session, vault, socket }
}

/** The key packages that Bento published: others invite him because of them. */
function keyPackagesPublicados(socket: FakeSocket): Uint8Array[] {
  const publicacao = socket.sent.find((frame) => frame.t === "keypackage.publish")
  const wires = publicacao?.packages as string[] | undefined
  if (!wires || wires.length < 2) throw new Error("o Bento não publicou key packages que cheguem")
  return wires.map(fromBase64)
}

async function assentar(vezes = 60): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** A channel founded by someone else, with history, and the invite for Bento. */
async function canalComConvite(
  canal: string,
  keyPackage: Uint8Array,
  quantas: number,
): Promise<{ historia: string[]; welcome: string }> {
  const dono = generateIdentity(CASA)
  let grupo = await createChannel(dono, canal)

  const convite = await addMembers(grupo, [decodeKeyPackage(keyPackage)])
  grupo = convite.session

  // Said AFTER the invite, so at Bento's epoch: this is what he opens, and that
  // is why it serves as a measure, if it does not arrive, it was the catch-up
  // that got lost.
  const historia: string[] = []
  for (let i = 0; i < quantas; i++) {
    const dito = await encryptPayload(grupo, texto(`${canal} ${i}`))
    grupo = dito.session
    historia.push(toBase64(dito.ciphertext))
  }

  return { historia, welcome: toBase64(convite.welcome) }
}

beforeEach(() => {
  FakeSocket.reply = respostaBase
  FakeSocket.last = null
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})


const CANAIS = ["!um:localhost:8448", "!dois:localhost:8448", "!tres:localhost:8448", "!quatro:localhost:8448", "!cinco:localhost:8448", "!seis:localhost:8448"]

describe("recuperação ao ligar, canais lado a lado", () => {
  it("pede a primeira página de vários canais antes de qualquer resposta, e cada um acaba no seu sítio", async () => {
    const { session, vault, socket } = await bentoLigado()
    const pacotes = keyPackagesPublicados(socket)
    const historias = new Map<string, string[]>()
    for (const [i, canal] of CANAIS.entries()) {
      const pacote = pacotes[i]
      if (!pacote) throw new Error("faltam key packages")
      const { historia, welcome } = await canalComConvite(canal, pacote, 2)
      historias.set(canal, historia)
      socket.empurrar({ t: "channel.event", channel: canal, seq: 0, kind: "welcome", ciphertext: welcome, receivedAtMinute: 0 })
      await assentar(200)
    }
    for (const canal of CANAIS) expect(session.channels).toContain(canal)

    // Away, and back: the new connection catches up every channel. The server
    // holds every backfill until we say so.
    session.disconnect()
    const retidos: Sent[] = []
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t === "channel.backfill") {
        retidos.push(frame)
        return undefined
      }
      return undefined
    }
    // The person used the last two channels most recently: they come first.
    vault.contents.lidas = { ...vault.contents.lidas, [CANAIS[5]!]: 9_000, [CANAIS[4]!]: 8_000 }
    const ligacao = session.connect()
    await assentar(200)
    const aMeio = new Set(retidos.map((f) => f.channel))
    expect(aMeio.size).toBeGreaterThanOrEqual(4)
    expect(retidos.slice(0, 2).map((f) => f.channel).sort()).toEqual([CANAIS[4], CANAIS[5]].sort())

    // Now the server answers what it held, and what comes after.
    const novo = FakeSocket.last
    if (!novo) throw new Error("sem socket")
    const responder = (frame: Sent): unknown[] => {
      const canal = String(frame.channel)
      const depois = Number(frame.afterSeq ?? -1)
      const eventos = (historias.get(canal) ?? [])
        .map((ciphertext, indice) => ({ seq: indice + 1, kind: "application", ciphertext, receivedAtMinute: 0 }))
        .filter((e) => e.seq > depois)
      return [{ t: "channel.backfill.page", channel: canal, more: false, events: eventos }]
    }
    FakeSocket.reply = (frame) => respostaBase(frame) ?? (frame.t === "channel.backfill" ? responder(frame) : undefined)
    for (const frame of retidos.splice(0)) for (const resposta of responder(frame)) novo.empurrar(resposta)
    await ligacao
    await assentar(200)
    for (const canal of CANAIS) expect(vault.contents.lastSeq[canal]).toBe(2)
  }, 120_000)
})
