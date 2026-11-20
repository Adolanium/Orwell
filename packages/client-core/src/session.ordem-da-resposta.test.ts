import { addMembers, createChannel, decodeKeyPackage, encryptPayload } from "@enclave/crypto"
import { fromBase64, generateIdentity, parseServerName, toBase64, type Payload } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, entradasDoCanal, type VaultBackend } from "./vault.js"

/**
 * **A quick reply of ours stays BELOW the message it answers, in the vault and
 * after a restart** (defect of 20/11/2026, desktop 1.3.22).
 *
 * The server numbers the other side's message first (`seq` N) and our reply
 * after it (N+1). But this device can record our reply before it records the
 * other side's message: our send enters the history at send time, and the
 * message the server numbered before it can still be on its way to this device
 * (a busy device, a live frame lost to a replaced connection, a gap filled by
 * recovery). `appendHistory` pushed each arrival to the end and `confirmarSeq`
 * gave our entry its `seq` where it stood, so the vault kept arrival order,
 * N+1 above N, and a restart drew it the same way.
 *
 * The fake server makes the order exact. Clock skew is a control: no list is
 * ordered by `sentAt`, so a sender clock 30 s off changes nothing.
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

const CANAL = "!resposta:localhost:8448"
const CASA = parseServerName("localhost:8448")
const MINUTO_DE_AGORA = Math.floor(Date.now() / 60_000)

function texto(corpo: string): Extract<Payload, { t: "message" }> {
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


interface Montagem {
  vault: Vault
  session: Session
  socket: FakeSocket
  eventos: { seq: number; kind: string; ciphertext: string; receivedAtMinute: number }[]
  dizer: (corpo: string, sentAt: number) => Promise<{ seq: number; kind: string; ciphertext: string; receivedAtMinute: number }>
}

/** Bento (this device) seated in the owner's channel by Welcome, recovery done. */
async function montar(): Promise<Montagem & { backend: MemoryBackend }> {
  const backend = new MemoryBackend()
  const vault = new Vault(backend)
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await assentar(20)
  const socket = FakeSocket.last
  if (!socket) throw new Error("no socket")
  const dono = generateIdentity(CASA)
  let grupo = await createChannel(dono, CANAL)
  const publicacao = socket.sent.find((frame) => frame.t === "keypackage.publish")
  const pacote = (publicacao?.packages as string[] | undefined)?.[0]
  if (!pacote) throw new Error("Bento published no key packages")
  const convite = await addMembers(grupo, [decodeKeyPackage(fromBase64(pacote))])
  grupo = convite.session
  const eventos: Montagem["eventos"] = []
  const dizer: Montagem["dizer"] = async (corpo, sentAt) => {
    const dito = await encryptPayload(grupo, { ...texto(corpo), sentAt })
    grupo = dito.session
    const evento = { seq: (eventos.at(-1)?.seq ?? 0) + 1, kind: "application", ciphertext: toBase64(dito.ciphertext), receivedAtMinute: MINUTO_DE_AGORA }
    eventos.push(evento)
    return evento
  }
  FakeSocket.reply = (frame) => {
    const base = respostaBase(frame)
    if (base) return base
    if (frame.t === "channel.send" && frame.channel === CANAL) {
      const seq = (eventos.at(-1)?.seq ?? 0) + 1
      eventos.push({ seq, kind: String(frame.kind), ciphertext: String(frame.ciphertext), receivedAtMinute: MINUTO_DE_AGORA })
      // `ref` only on our own send: a signal (typing) goes out without one and gets no echo.
      if (frame.ref === undefined) return undefined
      return [{ t: "channel.event", channel: CANAL, seq, kind: frame.kind, ciphertext: frame.ciphertext, receivedAtMinute: MINUTO_DE_AGORA, ref: frame.ref }]
    }
    if (frame.t === "channel.backfill" && frame.channel === CANAL) {
      const depois = typeof frame.afterSeq === "number" ? frame.afterSeq : -1
      return [{ t: "channel.backfill.page", channel: CANAL, more: false, events: eventos.filter((evento) => evento.seq > depois) }]
    }
    return undefined
  }
  // seq 1: the owner says hello. Bento's recovery after the Welcome reads it.
  await dizer("olá", Date.now())
  socket.empurrar({ t: "channel.event", channel: CANAL, seq: 0, kind: "welcome", ciphertext: toBase64(convite.welcome), receivedAtMinute: 0 })
  await ate(() => session.channels.includes(CANAL) && (vault.contents.lastSeq[CANAL] ?? -1) >= 1)
  await assentar(40)
  return { vault, session, socket, eventos, dizer, backend }
}

function corpos(vault: Vault): string[] {
  return entradasDoCanal(vault.contents, CANAL)
    .filter((entrada) => entrada.payload.t === "message")
    .map((entrada) => String(entrada.payload.body))
}

/** The order a restart reads: the same bytes, opened by a new vault. */
async function aoReabrir(backend: MemoryBackend, session: Session): Promise<string[]> {
  await session.flush()
  const outro = new Vault(backend)
  await outro.unlock("frase-passe")
  return corpos(outro)
}

describe("a resposta rápida fica por baixo da mensagem a que responde", () => {
  it("controlo: a mensagem do outro chega, a resposta sai logo a seguir", async () => {
    const { vault, session, socket, dizer } = await montar()
    const pergunta = await dizer("pergunta", Date.now())
    socket.empurrar({ t: "channel.event", channel: CANAL, ...pergunta })
    await ate(() => corpos(vault).includes("pergunta"))
    const ecos: { channel: string; id: string; seq: number }[] = []
    session.on("eco", (eco) => ecos.push(eco))
    const resposta = texto("resposta")
    await session.send(CANAL, resposta)
    await ate(() => entradasDoCanal(vault.contents, CANAL).some((entrada) => entrada.payload.body === "resposta" && entrada.seq >= 0))
    expect(corpos(vault)).toEqual(["olá", "pergunta", "resposta"])
    // The screen hears the echo `seq` of our message, by its id.
    const guardada = entradasDoCanal(vault.contents, CANAL).find((entrada) => entrada.payload.body === "resposta")
    expect(ecos).toEqual([{ channel: CANAL, id: resposta.id, seq: guardada?.seq }])
  }, 60_000)

  it.each([30_000, -30_000])("controlo: o relógio de quem pergunta desviado %i ms não muda a ordem", async (desvio) => {
    const { vault, session, socket, dizer } = await montar()
    const pergunta = await dizer("pergunta", Date.now() + desvio)
    socket.empurrar({ t: "channel.event", channel: CANAL, ...pergunta })
    await ate(() => corpos(vault).includes("pergunta"))
    await session.send(CANAL, texto("resposta"))
    await ate(() => entradasDoCanal(vault.contents, CANAL).some((entrada) => entrada.payload.body === "resposta" && entrada.seq >= 0))
    expect(corpos(vault)).toEqual(["olá", "pergunta", "resposta"])
  }, 60_000)

  it("a mensagem que o servidor numerou antes chega a este aparelho depois do eco da resposta", async () => {
    const { vault, session, socket, dizer, backend } = await montar()
    // The server numbers the question (seq 2) and holds the live frame: it is still on its way here.
    const pergunta = await dizer("pergunta", Date.now())
    await session.send(CANAL, texto("resposta"))
    await ate(() => entradasDoCanal(vault.contents, CANAL).some((entrada) => entrada.payload.body === "resposta" && entrada.seq >= 0))
    socket.empurrar({ t: "channel.event", channel: CANAL, ...pergunta })
    await ate(() => corpos(vault).includes("pergunta"))
    await assentar(40)
    expect(corpos(vault)).toEqual(["olá", "pergunta", "resposta"])
    // By server order: each `seq` larger than the one before.
    const seqs = entradasDoCanal(vault.contents, CANAL).filter((entrada) => entrada.payload.t === "message").map((entrada) => entrada.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(await aoReabrir(backend, session)).toEqual(["olá", "pergunta", "resposta"])
  }, 60_000)

  it("a mensagem chega depois da resposta sair, mas antes do eco", async () => {
    const { vault, session, socket, dizer, backend } = await montar()
    const pergunta = await dizer("pergunta", Date.now())
    // Hold our echo until the question has arrived.
    const responder = FakeSocket.reply
    let ecoRetido: unknown[] | undefined
    FakeSocket.reply = (frame) => {
      const resposta = responder(frame)
      if (frame.t === "channel.send" && frame.ref !== undefined) {
        ecoRetido = resposta
        return undefined
      }
      return resposta
    }
    const envio = session.send(CANAL, texto("resposta"))
    await ate(() => ecoRetido !== undefined && corpos(vault).includes("resposta"))
    socket.empurrar({ t: "channel.event", channel: CANAL, ...pergunta })
    await ate(() => corpos(vault).includes("pergunta"))
    for (const frame of ecoRetido ?? []) socket.empurrar(frame)
    await envio
    await ate(() => entradasDoCanal(vault.contents, CANAL).some((entrada) => entrada.payload.body === "resposta" && entrada.seq >= 0))
    await assentar(40)
    expect(corpos(vault)).toEqual(["olá", "pergunta", "resposta"])
    expect(await aoReabrir(backend, session)).toEqual(["olá", "pergunta", "resposta"])
  }, 60_000)
})
