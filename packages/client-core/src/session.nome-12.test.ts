import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The display name and the channel nickname stop at 12 graphemes on write.
 *
 * The guard is in the core, not only in the field: a host or a script that
 * skips the interface still cannot publish a longer name. A name that is
 * already stored longer (written by 1.3.7 to 1.3.18) is not touched: saving
 * the profile for something else (the bio, the state) keeps it as it is,
 * because refusing there would lock an old account out of its own profile.
 *
 * Harness copied from `session.antes-do-auth.test.ts`.
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

const DOZE_EMOJIS = "👨‍👩‍👧‍👦🇵🇹👍🏽😀🎉❤️👨‍👩‍👧‍👦🇵🇹👍🏽😀🎉❤️"

describe("nome de apresentação: 12 grafemas na escrita", () => {
  it("12 passa e 13 falha", async () => {
    const session = await sessaoLigada()
    await session.updateProfile({ displayName: "abcdefghijkl", donations: [] })
    expect(session.profile.displayName).toBe("abcdefghijkl")
    await expect(session.updateProfile({ displayName: "abcdefghijklm", donations: [] })).rejects.toThrow("the display name is too long")
    expect(session.profile.displayName).toBe("abcdefghijkl")
    session.disconnect()
  }, 60_000)

  it("12 emojis compostos passam", async () => {
    const session = await sessaoLigada()
    await session.updateProfile({ displayName: DOZE_EMOJIS, donations: [] })
    expect(session.profile.displayName).toBe(DOZE_EMOJIS)
    session.disconnect()
  }, 60_000)

  it("um nome antigo de 30 já guardado não impede mudar a biografia", async () => {
    const session = await sessaoLigada()
    const antigo = "Maria Eduarda Albuquerque Sous"
    session.vault.contents.profile = { displayName: antigo, donations: [], updatedAt: 1 }
    await session.updateProfile({ displayName: antigo, donations: [], bio: "nova" })
    expect(session.profile.displayName).toBe(antigo)
    expect(session.profile.bio).toBe("nova")
    session.disconnect()
  }, 60_000)

  it("o apelido do canal: 12 passa, 13 falha", async () => {
    const session = await sessaoLigada()
    const eu = session.identity.address
    await expect(session.setNickname(CANAL, eu, "abcdefghijklm")).rejects.toThrow("the nickname is too long")
    await session.setNickname(CANAL, eu, DOZE_EMOJIS)
    session.disconnect()
  }, 60_000)
})

describe("biografia: 300 grafemas na escrita, o cliente nunca envia mais", () => {
  /** The `bio` of every `profile` payload this session sends, on any channel. */
  function espiarBios(session: Session): (string | undefined)[] {
    const bios: (string | undefined)[] = []
    const original = session.send.bind(session)
    session.send = (channel, payload, opcoes) => {
      if (payload.t === "profile") bios.push(payload.bio)
      return original(channel, payload, opcoes)
    }
    return bios
  }

  it("uma biografia de 301 grava e publica com 300", async () => {
    const session = await sessaoLigada()
    const bios = espiarBios(session)
    await session.updateProfile({ displayName: "Ana", donations: [], bio: "a".repeat(301) })
    expect(session.profile.bio).toBe("a".repeat(300))
    // The publish waits for the edits to stop (1.3.26): send it now, as a close does.
    await session.publicarPerfilPendente()
    expect(bios.length).toBeGreaterThan(0)
    for (const bio of bios) expect(bio).toBe("a".repeat(300))
    session.disconnect()
  }, 60_000)

  it("uma biografia antiga de 1000 já guardada sai com 300 ao republicar", async () => {
    const session = await sessaoLigada()
    session.vault.contents.profile = { displayName: "Ana", donations: [], bio: "y".repeat(1000), updatedAt: 1 }
    const bios = espiarBios(session)
    await session.publishProfile(session.channels, true)
    expect(bios.length).toBeGreaterThan(0)
    for (const bio of bios) expect(bio).toBe("y".repeat(300))
    // The stored text is not rewritten by a publish: only an edit saves it shorter.
    expect(session.profile.bio).toBe("y".repeat(1000))
    session.disconnect()
  }, 60_000)
})
