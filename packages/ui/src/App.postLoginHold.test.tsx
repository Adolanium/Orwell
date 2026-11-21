import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { POST_LOGIN_CAP_MS, POST_LOGIN_EXTRA_MS, postLoginHold } from "./hooks/usePostLoginHold.js"
import { moradaDeTeste } from "../testes/moradas.js"

/**
 * The opening stays after entering until the session is online AND
 * `POST_LOGIN_EXTRA_MS` have passed, whichever comes last, and never longer
 * than `POST_LOGIN_CAP_MS`. The remembered session (the silent unlock) is the
 * entry measured here: it is the one that used to show the layout still
 * connecting.
 */

const EU = "@eu:casa.pt"
const LAGAR = "!lagar:casa.pt"

type Estado = "offline" | "connecting" | "online" | "reconnecting"

function ponte(ligacao: { emitir: ((estado: Estado) => void) | null }, list: ReturnType<typeof vi.fn>): EnclaveBridge {
  return {
    vault: {
      status: async () => ({ exists: true, supportsOsProtection: true }),
      unlock: async () => ({ ok: true }),
      create: async () => ({ ok: true }),
      lock: async () => ({ ok: true }),
      destroy: async () => ({ ok: true }),
    },
    identity: {
      load: async () => ({ address: EU, accountId: "eu" }),
      create: async () => ({ address: EU, accountId: "eu" }),
    },
    session: {
      // Never settles, like a socket still in its handshake: the state comes by event.
      connect: () => new Promise(() => {}),
      capabilities: async () => ["mls"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
      list,
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: async () => ({ ok: true }),
      declineChannelInvite: async () => ({ ok: true }),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU],
      history: async () => [],
      forget: async () => ({ ok: true }),
      leave: async () => ({ ok: true }),
      safetyNumber: async () => null,
    },
    invites: {
      create: async () => "enclave://join/x/y#z",
      redeem: async () => ({ ok: true }),
      list: async () => [],
      revoke: async () => ({ ok: true }),
    },
    social: {
      post: async () => ({ ok: true }),
      acceptFollower: async () => ({ ok: true }),
      acceptFriend: async () => ({ ok: true }),
      declineFriend: async () => ({ ok: true }),
      unfriend: async () => ({ ok: true }),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      feedChannel: async () => moradaDeTeste("mural eu", "casa.pt"),
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({}),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: () => () => {},
      epoch: () => () => {},
      status: () => () => {},
      connection: (handler: (raw: unknown) => void) => {
        ligacao.emitir = (state) => handler({ state })
        return () => {
          ligacao.emitir = null
        }
      },
      channels: () => () => {},
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}

/** The layout is on screen: the rail's Chat button only exists in it. */
function layoutAberto(): boolean {
  return screen.queryByRole("button", { name: strings.rail.chat }) !== null
}

function aberturaNoEcra(): boolean {
  return document.querySelector(".gate .abertura") !== null
}

async function avancar(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Render and run until the gate has entered (`enter` reads the channel list). Time spent here: none. */
async function entrar(): Promise<{ emitir: (estado: Estado) => void }> {
  const ligacao: { emitir: ((estado: Estado) => void) | null } = { emitir: null }
  const list = vi.fn(async () => [LAGAR])
  render(<App bridge={ponte(ligacao, list)} />)
  for (let i = 0; i < 50 && list.mock.calls.length === 0; i++) await avancar(0)
  expect(list).toHaveBeenCalled()
  return {
    emitir: (estado) =>
      act(() => {
        ligacao.emitir?.(estado)
      }),
  }
}

describe("the opening after entering", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    postLoginHold.extraMs = POST_LOGIN_EXTRA_MS
    postLoginHold.capMs = POST_LOGIN_CAP_MS
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    // Back to the package's default for the tests: off (see `testes/lingua-de-teste.ts`).
    postLoginHold.capMs = 0
  })

  it("the numbers: 2 s extra, a 10 s ceiling", () => {
    expect(POST_LOGIN_EXTRA_MS).toBe(2000)
    expect(POST_LOGIN_CAP_MS).toBe(10_000)
  })

  it("stays at least 2 s more, even when the connection is already there", async () => {
    const { emitir } = await entrar()
    emitir("connecting")
    emitir("online")
    expect(aberturaNoEcra()).toBe(true)
    await avancar(POST_LOGIN_EXTRA_MS - 1)
    expect(aberturaNoEcra()).toBe(true)
    expect(layoutAberto()).toBe(false)
    await avancar(1)
    expect(layoutAberto()).toBe(true)
    expect(aberturaNoEcra()).toBe(false)
  })

  it("does not leave before the connection: the connection is last, it decides", async () => {
    const { emitir } = await entrar()
    emitir("connecting")
    await avancar(POST_LOGIN_EXTRA_MS + 3000)
    expect(aberturaNoEcra()).toBe(true)
    expect(layoutAberto()).toBe(false)
    emitir("online")
    await avancar(0)
    expect(layoutAberto()).toBe(true)
  })

  it("leaves at the ceiling when the connection never comes, with the connecting banner", async () => {
    const { emitir } = await entrar()
    emitir("connecting")
    await avancar(POST_LOGIN_CAP_MS - 1)
    expect(aberturaNoEcra()).toBe(true)
    expect(layoutAberto()).toBe(false)
    await avancar(1)
    expect(layoutAberto()).toBe(true)
    expect(screen.getByRole("button", { name: strings.connection.aLigar })).toBeTruthy()
  })

  it("once open, a drop does not bring the opening back", async () => {
    const { emitir } = await entrar()
    emitir("online")
    await avancar(POST_LOGIN_EXTRA_MS)
    expect(layoutAberto()).toBe(true)
    emitir("reconnecting")
    await avancar(POST_LOGIN_CAP_MS)
    expect(layoutAberto()).toBe(true)
    expect(aberturaNoEcra()).toBe(false)
  })
})
