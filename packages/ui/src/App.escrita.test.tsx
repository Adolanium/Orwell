import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createElement, memo, Profiler, type ComponentProps, type FC } from "react"
import type { FichaDoCanal, StoredChatMessage } from "@enclave/client-core"
import type { EnclaveBridge } from "./bridge.js"
import { strings } from "./strings.js"

/**
 * Typing in the composer of a large account (1.3.15).
 *
 * The owner felt a delay on every key. The draft lived in the root state
 * (`useDrafts` in `App.tsx`), so each key re-rendered the whole app: the sidebar
 * with 72 channels, the member list and the conversation. The draft now lives
 * in the composer and only goes up to the root when the channel changes or a
 * message is sent.
 *
 * The big lists are counted through their modules: each render of the element
 * by its parent counts, memo or not. A key must not count any.
 */

const renders = { sidebar: 0, membros: 0, conversa: 0 }
/** The sidebar's own renders, after its `memo`: what the parent's stable props save. */
const dentro = { sidebar: 0, props: [] as Record<string, unknown>[] }

vi.mock("./screens/chat/ChannelSidebar.js", async (original) => {
  const modulo = await original<typeof import("./screens/chat/ChannelSidebar.js")>()
  const Real = modulo.ChannelSidebar
  const Inteira = (Real as unknown as { type: FC<ComponentProps<typeof Real>> }).type
  const Contada = memo((props: ComponentProps<typeof Real>) => {
    dentro.sidebar++
    dentro.props.push(props as unknown as Record<string, unknown>)
    return Inteira(props)
  }, (a, b) => {
    // React's own shallow comparison, written out so a failure can be read here.
    const mudou = Object.keys({ ...a, ...b }).filter((k) => (a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k])
    return mudou.length === 0
  })
  return {
    ...modulo,
    ChannelSidebar: (props: ComponentProps<typeof Real>) => {
      renders.sidebar++
      return createElement(Contada, props)
    },
  }
})
vi.mock("./screens/chat/MemberPanel.js", async (original) => {
  const modulo = await original<typeof import("./screens/chat/MemberPanel.js")>()
  const Real = modulo.MemberPanel
  return {
    ...modulo,
    MemberPanel: (props: ComponentProps<typeof Real>) => {
      renders.membros++
      return createElement(Real, props)
    },
  }
})
vi.mock("./screens/chat/Timeline.js", async (original) => {
  const modulo = await original<typeof import("./screens/chat/Timeline.js")>()
  const Real = modulo.Timeline
  return {
    ...modulo,
    Timeline: (props: ComponentProps<typeof Real>) => {
      renders.conversa++
      return createElement(Real, props)
    },
  }
})

const { App } = await import("./App.js")

const EU = "@eu:casa.pt"
const QUANDO = 1_700_000_000_000
const CANAIS = Array.from({ length: 72 }, (_, i) => `!sala-${String(i).padStart(2, "0")}:casa.pt`)
const MEMBROS = [EU, ...Array.from({ length: 400 }, (_, i) => `@pessoa-${String(i).padStart(3, "0")}:casa.pt`)]
const NOMES = ["Ana", "Bruno", "Carla", "Duarte", "Inês", "Rita", "Tomé", "Vera"]
const HISTORICO = (canal: string): StoredChatMessage[] =>
  Array.from({ length: 300 }, (_, i) => ({
    seq: i + 1,
    sender: MEMBROS[1 + (i % 400)]!,
    at: QUANDO + i * 1000,
    payload: { t: "message", id: `${canal}-m-${String(i).padStart(4, "0")}`, sentAt: QUANDO + i * 1000, body: `mensagem ${i} em ${canal}` },
  })) as unknown as StoredChatMessage[]

afterEach(cleanup)
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  localStorage.clear()
})

const emitir: { current: ((mensagem: unknown) => void) | null } = { current: null }

function ponte(ligar: { current: ((estado: unknown) => void) | null }): EnclaveBridge {
  const fichas: Record<string, FichaDoCanal> = Object.fromEntries(CANAIS.map((c) => [c, { tipo: "sala" }]))
  const diretorio = Object.fromEntries(
    MEMBROS.slice(1).map((m, i) => [
      m,
      { at: QUANDO, payload: { t: "profile", displayName: `${NOMES[i % NOMES.length]} ${i}`, donations: [], updatedAt: QUANDO } },
    ]),
  )
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
      capabilities: async () => ["mls", "presence"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
      fichas: () => fichas,
      list: async () => CANAIS,
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: async () => ({ ok: true }),
      declineChannelInvite: async () => ({ ok: true }),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => MEMBROS,
      history: async (canal: string) => HISTORICO(canal),
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [{ room: "", name: "geral", category: "", kind: "text", position: 0 }],
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
      acceptFollower: async () => ({ ok: true }),
      acceptFriend: async () => ({ ok: true }),
      declineFriend: async () => ({ ok: true }),
      unfriend: async () => ({ ok: true }),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      feedChannel: async () => null,
    },
    profile: {
      get: async () => ({ displayName: "Eu", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => diretorio,
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (handler: (mensagem: unknown) => void) => {
        emitir.current = handler
        return () => {}
      },
      epoch: () => () => {},
      status: () => () => {},
      connection: (handler: (estado: unknown) => void) => {
        ligar.current = handler
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

/** The text box. By the form, not the help text, which changes with the connection. */
const caixa = (): HTMLInputElement => document.querySelector<HTMLInputElement>(".chat-composer .composer-line input:not([type])")!

interface Medida {
  commits: number
  ms: number
}

/** Opens the account on the first channel, connected, and returns the profiler counters. */
async function abrir(): Promise<{ user: ReturnType<typeof userEvent.setup>; medida: Medida }> {
  const ligar: { current: ((estado: unknown) => void) | null } = { current: null }
  const medida: Medida = { commits: 0, ms: 0 }
  const user = userEvent.setup()
  render(
    <Profiler
      id="app"
      onRender={(_id, _fase, duracao) => {
        medida.commits++
        medida.ms += duracao
      }}
    >
      <App bridge={ponte(ligar)} />
    </Profiler>,
  )
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.rail.chat }))
  await act(async () => {
    ligar.current?.({ state: "online" })
    await Promise.resolve()
  })
  await screen.findByText(`mensagem 299 em ${CANAIS[0]}`, undefined, { timeout: 20_000 })
  await screen.findAllByText("Rita 5")
  return { user, medida }
}

/** One key, as the browser delivers it: the new value of the box. Returns the wall time of the render and commit. */
function tecla(texto: string): number {
  const inicio = performance.now()
  fireEvent.change(caixa(), { target: { value: texto, selectionStart: texto.length } })
  return performance.now() - inicio
}

/** Types `frase` key by key and returns what the profiler and the clock saw. */
function escrever(frase: string, medida: Medida): { commits: number; profilerMs: number; relogioMs: number } {
  const antes = { ...medida }
  let relogio = 0
  for (let i = 1; i <= frase.length; i++) relogio += tecla(frase.slice(0, i))
  return {
    commits: medida.commits - antes.commits,
    profilerMs: (medida.ms - antes.ms) / frase.length,
    relogioMs: relogio / frase.length,
  }
}

// A large account in jsdom: opening it takes a few seconds.
describe("escrever numa conta grande", { timeout: 60_000 }, () => {
  it("cada tecla não volta a desenhar a barra lateral, os membros nem a conversa", async () => {
    const { medida } = await abrir()
    renders.sidebar = 0
    renders.membros = 0
    renders.conversa = 0
    const frase = "Bom dia a todos"
    const visto = escrever(frase, medida)
    // The numbers for the report (`npx vitest run App.escrita`).
    console.info(
      `[escrita] ${frase.length} teclas: ${visto.commits} commits, ${visto.profilerMs.toFixed(2)} ms por tecla no Profiler, ${visto.relogioMs.toFixed(2)} ms no relógio (jsdom)`,
    )

    expect(caixa().value).toBe(frase)
    expect(renders).toEqual({ sidebar: 0, membros: 0, conversa: 0 })
  })

  it("as sugestões de @ não voltam a dobrar os 400 nomes em cada tecla", async () => {
    const { medida } = await abrir()
    const dobrar = vi.spyOn(String.prototype, "normalize")
    const frase = "Olá @rita"
    const visto = escrever(frase, medida)
    const chamadas = dobrar.mock.calls.length
    dobrar.mockRestore()
    console.info(
      `[mencoes] ${frase.length} teclas: ${chamadas} normalize, ${visto.profilerMs.toFixed(2)} ms por tecla no Profiler, ${visto.relogioMs.toFixed(2)} ms no relógio (jsdom)`,
    )

    expect(screen.getAllByRole("option").length).toBeGreaterThan(0)
    // Folding each name and address once is allowed (the list changed); once per key is not.
    expect(chamadas).toBeLessThan(2 * MEMBROS.length + 3 * frase.length)
  })

  it("uma mensagem nova na conversa aberta desenha a App, e a barra lateral não se desenha outra vez", async () => {
    await abrir()
    renders.sidebar = 0
    dentro.sidebar = 0
    dentro.props = []
    await act(async () => {
      emitir.current?.({
        channel: CANAIS[0],
        sender: MEMBROS[3],
        seq: 10_000,
        payload: { t: "message", id: "nova-0001", sentAt: QUANDO + 400_000, body: "chegou agora" },
      })
      await Promise.resolve()
    })
    await screen.findByText("chegou agora")

    // The App rendered and handed the sidebar its props again...
    expect(renders.sidebar).toBeGreaterThan(0)
    // ...all equal: the memo skipped it.
    expect(dentro.sidebar).toBe(0)
  })

  it("o rascunho sobrevive à mudança de canal, e enviar apaga-o", async () => {
    const { user } = await abrir()
    await user.type(caixa(), "meio escrito")

    await user.click(screen.getByRole("button", { name: new RegExp(CANAIS[1]!.slice(1, 8)) }))
    await screen.findByText(`mensagem 299 em ${CANAIS[1]}`)
    expect(caixa().value).toBe("")

    await user.click(screen.getByRole("button", { name: new RegExp(CANAIS[0]!.slice(1, 8)) }))
    await screen.findByText(`mensagem 299 em ${CANAIS[0]}`)
    expect(caixa().value).toBe("meio escrito")

    await user.type(caixa(), "{Enter}")
    expect(caixa().value).toBe("")
    await user.click(screen.getByRole("button", { name: new RegExp(CANAIS[1]!.slice(1, 8)) }))
    await screen.findByText(`mensagem 299 em ${CANAIS[1]}`)
    await user.click(screen.getByRole("button", { name: new RegExp(CANAIS[0]!.slice(1, 8)) }))
    await screen.findByText(`mensagem 299 em ${CANAIS[0]}`)
    expect(caixa().value).toBe("")
  })
})
