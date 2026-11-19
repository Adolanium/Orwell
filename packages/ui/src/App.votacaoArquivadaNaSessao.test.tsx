import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * A poll that leaves the vault for the archive while the polls room is open stays
 * in the room (I2 of the diag-votacao review, polls-somem 19/11/2026).
 *
 * A poll that closes is no longer held in the vault, and the next trim archives it.
 * The archive was read once per channel in a session: the poll was in neither read,
 * and it left "Closed" until reload. The rest of this note is the model test's.
 *
 *
 * The conversation seeds the last `MEMORY_PER_CHANNEL` (200) entries of a channel
 * into memory, rooms and state (votes, reactions, edits) together. A poll with
 * more than that after it, in any room, left memory on the next start, and its
 * polls room showed nothing: no card, no line, and no "load older" to bring it back.
 * The same for a poll past the vault, in the archived conversation.
 *
 * And what is no longer a poll leaves a trace in the polls room, as messages do in a
 * conversation: deleted by its author, deleted by moderation, and a poll from someone
 * without the power to create polls (1.3.21, after the cut), which shows its text.
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
let leiturasDoArquivo = 0
let arquivoPronto: Promise<void> = Promise.resolve()
let ouvinte: ((raw: unknown) => void) | null = null

const votacaoDe = (id: string, sender: string, pergunta: string, seq = 3) => ({
  channel: LAGAR,
  seq,
  sender,
  payload: {
    t: "message",
    id,
    room: "votos",
    sentAt: Date.now() - 60_000,
    body: `${pergunta}\n1. Sim\n2. Não`,
    poll: { question: pergunta, options: ["Sim", "Não"] },
  },
})

beforeEach(() => {
  poder.criar = false
  enviar = vi.fn(async () => ({ ok: true }))
  apagar = vi.fn(async () => ({ ok: true }))
  historico = []
  arquivo = []
  moderadores = new Set()
  leiturasDoArquivo = 0
  arquivoPronto = Promise.resolve()
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
      conversaArquivada: async () => {
        leiturasDoArquivo += 1
        await arquivoPronto
        return { entradas: arquivo, seguinte: null }
      },
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
      message: (handler: (raw: unknown) => void) => {
        ouvinte = handler
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

/** Open the channel, then the polls room. */
async function abrirVotos(): Promise<void> {
  await abrirSala("votos")
  await screen.findByRole("tablist", { name: strings.salaDeVotacoes.separadores })
}

/** Open the channel, then a room by its name. */
async function abrirSala(nome: string): Promise<void> {
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  const canal = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  await act(async () => {
    ;(canal?.querySelector("button") as HTMLElement).click()
    await Promise.resolve()
  })
  const linha = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => new RegExp(nome).test(row.textContent ?? ""))
  await act(async () => {
    ;(linha?.querySelector("button") ?? linha)?.click()
    await Promise.resolve()
  })
}

const conversa = (seq: number) => ({
  channel: LAGAR,
  seq,
  sender: ANA,
  payload: { t: "message", id: `conversa-${seq}`, room: "conversa", sentAt: Date.now() - 30_000 + seq, body: `olá ${seq}` },
})

describe("uma votação que passa do cofre ao arquivo com a sala aberta", () => {
  it("continua na sala depois da leitura seguinte do cofre", async () => {
    // Past the 200 entries memory seeds: the poll is only in the vault read.
    const votacao = votacaoDe("fechada-0001", ANA, "Jantar na sexta?", 1)
    const depois = Array.from({ length: 250 }, (_, i) => conversa(i + 2))
    historico = [votacao, ...depois]
    await abrirVotos()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(await screen.findByRole("heading", { name: "Jantar na sexta?" })).toBeTruthy()
    const leiturasAntes = leiturasDoArquivo
    // The vault trims it into the archive; fifty server events later the room reads the vault again.
    historico = depois
    arquivo = [votacao]
    await act(async () => {
      ouvinte?.(conversa(320))
      await new Promise((resolve) => setTimeout(resolve, 150))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByRole("heading", { name: "Jantar na sexta?" })).not.toBeNull()
    expect(leiturasDoArquivo).toBe(leiturasAntes + 1)
  })
})
