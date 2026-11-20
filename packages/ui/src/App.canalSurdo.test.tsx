import { moradaDeTeste } from "../testes/moradas.js"
import type { FichaDoCanal } from "@enclave/client-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { formatInviteLink } from "@enclave/client-core"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { SALA_SURDA } from "./hooks/useOutbox.js"
import { strings, translateError } from "./strings.js"

/**
 * A deaf room, seen from the whole shell (1.3.25, P2 and P5).
 *
 * The core says which rooms this device cannot read (`on.surdez`) and refuses
 * to send there (`SALA_SURDA`). The room says so, in a line in the flow, with
 * the error code; what is written waits for the room and goes out when it
 * hears again; and the line goes away.
 *
 * The bench is the one of `App.fluidez.test.tsx`, with the `surdez` event.
 */

afterEach(cleanup)
beforeEach(() => localStorage.clear())

const ME = "@me:casa.pt"

const DM_ANA = moradaDeTeste("directa ana me", "casa.pt")
/** The card of each channel (1.0 "Arca", slice 6b), for the false bridge to give to the interface. */
const FICHAS = (): Record<string, FichaDoCanal> => ({
  [DM_ANA]: { tipo: "directa", par: "@ana:casa.pt" },
  [FEED]: { tipo: "mural", dono: "@me:casa.pt" },
})
const FEED = moradaDeTeste("mural me", "casa.pt")
const CANAL = "!sala-nova:casa.pt"
const GERAL = "!geral:casa.pt"
const CODIGO = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"

interface Bancada {
  bridge: EnclaveBridge
  redeem: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  ligar: () => void
  cair: () => void
  canais: (lista: string[]) => void
  surdez: (canais: string[]) => void
}

function bancada(
  opcoes: { cofre?: "abre" | "pede-palavra" | "nao-existe"; aplicacaoInstalada?: boolean; destroy?: () => Promise<{ ok: boolean }>; exportar?: boolean } = {},
): Bancada {
  const cofre = opcoes.cofre ?? "abre"
  const redeem = vi.fn(async () => ({ ok: true }))
  const connect = vi.fn(async () => ({ ok: true }))
  const send = vi.fn(async () => ({ ok: true }))
  let aoLigar: ((payload: unknown) => void) | null = null
  let aosCanais: ((payload: unknown) => void) | null = null
  let aSurdez: ((evento: { canais: string[] }) => void) | null = null
  const bridge = {
    vault: {
      status: async () => ({ exists: cofre !== "nao-existe", supportsOsProtection: true }),
      unlock: async () => {
        if (cofre === "pede-palavra") throw new Error("wrong passphrase, or the vault is damaged")
        return { ok: true }
      },
      create: async () => ({ ok: true }),
      // Only where the account is created here: the account-file step needs it. An
      // account that already exists, with no export, gets no one-time notice.
      ...(cofre === "nao-existe" || opcoes.exportar ? { export: async () => ({ data: "ficheiro-da-conta" }) } : {}),
      lock: async () => ({ ok: true }),
      destroy: opcoes.destroy ?? (async () => ({ ok: true })),
    },
    identity: {
      load: async () => ({ address: ME, accountId: "me" }),
      create: async () => ({ address: ME, accountId: "me" }),
    },
    session: {
      connect,
      capabilities: async () => ["mls", "presence"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
        fichas: FICHAS,
      list: async () => [FEED],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: async () => ({ ok: true }),
      declineChannelInvite: async () => ({ ok: true }),
      send,
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [ME],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
    },
    invites: {
      create: async () => formatInviteLink("casa.pt", CANAL, CODIGO),
      redeem,
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
      connection: (handler: (payload: unknown) => void) => {
        aoLigar = handler
        return () => {}
      },
      channels: (handler: (payload: unknown) => void) => {
        aosCanais = handler
        return () => {}
      },
      surdez: (handler: (evento: { canais: string[] }) => void) => {
        aSurdez = handler
        return () => {}
      },
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    call: { on: () => () => {}, setMuted: () => {} },
    ...(opcoes.aplicacaoInstalada
      ? { actualizacao: { verificar: async () => null, dispensar: async () => {}, abrir: async () => {} } }
      : {}),
  } as unknown as EnclaveBridge
  return {
    bridge,
    redeem,
    connect,
    send,
    ligar: () => act(() => aoLigar?.({ state: "online" })),
    cair: () => act(() => aoLigar?.({ state: "reconnecting" })),
    canais: (lista) => act(() => aosCanais?.({ channels: lista })),
    surdez: (canais) => act(() => aSurdez?.({ canais })),
  }
}



async function dentro(): Promise<void> {
  await screen.findByRole("button", { name: strings.rail.social })
}

describe("uma sala surda", () => {
  it("a janela que recarrega a meio da sessão lê o estado logo, sem esperar por outro evento", async () => {
    const { bridge, ligar, canais } = bancada()
    bridge.channels.list = async () => [FEED, GERAL]
    ;(bridge.social as { canaisSurdos?: () => Promise<string[]> }).canaisSurdos = async () => [GERAL]
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    canais([FEED, GERAL])
    const [codigo, frase] = translateError(SALA_SURDA).split("\n")
    expect(await screen.findByText(frase as string)).toBeTruthy()
    expect(screen.getByText(codigo as string)).toBeTruthy()
  })

  it("diz-se na sala com o código, a mensagem fica à espera da sala, e sai quando a sala volta a ouvir", async () => {
    const user = userEvent.setup()
    const { bridge, send, ligar, canais, surdez } = bancada()
    bridge.channels.list = async () => [FEED, GERAL]
    let surda = true
    send.mockImplementation(async () => {
      if (surda) throw new Error(SALA_SURDA)
      return { ok: true }
    })
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    canais([FEED, GERAL])

    const caixa = await screen.findByRole("textbox")
    const [codigo, frase] = translateError(SALA_SURDA).split("\n")
    expect(screen.queryByText(frase as string)).toBeNull()

    surdez([GERAL])
    // Code first, then the sentence, in one line in the flow.
    expect(await screen.findByText(frase as string)).toBeTruthy()
    expect(screen.getByText(codigo as string)).toBeTruthy()

    await user.type(caixa, "estás aí?{Enter}")
    expect(await screen.findByText(strings.chat.aEsperaDaSalaNota)).toBeTruthy()
    expect(screen.getByText("estás aí?")).toBeTruthy()

    surda = false
    surdez([])
    await waitFor(() => expect(screen.queryByText(frase as string)).toBeNull())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(strings.chat.aEsperaDaSalaNota)).toBeNull())
  })
})
