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
const dentro = { sidebar: 0, props: [] as Record<string, unknown>[], membros: 0, mudouNosMembros: [] as string[] }

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
  const Inteira = (Real as unknown as { type: FC<ComponentProps<typeof Real>> }).type
  const ContadoMembros = memo((props: ComponentProps<typeof Real>) => {
    dentro.membros++
    return Inteira(props)
  }, (a, b) => {
    const mudou = Object.keys({ ...a, ...b }).filter((k) => (a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k])
    if (mudou.length) dentro.mudouNosMembros.push(...mudou)
    return mudou.length === 0
  })
  return {
    ...modulo,
    MemberPanel: (props: ComponentProps<typeof Real>) => {
      renders.membros++
      return createElement(ContadoMembros, props)
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
/** The bridge's typing subscription: who is typing reaches the screen through here. */
const aEscrever: { current: ((sinal: unknown) => void) | null } = { current: null }

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
      typing: (handler: (sinal: unknown) => void) => {
        aEscrever.current = handler
        return () => {}
      },
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}

/** The text box. By the form, not the help text, which changes with the connection. */
const caixa = (): HTMLInputElement => document.querySelector<HTMLInputElement>(".chat-composer .composer-line textarea")!

interface Medida {
  commits: number
  ms: number
}

/** Opens the account on the first channel, connected, and returns the profiler counters. */
async function abrir(opcoes: { lotePorQuadro?: boolean } = {}): Promise<{ user: ReturnType<typeof userEvent.setup>; medida: Medida }> {
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
      <App bridge={ponte(ligar)} {...(opcoes.lotePorQuadro ? { lotePorQuadro: true } : {})} />
    </Profiler>,
  )
  await screen.findByRole("button", { name: strings.rail.chat })
  await user.click(screen.getByRole("button", { name: strings.rail.chat }))
  await act(async () => {
    ligar.current?.({ state: "online" })
    await Promise.resolve()
  })
  await screen.findByText(`mensagem 299 em ${CANAIS[0]}`, undefined, { timeout: 20_000 })
  // The member panel is up. Above 50 members it lists who is online and a "+N" row
  // for the rest, so an offline name is not on screen: the row is.
  await screen.findByText((texto) => /^\+\d+ /.test(texto) && texto === strings.members.maisPessoas(Number(texto.slice(1).split(" ")[0])))
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

  /*
    "Who is typing" (1.3.16.1): it rode along with the scroll. It
    lived inside the conversation's scroller, and each signal re-rendered the
    whole chat screen, conversation included. Now it is a strip held by the
    composer, with its height always reserved, and a signal only draws there.
  */
  it("alguém a escrever aparece na faixa da caixa, fora da conversa, e não volta a desenhar a conversa", async () => {
    await abrir()
    const faixa = document.querySelector(".chat-composer .chat-a-escrever")
    // Reserved before anyone types: the strip is there, empty.
    expect(faixa).not.toBeNull()
    expect(faixa!.textContent).toBe("")
    renders.sidebar = 0
    renders.membros = 0
    renders.conversa = 0
    await act(async () => {
      aEscrever.current?.({ channel: CANAIS[0], room: "", from: MEMBROS[3], until: Date.now() + 6_000 })
      await Promise.resolve()
    })
    const nome = `${NOMES[2 % NOMES.length]} 2`
    expect(faixa!.textContent).toContain(strings.chat.typing([nome]))
    // The same node: the strip changes its text, it is not born or removed.
    expect(document.querySelector(".chat-composer .chat-a-escrever")).toBe(faixa)
    expect(document.querySelector(".timeline .chat-a-escrever, .timeline .timeline-typing")).toBeNull()
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

  /*
    Fluidity: each live message re-read the roles and rebuilt
    `roleFor`, and the member list (400 people) drew again, asking the core for
    the admins once per person. A message that is not about roles changes none
    of that.
  */
  it("uma mensagem nova na conversa aberta não desenha o painel de membros outra vez", async () => {
    await abrir()
    dentro.membros = 0
    dentro.mudouNosMembros = []
    await act(async () => {
      emitir.current?.({
        channel: CANAIS[0],
        sender: MEMBROS[3],
        seq: 10_001,
        payload: { t: "message", id: "nova-0002", sentAt: QUANDO + 400_000, body: "outra que chegou" },
      })
      await Promise.resolve()
    })
    await screen.findByText("outra que chegou")
    expect(dentro.mudouNosMembros).toEqual([])
    expect(dentro.membros).toBe(0)
  })

  /*
    Fluidity: each frame from the server is a task of its own, and
    each one put its messages on screen in its own render (and its own forced
    layout to stay at the bottom). A burst of 200 events was 200 renders. With
    `lotePorQuadro` (the web and the desktop pass it) what arrives before the
    next frame enters in one render.
  */
  let medidaRajada: Medida | null = null
  it("mensagens que chegam em tarefas separadas, antes do próximo quadro, entram num só desenho", async () => {
    const quadros: FrameRequestCallback[] = []
    const original = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (f: FrameRequestCallback) => (quadros.push(f), quadros.length)
    try {
      const { medida } = await abrir({ lotePorQuadro: true })
      medidaRajada = medida
      medida.commits = 0
      renders.conversa = 0
      await act(async () => {
        for (let i = 0; i < 5; i++) {
          emitir.current?.({
            channel: CANAIS[0],
            sender: MEMBROS[3],
            seq: 20_000 + i,
            payload: { t: "message", id: `rajada-${i}`, sentAt: QUANDO + 500_000 + i, body: `rajada ${i}` },
          })
          // A task of its own, as each WebSocket frame is.
          await new Promise((r) => setTimeout(r, 0))
        }
      })
      expect(screen.queryByText("rajada 0")).toBeNull()
      await act(async () => {
        for (const f of quadros.splice(0)) f(performance.now())
        await Promise.resolve()
      })
      for (let i = 0; i < 5; i++) expect(screen.getByText(`rajada ${i}`)).toBeTruthy()
      // One render for the batch, and at most one more for what its effects set: never one per message.
      expect(renders.conversa).toBeLessThanOrEqual(2)
      expect(medidaRajada?.commits).toBeLessThanOrEqual(2)
    } finally {
      globalThis.requestAnimationFrame = original
    }
  })

  /*
    A frame asked for just before the page hides does not run until it comes
    back: what arrived waited in the queue, and the unread counters stood still
    for the whole absence. Hiding the page lets the batch in at once.
  */
  it("um lote à espera do quadro entra quando a página se esconde, sem esperar pela volta", async () => {
    const quadros: FrameRequestCallback[] = []
    const original = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (f: FrameRequestCallback) => (quadros.push(f), quadros.length)
    let visibilidade: DocumentVisibilityState = "visible"
    const descritor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState")
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidade })
    try {
      await abrir({ lotePorQuadro: true })
      await act(async () => {
        emitir.current?.({
          channel: CANAIS[0],
          sender: MEMBROS[3],
          seq: 30_000,
          payload: { t: "message", id: "antes-de-esconder", sentAt: QUANDO + 600_000, body: "antes de esconder" },
        })
        await new Promise((r) => setTimeout(r, 0))
      })
      expect(screen.queryByText("antes de esconder")).toBeNull()
      await act(async () => {
        visibilidade = "hidden"
        document.dispatchEvent(new Event("visibilitychange"))
        await Promise.resolve()
      })
      expect(screen.getByText("antes de esconder")).toBeTruthy()
      // The frame that finally runs on return adds nothing twice.
      await act(async () => {
        visibilidade = "visible"
        for (const f of quadros.splice(0)) f(performance.now())
        await Promise.resolve()
      })
      expect(screen.getAllByText("antes de esconder")).toHaveLength(1)
    } finally {
      globalThis.requestAnimationFrame = original
      delete (document as unknown as Record<string, unknown>).visibilityState
      if (descritor) Object.defineProperty(Document.prototype, "visibilityState", descritor)
    }
  })

  /*
    1.3.16.1: a window covered by another, in another Space or minimized has no
    frames, and Safari can keep it "visible". The batch waited for a frame that
    never came: no line, no unread counter, no title, until the window showed
    again. Without a frame the batch enters by a short deadline, and once the
    frames are known to be stopped, the next message enters in its own handler,
    with no timer (Safari throttles those too).
  */
  it("sem quadros e com a página visível, o lote entra na mesma, e a mensagem seguinte entra sem temporizador", async () => {
    const quadros: FrameRequestCallback[] = []
    const original = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (f: FrameRequestCallback) => (quadros.push(f), quadros.length)
    try {
      await abrir({ lotePorQuadro: true })
      await act(async () => {
        emitir.current?.({
          channel: CANAIS[0],
          sender: MEMBROS[3],
          seq: 40_000,
          payload: { t: "message", id: "sem-quadro-1", sentAt: QUANDO + 700_000, body: "sem quadro um" },
        })
        // Longer than the deadline, and no frame ever runs.
        await new Promise((r) => setTimeout(r, 250))
      })
      expect(screen.getByText("sem quadro um")).toBeTruthy()

      // The frames are known to be stopped: the next one enters with only microtasks, no timer.
      const temporizador = vi.spyOn(globalThis, "setTimeout")
      try {
        await act(async () => {
          emitir.current?.({
            channel: CANAIS[0],
            sender: MEMBROS[3],
            seq: 40_001,
            payload: { t: "message", id: "sem-quadro-2", sentAt: QUANDO + 700_001, body: "sem quadro dois" },
          })
          await Promise.resolve()
        })
      } finally {
        temporizador.mockRestore()
      }
      expect(screen.getByText("sem quadro dois")).toBeTruthy()

      // The frames that finally run add nothing twice.
      await act(async () => {
        for (const f of quadros.splice(0)) f(performance.now())
        await Promise.resolve()
      })
      expect(screen.getAllByText("sem quadro um")).toHaveLength(1)
      expect(screen.getAllByText("sem quadro dois")).toHaveLength(1)
    } finally {
      globalThis.requestAnimationFrame = original
    }
  })

  /*
    A hidden page: Safari throttles a zero timer in a background tab to a second
    or more, and the batch, with the unread counters and the title, waited for it.
    Hidden, the batch enters in the handler's own task.
  */
  it("com a página escondida, a mensagem entra sem esperar por temporizador", async () => {
    let visibilidade: DocumentVisibilityState = "visible"
    const descritor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState")
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidade })
    try {
      await abrir({ lotePorQuadro: true })
      visibilidade = "hidden"
      await act(async () => {
        emitir.current?.({
          channel: CANAIS[0],
          sender: MEMBROS[3],
          seq: 41_000,
          payload: { t: "message", id: "escondida-1", sentAt: QUANDO + 800_000, body: "com a página escondida" },
        })
        await Promise.resolve()
      })
      expect(screen.getByText("com a página escondida")).toBeTruthy()
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState
      if (descritor) Object.defineProperty(Document.prototype, "visibilityState", descritor)
    }
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
