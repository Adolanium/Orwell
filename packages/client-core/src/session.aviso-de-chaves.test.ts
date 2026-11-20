import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The hourly cap on the top-ups that `keypackage.low` starts (1.3.25, P4).
 *
 * Since 1.3.25 the server nudges after a claim that found this device's pool empty
 * too, so someone claiming the account in a loop gets one nudge per 5 s. Without a
 * cap each nudge minted 20 key packages until the ring was full, and reset the ring
 * at 0. The login top-up is not capped. The harness is the one of
 * `session.antes-do-auth.test.ts`: a fake server that accepts the handshake.
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
    if (frame.t === "ping") {
      this.answer({ t: "pong" })
    } else if (frame.t === "hello") {
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


const ORIGINAIS = {
  cap: Session.CHAVES_POR_HORA_POR_AVISO,
  anel: Session.KEY_PACKAGES_LOCAIS_MAX,
  espera: Session.ESPERA_ANTES_DE_REINICIAR_O_ANEL_MS,
}
beforeEach(() => {
  FakeSocket.last = null
  FakeSocket.segurarAuth = false
  FakeSocket.largarAuth = null
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  Session.CHAVES_POR_HORA_POR_AVISO = ORIGINAIS.cap
  Session.KEY_PACKAGES_LOCAIS_MAX = ORIGINAIS.anel
  Session.ESPERA_ANTES_DE_REINICIAR_O_ANEL_MS = ORIGINAIS.espera
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

const publicacoes = (socket: FakeSocket): Frame[] => socket.sent.filter((frame) => frame.t === "keypackage.publish")

async function sessaoLigada(): Promise<{ session: Session; socket: FakeSocket; registos: string[] }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  const registos: string[] = []
  session.on("status", (estado: { code?: string }) => {
    if (estado.code) registos.push(estado.code)
  })
  await session.connect()
  await settle()
  const socket = FakeSocket.last as FakeSocket
  // The login published the first pool (the vault had no key packages).
  expect(publicacoes(socket)).toHaveLength(1)
  return { session, socket, registos }
}

describe("keypackage.low com tecto por hora", () => {
  it("passado o tecto de chaves geradas, um aviso não gera chaves e fica no registo", async () => {
    Session.CHAVES_POR_HORA_POR_AVISO = 60
    const { session, socket, registos } = await sessaoLigada()
    for (let i = 0; i < 10; i++) {
      socket.answer({ t: "keypackage.low", remaining: 5 })
      await settle()
    }
    // Three top-ups of 20 from nudges, the rest ignored (without the cap: nine, until the ring of 200 is full).
    expect(publicacoes(socket)).toHaveLength(1 + 3)
    expect(registos.filter((c) => c === "keypackage-cap")).toHaveLength(7)
    session.disconnect()
  }, 60_000)

  it("com o anel cheio, os avisos que não geram nada não gastam o tecto, e o aviso a zero ainda reinicia o anel", async () => {
    // The merge of 1.3.25: the cap counted nudges, a full ring answers each one above 0
    // with nothing, and the nudge at 0 that resets the ring came after the cap.
    Session.KEY_PACKAGES_LOCAIS_MAX = 40
    Session.ESPERA_ANTES_DE_REINICIAR_O_ANEL_MS = 0
    const { session, socket, registos } = await sessaoLigada()
    socket.answer({ t: "keypackage.low", remaining: 15 })
    await settle()
    // Ring at 40: full.
    expect(publicacoes(socket)).toHaveLength(2)
    // Fourteen nudges above 0, more than the twelve the old cap allowed: none mints anything.
    for (let i = 0; i < 14; i++) {
      socket.answer({ t: "keypackage.low", remaining: 14 - i })
      await settle()
    }
    expect(publicacoes(socket)).toHaveLength(2)
    socket.answer({ t: "keypackage.low", remaining: 0 })
    await settle(200)
    const ultima = publicacoes(socket).at(-1)
    expect(publicacoes(socket)).toHaveLength(3)
    expect(ultima?.["replace"]).toBe(true)
    expect(registos).not.toContain("keypackage-cap")
    session.disconnect()
  }, 60_000)
})
