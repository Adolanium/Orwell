import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * The polls room shows every poll the vault holds, not only those in the last
 * entries of the channel that the conversation keeps in memory (diag-votacao,
 * 18/11/2026).
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
      message: () => () => {},
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

describe("a sala de votações vê as votações que o cofre guarda", () => {
  it("uma votação com 250 mensagens de outra sala depois dela continua na sala de votações", async () => {
    historico = [votacaoDe("antiga-0001", ANA, "Jantar na sexta?", 1), ...Array.from({ length: 250 }, (_, i) => conversa(i + 2))]
    await abrirVotos()
    expect(await screen.findByRole("heading", { name: "Jantar na sexta?" })).toBeTruthy()
  })
})

describe("a votação aberta fica presa", () => {
  it("com 1 000 entradas depois (mensagens e votos), continua na sala de votações ao reabrir a app", async () => {
    const votos = Array.from({ length: 500 }, (_, i) => ({
      channel: LAGAR,
      seq: 2 + i,
      sender: `@v${i}:casa.pt`,
      payload: { t: "post.reaction", id: `voto-${i}`, target: "aberta-0001", emoji: "", at: Date.now() - 20_000, remove: false, vote: 0 },
    }))
    historico = [votacaoDe("aberta-0001", ANA, "Jantar na sexta?", 1), ...votos, ...Array.from({ length: 500 }, (_, i) => conversa(600 + i))]
    await abrirVotos()
    expect(await screen.findByRole("heading", { name: "Jantar na sexta?" })).toBeTruthy()
  })
})

describe("a votação que já saiu do cofre", () => {
  it("uma votação no arquivo da conversa aparece na sala de votações", async () => {
    arquivo = [votacaoDe("arquivada-0001", ANA, "Praia ou campo?", 1)]
    historico = Array.from({ length: 10 }, (_, i) => conversa(i + 2))
    await abrirVotos()
    expect(await screen.findByRole("heading", { name: "Praia ou campo?" })).toBeTruthy()
  })
})

const lapide = (alvo: string, sender: string, seq: number) => ({
  channel: LAGAR,
  seq,
  sender,
  payload: { t: "redact", id: `lapide-${seq}`, target: alvo, sentAt: Date.now() - 10_000 },
})

describe("o que já não é votação deixa rasto na sala de votações", () => {
  it("eliminada pelo autor: a linha diz «Votação eliminada pelo autor.»", async () => {
    historico = [votacaoDe("apagada-0001", ANA, "Jantar na sexta?", 1), lapide("apagada-0001", ANA, 2)]
    await abrirVotos()
    expect(await screen.findByText(strings.salaDeVotacoes.eliminadaPeloAutor)).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Jantar na sexta?" })).toBeNull()
  })

  it("eliminada por quem modera: a linha diz «Votação eliminada por moderação.»", async () => {
    moderadores = new Set([EU])
    historico = [votacaoDe("moderada-0001", ANA, "Jantar na sexta?", 1), lapide("moderada-0001", EU, 2)]
    await abrirVotos()
    expect(await screen.findByText(strings.salaDeVotacoes.eliminadaPorModeracao)).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Jantar na sexta?" })).toBeNull()
  })

  it("a lápide de quem não modera, na votação de outra pessoa, não tira nada", async () => {
    historico = [votacaoDe("dela-0001", ANA, "Jantar na sexta?", 1), lapide("dela-0001", EU, 2)]
    await abrirVotos()
    expect(await screen.findByRole("heading", { name: "Jantar na sexta?" })).toBeTruthy()
    expect(screen.queryByText(strings.salaDeVotacoes.eliminadaPorModeracao)).toBeNull()
    expect(screen.queryByText(strings.salaDeVotacoes.eliminadaPeloAutor)).toBeNull()
  })

  it("votação de quem não tem o poder, depois do corte: o texto aparece, com a nota, e sem votar", async () => {
    const { poll: _poll, ...semPoll } = votacaoDe("sem-poder-0001", ANA, "Jantar na sexta?", 1).payload
    historico = [{ channel: LAGAR, seq: 1, sender: ANA, payload: { ...semPoll, votacaoSemPoder: true } }]
    await abrirVotos()
    expect(await screen.findByText(strings.salaDeVotacoes.semPoder)).toBeTruthy()
    expect(screen.getByText(/Jantar na sexta\?/)).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Jantar na sexta?" })).toBeNull()
  })
})

describe("revisão do diag-votacao", () => {
  it("B1: uma mensagem e um voto de outra pessoa com o mesmo id não escondem a votação", async () => {
    historico = [
      votacaoDe("alvo-0001", ANA, "Jantar na sexta?", 1),
      { channel: LAGAR, seq: 2, sender: EU, payload: { t: "message", id: "alvo-0001", room: "votos", sentAt: Date.now(), body: "intruso", votacaoSemPoder: true } },
      { channel: LAGAR, seq: 3, sender: EU, payload: { t: "post.reaction", id: "alvo-0001", target: "alvo-0001", emoji: "", at: Date.now(), remove: false, vote: 0 } },
    ]
    await abrirVotos()
    expect(await screen.findByRole("heading", { name: "Jantar na sexta?" })).toBeTruthy()
  })

  it("B2: na conversa, uma votação eliminada por moderação com 250 entradas depois não volta ao ecrã sem a lápide", async () => {
    moderadores = new Set([EU])
    const naConversa = { ...votacaoDe("moderada-0002", ANA, "Jantar na sexta?", 1) }
    naConversa.payload = { ...naConversa.payload, room: "conversa" }
    // Reactions are entries, not lines: the poll would be among the few lines on screen.
    const reaccoes = Array.from({ length: 250 }, (_, i) => ({
      channel: LAGAR,
      seq: 3 + i,
      sender: `@r${i}:casa.pt`,
      payload: { t: "reaction", target: "conversa-300", emoji: "👍" },
    }))
    historico = [naConversa, lapide("moderada-0002", EU, 2), ...reaccoes, conversa(300)]
    await abrirSala("conversa")
    await screen.findByText("olá 300")
    expect(screen.queryByRole("heading", { name: "Jantar na sexta?" })).toBeNull()
  })

  it("B2: na conversa, uma votação aberta com 250 votos não aparece com uma contagem errada", async () => {
    const naConversa = { ...votacaoDe("contada-0001", ANA, "Jantar na sexta?", 1) }
    naConversa.payload = { ...naConversa.payload, room: "conversa" }
    const votos = Array.from({ length: 250 }, (_, i) => ({
      channel: LAGAR,
      seq: 2 + i,
      sender: `@v${i}:casa.pt`,
      payload: { t: "post.reaction", id: `voto-c${i}`, target: "contada-0001", emoji: "", at: Date.now() - 20_000, remove: false, vote: 0 },
    }))
    historico = [naConversa, ...votos, ...Array.from({ length: 5 }, (_, i) => conversa(300 + i))]
    await abrirSala("conversa")
    await screen.findByText("olá 304")
    const cartao = screen.queryByRole("heading", { name: "Jantar na sexta?" })
    // Absent until "load older", or present with the full count: never a partial one.
    if (cartao) expect(screen.getByText(strings.votacao.total(250))).toBeTruthy()
  })
})

describe("I1: uma leitura do arquivo por canal", () => {
  it("sair da sala de votações e voltar, com a leitura a meio, não começa outra leitura", async () => {
    let soltar: () => void = () => {}
    arquivoPronto = new Promise<void>((resolve) => (soltar = resolve))
    arquivo = [votacaoDe("arquivada-0002", ANA, "Praia ou campo?", 1)]
    await abrirVotos()
    await vi.waitFor(() => expect(leiturasDoArquivo).toBe(1))
    for (const nome of ["conversa", "votos"]) {
      const linha = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => new RegExp(nome).test(row.textContent ?? ""))
      await act(async () => {
        ;(linha?.querySelector("button") ?? linha)?.click()
        await Promise.resolve()
      })
    }
    await screen.findByRole("tablist", { name: strings.salaDeVotacoes.separadores })
    soltar()
    expect(await screen.findByRole("heading", { name: "Praia ou campo?" })).toBeTruthy()
    expect(leiturasDoArquivo).toBe(1)
  })
})
