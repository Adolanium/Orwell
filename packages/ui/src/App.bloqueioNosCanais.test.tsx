import { moradaDeTeste } from "../testes/moradas.js"
import type { FichaDoCanal } from "@enclave/client-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { motor } from "./sons/motor.js"
import { esquecerMarcasDeEntrada, LAST_READ_KEY } from "./hooks/useUnreads.js"
import { esquecerLidasPorSala } from "./lib/porLerPorSala.js"
import { esquecerReveladas } from "./lib/bloqueados.js"
import { PREFS_KEY } from "./hooks/usePrefs.js"
import { strings } from "./strings.js"
import { comLacosDoNucleo } from "./testes/lacosDoNucleo.js"

/**
 * Someone I blocked, in a room we share (20/11/2026).
 *
 * The core lets what they say in a shared room through, on purpose (see
 * `#bloqueadoAqui`). This device hides it: one folded line with "Show", no
 * sound, no count, no bell, and their reactions do not count in the chips.
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

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
/** Blocked on this device. */
const RUI = "@rui:casa.pt"
/** Where the app opens: the first channel in the list. */
const LAGAR = "!lagar:casa.pt"
/** A side channel, where counts show. */
const ADEGA = "!adega:casa.pt"
const MEU_FEED = moradaDeTeste("mural eu", "casa.pt")
const FICHAS = (): Record<string, FichaDoCanal> => ({ [MEU_FEED]: { tipo: "mural", dono: EU } })

let onMessage: ((message: unknown) => void) | null = null

function ponte(): EnclaveBridge {
  onMessage = null
  return comLacosDoNucleo({
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
      list: async () => [LAGAR, ADEGA, MEU_FEED],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      react: async () => ({ ok: true }),
      members: async () => [EU, ANA, RUI],
      history: async () => [],
      forget: async () => ({ ok: true }),
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
      acceptFollower: vi.fn().mockResolvedValue({ ok: true }),
      acceptFriend: vi.fn().mockResolvedValue({ ok: true }),
      declineFriend: vi.fn().mockResolvedValue({ ok: true }),
      unfriend: vi.fn().mockResolvedValue({ ok: true }),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      feedChannel: async () => MEU_FEED,
      blocked: vi.fn(async () => [{ address: RUI, at: 1 }]),
      block: vi.fn(async () => ({ ok: true })),
      unblock: vi.fn(async () => ({ ok: true })),
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({}),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (handler: (message: unknown) => void) => {
        onMessage = handler
        return () => {
          onMessage = null
        }
      },
      epoch: () => () => {},
      status: () => () => {},
      connection: () => () => {},
      channels: () => () => {},
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge, EU)
}

let seq = 0
async function chega(channel: string, sender: string, payload: Record<string, unknown>, aoVivo = true): Promise<void> {
  seq += 1
  await act(async () => {
    onMessage?.({ channel, sender, seq, ...(aoVivo ? { aoVivo } : {}), payload: { id: `m${seq}`, sentAt: Date.now() + 60_000, ...payload } })
    await Promise.resolve()
  })
}

/** The number above a rail icon, or nothing if there's no badge. */
function cracha(destino: string): string | null {
  return screen.getByRole("button", { name: destino }).querySelector(".rail-count")?.textContent ?? null
}

async function abrir(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.social })
  // The blocked list comes from the bridge after the vault opens.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  return user
}

const tipos = (): string[] => vi.mocked(motor.tocar).mock.calls.map(([acontecimento]) => acontecimento.tipo)

beforeEach(() => {
  localStorage.removeItem(LAST_READ_KEY)
  localStorage.removeItem(PREFS_KEY)
  esquecerMarcasDeEntrada()
  esquecerLidasPorSala()
  esquecerReveladas()
  vi.mocked(motor.tocar).mockClear()
  seq = 0
})

describe("numa sala partilhada, quem bloqueei fica dobrado", () => {
  it("duas mensagens seguidas dela são uma linha; Mostrar abre só essas", async () => {
    const user = await abrir()
    await chega(LAGAR, ANA, { t: "message", body: "bom dia" })
    await chega(LAGAR, RUI, { t: "message", body: "primeira do rui" })
    await chega(LAGAR, RUI, { t: "message", body: "segunda do rui" })
    await chega(LAGAR, ANA, { t: "message", body: "e então" })
    await chega(LAGAR, RUI, { t: "message", body: "terceira do rui" })

    expect(screen.getByText("bom dia")).toBeTruthy()
    expect(screen.getByText("e então")).toBeTruthy()
    expect(screen.queryByText("primeira do rui")).toBeNull()
    expect(screen.queryByText("segunda do rui")).toBeNull()
    expect(screen.queryByText("terceira do rui")).toBeNull()
    // Two lines: the run of two, and the one after Ana.
    expect(screen.getByText(strings.chat.bloqueadas(2))).toBeTruthy()
    expect(screen.getByText(strings.chat.bloqueadas(1))).toBeTruthy()

    const botoes = screen.getAllByRole("button", { name: strings.chat.mostrarBloqueadas })
    expect(botoes).toHaveLength(2)
    await user.click(botoes[0] as HTMLElement)
    expect(screen.getByText("primeira do rui")).toBeTruthy()
    expect(screen.getByText("segunda do rui")).toBeTruthy()
    // Only those: the other run stays folded.
    expect(screen.queryByText("terceira do rui")).toBeNull()
    expect(screen.getAllByRole("button", { name: strings.chat.mostrarBloqueadas })).toHaveLength(1)
  })

  it("o que ela diz noutro canal não conta no carril", async () => {
    /*
      Since the rail notices (1.3.25) unread with nobody waiting is the pill on
      Communities, with no number, and the open destination draws no pill: it is
      read from Friends.
    */
    const user = await abrir()
    const pilula = async (): Promise<boolean> => {
      await user.click(screen.getByRole("button", { name: strings.rail.people }))
      const ha = screen.getByRole("button", { name: strings.rail.chat }).querySelector(".rail-pill") !== null
      await user.click(screen.getByRole("button", { name: strings.rail.chat }))
      return ha
    }
    await chega(ADEGA, RUI, { t: "message", body: "um" })
    await chega(ADEGA, RUI, { t: "message", body: "dois" })
    expect(cracha(strings.rail.chat)).toBeNull()
    expect(await pilula()).toBe(false)
    await chega(ADEGA, ANA, { t: "message", body: "três" })
    expect(cracha(strings.rail.chat)).toBeNull()
    expect(await pilula()).toBe(true)
  })

  it("uma menção dela não toca, não acende o sino e não conta", async () => {
    await abrir()
    await chega(ADEGA, RUI, { t: "message", body: "@Vera olha", mentions: [EU] })
    expect(tipos()).toEqual([])
    expect(screen.queryByRole("button", { name: strings.notifCenter.bellWithCount(1) })).toBeNull()
    expect(cracha(strings.rail.chat)).toBeNull()
    // The same mention from Ana rings, so the test measures the block and not a deaf shell.
    await chega(ADEGA, ANA, { t: "message", body: "@Vera olha", mentions: [EU] })
    expect(tipos()).toEqual(["mencao"])
  })

  it("um pedido de amizade dela numa sala não entra no sino", async () => {
    await abrir()
    await chega(LAGAR, RUI, { t: "friend.request", sentAt: 100 })
    expect(screen.queryByRole("button", { name: strings.notifCenter.bellWithCount(1) })).toBeNull()
  })

  it("as reacções dela não contam nas fichas", async () => {
    await abrir()
    await chega(LAGAR, ANA, { t: "message", id: "alvo", body: "votem" })
    await chega(LAGAR, RUI, { t: "reaction", target: "alvo", emoji: "👍", remove: false })
    expect(screen.queryByRole("button", { name: strings.reaccoes.rotulo("👍", 1, false) })).toBeNull()
    await chega(LAGAR, ANA, { t: "reaction", target: "alvo", emoji: "👍", remove: false })
    expect(screen.getByRole("button", { name: strings.reaccoes.rotulo("👍", 1, false) })).toBeTruthy()
  })
})
