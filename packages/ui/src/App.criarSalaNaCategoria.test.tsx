import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import type { ChatMessage } from "./types.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * A room created in a category from the sidebar (1.3.25): the `+` left
 * of the category's name and "Create room" in its menu open "New room" with that
 * category already chosen. Only for whoever organizes the channel's rooms.
 */
afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"

const poder = { criar: false }
let enviar = vi.fn(async () => ({ ok: true }))
let apagar = vi.fn(async () => ({ ok: true }))
let historico: unknown[] = []
let podeEditar = true
/** The bridge's vault read of reactions; `null`: an older bridge without it. */
let arquivo: unknown[] = []
let moderadores = new Set<string>()
let aoVivo: ((message: ChatMessage) => void) | null = null
let paginasDoArquivo: ((cursor?: number | null) => { entradas: unknown[]; seguinte: number | null }) | null = null

beforeEach(() => {
  poder.criar = false
  enviar = vi.fn(async () => ({ ok: true }))
  apagar = vi.fn(async () => ({ ok: true }))
  historico = []
  podeEditar = true
  arquivo = []
  moderadores = new Set()
  aoVivo = null
  paginasDoArquivo = null
})

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
      list: async () => [LAGAR],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: enviar,
      deleteMessage: apagar,
      mayCreatePoll: () => poder.criar,
      mayModerate: (_canal: string, quem: string) => moderadores.has(quem),
      mayEdit: () => podeEditar,
      conversaArquivada: async (_canal: string, cursor?: number | null) =>
        paginasDoArquivo ? paginasDoArquivo(cursor) : { entradas: arquivo, seguinte: null },
      temConversaArquivada: async () => arquivo.length > 0,
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA],
      history: async () => historico,
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [
        { room: "conversa", name: "conversa", category: "Cozinha", kind: "text", position: 0 },
        { room: "adega", name: "adega", category: "Cave", kind: "text", position: 1 },
      ],
    },
    votacoes: { votar: async () => ({ ok: true }) },
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
      message: (ouvir: (message: ChatMessage) => void) => {
        aoVivo = ouvir
        return () => {}
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

async function abrirSala(sala: string): Promise<void> {
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  const canal = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  await act(async () => {
    ;(canal?.querySelector("button") as HTMLElement).click()
    await Promise.resolve()
  })
  const linha = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => row.textContent?.includes(sala))
  await act(async () => {
    ;(linha?.querySelector("button") ?? linha)?.click()
    await new Promise((r) => setTimeout(r, 50))
  })
}

const campoDaCategoria = (): HTMLInputElement => screen.getByLabelText(strings.newRoom.categoryLabel) as HTMLInputElement

describe("criar sala numa categoria", () => {
  it("o + à esquerda de «Cave» abre «Nova sala» já na categoria Cave", async () => {
    await abrirSala("conversa")
    const mais = screen.getByRole("button", { name: strings.sidebar.criarSalaNaCategoriaRotulo("Cave") })
    await act(async () => {
      mais.click()
      await Promise.resolve()
    })
    expect(campoDaCategoria().value).toBe("Cave")
  })

  it("«Criar sala» no menu de «Cozinha» faz o mesmo, e o «Nova sala» seguinte já não traz categoria", async () => {
    await abrirSala("conversa")
    const cabecalho = [...document.querySelectorAll<HTMLElement>(".room-category")].find((h) => h.textContent?.includes("Cozinha")) as HTMLElement
    await act(async () => {
      fireEvent.contextMenu(cabecalho, { clientX: 10, clientY: 10 })
      await Promise.resolve()
    })
    await act(async () => {
      screen.getByRole("menuitem", { name: strings.menu.criarSalaNaCategoria }).click()
      await Promise.resolve()
    })
    expect(campoDaCategoria().value).toBe("Cozinha")
    await act(async () => {
      screen.getByRole("button", { name: strings.prompts.cancel }).click()
      await Promise.resolve()
    })
    await act(async () => {
      ;(document.querySelector(".room-new") as HTMLElement).click()
      await Promise.resolve()
    })
    expect(campoDaCategoria().value).toBe("")
  })

  it("sem poder organizar as salas, não há +", async () => {
    podeEditar = false
    await abrirSala("conversa")
    expect(screen.queryByRole("button", { name: strings.sidebar.criarSalaNaCategoriaRotulo("Cave") })).toBeNull()
  })
})
