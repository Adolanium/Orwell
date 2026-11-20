import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import type { ChatMessage } from "./types.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * Reaction chips are counted from the vault, not only from memory (B6, 1.3.25).
 *
 * Memory holds the newest 200 entries of a channel, and the chips of a line were
 * folded over memory alone. Here the fake host seeds memory with the line and the
 * entries after it, and keeps its reactions in the vault only (`reaccoesGuardadas`):
 * the line must show them all the same.
 */

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"

const poder = { criar: false }
let enviar = vi.fn(async () => ({ ok: true }))
let apagar = vi.fn(async () => ({ ok: true }))
let historico: unknown[] = []
/** The bridge's vault read of reactions; `null`: an older bridge without it. */
let lerReaccoes: (() => Promise<unknown[]>) | undefined = async () => guardadas
/** The reactions the vault holds (`reaccoesGuardadas`), apart from what memory is seeded with. */
let guardadas: unknown[] = []
let arquivo: unknown[] = []
let moderadores = new Set<string>()
let aoVivo: ((message: ChatMessage) => void) | null = null
let paginasDoArquivo: ((cursor?: number | null) => { entradas: unknown[]; seguinte: number | null }) | null = null

beforeEach(() => {
  poder.criar = false
  enviar = vi.fn(async () => ({ ok: true }))
  apagar = vi.fn(async () => ({ ok: true }))
  historico = []
  guardadas = []
  lerReaccoes = async () => guardadas
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
      conversaArquivada: async (_canal: string, cursor?: number | null) =>
        paginasDoArquivo ? paginasDoArquivo(cursor) : { entradas: arquivo, seguinte: null },
      temConversaArquivada: async () => arquivo.length > 0,
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA],
      history: async () => historico,
      ...(lerReaccoes ? { reaccoesGuardadas: lerReaccoes } : {}),
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [
        { room: "conversa", name: "conversa", category: "", kind: "text", position: 0 },
        { room: "votos", name: "votos", category: "", kind: "text", position: 1, layout: "polls" },
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

const ANTES = Date.now() - 3_000_000
const conversa = (seq: number) => ({
  channel: LAGAR,
  seq,
  sender: ANA,
  payload: { t: "message", id: `conversa-${seq}`, room: "conversa", sentAt: ANTES + seq, body: `olá ${seq}` },
})
const jantar = { channel: LAGAR, seq: 1, sender: ANA, payload: { t: "message", id: "jantar", room: "conversa", sentAt: ANTES, body: "Jantar?" } }
const reaccao = (seq: number, quem: string) => ({ channel: LAGAR, seq, sender: quem, payload: { t: "reaction", target: "jantar", emoji: "👍", remove: false } })

/** The chips on the "Jantar?" line: emoji and count. */
function fichas(): string[] {
  const linha = [...document.querySelectorAll(".timeline .message")].find((m) => m.getAttribute("data-mensagem") === "jantar")
  if (!linha) throw new Error("the line is not on screen")
  return [...linha.querySelectorAll(".reaccao:not(.reaccao-mais)")].map((ficha) => (ficha.textContent ?? "").replace(/\s+/g, ""))
}
const espera = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

describe("as reacções contam-se a partir do cofre", () => {
  beforeEach(() => {
    historico = [jantar, ...Array.from({ length: 20 }, (_, i) => conversa(300 + i))]
    guardadas = [reaccao(2, ANA), reaccao(3, "@bruno:casa.pt"), reaccao(4, "@carla:casa.pt")]
  })

  it("uma linha com reacções de 3 pessoas que a memória já não tem mostra as 3 ao reabrir", async () => {
    await abrirSala("conversa")
    await espera(50)
    expect(fichas()).toEqual(["👍3"])
  })

  it("uma reacção que chega ao vivo junta-se às do cofre, e a mesma não conta duas vezes", async () => {
    await abrirSala("conversa")
    await espera(50)
    await act(async () => {
      aoVivo?.(reaccao(400, "@duda:casa.pt") as unknown as ChatMessage)
      aoVivo?.(reaccao(3, "@bruno:casa.pt") as unknown as ChatMessage)
      await new Promise((r) => setTimeout(r, 150))
    })
    expect(fichas()).toEqual(["👍4"])
  })

  it("uma ponte sem a leitura do cofre conta o que há em memória, como antes", async () => {
    lerReaccoes = undefined
    historico = [jantar, reaccao(2, ANA), ...Array.from({ length: 20 }, (_, i) => conversa(300 + i))]
    await abrirSala("conversa")
    await espera(50)
    expect(fichas()).toEqual(["👍1"])
  })
})
