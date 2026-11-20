import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { StoredChatMessage } from "@enclave/client-core"
import type { EnclaveBridge, PinnedMessage } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { CHAVE_DAS_FIXADAS_ESCONDIDAS } from "./lib/barraDasFixadas.js"
import { moradaDeTeste } from "../testes/moradas.js"

/**
 * The pinned bar at the top of the room (fixadas-topo, 20/11/2026), seen from the screen.
 *
 * The question: does a pinned message stay at the top when the
 * room is long and the app starts again? Memory holds the last 200 entries at
 * start, so the 10th of 500 is not in it. The bar reads the pin list (the core's
 * `pinnedOf`), never the memory window, and the jump reads the vault.
 */

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")
const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const CANAL = "!lagar:casa.pt"
const QUANDO = 1_700_000_000_000

/** 500 messages from Ana in the default room; the 10th is the one pinned. */
function conversaLonga(): StoredChatMessage[] {
  return Array.from({ length: 500 }, (_, i) => ({
    seq: i + 1,
    sender: ANA,
    at: QUANDO + i * 1000,
    payload: { t: "message", id: `m${i + 1}`, sentAt: QUANDO + i * 1000, body: i === 9 ? "O código do portão é 4417.\nE a chave está no vaso." : `mensagem ${i + 1}` },
  })) as StoredChatMessage[]
}

const fixada = (id: string, body: string, pinnedAt = QUANDO, extra: Partial<PinnedMessage> = {}): PinnedMessage => ({
  id,
  sender: ANA,
  body,
  sentAt: QUANDO,
  pinnedAt,
  pinnedBy: ANA,
  ...extra,
})

interface Ponte {
  bridge: EnclaveBridge
  emitir: (message: unknown) => void
  fixadas: PinnedMessage[]
}

function ponte(historia: StoredChatMessage[], fixadas: PinnedMessage[]): Ponte {
  let onMessage: ((message: unknown) => void) | null = null
  const lista = [...fixadas]
  const bridge = {
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
      members: async () => [EU, ANA],
      history: vi.fn(async () => historia),
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [],
      meta: () => null,
      editMessage: async () => ({ ok: true }),
      deleteMessage: async () => ({ ok: true }),
      mayPin: () => false,
      pins: () => [...lista],
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
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({ [ANA]: { displayName: "Ana", donations: [] } }),
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
  } as unknown as EnclaveBridge
  return { bridge, emitir: (message) => onMessage?.(message), fixadas: lista }
}

/** Open the app (a start, or a restart: the bridge keeps the vault) and the channel. */
async function abrir(p: Ponte): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<App bridge={p.bridge} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.rail.chat }))
  return user
}

const barra = (): HTMLElement | null => screen.queryByRole("region", { name: strings.chat.pinnedBarRegion })

describe("a barra das fixadas no topo da sala", () => {
  it("sala com 500 mensagens e a fixada na 10.ª: continua no topo depois de recarregar", async () => {
    const p = ponte(conversaLonga(), [fixada("m10", "O código do portão é 4417.\nE a chave está no vaso.")])
    await abrir(p)
    // The 10th is not in memory (the last 200 are), and the bar still shows it, with its first line.
    expect(await screen.findByRole("region", { name: strings.chat.pinnedBarRegion })).toBeTruthy()
    expect(within(barra()!).getByText("O código do portão é 4417.")).toBeTruthy()
    expect(within(barra()!).getByText("Ana")).toBeTruthy()
    expect(document.querySelector('[data-mensagem="m10"]')).toBeNull()

    // Restart: a new App on the same vault.
    cleanup()
    await abrir(p)
    expect(await screen.findByRole("region", { name: strings.chat.pinnedBarRegion })).toBeTruthy()
    expect(within(barra()!).getByText("O código do portão é 4417.")).toBeTruthy()
  })

  it("a barra fica no fluxo, antes da conversa, e não dentro dela", async () => {
    const p = ponte(conversaLonga(), [fixada("m10", "O código do portão é 4417.")])
    await abrir(p)
    const b = await screen.findByRole("region", { name: strings.chat.pinnedBarRegion })
    const conversa = document.querySelector(".timeline")
    expect(conversa).toBeTruthy()
    expect(conversa!.contains(b)).toBe(false)
    // The bar comes first, then the scroller, in the same column.
    expect(b.parentElement).toBe(conversa!.parentElement)
    expect(b.compareDocumentPosition(conversa!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("um clique salta para a mensagem fora da janela: lê o cofre e acende-a", async () => {
    const p = ponte(conversaLonga(), [fixada("m10", "O código do portão é 4417.")])
    const user = await abrir(p)
    await screen.findByRole("region", { name: strings.chat.pinnedBarRegion })
    await user.click(within(barra()!).getByRole("button", { name: /O código do portão é 4417\./ }))
    await waitFor(() => expect(document.querySelector('[data-mensagem="m10"].destacada')).toBeTruthy())
  })

  it("com várias, mostra a mais recente, conta e as setas passam entre elas", async () => {
    const p = ponte(conversaLonga(), [
      fixada("m10", "A primeira fixada", QUANDO),
      fixada("m20", "A segunda fixada", QUANDO + 1),
      fixada("m30", "A terceira fixada", QUANDO + 2),
    ])
    const user = await abrir(p)
    await screen.findByRole("region", { name: strings.chat.pinnedBarRegion })
    expect(within(barra()!).getByText("A terceira fixada")).toBeTruthy()
    expect(within(barra()!).getByText(strings.chat.pinnedBarCount(1, 3))).toBeTruthy()
    await user.click(within(barra()!).getByRole("button", { name: strings.chat.pinnedBarNext }))
    expect(within(barra()!).getByText("A segunda fixada")).toBeTruthy()
    expect(within(barra()!).getByText(strings.chat.pinnedBarCount(2, 3))).toBeTruthy()
    await user.click(within(barra()!).getByRole("button", { name: strings.chat.pinnedBarPrevious }))
    await user.click(within(barra()!).getByRole("button", { name: strings.chat.pinnedBarPrevious }))
    // Round: before the newest comes the oldest.
    expect(within(barra()!).getByText("A primeira fixada")).toBeTruthy()
  })

  it("com uma só, não há conta nem setas", async () => {
    const p = ponte(conversaLonga(), [fixada("m10", "Só esta")])
    await abrir(p)
    await screen.findByRole("region", { name: strings.chat.pinnedBarRegion })
    expect(within(barra()!).queryByRole("button", { name: strings.chat.pinnedBarNext })).toBeNull()
    expect(within(barra()!).queryByText(strings.chat.pinnedBarCount(1, 1))).toBeNull()
  })

  it("mostra a miniatura da primeira imagem, e o nome do ficheiro quando não há texto", async () => {
    const miniatura = "data:image/png;base64,iVBORw0KGgo="
    const p = ponte(conversaLonga(), [
      fixada("m10", "", QUANDO, { attachments: [{ name: "portao.png", kind: "image", mediaType: "image/png", byteLength: 10, thumbnail: miniatura }] }),
    ])
    await abrir(p)
    const b = await screen.findByRole("region", { name: strings.chat.pinnedBarRegion })
    expect(b.querySelector(`img.barra-fixadas-miniatura[src="${miniatura}"]`)).toBeTruthy()
    expect(within(b).getByText("portao.png")).toBeTruthy()
  })

  it("esconder a barra fica lembrado neste aparelho; uma fixada mais nova volta a mostrá-la", async () => {
    const p = ponte(conversaLonga(), [fixada("m10", "O código do portão é 4417.")])
    const user = await abrir(p)
    await screen.findByRole("region", { name: strings.chat.pinnedBarRegion })
    await user.click(within(barra()!).getByRole("button", { name: strings.chat.pinnedBarHide }))
    expect(barra()).toBeNull()
    expect(localStorage.getItem(CHAVE_DAS_FIXADAS_ESCONDIDAS)).toContain(CANAL)
    // The header button and the sheet stay.
    expect(screen.getByRole("button", { name: strings.chat.pinnedToggle })).toBeTruthy()

    // Restart: still hidden.
    cleanup()
    const user2 = await abrir(p)
    await screen.findByRole("button", { name: strings.chat.pinnedToggle })
    expect(barra()).toBeNull()

    // The sheet brings it back.
    await user2.click(screen.getByRole("button", { name: strings.chat.pinnedToggle }))
    const folha = screen.getByRole("dialog", { name: strings.chat.pinnedTitle })
    await user2.click(within(folha).getByRole("button", { name: strings.chat.pinnedBarShow }))
    expect(await screen.findByRole("region", { name: strings.chat.pinnedBarRegion })).toBeTruthy()

    // Hide again, then a newer pin arrives: the bar comes back on its own.
    await user2.click(within(barra()!).getByRole("button", { name: strings.chat.pinnedBarHide }))
    expect(barra()).toBeNull()
    p.fixadas.push(fixada("m20", "Reunião na sexta.", QUANDO + 5))
    await act(async () => {
      p.emitir({ channel: CANAL, seq: -1, sender: ANA, payload: { t: "channel.meta", room: "", name: "geral", category: "", kind: "text", position: -1, closed: false, removed: false, updatedAt: Date.now() } })
      await Promise.resolve()
    })
    expect(await screen.findByRole("region", { name: strings.chat.pinnedBarRegion })).toBeTruthy()
    expect(within(barra()!).getByText("Reunião na sexta.")).toBeTruthy()
  })

  it("sem a mensagem neste aparelho, abre a folha na cópia e diz porquê", async () => {
    // Someone who joined later: the vault has the last 50, the pin is older than all of them.
    const p = ponte(conversaLonga().slice(-50), [fixada("m10", "O código do portão é 4417.")])
    const user = await abrir(p)
    await screen.findByRole("region", { name: strings.chat.pinnedBarRegion })
    await user.click(within(barra()!).getByRole("button", { name: /O código do portão é 4417\./ }))
    const folha = await screen.findByRole("dialog", { name: strings.chat.pinnedTitle })
    const linha = folha.querySelector(".pinned-row.realcada")
    expect(linha).toBeTruthy()
    expect(within(linha as HTMLElement).getByText("O código do portão é 4417.")).toBeTruthy()
    expect(await screen.findByText(strings.chat.pinnedBarNotHere)).toBeTruthy()
  })
})
