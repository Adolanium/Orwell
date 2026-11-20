import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import type { StoredChatMessage } from "@enclave/client-core"
import { App, confirmarNaMemoria, juntarLote } from "./App.js"
import type { ChatMessage } from "./types.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

/**
 * A quick reply of ours stays below the message it answers, LIVE (ordem-resposta,
 * 20/11/2026). The server numbered the question first; this screen can hear it
 * after our reply. Our line takes the echo `seq` (`bridge.on.eco`) and memory keeps
 * the server order, the vault's rule.
 */

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")
const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const CANAL = "!lagar:casa.pt"
const OUTRO = "!adega:casa.pt"
const QUANDO = 1_700_000_000_000

afterEach(cleanup)
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

type Envio = [channel: string, body: string, room?: string, extras?: Record<string, unknown>]

function ponte(
  emitRef: { current: ((message: unknown) => void) | null },
  ecoRef: { current: ((eco: { channel: string; id: string; seq: number }) => void) | null },
  ligarRef: { current: ((estado: unknown) => void) | null },
  envios: Envio[],
  historico: StoredChatMessage[] = [],
): EnclaveBridge {
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
      send: async (...envio: Envio) => {
        envios.push(envio)
        return { ok: true }
      },
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA],
      history: async () => historico,
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [
        { room: "", name: "geral", category: "", kind: "text", position: 0 },
        { room: "obras", name: "obras", category: "", kind: "text", position: 1 },
      ],
      meta: () => null,
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
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({ [ANA]: { displayName: "Ana", donations: [] } }),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (handler: (message: unknown) => void) => {
        emitRef.current = handler
        return () => {}
      },
      eco: (handler: (eco: { channel: string; id: string; seq: number }) => void) => {
        ecoRef.current = handler
        return () => {}
      },
      epoch: () => () => {},
      status: () => () => {},
      connection: (handler: (estado: unknown) => void) => {
        ligarRef.current = handler
        return () => {}
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

function dita(sender: string, id: string, seq: number, channel = CANAL): ChatMessage {
  return { channel, seq, sender, payload: { t: "message", id, sentAt: QUANDO, body: `corpo ${id}` } } as unknown as ChatMessage
}

const ordem = (lista: readonly ChatMessage[], channel = CANAL): string[] =>
  lista.filter((m) => m.channel === channel).map((m) => `${String(m.payload.id)}:${m.seq}`)

describe("a memória pela ordem do servidor", () => {
  it("a pergunta chega depois do eco da resposta: entra antes dela", () => {
    let lista = juntarLote([], [dita(ANA, "ola", 1), dita(EU, "resposta", -1)])
    lista = confirmarNaMemoria(lista, { channel: CANAL, id: "resposta", seq: 3 })
    lista = juntarLote(lista, [dita(ANA, "pergunta", 2)])
    expect(ordem(lista)).toEqual(["ola:1", "pergunta:2", "resposta:3"])
  })

  it("a pergunta chega antes do eco: o eco põe a resposta depois dela", () => {
    let lista = juntarLote([], [dita(ANA, "ola", 1), dita(EU, "resposta", -1), dita(ANA, "pergunta", 2)])
    expect(ordem(lista)).toEqual(["ola:1", "resposta:-1", "pergunta:2"])
    lista = confirmarNaMemoria(lista, { channel: CANAL, id: "resposta", seq: 3 })
    expect(ordem(lista)).toEqual(["ola:1", "pergunta:2", "resposta:3"])
  })

  it("outro canal pelo meio não conta, e uma chegada em ordem vai para o fim", () => {
    let lista = juntarLote([], [dita(ANA, "ola", 1), dita(EU, "resposta", -1), dita(ANA, "la", 7, OUTRO)])
    lista = confirmarNaMemoria(lista, { channel: CANAL, id: "resposta", seq: 3 })
    lista = juntarLote(lista, [dita(ANA, "pergunta", 2), dita(ANA, "depois", 4)])
    expect(ordem(lista)).toEqual(["ola:1", "pergunta:2", "resposta:3", "depois:4"])
    expect(ordem(lista, OUTRO)).toEqual(["la:7"])
  })

  it("um eco sem a linha em memória não muda a lista", () => {
    const lista = juntarLote([], [dita(ANA, "ola", 1)])
    expect(confirmarNaMemoria(lista, { channel: CANAL, id: "outra", seq: 9 })).toBe(lista)
  })
})

async function noCanal(): Promise<{
  emitir: (message: unknown) => Promise<void>
  ecoar: (eco: { channel: string; id: string; seq: number }) => Promise<void>
}> {
  const emitRef: { current: ((message: unknown) => void) | null } = { current: null }
  const ecoRef: { current: ((eco: { channel: string; id: string; seq: number }) => void) | null } = { current: null }
  const ligarRef: { current: ((estado: unknown) => void) | null } = { current: null }
  const user = userEvent.setup()
  render(<App bridge={ponte(emitRef, ecoRef, ligarRef, [])} />)
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.rail.chat }))
  await act(async () => {
    ligarRef.current?.({ state: "online" })
    await Promise.resolve()
  })
  return {
    emitir: async (message) => {
      await act(async () => {
        emitRef.current?.(message)
        await Promise.resolve()
      })
    },
    ecoar: async (eco) => {
      await act(async () => {
        ecoRef.current?.(eco)
        await Promise.resolve()
      })
    },
  }
}

/** The bodies on screen, top to bottom. */
function noEcra(): string[] {
  return [...document.querySelectorAll(".timeline")].flatMap((linha) =>
    [...(linha.textContent ?? "").matchAll(/corpo ([a-z]+)/g)].map((achado) => achado[1] as string),
  )
}

describe("a resposta rápida, ao vivo, no ecrã inteiro", () => {
  it("a pergunta que o servidor numerou antes chega depois do eco: aparece por cima da resposta", async () => {
    const { emitir, ecoar } = await noCanal()
    await emitir(dita(ANA, "ola", 1))
    await emitir(dita(EU, "resposta", -1))
    await screen.findByText("corpo resposta")
    await ecoar({ channel: CANAL, id: "resposta", seq: 3 })
    await emitir(dita(ANA, "pergunta", 2))
    await screen.findByText("corpo pergunta")
    expect(noEcra()).toEqual(["ola", "pergunta", "resposta"])
  })

  it("a pergunta chega antes do eco: o eco passa a resposta para baixo dela", async () => {
    const { emitir, ecoar } = await noCanal()
    await emitir(dita(ANA, "ola", 1))
    await emitir(dita(EU, "resposta", -1))
    await emitir(dita(ANA, "pergunta", 2))
    await screen.findByText("corpo pergunta")
    await ecoar({ channel: CANAL, id: "resposta", seq: 3 })
    expect(noEcra()).toEqual(["ola", "pergunta", "resposta"])
  })
})
