import { addMembers, createChannel, decodeKeyPackage, encryptPayload, generateKeyPackages } from "@enclave/crypto"
import { fromBase64, generateIdentity, parseServerName, toBase64, type Payload } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * **Our own message, read back by recovery in an epoch we have since left, is
 * not a loss.**
 *
 * The intermittent failure of `scripts/e2e-cliente-antigo.mjs`, section 8 ("o
 * evento N não se leu e a âncora passou-lhe por cima", 17/11/2026, three
 * times): a device that has just joined sends while its recovery of the
 * channel is still running. The message goes out in epoch E. The server numbers
 * a commit E → E+1 from another member BEFORE it, and recovery, which reads in
 * order, applies that commit first and then reads our own message back from
 * the page. Our sending ratchet already spent that generation, so ts-mls says
 * "Desired gen in the past", and because the frame is from a past epoch at or
 * above `#epocaAoLigar`, it was marked `saltado`: an error-level loss report,
 * a gap in the vault, and requests to the server for days. Nothing was lost.
 * The message is in the history since the send.
 *
 * Measured live with a trace (four failures in about fifteen runs under load):
 * the frame was always this device's own echo (`nosso=true`) and the reason
 * always "Desired gen in the past". In the current epoch the same refusal is
 * already treated as proof the seat holds the keys (`geracaoGasta`); it was
 * only the past-epoch branch that read it as a loss.
 *
 * The fake server makes the order exact: the send is answered with `seq` 3,
 * after the commit at `seq` 2, and only then is the recovery page answered.
 * The send is the device signal (a `typing` born expired), which goes out at
 * once; a message a person writes waits for the recovery
 * (`#esperarPelaRecuperacao`) and does not reach this order.
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

const CANAL = "!eco:localhost:8448"
const CASA = parseServerName("localhost:8448")
const MINUTO_DE_AGORA = Math.floor(Date.now() / 60_000)

function texto(corpo: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: 1, body: corpo, attachments: [], mentions: [], links: [] }
}

function respostaBase(frame: Sent): unknown[] | undefined {
  if (frame.t === "hello") return [{ t: "hello.ok", version: 1, capabilities: [], retentionDays: 30 }]
  if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
  if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost:8448" }]
  return undefined
}

async function assentar(vezes = 60): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function ate(condicao: () => boolean, ms = 10_000): Promise<void> {
  const fim = Date.now() + ms
  while (!condicao()) {
    if (Date.now() > fim) throw new Error("timed out")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

let abertas: Session[] = []
const estados: { code?: string; channel?: string; detail: string }[] = []

beforeEach(() => {
  FakeSocket.reply = respostaBase
  FakeSocket.last = null
  abertas = []
  estados.length = 0
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("o eco próprio lido pela recuperação", () => {
  it("uma mensagem nossa, enviada durante a recuperação e lida depois de um commit, não é lacuna", async () => {
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    abertas.push(session)
    session.on("status", (estado) => estados.push(estado))
    await session.createIdentity("localhost:8448")
    await session.connect()
    await assentar(20)
    const socket = FakeSocket.last
    if (!socket) throw new Error("no socket")

    // The owner's channel: Bento enters in epoch 1 by Welcome.
    const dono = generateIdentity(CASA)
    let grupo = await createChannel(dono, CANAL)
    const publicacao = socket.sent.find((frame) => frame.t === "keypackage.publish")
    const pacote = (publicacao?.packages as string[] | undefined)?.[0]
    if (!pacote) throw new Error("Bento published no key packages")
    const convite = await addMembers(grupo, [decodeKeyPackage(fromBase64(pacote))])
    grupo = convite.session

    // seq 1: the owner speaks in epoch 1. seq 2: the owner commits, epoch 1 → 2.
    const dito = await encryptPayload(grupo, texto("do dono"))
    grupo = dito.session
    const figurante = (await generateKeyPackages(generateIdentity(CASA), 1))[0]
    if (!figurante) throw new Error("no key package for the extra member")
    const commit = await addMembers(grupo, [figurante.publicPackage])
    const eventos: { seq: number; kind: string; ciphertext: string; receivedAtMinute: number }[] = [
      { seq: 1, kind: "application", ciphertext: toBase64(dito.ciphertext), receivedAtMinute: MINUTO_DE_AGORA },
      { seq: 2, kind: "handshake", ciphertext: toBase64(commit.commit), receivedAtMinute: MINUTO_DE_AGORA },
    ]

    /*
      The recovery that the Welcome starts asks for its first page, and the
      server holds it. Meanwhile Bento sends, still in epoch 1, and the server
      numbers that send AFTER the commit (seq 3). Only then does the page come,
      with the commit before our own message.
    */
    let paginaPedida = false
    FakeSocket.reply = (frame) => {
      const base = respostaBase(frame)
      if (base) return base
      if (frame.t === "channel.send" && frame.channel === CANAL) {
        // Numbered after the commit, in the order they arrive.
        const seq = (eventos.at(-1)?.seq ?? 0) + 1
        eventos.push({ seq, kind: String(frame.kind), ciphertext: String(frame.ciphertext), receivedAtMinute: MINUTO_DE_AGORA })
        return [{ t: "channel.event", channel: CANAL, seq, kind: frame.kind, ciphertext: frame.ciphertext, receivedAtMinute: MINUTO_DE_AGORA, ref: frame.ref }]
      }
      if (frame.t === "channel.backfill" && frame.channel === CANAL) {
        const depois = typeof frame.afterSeq === "number" ? frame.afterSeq : -1
        if (!paginaPedida) {
          paginaPedida = true
          return undefined
        }
        return [{ t: "channel.backfill.page", channel: CANAL, more: false, events: eventos.filter((evento) => evento.seq > depois) }]
      }
      return undefined
    }

    socket.empurrar({ t: "channel.event", channel: CANAL, seq: 0, kind: "welcome", ciphertext: toBase64(convite.welcome), receivedAtMinute: 0 })
    await ate(() => paginaPedida && session.channels.includes(CANAL))

    // A send that does not wait for the recovery (only what a person writes
    // waits): the device signal, a `typing` born expired, as the live trace had.
    await session.send(CANAL, { t: "typing", until: 0 })
    const pedido = [...socket.sent].reverse().find((frame) => frame.t === "channel.backfill" && frame.channel === CANAL)
    const depois = typeof pedido?.afterSeq === "number" ? pedido.afterSeq : -1
    socket.empurrar({ t: "channel.backfill.page", channel: CANAL, more: false, events: eventos.filter((evento) => evento.seq > depois) })

    await ate(() => (vault.contents.lastSeq[CANAL] ?? -1) >= 3)
    await assentar(100)

    const lidas = (vault.contents.history[CANAL] ?? [])
      .filter((entrada) => entrada.payload.t === "message")
      .map((entrada) => String(entrada.payload.body))
    expect(lidas).toEqual(["do dono"])
    // And our own echo is not reported as a loss, nor kept as a gap to ask for again.
    expect(estados.filter((estado) => estado.code === "epoca-saltada")).toEqual([])
    expect(vault.contents.lacunas).toBeUndefined()
    expect(session.deafChannels()).toEqual([])
  }, 60_000)
})
