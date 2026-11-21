import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ChannelRoom, ConnectionState, EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { APRESENTADOS_KEY } from "./hooks/usePrefs.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"
import { arrastar, ponteiro } from "./testes/ponteiro.js"

/**
 * The phone layout, option B (20/11/2026), at 390 x 844.
 *
 * Four tabs at the bottom. Communities is the 72 px rail of communities and
 * the channels of the chosen one. Tapping a channel pushes its conversation
 * full screen; the back arrow, the browser back button and a swipe from the
 * left edge take it off. The members button pushes the members. The tabs
 * show only on a list.
 *
 * jsdom has no media queries: `matchMedia` is stubbed to say "390 px, a
 * finger". Without it (the last block) the desktop layout is what renders,
 * and nothing of this exists.
 */

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")
const LAGAR = "!lagar:casa.pt"
const ADEGA = "!adega:casa.pt"

const SALAS: Record<string, ChannelRoom[]> = {
  [LAGAR]: [
    { room: "", name: "geral", category: "", kind: "text", position: 0 },
    { room: "prensa", name: "prensa", category: "", kind: "text", position: 1 },
  ],
  [ADEGA]: [
    { room: "", name: "geral", category: "", kind: "text", position: 0 },
    { room: "barricas", name: "barricas", category: "", kind: "text", position: 1 },
  ],
}

let onConnection: ((payload: unknown) => void) | null = null
const setRoom = vi.fn(async () => ({ ok: true }))

function ponte(): EnclaveBridge {
  onConnection = null
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
      list: async () => [LAGAR, ADEGA],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: (channel: string) => SALAS[channel] ?? [],
      closedRooms: () => [],
      categories: () => [],
      mayEdit: () => true,
      rolesFor: () => [],
      setRoom: setRoom,
    },
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
      connection: (handler: (payload: unknown) => void) => {
        onConnection = handler
        return () => {
          onConnection = null
        }
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

/** 390 x 844, a finger. */
function telemovel(): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((consulta: string) => ({
      matches: consulta === "(max-width: 840px)" || consulta.includes("pointer: coarse") || consulta.includes("hover: none"),
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })),
  )
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 })
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 })
}

const larguraOriginal = window.innerWidth
const alturaOriginal = window.innerHeight

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Object.defineProperty(window, "innerWidth", { configurable: true, value: larguraOriginal })
  Object.defineProperty(window, "innerHeight", { configurable: true, value: alturaOriginal })
})

async function abrir(mudar?: (bridge: EnclaveBridge) => void): Promise<ReturnType<typeof userEvent.setup>> {
  localStorage.setItem(APRESENTADOS_KEY, JSON.stringify([LAGAR, ADEGA]))
  const user = userEvent.setup()
  const bridge = ponte()
  mudar?.(bridge)
  render(<App bridge={bridge} />)
  await waitFor(() => expect(document.querySelector(".app")).not.toBeNull())
  await act(async () => {
    onConnection?.({ state: "online" as ConnectionState })
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
  return user
}

const app = (): HTMLElement => document.querySelector(".app") as HTMLElement
const separadores = (): HTMLElement | null => document.querySelector(".separadores")
const carril = (): HTMLElement => document.querySelector(".carril-comunidades") as HTMLElement
const sala = (nome: string): HTMLElement =>
  [...document.querySelectorAll<HTMLElement>(".room-tree button.room")].find((botao) =>
    new RegExp(nome).test(botao.textContent ?? ""),
  ) as HTMLElement
const empurrado = (): HTMLElement | null => document.querySelector(".ecra-empurrado")

async function abrirSala(user: ReturnType<typeof userEvent.setup>, nome: string): Promise<void> {
  await waitFor(() => expect(sala(nome)).toBeTruthy())
  await user.click(sala(nome))
  await waitFor(() => expect(empurrado()).not.toBeNull())
}

describe("telemóvel, opção B: a lista de Comunidades", () => {
  it("opens on the Communities list: the rail, the channels and the four tabs; no conversation and no drawer button", async () => {
    telemovel()
    await abrir()
    expect(app().classList.contains("telemovel")).toBe(true)
    expect(app().dataset.separador).toBe("comunidades")
    expect(app().dataset.profundidade).toBe("0")
    const nomes = within(carril())
      .getAllByRole("button")
      .map((botao) => botao.getAttribute("aria-label"))
    expect(nomes).toEqual(["lagar", "adega", strings.telemovel.novaComunidade])
    expect(within(separadores() as HTMLElement).getAllByRole("button")).toHaveLength(4)
    expect(empurrado()).toBeNull()
    // The two old doors to the channel column are not drawn on the phone.
    expect(document.querySelector(".drawer-scrim")).toBeNull()
    expect(document.querySelector(".sidebar")?.classList.contains("open")).toBe(false)
  })

  it("tapping a community on the rail shows its channels, and opens no conversation", async () => {
    telemovel()
    const user = await abrir()
    await waitFor(() => expect(sala("prensa")).toBeTruthy())
    await user.click(within(carril()).getByRole("button", { name: "adega" }))
    await waitFor(() => expect(sala("barricas")).toBeTruthy())
    expect(sala("prensa")).toBeUndefined()
    expect(empurrado()).toBeNull()
    expect(app().dataset.profundidade).toBe("0")
  })

  it("tapping a channel pushes the conversation: back arrow, the channel with the community under it, search and members; the tabs go", async () => {
    telemovel()
    const user = await abrir()
    await abrirSala(user, "prensa")
    expect(app().dataset.profundidade).toBe("1")
    const topo = empurrado()?.querySelector(".topbar") as HTMLElement
    expect(within(topo).getByRole("button", { name: strings.telemovel.voltar })).toBeTruthy()
    expect(within(topo).getByRole("heading", { level: 1 }).textContent).toBe("prensa")
    expect(topo.querySelector(".topbar-comunidade")?.textContent).toBe("lagar")
    expect(within(topo).getByRole("button", { name: strings.chat.searchToggle })).toBeTruthy()
    expect(within(topo).getByRole("button", { name: strings.chat.membersToggle })).toBeTruthy()
    expect(separadores()).toBeNull()
    // The list stays under it, mounted and out of reach.
    expect((document.querySelector(".sidebar") as HTMLElement).inert).toBe(true)
  })

  it("the back arrow takes the conversation off, and the tabs come back", async () => {
    telemovel()
    const user = await abrir()
    await abrirSala(user, "prensa")
    await user.click(within(empurrado() as HTMLElement).getAllByRole("button", { name: strings.telemovel.voltar })[0] as HTMLElement)
    await waitFor(() => expect(empurrado()).toBeNull())
    expect(separadores()).not.toBeNull()
    expect((document.querySelector(".sidebar") as HTMLElement).inert).toBe(false)
  })

  it("growing past 840 px with a conversation pushed gives the column back its clicks (no inert left over)", async () => {
    // A phone turned on its side, a tablet, a window made wider: the media query changes live.
    let estreito = true
    const ouvintes = new Set<() => void>()
    vi.stubGlobal(
      "matchMedia",
      vi.fn((consulta: string) => ({
        get matches() {
          return consulta === "(max-width: 840px)" ? estreito : consulta.includes("pointer: coarse") || consulta.includes("hover: none")
        },
        media: consulta,
        addEventListener: (_: string, ouvinte: () => void) => ouvintes.add(ouvinte),
        removeEventListener: (_: string, ouvinte: () => void) => ouvintes.delete(ouvinte),
        addListener: () => {},
        removeListener: () => {},
      })),
    )
    const user = await abrir()
    await abrirSala(user, "prensa")
    expect((document.querySelector(".sidebar") as HTMLElement).inert).toBe(true)
    estreito = false
    act(() => {
      for (const ouvinte of ouvintes) ouvinte()
    })
    await waitFor(() => expect(app().classList.contains("telemovel")).toBe(false))
    expect((document.querySelector(".sidebar") as HTMLElement).inert).toBe(false)
  })

  it("the browser back button (and the system back gesture) takes the conversation off", async () => {
    telemovel()
    const user = await abrir()
    await abrirSala(user, "prensa")
    await act(async () => {
      window.history.back()
      await new Promise((resolver) => setTimeout(resolver, 30))
    })
    await waitFor(() => expect(empurrado()).toBeNull())
    expect(separadores()).not.toBeNull()
  })

  it("a swipe from the left edge takes the conversation off", async () => {
    telemovel()
    const user = await abrir()
    await abrirSala(user, "prensa")
    const borda = empurrado()?.querySelector(".borda-de-voltar") as HTMLElement
    act(() => arrastar(borda, { x: 4, y: 420 }, { x: 300, y: 430 }))
    await waitFor(() => expect(empurrado()).toBeNull())
  })

  it("a sideways swipe in the middle of the conversation is not a back", async () => {
    telemovel()
    const user = await abrir()
    await abrirSala(user, "prensa")
    const conversa = empurrado()?.querySelector(".timeline") as HTMLElement
    act(() => arrastar(conversa, { x: 150, y: 420 }, { x: 380, y: 420 }))
    expect(empurrado()).not.toBeNull()
  })

  it("the members button pushes the members over the conversation; back closes only the members", async () => {
    telemovel()
    const user = await abrir()
    await abrirSala(user, "prensa")
    await user.click(screen.getByRole("button", { name: strings.chat.membersToggle }))
    const membros = document.querySelector(".members") as HTMLElement
    expect(membros.classList.contains("open")).toBe(true)
    expect(app().dataset.profundidade).toBe("2")
    await user.click(within(membros).getByRole("button", { name: strings.telemovel.voltar }))
    expect(membros.classList.contains("open")).toBe(false)
    expect(app().dataset.profundidade).toBe("1")
    expect(empurrado()).not.toBeNull()
  })

  it("the browser back button closes the members first, then the conversation", async () => {
    telemovel()
    const user = await abrir()
    await abrirSala(user, "prensa")
    await user.click(screen.getByRole("button", { name: strings.chat.membersToggle }))
    await act(async () => {
      window.history.back()
      await new Promise((resolver) => setTimeout(resolver, 30))
    })
    await waitFor(() => expect(app().dataset.profundidade).toBe("1"))
    expect(document.querySelector(".members")?.classList.contains("open")).toBe(false)
    await act(async () => {
      window.history.back()
      await new Promise((resolver) => setTimeout(resolver, 30))
    })
    await waitFor(() => expect(empurrado()).toBeNull())
  })

  it("tapping the open tab again takes it back to its list", async () => {
    telemovel()
    const user = await abrir()
    await user.click(within(separadores() as HTMLElement).getByRole("button", { name: strings.telemovel.tu }))
    await user.click(within(document.querySelector(".menu-do-tu-lista") as HTMLElement).getByRole("button", { name: strings.telemovel.definicoes }))
    expect(app().dataset.profundidade).toBe("1")
    await user.click(within(separadores() as HTMLElement).getByRole("button", { name: strings.telemovel.tu }))
    expect(app().dataset.profundidade).toBe("0")
  })
})

describe("telemóvel, opção B: menus inteiros por toque longo", () => {
  /** The entries of the menu on screen, in order. */
  const entradas = (): string[] => screen.getAllByRole("menuitem").map((item) => item.textContent ?? "")

  it("a long press on a channel opens the SAME menu as the right click on a computer, in a sheet", async () => {
    // The computer first: the right click on the room line.
    const noComputador = await (async () => {
      await abrir()
      await waitFor(() => expect(sala("prensa")).toBeTruthy())
      fireEvent.contextMenu(sala("prensa").closest(".room-row") ?? sala("prensa"), { clientX: 100, clientY: 200 })
      const lista = entradas()
      cleanup()
      return lista
    })()
    expect(noComputador.length).toBeGreaterThan(2)

    telemovel()
    await abrir()
    await waitFor(() => expect(sala("prensa")).toBeTruthy())
    const linha = sala("prensa")
    ponteiro(linha, "pointerdown", { clientX: 200, clientY: 300 })
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 650))
    })
    const menu = screen.getByRole("menu")
    expect(menu.className).toContain("context-folha")
    // The same entries in the same order, plus "Mover" after "Mudar o nome": the
    // phone's door to the order that the computer changes by dragging.
    const noTelemovel = entradas()
    expect(noTelemovel.filter((entrada) => !entrada.startsWith(strings.menu.mover))).toEqual(noComputador)
    expect(noTelemovel[noTelemovel.indexOf(strings.menu.renameRoom) + 1]).toMatch(new RegExp(`^${strings.menu.mover}`))
  })

  it("a long press on a community face in the rail opens the community menu, the same one as its line", async () => {
    const noComputador = await (async () => {
      await abrir()
      await waitFor(() => expect(document.querySelector(".channel-row")).not.toBeNull())
      fireEvent.contextMenu(document.querySelector(".channel-row") as HTMLElement, { clientX: 100, clientY: 200 })
      const lista = entradas()
      cleanup()
      return lista
    })()

    telemovel()
    await abrir()
    ponteiro(within(carril()).getByRole("button", { name: "lagar" }), "pointerdown", { clientX: 36, clientY: 80 })
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 650))
    })
    expect(screen.getByRole("menu").className).toContain("context-folha")
    expect(entradas()).toEqual(noComputador)
  })
})

describe("telemóvel: a linha da comunidade e as portas de entrada (decisões de 20/11/2026)", () => {
  it("a long press on the community line opens only the menu sheet: no conversation is pushed under it", async () => {
    telemovel()
    await abrir()
    await waitFor(() => expect(document.querySelector(".channel-row")).not.toBeNull())
    ponteiro(document.querySelector(".channel-row") as HTMLElement, "pointerdown", { clientX: 120, clientY: 90 })
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 650))
    })
    expect(screen.getByRole("menu").className).toContain("context-folha")
    expect(empurrado()).toBeNull()
    expect(app().dataset.profundidade).toBe("0")
    // The system's own long press (contextmenu, as Android Chrome sends it) is the same: only the menu.
    fireEvent.contextMenu(document.querySelector(".channel-row") as HTMLElement, { clientX: 120, clientY: 90 })
    expect(empurrado()).toBeNull()
  })

  it("on a computer the right click on the community line still picks the channel first", async () => {
    await abrir()
    await waitFor(() => expect(document.querySelectorAll(".channel-row").length).toBeGreaterThan(1))
    const adega = [...document.querySelectorAll<HTMLElement>(".channel-row")].find((linha) => /adega/.test(linha.textContent ?? ""))!
    fireEvent.contextMenu(adega, { clientX: 100, clientY: 200 })
    await waitFor(() => expect(adega.classList.contains("current")).toBe(true))
  })

  it("every account keeps both doors on the phone: the + of the rail creates, and Join with a link is in the list", async () => {
    telemovel()
    const user = await abrir()
    expect(within(carril()).getByRole("button", { name: strings.telemovel.novaComunidade })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.sidebar.joinWithLink }))
    expect(await screen.findByRole("heading", { name: strings.prompts.joinTitle })).toBeTruthy()
  })

  it("the + of the rail is called Create channel, like the + on a computer", () => {
    expect(strings.telemovel.novaComunidade).toBe(strings.sidebar.createRoom)
    expect(strings.telemovel.novaComunidade).toBe("Criar canal")
  })

  /** The cap on channels (1.3.26): the server says how many this account created and may create. */
  const noTecto = (quota: { criados: number; maximo: number; contaNova: boolean }) => (bridge: EnclaveBridge) => {
    bridge.session.criarCanais = async () => quota
  }
  /** The cap on rooms (1.3.26). */
  const atRoomCap = (quota: { created: number; max: number; newAccount?: boolean }) => (bridge: EnclaveBridge) => {
    bridge.session.roomQuota = async () => quota
  }

  it("at the channel cap the + of the rail stays, grey and aria-disabled; a tap shows why; Join with a link stays", async () => {
    telemovel()
    const user = await abrir(noTecto({ criados: 5, maximo: 5, contaNova: false }))
    const frase = strings.sidebar.channelLimit({ maximo: 5, contaNova: false })
    const mais = await waitFor(() => {
      const botao = within(carril()).getByRole("button", { name: strings.telemovel.novaComunidade })
      expect(botao.getAttribute("aria-disabled")).toBe("true")
      return botao
    })
    expect(mais.getAttribute("data-tip")).toBe(frase)
    expect(document.getElementById(mais.getAttribute("aria-describedby") ?? "")?.textContent).toBe(frase)
    await user.click(mais)
    expect(document.body.querySelector(".dica-tocada")?.textContent).toBe(frase)
    // Nothing opens: no "Create channel" sheet.
    expect(screen.queryByRole("heading", { name: strings.prompts.createRoomTitle })).toBeNull()
    await user.click(screen.getByRole("button", { name: strings.sidebar.joinWithLink }))
    expect(await screen.findByRole("heading", { name: strings.prompts.joinTitle })).toBeTruthy()
  })

  it("on a computer, at the channel cap, the + of the column stays, grey, with the 3 days sentence as its tip", async () => {
    await abrir(noTecto({ criados: 1, maximo: 1, contaNova: true }))
    const mais = await waitFor(() => {
      const botao = document.querySelector<HTMLElement>(".header-add.no-tecto")
      expect(botao).not.toBeNull()
      return botao as HTMLElement
    })
    expect(mais.getAttribute("aria-label")).toBe(strings.sidebar.createRoom)
    expect(mais.getAttribute("data-tip")).toBe(strings.sidebar.channelLimit({ maximo: 1, contaNova: true }))
    expect(screen.queryByText(strings.sidebar.noRoomsBefore, { exact: false })).toBeNull()
    expect(screen.getByRole("button", { name: strings.sidebar.joinWithLink })).toBeTruthy()
  })

  it("at the room cap, New room stays, grey, with the room sentence; under it, it works", async () => {
    await abrir(atRoomCap({ created: 12, max: 12, newAccount: true }))
    const nova = await waitFor(() => {
      const botao = screen.getByRole("button", { name: strings.sidebar.newRoom })
      expect(botao.getAttribute("aria-disabled")).toBe("true")
      return botao
    })
    expect(nova.getAttribute("data-tip")).toBe(strings.sidebar.roomLimit({ max: 12, newAccount: true }))
    cleanup()
    await abrir(atRoomCap({ created: 29, max: 30 }))
    const livre = await screen.findByRole("button", { name: strings.sidebar.newRoom })
    expect(livre.getAttribute("aria-disabled")).toBeNull()
  })

  it("under the cap, and with a host that does not say, the + stays", async () => {
    await abrir(noTecto({ criados: 4, maximo: 5, contaNova: false }))
    await waitFor(() => expect(screen.getByRole("button", { name: strings.sidebar.createRoom })).toBeTruthy())
    cleanup()
    await abrir()
    expect(screen.getByRole("button", { name: strings.sidebar.createRoom })).toBeTruthy()
  })
})

describe("telemóvel, opção B: ordenar sem arrastar", () => {
  /*
    On a computer a room moves by drag and drop. A finger has no reliable HTML
    drag, so the phone's room menu carries "Mover": up, down, another category.
  */
  it("the room menu on the phone has Move; Move down publishes the new order", async () => {
    telemovel()
    setRoom.mockClear()
    const user = await abrir()
    await waitFor(() => expect(sala("geral")).toBeTruthy())
    ponteiro(sala("geral"), "pointerdown", { clientX: 200, clientY: 300 })
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 650))
    })
    await user.click(screen.getByRole("menuitem", { name: new RegExp(strings.menu.mover) }))
    await user.click(screen.getByRole("menuitem", { name: strings.menu.moverParaBaixo }))
    await waitFor(() => expect(setRoom).toHaveBeenCalled())
  })

  it("the computer's room menu stays as it was, with no Move (it has the drag)", async () => {
    await abrir()
    await waitFor(() => expect(sala("geral")).toBeTruthy())
    fireEvent.contextMenu(sala("geral"), { clientX: 100, clientY: 200 })
    expect(screen.queryByRole("menuitem", { name: new RegExp(strings.menu.mover) })).toBeNull()
  })
})

describe("telemóvel, opção B: os outros separadores", () => {
  it("Tu: Profile, Feed and Settings, and the account card; an entry pushes its screen with a bar back", async () => {
    telemovel()
    const user = await abrir()
    await user.click(within(separadores() as HTMLElement).getByRole("button", { name: strings.telemovel.tu }))
    expect(app().dataset.separador).toBe("tu")
    const menu = document.querySelector(".menu-do-tu") as HTMLElement
    expect(within(menu).getByRole("button", { name: strings.telemovel.perfil })).toBeTruthy()
    expect(within(menu).getByRole("button", { name: strings.telemovel.mural })).toBeTruthy()
    expect(within(menu).getByRole("button", { name: strings.telemovel.definicoes })).toBeTruthy()
    // The account card: the bell, the microphone and the sound live here on the phone.
    expect(menu.querySelector(".me-faixa")).not.toBeNull()

    await user.click(within(menu).getByRole("button", { name: strings.telemovel.definicoes }))
    const barra = document.querySelector(".barra-do-telemovel") as HTMLElement
    expect(barra.textContent).toContain(strings.telemovel.definicoes)
    await user.click(within(barra).getByRole("button", { name: strings.telemovel.voltar }))
    expect(document.querySelector(".barra-do-telemovel")).toBeNull()
    expect(document.querySelector(".menu-do-tu")).not.toBeNull()
  })

  it("each tab keeps its own stack: Settings stays open in Tu while Communities is on screen", async () => {
    telemovel()
    const user = await abrir()
    const tab = (nome: string): HTMLElement => within(separadores() as HTMLElement).getByRole("button", { name: nome })
    await user.click(tab(strings.telemovel.tu))
    await user.click(within(document.querySelector(".menu-do-tu-lista") as HTMLElement).getByRole("button", { name: strings.telemovel.definicoes }))
    await user.click(tab(strings.telemovel.comunidades))
    expect(app().dataset.separador).toBe("comunidades")
    expect(document.querySelector(".barra-do-telemovel")).toBeNull()
    await user.click(tab(strings.telemovel.tu))
    expect(document.querySelector(".barra-do-telemovel")?.textContent).toContain(strings.telemovel.definicoes)
  })

  it("Messages shows the direct conversations full screen; Friends shows the tabs of Friends and the list", async () => {
    telemovel()
    const user = await abrir()
    const tab = (nome: string): HTMLElement => within(separadores() as HTMLElement).getByRole("button", { name: nome })
    await user.click(tab(strings.telemovel.mensagens))
    expect(app().dataset.separador).toBe("mensagens")
    expect(document.querySelector(".people-aside")).not.toBeNull()
    expect(screen.getByRole("heading", { name: strings.people.directsTitle })).toBeTruthy()

    await user.click(tab(strings.telemovel.amigos))
    expect(app().dataset.separador).toBe("amigos")
    expect(document.querySelector(".people-bar")).not.toBeNull()
  })
})

describe("no computador nada muda", () => {
  it("without the phone media query: the rail, the column, no tabs and no community rail", async () => {
    await abrir()
    expect(app().classList.contains("telemovel")).toBe(false)
    expect(app().dataset.separador).toBeUndefined()
    expect(document.querySelector(".rail")).not.toBeNull()
    expect(separadores()).toBeNull()
    expect(document.querySelector(".carril-comunidades")).toBeNull()
    expect(document.querySelector(".menu-do-tu")).toBeNull()
    expect(screen.queryByRole("button", { name: strings.telemovel.voltar })).toBeNull()
  })
})
