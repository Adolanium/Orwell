import { CAPACIDADE_LIMITE_DE_CANAIS, RECUSA_DE_LIMITE_DE_CANAIS } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { moradaNova } from "../testes/moradas.js"
import { ERRO_LIMITE_DE_CANAIS, Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * A claim's answer is paired by its channel, not by its type (1.3.26 review,
 * note 5).
 *
 * `channel.claim.result` and `room.claim.result` waited in one queue per type.
 * When answers came back in another order (one late, or one whose wait had
 * given up), a claim took the answer of another channel: it returned as if
 * there were no refusal, and the other flow could read a refusal as "not
 * mine". Each answer now goes to the wait for its own channel (and room).
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

/** Each reply with its delay in ms. */
type Reply = (frame: Sent) => { frame: unknown; delayMs?: number }[] | undefined

class FakeSocket {
  static reply: Reply = () => undefined
  readyState = 0
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    setTimeout(() => {
      this.readyState = 1
      this.fire("open", {})
    }, 0)
  }

  addEventListener(kind: string, handler: (event: unknown) => void): void {
    this.#listeners.set(kind, [...(this.#listeners.get(kind) ?? []), handler])
  }

  removeEventListener(kind: string, handler: (event: unknown) => void): void {
    this.#listeners.set(kind, (this.#listeners.get(kind) ?? []).filter((item) => item !== handler))
  }

  send(raw: string): void {
    for (const { frame, delayMs } of FakeSocket.reply(JSON.parse(raw) as Sent) ?? []) {
      setTimeout(() => this.fire("message", { data: JSON.stringify(frame) }), delayMs ?? 0)
    }
  }

  close(): void {
    this.readyState = 3
    this.fire("close", {})
  }

  fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

async function settle(times = 60): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("claim answers paired by channel", () => {
  it("a late refusal for one channel still reaches that channel, not the next claim", async () => {
    const refused = moradaNova()
    const allowed = moradaNova()
    FakeSocket.reply = (frame) => {
      if (frame.t === "hello") return [{ frame: { t: "hello.ok", version: 1, capabilities: [CAPACIDADE_LIMITE_DE_CANAIS] } }]
      if (frame.t === "auth.begin") return [{ frame: { t: "auth.challenge", nonce: "AAAA" } }]
      if (frame.t === "auth.finish") return [{ frame: { t: "auth.ok", address: "@x:localhost" } }]
      if (frame.t === "channel.claim" && frame.channel === refused) {
        // The refusal comes late: the claim for the other channel is answered first.
        return [
          {
            frame: { t: "channel.claim.result", channel: refused, owner: "", mine: false, recusa: RECUSA_DE_LIMITE_DE_CANAIS },
            delayMs: 200,
          },
        ]
      }
      if (frame.t === "channel.claim" && frame.channel === allowed) {
        return [{ frame: { t: "channel.claim.result", channel: allowed, owner: "@x:localhost", mine: true, empty: true } }]
      }
      return undefined
    }
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    await session.createIdentity("localhost:8448")
    await session.connect()
    await settle()

    const first = session.createSpace(refused).then(
      () => "created",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    // The second creation is not awaited: past its claim it waits on frames this socket never sends.
    void session.createSpace(allowed).catch(() => {})

    expect(await first).toBe(ERRO_LIMITE_DE_CANAIS)
    session.disconnect()
  }, 30_000)
})
