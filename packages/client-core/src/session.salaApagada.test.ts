import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * A deleted room stays deleted, and takes its polls (17/11/2026). The core
 * keeps the tombstone (`removedRoomsOf`), and a later statement of the same room
 * without `removed` (a member that had not heard of the deletion republishing its
 * copy) does not bring it back. The fake socket and the linked session are from
 * `session.salaAfk.test.ts`.
 */

vi.setConfig({ testTimeout: 60_000 })
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

type Reply = (frame: Sent) => unknown[] | undefined

class FakeSocket {
  static last: FakeSocket | null = null
  static reply: Reply = () => undefined

  readyState = 0
  readonly sent: Sent[] = []
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
    const frame = JSON.parse(raw) as Sent
    this.sent.push(frame)
    const replies = FakeSocket.reply(frame)
    for (const reply of replies ?? []) {
      setTimeout(() => this.fire("message", { data: JSON.stringify(reply) }), 0)
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

function respostaBase(sala: string | undefined): Reply {
  return (frame) => {
    if (frame.t === "hello") {
      return [{ t: "hello.ok", version: 1, capabilities: [], ...(sala ? { commonRoom: sala } : {}) }]
    }
    if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
    if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost" }]
    return undefined
  }
}

async function settle(times = 60): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * A session LINKED to the fake socket, with a channel of this account.
 *
 * Linked, and not offline like in the neighboring files, because here what is
 * measured is what goes out: an unlinked session breaks in `#send` AFTER it
 * already recorded the message in history, and a test that swallowed that
 * rejection would claim "nothing went out" about a path that records and fails.
 * The refusals that this file catches must happen BEFORE that, and that is what
 * we want to see.
 */
async function sessaoCom(channel: string): Promise<{ session: Session; vault: Vault }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await settle()
  await session.createSpaceChannel(channel)
  return { session, vault }
}

/** Pass the foundation to someone else, which is how you test who does NOT command. */
async function fundadoPor(vault: Vault, channel: string, address: string): Promise<void> {
  await vault.update((contents) => {
    contents.channelFounder[channel] = { address, seq: 0 }
  })
}

beforeEach(() => {
  FakeSocket.reply = respostaBase(undefined)
  FakeSocket.last = null
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})


const CANAL = moradaDeTeste("casa")
const VOTOS = "forum-votos-aaaa"

async function comAdministrador(): Promise<{ session: Session; vault: Vault }> {
  const pronta = await sessaoCom(CANAL)
  await fundadoPor(pronta.vault, CANAL, pronta.session.identity.address)
  await pronta.session.upsertRoom(CANAL, { room: VOTOS, name: "polls", kind: "text", layout: "polls" })
  return pronta
}

describe("eliminar uma sala de votações", () => {
  it("a lápide fica na lista das salas eliminadas", async () => {
    const { session } = await comAdministrador()
    expect(session.removedRoomsOf(CANAL)).toEqual([])
    await session.upsertRoom(CANAL, { room: VOTOS, name: "polls", kind: "text", layout: "polls", closed: true, removed: true })
    expect(session.removedRoomsOf(CANAL)).toEqual([VOTOS])
    expect(session.roomsOf(CANAL).some((sala) => sala.room === VOTOS)).toBe(false)
    expect(session.closedRoomsOf(CANAL).some((sala) => sala.room === VOTOS)).toBe(false)
  })

  it("uma declaração mais recente da mesma sala, sem a lápide, não a ressuscita", async () => {
    const { session } = await comAdministrador()
    await session.upsertRoom(CANAL, { room: VOTOS, name: "polls", kind: "text", layout: "polls", closed: true, removed: true })
    // What an admin that never heard of the deletion republishes: the room alive, with a newer stamp.
    await session.upsertRoom(CANAL, { room: VOTOS, name: "polls", kind: "text", layout: "polls" })
    expect(session.removedRoomsOf(CANAL)).toEqual([VOTOS])
    expect(session.roomsOf(CANAL).some((sala) => sala.room === VOTOS)).toBe(false)
  })

  it("mudar o nome continua a ser só republicar a sala, com o layout", async () => {
    const { session } = await comAdministrador()
    await session.upsertRoom(CANAL, { room: VOTOS, name: "votações do mês", kind: "text", layout: "polls" })
    const sala = session.roomsOf(CANAL).find((s) => s.room === VOTOS)
    expect(sala?.name).toBe("votações do mês")
    expect(sala?.layout).toBe("polls")
  })
})
