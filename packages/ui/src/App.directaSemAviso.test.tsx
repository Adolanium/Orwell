import { moradaDeTeste } from "../testes/moradas.js"
import type { FichaDoCanal } from "@enclave/client-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { motor } from "./sons/motor.js"
import { strings } from "./strings.js"
import { DEFAULT_PREFS, readPrefs, writePrefs } from "./hooks/usePrefs.js"

/**
 * Opening a direct is not a notice (12/11/2026).
 *
 * "When a user opens the conversation with another, without friendship, the other
 * user is notified; I do not want that." The opener's device creates the MLS
 * group and seats us, so the channel arrives here through `onChannels`, often
 * followed by the opener's profile. Neither may make a sound, ring the bell,
 * raise a system notice, or put a new row in the Friends column. A friend request
 * that comes later still does all of that, as before.
 */

vi.mock("./sons/motor.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./sons/motor.js")>()
  return {
    ...real,
    motor: {
      tocar: vi.fn(() => "tocou"),
      tocarChamada: vi.fn(() => "tocou"),
      pararChamada: vi.fn(),
      chamadaATocar: vi.fn(() => null),
      chamar: vi.fn(() => "tocou"),
      pararDeChamar: vi.fn(),
      aChamar: vi.fn(() => null),
      ouvir: vi.fn(() => true),
      armar: () => () => {},
      ligarAmbiente: vi.fn(),
    },
  }
})

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

afterEach(cleanup)
beforeEach(() => {
  vi.mocked(motor.tocar).mockClear()
  vi.mocked(motor.tocarChamada).mockClear()
})

const EU = "@eu:casa.pt"

const MURAL_DA_ANA = moradaDeTeste("mural ana", "casa.pt")
const MEU_FEED = moradaDeTeste("mural eu", "casa.pt")
/** The card of each channel (1.0 "Arca", slice 6b), for the false bridge to give to the interface. */
const FICHAS = (): Record<string, FichaDoCanal> => ({
  [DM]: { tipo: "directa", par: "@ana:casa.pt" },
  [MURAL_DA_ANA]: { tipo: "mural", dono: "@ana:casa.pt" },
  [MEU_FEED]: { tipo: "mural", dono: "@eu:casa.pt" },
})
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"
const DM = moradaDeTeste("directa ana eu", "casa.pt")

type Mensagem = { channel: string; sender: string; seq: number; payload: Record<string, unknown> }
let onMessage: ((message: Mensagem) => void) | null = null
let onCallActivity: ((event: { channel: string; from: string; joined: boolean; room: string }) => void) | null = null
let onConnection: ((payload: { state: string }) => void) | null = null
let onChannels: ((payload: { channels: string[] }) => void) | null = null

function ponte(): EnclaveBridge {
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
      connect: async () => ({ ok: true }),
      capabilities: async () => ["mls"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
        fichas: FICHAS,
      list: async () => [LAGAR],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [{ room: "voz", name: "voz", category: "", kind: "voice", position: 0 }],
    },
    invites: {
      create: async () => "enclave://join/x/y#z",
      redeem: async () => ({ ok: true }),
      list: async () => [],
      revoke: async () => ({ ok: true }),
    },
    social: {
      post: async () => ({ ok: true }),
      acceptFollower: vi.fn().mockResolvedValue({ ok: true }),
      acceptFriend: vi.fn().mockResolvedValue({ ok: true }),
      declineFriend: vi.fn().mockResolvedValue({ ok: true }),
      unfriend: vi.fn().mockResolvedValue({ ok: true }),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      feedChannel: async () => MEU_FEED,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({}),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (handler: never) => {
        onMessage = handler as never
        return () => {}
      },
      epoch: () => () => {},
      status: () => () => {},
      connection: (handler: never) => {
        onConnection = handler as never
        return () => {}
      },
      channels: (handler: never) => {
        onChannels = handler as never
        return () => {}
      },
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: (handler: never) => {
        onCallActivity = handler as never
        return () => {}
      },
    },
    call: {
      on: () => () => {},
      setMuted: () => {},
      setCameraOff: () => {},
      join: async () => ({ ok: true }),
      leave: async () => ({ ok: true }),
      tectoDePartilha: 6,
      podePartilharEcra: false,
    },
  } as unknown as EnclaveBridge
}

async function abrir(bridge: EnclaveBridge = ponte()): Promise<void> {
  render(<App bridge={bridge} />)
  await screen.findByRole("button", { name: strings.rail.chat })
}

let seq = 0
async function chega(channel: string, sender: string, payload: Record<string, unknown>): Promise<void> {
  seq += 1
  await act(async () => {
    onMessage?.({ channel, sender, seq, payload: { id: `m${seq}`, sentAt: Date.now(), ...payload } })
    await Promise.resolve()
  })
}

const tipos = (): string[] => vi.mocked(motor.tocar).mock.calls.map(([acontecimento]) => acontecimento.tipo)


async function chegaACanal(channels: string[]): Promise<void> {
  await act(async () => {
    onChannels?.({ channels })
    await Promise.resolve()
  })
}

/** The bell button's name carries the unread count, so finding it by name checks the count too. */
async function abrirSino(porLer: number): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: strings.notifCenter.bellWithCount(porLer) }))
}

describe("abrir uma conversa directa não avisa a outra pessoa", () => {
  it("a conversa nova, vazia, de quem não é amigo: sem som, sem sino, sem linha em Amigos", async () => {
    await abrir()
    await chegaACanal([LAGAR])
    await chegaACanal([LAGAR, DM])
    // What the opener publishes on opening: their profile. Not a word said.
    await chega(DM, ANA, { t: "profile", displayName: "Ana", updatedAt: 1 })

    expect(tipos()).toEqual([])

    await abrirSino(0)
    expect(await screen.findByText(strings.notifCenter.empty)).toBeTruthy()
    await userEvent.setup().keyboard("{Escape}")

    await userEvent.setup().click(screen.getByRole("button", { name: strings.rail.people }))
    const coluna = await screen.findByRole("complementary", { name: strings.people.asideLabel })
    expect(within(coluna).queryByText("Ana")).toBeNull()
    expect(within(coluna).getByText(strings.people.directsEmpty)).toBeTruthy()
  })

  it("o pedido de amizade que vem depois continua a avisar, uma vez", async () => {
    await abrir()
    await chegaACanal([LAGAR])
    await chegaACanal([LAGAR, DM])
    await chega(DM, ANA, { t: "profile", displayName: "Ana", updatedAt: 1 })
    await chega(DM, ANA, { t: "friend.request" })

    expect(tipos()).toEqual(["pedido"])
    await abrirSino(1)
    // One line in the bell: the request, and no "opened a conversation" next to it.
    expect(document.querySelectorAll(".notif-list li")).toHaveLength(1)
  })
})
