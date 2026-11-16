import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * No account frame leaves before the connection is authenticated (review of
 * 1.3.8, finding 2).
 *
 * Since 1.3.8 the app opens when the vault opens, before `connect()` ends, so a
 * channel is on screen while the socket is open and the `auth.ok` has not
 * arrived. A message, a reaction or a typing signal sent in that window reached
 * the server before authentication, and the server answers that with a FATAL
 * `unauthenticated` and closes the socket.
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

interface Frame {
  t: string
  [key: string]: unknown
}

/** A server that accepts the handshake and swallows everything else without complaint. */
class FakeSocket {
  static last: FakeSocket | null = null
  /** Hold the `auth.ok` until `largarAuth` is called. */
  static segurarAuth = false
  static largarAuth: (() => void) | null = null

  readyState = 0
  readonly sent: Frame[] = []
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.last = this
    setTimeout(() => {
      this.readyState = 1
      this.fire("open", {})
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
    this.#listeners.set(
      kind,
      (this.#listeners.get(kind) ?? []).filter((item) => item !== handler),
    )
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as Frame
    this.sent.push(frame)
    if (frame.t === "hello") {
      this.answer({ t: "hello.ok", version: 1, capabilities: [] })
    } else if (frame.t === "auth.begin") {
      this.answer({ t: "auth.challenge", nonce: "AAAA" })
    } else if (frame.t === "auth.finish") {
      if (FakeSocket.segurarAuth) FakeSocket.largarAuth = () => this.answer({ t: "auth.ok", address: "@x:localhost" })
      else this.answer({ t: "auth.ok", address: "@x:localhost" })
    }
  }

  answer(frame: unknown): void {
    setTimeout(() => this.fire("message", { data: JSON.stringify(frame) }), 0)
  }

  close(): void {
    this.readyState = 3
    // Asynchronous, as in a browser: the `close` event arrives after `close()` returns.
    setTimeout(() => this.fire("close", {}), 0)
  }

  fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

async function settle(times = 60): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const CANAL = moradaDeTeste("sala")

/** Session connected, with vault and MLS group for real. */
async function sessaoLigada(): Promise<Session> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await settle()
  await session.createSpaceChannel(CANAL).catch(() => {})
  await settle()
  return session
}

beforeEach(() => {
  FakeSocket.last = null
  FakeSocket.segurarAuth = false
  FakeSocket.largarAuth = null
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

/** The frames the session put on the wire for this channel. */
function enviados(): Frame[] {
  return (FakeSocket.last?.sent ?? []).filter((frame) => frame.t === "channel.send")
}

const HANDSHAKE = new Set(["hello", "auth.begin", "auth.finish", "ping"])

describe("antes do auth.ok", () => {
  it("uma mensagem e o sinal de escrita esperam pela autenticação, e a mensagem sai depois dela", async () => {
    const session = await sessaoLigada()
    session.disconnect()
    await settle()

    FakeSocket.segurarAuth = true
    const ligacao = session.connect()
    for (let i = 0; i < 200 && FakeSocket.largarAuth === null; i++) await settle(1)
    expect(FakeSocket.largarAuth).not.toBeNull()
    const socket = FakeSocket.last as FakeSocket

    const envio = session.send(CANAL, { t: "message", id: "mensagem-antes-do-auth", sentAt: Date.now(), body: "cedo", attachments: [], mentions: [], links: [] })
    const escrita = session.sinalizarEscrita(CANAL)
    await settle()
    // Nothing but the handshake went out on this socket.
    expect(socket.sent.filter((frame) => !HANDSHAKE.has(frame.t)).map((frame) => frame.t)).toEqual([])

    FakeSocket.largarAuth?.()
    await ligacao
    await envio
    await escrita
    await settle()
    expect(socket.sent.some((frame) => frame.t === "channel.send")).toBe(true)
  }, 60_000)

  it("depois de desligar e voltar a ligar, nenhuma trama interna sai antes do auth.ok (re-revisão, R1)", async () => {
    // `#autenticado` only went back to false in `#onClose`, and `disconnect()`
    // drops the socket before its `close` arrives: the next handshake ran with
    // the flag still true, and an internal frame (here `presence.set`) went out
    // before `auth.ok`, which the server answers with a fatal `unauthenticated`.
    const session = await sessaoLigada()
    session.disconnect()
    await settle()

    FakeSocket.segurarAuth = true
    const ligacao = session.connect()
    for (let i = 0; i < 200 && FakeSocket.largarAuth === null; i++) await settle(1)
    expect(FakeSocket.largarAuth).not.toBeNull()
    const socket = FakeSocket.last as FakeSocket
    session.setVisible(false)
    await settle()
    expect(socket.sent.filter((frame) => !HANDSHAKE.has(frame.t)).map((frame) => frame.t)).toEqual([])

    FakeSocket.largarAuth?.()
    await ligacao
  }, 60_000)
})
