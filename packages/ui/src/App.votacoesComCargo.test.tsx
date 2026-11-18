import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

/**
 * Creating polls needs a role (`votacoes`, 1.3.21), and a poll can be deleted.
 *
 * - Without the power, no entry to create one is drawn: the polls room has no
 *   "New poll", and the sheet refuses with Error 781 if the power leaves while it is open.
 * - "Delete poll" on the polls page, with the confirmation messages use, sends
 *   the message tombstone (`deleteMessage`).
 */

afterEach(cleanup)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"

const poder = { criar: false }
let enviar = vi.fn(async () => ({ ok: true }))
let apagar = vi.fn(async () => ({ ok: true }))
let historico: unknown[] = []

const votacaoDe = (id: string, sender: string, pergunta: string) => ({
  channel: LAGAR,
  seq: 3,
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
      mayModerate: () => false,
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
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  const canal = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  await act(async () => {
    ;(canal?.querySelector("button") as HTMLElement).click()
    await Promise.resolve()
  })
  const linha = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) => /votos/.test(row.textContent ?? ""))
  await act(async () => {
    ;(linha?.querySelector("button") ?? linha)?.click()
    await Promise.resolve()
  })
  await screen.findByRole("tablist", { name: strings.salaDeVotacoes.separadores })
}

describe("criar votações pede o poder votacoes", () => {
  it("sem o poder, a sala de votações não tem «Nova votação» e diz porquê", async () => {
    await abrirVotos()
    expect(screen.queryByRole("button", { name: strings.salaDeVotacoes.nova })).toBeNull()
    expect(screen.getByText(strings.salaDeVotacoes.soLeitura)).toBeTruthy()
  })

  it("com o poder, o botão aparece; se o poder sair com a folha aberta, criar recusa com o Erro 781", async () => {
    poder.criar = true
    const user = userEvent.setup()
    await abrirVotos()
    await user.click(screen.getByRole("button", { name: strings.salaDeVotacoes.nova }))
    await user.type(screen.getByLabelText(strings.votacao.perguntaLabel), "Jantar na sexta?")
    await user.type(screen.getByLabelText(strings.votacao.opcaoLabel(1)), "Sim")
    await user.type(screen.getByLabelText(strings.votacao.opcaoLabel(2)), "Não")
    // A role leaves this account while the sheet is open.
    poder.criar = false
    await user.click(screen.getByRole("button", { name: strings.votacao.confirmar }))
    expect(await screen.findByText(/Erro 781/)).toBeTruthy()
    expect(enviar).not.toHaveBeenCalled()
  })
})

describe("eliminar uma votação na página das votações", () => {
  it("o autor vê «Eliminar votação», confirma, e a lápide sai; a votação de outra pessoa não tem o botão", async () => {
    historico = [votacaoDe("minha-0001", EU, "Jantar na sexta?"), votacaoDe("dela-0001", ANA, "Praia ou campo?")]
    const user = userEvent.setup()
    await abrirVotos()
    const minha = (await screen.findByRole("heading", { name: "Jantar na sexta?" })).closest("li") as HTMLElement
    const dela = screen.getByRole("heading", { name: "Praia ou campo?" }).closest("li") as HTMLElement
    expect(within(dela).queryByRole("button", { name: strings.votacao.eliminar })).toBeNull()
    await user.click(within(minha).getByRole("button", { name: strings.votacao.eliminar }))
    const pergunta = await screen.findByRole("alertdialog")
    expect(within(pergunta).getByText(strings.votacao.eliminarConfirmar)).toBeTruthy()
    await user.click(within(pergunta).getByRole("button", { name: strings.votacao.eliminar }))
    await vi.waitFor(() => expect(apagar).toHaveBeenCalledWith(LAGAR, "minha-0001"))
  })
})
