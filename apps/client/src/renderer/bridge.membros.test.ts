import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Desktop: a member list change reaches the interface and never rekeys the call
 * (1.3.26 review, finding 3).
 *
 * The session `members` event (P7: the shown list changed without an epoch)
 * travelled on `event:epoch`, the channel whose handler runs `call.rekey`. Every
 * roster answer then sent `voice.join` again and rotated the media key, with
 * no change in the group. On the web the two were already apart. Now the main
 * process sends `members` on its own channel, `event:members`, which the bridge
 * gives to the interface (and to the read cache) only. The IPC side is pinned
 * in `main/members-ipc.test.ts`.
 */

const rekeys: string[] = []

vi.mock("@enclave/client-core", () => ({
  Call: class {
    on(): () => void {
      return () => {}
    }
    emit(): void {}
    rekey(channel: string): Promise<void> {
      rekeys.push(channel)
      return Promise.resolve()
    }
    reafirmarPresenca(): void {}
    async aplicarSomAoVivo(): Promise<void> {}
  },
  Session: class {
    on(): () => void {
      return () => {}
    }
  },
  Vault: class {},
}))
vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("mediasoup-client", () => ({ Device: class {} }))
vi.mock("@enclave/ui", () => ({ registerSystemNoticeHost: () => {} }))

/** The handlers the bridge subscribed, by `on.<event>` name. */
const handlers: Record<string, ((payload: unknown) => void)[]> = {}
const fire = (event: string, payload: unknown): void => {
  for (const handler of handlers[event] ?? []) handler(payload)
}

Object.defineProperty(window, "enclaveHost", {
  value: new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "on") {
          return new Proxy(
            {},
            {
              get: (_on, event) => (handler: (payload: unknown) => void) => {
                ;(handlers[String(event)] ??= []).push(handler)
                return () => {}
              },
            },
          )
        }
        return new Proxy({}, { get: () => async () => ({}) })
      },
    },
  ),
  writable: true,
})

const { createDesktopBridge } = await import("./bridge.js")

beforeEach(() => {
  rekeys.length = 0
  for (const event of Object.keys(handlers)) delete handlers[event]
})

describe("desktop member events", () => {
  it("a members event reaches the interface and does not rekey the call", () => {
    const bridge = createDesktopBridge()
    const seen: unknown[] = []
    bridge.on.epoch((payload) => seen.push(payload))

    fire("members", { channel: "!adega:localhost" })

    expect(seen).toEqual([{ channel: "!adega:localhost" }])
    expect(rekeys).toEqual([])
  })

  it("an epoch event still rekeys the call and reaches the interface", () => {
    const bridge = createDesktopBridge()
    const seen: unknown[] = []
    bridge.on.epoch((payload) => seen.push(payload))

    fire("epoch", { channel: "!adega:localhost", epoch: 7 })

    expect(rekeys).toEqual(["!adega:localhost"])
    expect(seen).toEqual([{ channel: "!adega:localhost", epoch: 7 }])
  })

})
