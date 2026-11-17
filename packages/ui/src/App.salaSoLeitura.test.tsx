import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ConnectionState, EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { APRESENTADOS_KEY } from "./hooks/usePrefs.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const COMUM = "!orwell:casa.pt"
const LAGAR = "!lagar:casa.pt"

/**
 * A read-only room (12/11/2026), on the screen of someone who cannot write
 * there: the writing bar gives way to a sentence, the other room keeps it, and
 * a change of the rule shows on the next render, without reload.
 */

let onConnection: ((payload: unknown) => void) | null = null
let onMessage: ((payload: unknown) => void) | null = null
let soLeitura = true

function ponte(): EnclaveBridge {
  onConnection = null
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
      // The single source of truth: what the server announced in `hello.ok`.
      commonRoom: async () => COMUM,
    },
    channels: {
      list: async () => [COMUM, LAGAR],
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
      /* The same rooms in both channels: the name is not enough, the channel decides.
         The voice room with the same name proves only the text one counts. */
      rooms: () => [
        { room: "avisos", name: "Avisos", category: "", kind: "text", position: 0 },
        { room: "conversa", name: "conversa", category: "", kind: "text", position: 1 },
      ],
      roles: () => [],
      // The permissions model: `escrever` missing in "avisos" while `soLeitura` is on.
      permissoes: {
        todos: () => ({ powers: [], definido: false }),
        em: (_canal: string, _quem: string, lugar?: { sala?: string }) =>
          soLeitura && lugar?.sala === "avisos" ? ["reagir"] : ["escrever", "reagir"],
        mayManageRole: () => false,
        delegacao: () => false,
        sobreposicoes: () => [],
        maySetSobreposicoes: () => false,
        setSobreposicoes: async () => ({ ok: true }),
      },
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
      feedChannel: async () => MURAL_EU,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({}),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (handler: (payload: unknown) => void) => {
        onMessage = handler
        return () => {
          onMessage = null
        }
      },
      epoch: () => () => {},
      status: () => () => {},
      connection: (handler: (payload: unknown) => void) => {
        onConnection = handler
        return () => {
          onConnection = null
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

/** Connect. This is `online` that makes the shell ask what the public channel is. */
async function ligar(state: ConnectionState = "online"): Promise<void> {
  await act(async () => {
    onConnection?.({ state })
    await Promise.resolve()
  })
}

/** Open the channel and the room by name. */
async function abrir(canal: RegExp, sala: RegExp): Promise<void> {
  const user = userEvent.setup()
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await ligar()
  await act(async () => {
    await Promise.resolve()
  })
  const linha = [...document.querySelectorAll(".channel-row")].find((row) => canal.test(row.textContent ?? ""))
  await user.click(linha?.querySelector("button") as HTMLElement)
  const daSala = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => sala.test(row.textContent ?? ""))
  // Without the room in the list, the "does not appear" tests passed without opening anything.
  expect(daSala).toBeTruthy()
  await act(async () => {
    ;(daSala?.querySelector("button") ?? daSala)?.click()
    await Promise.resolve()
  })
}


beforeEach(() => {
  localStorage.setItem(APRESENTADOS_KEY, JSON.stringify([COMUM]))
  soLeitura = true
})

describe("uma sala só de leitura", () => {
  it("troca a barra de escrita por uma frase, sem caixa por baixo", async () => {
    await abrir(/lagar/i, /Avisos/)
    expect(screen.getByText(strings.soLeitura.semEscrita)).toBeTruthy()
    expect(document.querySelector(".chat-composer")).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("noutra sala do mesmo canal, a barra continua", async () => {
    await abrir(/lagar/i, /conversa/)
    expect(screen.queryByText(strings.soLeitura.semEscrita)).toBeNull()
    expect(screen.getByRole("textbox")).toBeTruthy()
  })

  it("a regra muda e o ecrã segue, sem recarregar", async () => {
    await abrir(/lagar/i, /Avisos/)
    expect(screen.getByText(strings.soLeitura.semEscrita)).toBeTruthy()
    soLeitura = false
    await act(async () => {
      onMessage?.({
        channel: LAGAR,
        seq: 1,
        sender: ANA,
        payload: { t: "message", room: "avisos", id: "m1", sentAt: Date.now(), body: "já podes", attachments: [], links: [], mentions: [] },
      })
      await Promise.resolve()
    })
    expect(screen.queryByText(strings.soLeitura.semEscrita)).toBeNull()
    expect(screen.getByRole("textbox")).toBeTruthy()
  })
})
