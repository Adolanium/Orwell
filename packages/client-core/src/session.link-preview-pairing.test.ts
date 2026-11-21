import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Link preview answers pair by address, not by arrival order (21/11/2026).
 *
 * The server handles each frame on its own, so two previews in flight answer
 * in the order their pages answer, not the order they were asked. A third one
 * over `PREVIEWS_AT_ONCE` is refused at once, ahead of the other two. Paired by
 * arrival, a video got another video's thumbnail, or the refusal meant for
 * someone else, and left with a blank card. Found while proving the YouTube
 * thumbnails fix with videos pasted one after another.
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

/** A server that authenticates and keeps the preview requests for the test to answer. */
class FakeSocket {
  static last: FakeSocket | null = null
  readyState = 0
  readonly previews: string[] = []
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
    if (frame.t === "hello") this.answer({ t: "hello.ok", version: 1, capabilities: [] })
    else if (frame.t === "auth.begin") this.answer({ t: "auth.challenge", nonce: "AAAA" })
    else if (frame.t === "auth.finish") this.answer({ t: "auth.ok", address: "@x:localhost" })
    else if (frame.t === "link.preview") this.previews.push(String(frame.url))
  }

  answer(frame: unknown): void {
    setTimeout(() => this.fire("message", { data: JSON.stringify(frame) }), 0)
  }

  close(): void {
    this.readyState = 3
    setTimeout(() => this.fire("close", {}), 0)
  }

  fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

async function settle(times = 60): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function connected(): Promise<Session> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await settle()
  return session
}

beforeEach(() => {
  FakeSocket.last = null
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

const A = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
const B = "https://youtu.be/jNQXAC9IVRw"
const C = "https://www.youtube.com/shorts/aqz-KE-bpKQ"

describe("previewLink pairs each answer with its own address", () => {
  it("answers in a different order than asked still reach the right request", async () => {
    const session = await connected()
    const a = session.previewLink(A)
    const b = session.previewLink(B)
    await settle(5)
    expect(FakeSocket.last?.previews).toEqual([A, B])

    // B's page answers first.
    FakeSocket.last?.answer({ t: "link.preview.result", url: B, ok: true, title: "B", image: "data:image/jpeg;base64,Qg==" })
    FakeSocket.last?.answer({ t: "link.preview.result", url: A, ok: true, title: "A", image: "data:image/jpeg;base64,QQ==" })

    await expect(a).resolves.toMatchObject({ title: "A", image: "data:image/jpeg;base64,QQ==" })
    await expect(b).resolves.toMatchObject({ title: "B", image: "data:image/jpeg;base64,Qg==" })
    session.disconnect()
  })

  it("a refusal for one address does not fail another request in flight", async () => {
    const session = await connected()
    const a = session.previewLink(A)
    const c = session.previewLink(C)
    // Watched from the start: the refusal lands before the test reads it.
    const cRefused = expect(c).rejects.toThrow()
    await settle(5)

    // The server refuses C at once (too many at once), while A is still being fetched.
    FakeSocket.last?.answer({ t: "link.preview.result", url: C, ok: false, reason: "too many requests" })
    await settle(5)
    FakeSocket.last?.answer({ t: "link.preview.result", url: A, ok: true, title: "A" })

    await cRefused
    await expect(a).resolves.toMatchObject({ title: "A" })
    session.disconnect()
  })

  it("two requests for the same address both get the answer", async () => {
    const session = await connected()
    const first = session.previewLink(A)
    const second = session.previewLink(A)
    await settle(5)
    FakeSocket.last?.answer({ t: "link.preview.result", url: A, ok: true, title: "A" })
    FakeSocket.last?.answer({ t: "link.preview.result", url: A, ok: true, title: "A" })
    await expect(first).resolves.toMatchObject({ title: "A" })
    await expect(second).resolves.toMatchObject({ title: "A" })
    session.disconnect()
  })
})
