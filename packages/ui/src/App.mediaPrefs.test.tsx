import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { PREFS_KEY, readPrefs } from "./hooks/usePrefs.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

/**
 * Changing screen must not erase the microphone choice.
 *
 * The effect that sends preferences to the core runs on every view change and
 * sent four of the seven keys. The bridge does not merge: it writes over. So
 * every screen change erased the chosen microphone and the gain, and the next call
 * opened the system device with factory volume, while
 * Settings kept showing, with full confidence, the choice that no longer existed.
 *
 * The guard is over ALL calls and not over the last one: one incomplete call is enough
 * to leave the core state without the field, and it is the incomplete call that this file
 * exists to catch.
 */

afterEach(cleanup)

const EU = "@eu:casa.pt"
const FEED = moradaDeTeste("mural eu", "casa.pt")

let aplicadas: Record<string, unknown>[] = []

function ponte(
  call: Partial<Pick<EnclaveBridge["call"], "setMuted" | "setCameraOff" | "join" | "leave">> = {},
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
      list: async () => [FEED],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
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
      feedChannel: async () => FEED,
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
    applyMediaPrefs: (next: Record<string, unknown>) => {
      aplicadas.push(next)
    },
    call: { on: () => () => {}, setMuted: () => {}, ...call },
  } as unknown as EnclaveBridge
}

beforeEach(() => {
  aplicadas = []
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      chosen: true,
      inputDeviceId: "mic-abc",
      inputGain: 1.5,
      filtroDeMicrofone: false,
      noiseSuppression: false,
    }),
  )
})

describe("as escolhas de microfone chegam ao núcleo e lá ficam", () => {
  it("desde o arranque, e outra vez a cada mudança de ecrã", async () => {
    render(<App bridge={ponte()} />)
    await screen.findByRole("button", { name: strings.rail.chat })

    await act(async () => {
      ;(screen.getByRole("button", { name: strings.rail.social }) as HTMLElement).click()
      await Promise.resolve()
    })

    expect(aplicadas.length).toBeGreaterThan(1)
    for (const chamada of aplicadas) {
      expect(chamada).toMatchObject({
        inputDeviceId: "mic-abc",
        inputGain: 1.5,
        filtroDeMicrofone: false,
        noiseSuppression: false,
      })
    }
  })
})


function montarChamada() {
  const canal = "!conversa:casa.pt"
  const entradas: boolean[] = []
  let aEnviar = true
  let ouvinteDaFala: ((premida: boolean) => void) | undefined
  const base = ponte({
    setMuted: (calado) => { aEnviar = !calado },
    setCameraOff: () => {},
    join: async () => { entradas.push(aEnviar) },
    leave: async () => {},
  })
  const bridge: EnclaveBridge = {
    ...base,
    channels: {
      ...base.channels,
      list: async () => [canal],
      rooms: () => [{ room: "voz", name: "Estúdio", category: "", kind: "voice", position: 0 }],
    },
    atalhosGlobais: {
      definir: async () => ({ globais: [], soComAJanela: [], ocupados: [], faltaAcessibilidade: [] }),
      suspender: async () => ({ ok: true }),
      abrirAcessibilidade: async () => ({ ok: true }),
      aoAccionar: () => () => {},
      aoFalar: (ouvinte) => {
        ouvinteDaFala = ouvinte
        return () => { ouvinteDaFala = undefined }
      },
    },
  }
  return {
    bridge,
    entradas,
    aEnviar: () => aEnviar,
    falarNoFundo: (premida: boolean) => act(() => ouvinteDaFala?.(premida)),
  }
}

async function abrirDefinicoesDeMedia() {
  fireEvent.click(await screen.findByRole("button", { name: strings.sidebar.abrirDefinicoes }))
  fireEvent.click(await screen.findByRole("button", { name: strings.settings.media }))
  return screen.findByRole("switch", { name: "Premir para falar" })
}

async function entrarNoEstudio() {
  await screen.findByRole("button", { name: strings.rail.chat })
  fireEvent.click(screen.getByRole("button", { name: strings.rail.chat }))
  const canal = [...document.querySelectorAll(".channel-row button")].find((botao) => botao.textContent?.includes("conversa"))
  if (canal) fireEvent.click(canal)
  fireEvent.click(await screen.findByRole("button", { name: /Estúdio/ }))
}

describe("premir para falar como modo do microfone", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it("só envia áudio durante a pressão da tecla, na janela ou no fundo", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      chosen: true,
      entrarSilenciado: true,
      atalhosDeVoz: { falar: "F8" },
    }))
    const chamada = montarChamada()
    render(<App bridge={chamada.bridge} />)
    const modo = await abrirDefinicoesDeMedia()
    expect(chamada.aEnviar()).toBe(true)
    fireEvent.click(modo)
    expect(modo.getAttribute("aria-checked")).toBe("true")
    expect(chamada.aEnviar()).toBe(false)
    expect(readPrefs().modoDoMicrofone).toBe("carregar")

    await entrarNoEstudio()
    expect(chamada.entradas).toEqual([false])
    expect(chamada.aEnviar()).toBe(false)
    fireEvent.keyDown(document, { key: "F8", code: "F8" })
    expect(chamada.aEnviar()).toBe(true)
    fireEvent.keyUp(document, { key: "F8", code: "F8" })
    expect(chamada.aEnviar()).toBe(false)
    chamada.falarNoFundo(true)
    expect(chamada.aEnviar()).toBe(true)
    chamada.falarNoFundo(false)
    expect(chamada.aEnviar()).toBe(false)

    fireEvent.click(await abrirDefinicoesDeMedia())
    expect(chamada.aEnviar()).toBe(true)
  })

  it("ao mudar de silenciado para premir para falar, basta a tecla", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, micMuted: true, atalhosDeVoz: { falar: "F8" } }))
    const chamada = montarChamada()
    render(<App bridge={chamada.bridge} />)
    const modo = await abrirDefinicoesDeMedia()
    fireEvent.click(modo)
    expect(chamada.aEnviar()).toBe(false)
    await entrarNoEstudio()

    fireEvent.keyDown(document, { key: "F8", code: "F8" })
    expect(chamada.aEnviar()).toBe(true)
    fireEvent.blur(window)
    expect(chamada.aEnviar()).toBe(false)
  })

  it("o modo guardado sem tecla começa silenciado e uma tecla aleatória não o abre", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, modoDoMicrofone: "carregar" }))
    const chamada = montarChamada()
    render(<App bridge={chamada.bridge} />)
    await entrarNoEstudio()
    expect(chamada.entradas).toEqual([false])
    fireEvent.keyDown(document, { key: "F8", code: "F8" })
    expect(chamada.aEnviar()).toBe(false)
    const modo = await abrirDefinicoesDeMedia()
    expect(modo.getAttribute("aria-checked")).toBe("true")
    expect(screen.getByText(strings.settings.pushToTalkNoKey)).toBeTruthy()

    const atalho = screen.getByText(strings.settings.atalhoAccao.falar).closest("li")
    if (!atalho) throw new Error("Falta a linha da tecla para falar")
    fireEvent.click(within(atalho).getByRole("button", { name: strings.settings.atalhoMudar }))
    await act(async () => { fireEvent.keyDown(document, { key: "F9", code: "F9" }) })
    expect(readPrefs().atalhosDeVoz.falar).toBe("F9")
    expect(chamada.aEnviar()).toBe(false)
    fireEvent.keyUp(document, { key: "F9", code: "F9" })
    fireEvent.keyDown(document, { key: "F9", code: "F9" })
    expect(chamada.aEnviar()).toBe(true)
    fireEvent.keyUp(document, { key: "F9", code: "F9" })
    expect(chamada.aEnviar()).toBe(false)
  })
})
