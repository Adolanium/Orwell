import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { StoredChatMessage } from "@enclave/client-core"
import type { EnclaveBridge, HistoricoDosIrmaos } from "./bridge.js"
import { App } from "./App.js"
import { strings, translateError } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"
import { clearDiagnostics, diagnosticsSnapshot } from "./lib/diagnostics.js"
import { esquecerFalhas } from "./lib/falhas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(() => {
  cleanup()
  clearDiagnostics()
  esquecerFalhas()
})

const EU = "@eu:casa.pt"
const BRUNO = "@bruno:casa.pt"
const CANAL = "!lagar:casa.pt"

/**
 * A throw in the `Shell` itself, not in a screen below it (1.3.27). The black
 * screen on the phone during the sync: the `Shell` was outside every
 * `ErrorBoundary`, so a throw in its body or its hooks unmounted the whole
 * root and left `#root` empty. Here the throw is in the `Shell`'s history
 * hook: the `setMessages` updater runs during the `Shell`'s render and reads
 * the payload of an entry the sync just brought.
 */
function ponte(
  historico: { atual: StoredChatMessage[] },
  aviso: { atual: ((evento: HistoricoDosIrmaos) => void) | null },
  agora: HistoricoDosIrmaos,
): EnclaveBridge {
  const diretorio = { atual: {} as Record<string, unknown> }
  const ouvintes = new Set<(evento: HistoricoDosIrmaos) => void>()
  const opcoes: { souFundador?: boolean; cargos?: never[]; poderes?: Record<string, string[]>; apelidos?: Record<string, string> } = {
    souFundador: true,
  }
  const cargosDe: Record<string, string[]> = {}
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
      list: async () => [CANAL],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, BRUNO],
      mayInvite: () => true,
      history: async () => historico.atual,
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [],
      meta: () => null,
      setMeta: async () => ({ ok: true }),
      mayEdit: () => true,
      founder: () => (opcoes.souFundador ? EU : "@dona:casa.pt"),
      admins: () => [],
      roles: () => opcoes.cargos ?? [],
      rolesFor: (_canal: string, quem: string) => cargosDe[quem] ?? [],
      setRoles: async () => ({ ok: true }),
      defineRole: async () => ({ ok: true }),
      deleteRole: async () => ({ ok: true }),
      mayManageRoles: () => opcoes.souFundador === true,
      mayModerate: (_canal: string, quem: string) => opcoes.poderes?.[quem]?.includes("moderar") ?? false,
      nicknames: () => opcoes.apelidos ?? {},
      setNickname: async () => ({ ok: true }),
      editMessage: async () => ({ ok: true }),
      deleteMessage: async () => ({ ok: true }),
    },
    invites: {
      create: async () => "enclave://join/x/y#z",
      redeem: async () => ({ ok: true }),
      list: async () => [],
      revoke: async () => ({ ok: true }),
    },
    social: {
      post: async () => ({ ok: true }),
      acceptFollower: vi.fn(async () => ({ ok: true })),
      acceptFriend: vi.fn(async () => ({ ok: true })),
      declineFriend: vi.fn(async () => ({ ok: true })),
      unfriend: vi.fn(async () => ({ ok: true })),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      feedChannel: async () => MURAL_EU,
      sucessoes: async () => ({}),
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => structuredClone(diretorio.atual),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: () => () => {},
      epoch: () => () => {},
      status: () => () => {},
      connection: () => () => {},
      channels: () => () => {},
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
      sucessoes: () => () => {},
      // Two subscriptions: the shell's (which rereads the channels) and the bar's.
      historico: (handler: (evento: HistoricoDosIrmaos) => void) => {
        ouvintes.add(handler)
        aviso.atual = (evento) => {
          for (const ouvinte of ouvintes) ouvinte(evento)
        }
        return () => {
          ouvintes.delete(handler)
        }
      },
    },
    sincronia: { estado: async () => [], lugarEm: async () => null, historico: async () => agora },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}

const mensagem = (seq: number, corpo: string): StoredChatMessage =>
  ({ seq, sender: BRUNO, at: seq, payload: { t: "message", id: `m${seq}`, sentAt: seq, body: corpo, attachments: [], mentions: [] } }) as StoredChatMessage

describe("a crash in the Shell during the sync", () => {
  it("shows the crash card with Error 901 and Reload, never an empty root", async () => {
    const historico = { atual: [mensagem(10, "the vine body")] }
    const aviso: { atual: ((evento: HistoricoDosIrmaos) => void) | null } = { atual: null }
    const inicio: HistoricoDosIrmaos = { aTrazer: true, feitas: 0, total: 1200, media: null, canais: [], inicial: true }
    const user = userEvent.setup()
    const consola = vi.spyOn(console, "error").mockImplementation(() => {})
    const { container } = render(<App bridge={ponte(historico, aviso, inicio)} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await user.click(screen.getByRole("button", { name: strings.rail.chat }))
    expect(await screen.findByText("the vine body")).toBeTruthy()

    // The same message comes back from the sync with a payload that throws when the Shell reads it.
    const venenosa = mensagem(10, "the vine body")
    Object.defineProperty(venenosa.payload, "media", {
      enumerable: true,
      get() {
        throw new TypeError("Cannot read properties of undefined (reading 'x')")
      },
    })
    historico.atual = [venenosa]
    await waitFor(() => expect(aviso.atual).not.toBeNull())
    await act(async () => {
      aviso.atual?.({ aTrazer: true, feitas: 340, total: 1200, media: null, canais: [CANAL], inicial: true })
    })

    expect(await screen.findByText(strings.errors.crashTitle)).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.errors.reload })).toBeTruthy()
    const [codigo, frase] = translateError("the app screen stopped working").split("\n")
    expect(screen.getByText(codigo!)).toBeTruthy()
    expect(screen.getByText(frase!)).toBeTruthy()
    expect(codigo).toContain("901")
    expect(container.innerHTML).not.toBe("")
    // And the cause reaches the diagnostic log, with the sync state and no message text.
    const linha = diagnosticsSnapshot().find((l) => l.code === "screen-crash")
    expect(linha?.detail).toContain("sync=history")
    expect(linha?.detail).toContain("reading 'x'")
    expect(linha?.detail).not.toContain("the vine body")
    consola.mockRestore()
  })
})
