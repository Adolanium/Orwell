import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App, appendBounded, paginaDoCofre } from "./App.js"
import type { ChatMessage } from "./types.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * "Load older" loads the conversation, not the state book (carregar-antigas, 18/11/2026).
 *
 * The report: "when I press load older in the chat, it does not load". The vault read
 * is the conversation and the state book of every room together, and a click took the
 * newest 100 ENTRIES memory did not hold. In a channel with a busy polls room those
 * were all votes: eight clicks drew nothing. And what came in by hand was the first
 * thing the memory bound dropped on the next arrival.
 */

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"

const poder = { criar: false }
let enviar = vi.fn(async () => ({ ok: true }))
let apagar = vi.fn(async () => ({ ok: true }))
let historico: unknown[] = []
let arquivo: unknown[] = []
let moderadores = new Set<string>()
let aoVivo: ((message: ChatMessage) => void) | null = null
let paginasDoArquivo: ((cursor?: number | null) => { entradas: unknown[]; seguinte: number | null }) | null = null

beforeEach(() => {
  poder.criar = false
  enviar = vi.fn(async () => ({ ok: true }))
  apagar = vi.fn(async () => ({ ok: true }))
  historico = []
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

async function abrirConversa(): Promise<void> {
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  const canal = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  await act(async () => {
    ;(canal?.querySelector("button") as HTMLElement).click()
    await Promise.resolve()
  })
  const linha = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => /conversa/.test(row.textContent ?? ""))
  await act(async () => {
    ;(linha?.querySelector("button") ?? linha)?.click()
    await new Promise((r) => setTimeout(r, 50))
  })
}

const conversa = (seq: number) => ({
  channel: LAGAR,
  seq,
  sender: ANA,
  payload: { t: "message", id: `conversa-${seq}`, room: "conversa", sentAt: Date.now() - 3_000_000 + seq, body: `olá ${seq}` },
})
const voto = (seq: number) => ({
  channel: LAGAR,
  seq,
  sender: `@v${seq}:casa.pt`,
  payload: { t: "post.reaction", id: `voto-${seq}`, target: "aberta-0001", emoji: "", at: Date.now() - 20_000, remove: false, vote: 0 },
})
const votacao = {
  channel: LAGAR,
  seq: 301,
  sender: ANA,
  payload: { t: "message", id: "aberta-0001", room: "votos", sentAt: Date.now() - 60_000, body: "Jantar?\n1. Sim\n2. Não", poll: { question: "Jantar?", options: ["Sim", "Não"] } },
}

/** The "olá N" lines the conversation draws. */
const linhas = (): Set<string> => new Set([...document.querySelectorAll(".timeline .message-body")].map((corpo) => /olá \d+/.exec(corpo.textContent ?? "")?.[0] ?? ""))

async function carregarAntigas(): Promise<void> {
  const botao = screen.getByRole("button", { name: strings.chat.loadOlder })
  await act(async () => {
    botao.click()
    await new Promise((r) => setTimeout(r, 50))
  })
}

describe("«Carregar mais antigas» num canal com muitos votos", () => {
  it("um toque traz linhas da conversa, mesmo com 1 000 votos de outra sala pelo meio", async () => {
    historico = [
      ...Array.from({ length: 300 }, (_, i) => conversa(i + 1)),
      votacao,
      ...Array.from({ length: 1000 }, (_, i) => voto(302 + i)),
      ...Array.from({ length: 10 }, (_, i) => conversa(1400 + i)),
    ]
    await abrirConversa()
    expect(linhas().size).toBe(10)
    await carregarAntigas()
    // The line right before the ones on screen, which sits under 1 000 votes in the vault.
    expect(linhas().has("olá 300")).toBe(true)
  })
})

describe("«Carregar mais antigas» no arquivo da conversa", () => {
  it("uma página do arquivo só com outra sala não pára o toque: lê a seguinte", async () => {
    const daOutraSala = (seq: number) => ({ ...conversa(seq), payload: { ...conversa(seq).payload, room: "votos", id: `votos-${seq}` } })
    historico = Array.from({ length: 10 }, (_, i) => conversa(1400 + i))
    arquivo = [conversa(1)]
    const lidas: (number | null | undefined)[] = []
    paginasDoArquivo = (cursor) => {
      lidas.push(cursor)
      if (cursor === undefined) return { entradas: Array.from({ length: 100 }, (_, i) => daOutraSala(500 + i)), seguinte: 0 }
      return { entradas: Array.from({ length: 100 }, (_, i) => conversa(100 + i)), seguinte: null }
    }
    await abrirConversa()
    await carregarAntigas()
    expect(lidas).toEqual([undefined, 0])
    expect(linhas().has("olá 199")).toBe(true)
    expect(document.querySelector(".timeline-inicio-do-aparelho")).toBeTruthy()
  })
})

describe("o tecto da memória não corta o que se carregou à mão", () => {
  it("as linhas que o leitor pediu ficam depois de chegarem mensagens novas", async () => {
    // 20 lines, then 380 reactions to them (they count toward the bound and draw no line), then 10 lines.
    const reaccao = (seq: number) => ({
      channel: LAGAR,
      seq,
      sender: `@r${seq}:casa.pt`,
      payload: { t: "reaction", target: `conversa-${1 + (seq % 20)}`, emoji: "👍", remove: false },
    })
    historico = [
      ...Array.from({ length: 20 }, (_, i) => conversa(i + 1)),
      ...Array.from({ length: 380 }, (_, i) => reaccao(100 + i)),
      ...Array.from({ length: 10 }, (_, i) => conversa(1400 + i)),
    ]
    await abrirConversa()
    // A catch-up fills memory to the bound before the click: 200 seeded, 200 live.
    await act(async () => {
      for (let i = 0; i < 200; i++) aoVivo?.(reaccao(1500 + i) as unknown as ChatMessage)
      await new Promise((r) => setTimeout(r, 200))
    })
    await carregarAntigas()
    expect(linhas().has("olá 1")).toBe(true)
    // 610 in memory now, past the bound of 400. Live:
    await act(async () => {
      for (let i = 0; i < 5; i++) aoVivo?.(conversa(2000 + i) as unknown as ChatMessage)
      await new Promise((r) => setTimeout(r, 200))
    })
    const vistas = linhas()
    expect(vistas.has("olá 2004")).toBe(true)
    expect(vistas.has("olá 1")).toBe(true)
  })
})

describe("paginaDoCofre", () => {
  const m = (t: string, room = "conversa"): ChatMessage =>
    ({ channel: LAGAR, seq: 1, sender: ANA, payload: { t, room } }) as unknown as ChatMessage
  const daConversa = (message: ChatMessage): boolean => message.payload.t === "message" && (message.payload as { room?: string }).room === "conversa"

  it("conta linhas da conversa, e traz o estado que está entre elas", () => {
    const lista = [m("message"), m("post.reaction"), m("message"), m("post.reaction"), m("post.reaction")]
    const { pagina, linhas, esgotou } = paginaDoCofre(lista, daConversa, 1)
    expect(linhas).toBe(1)
    expect(pagina).toEqual(lista.slice(2))
    expect(esgotou).toBe(false)
  })

  it("linhas de outra sala não contam", () => {
    const lista = [m("message"), m("message", "votos"), m("message", "votos")]
    expect(paginaDoCofre(lista, daConversa, 1)).toEqual({ pagina: lista, linhas: 1, esgotou: true })
  })
})

describe("appendBounded com um tecto maior", () => {
  it("o tecto do canal é o que se lhe passa", () => {
    let lista: ChatMessage[] = []
    for (let seq = 1; seq <= 450; seq++) lista = appendBounded(lista, conversa(seq) as unknown as ChatMessage, 500)
    expect(lista.length).toBe(450)
    expect(appendBounded(lista, conversa(451) as unknown as ChatMessage).length).toBe(400)
  })
})
