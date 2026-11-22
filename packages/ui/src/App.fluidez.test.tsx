import { moradaDeTeste } from "../testes/moradas.js"
import type { FichaDoCanal } from "@enclave/client-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { formatInviteLink } from "@enclave/client-core"
import type { EnclaveBridge } from "./bridge.js"
import { App, INTERVALO_DO_PULSO_MS, SILENCIO_DO_PULSO_MS } from "./App.js"
import { adiarOFicheiro, criarContaNoPortao } from "./testes/portao.js"
import { SINGLE_ACCOUNT_ID, storedAccountName } from "./lib/accountNames.js"
import { strings } from "./strings.js"

/**
 * Phase 4 (fluidity), seen from the whole shell:
 *
 *  - the "No connection" banner connects on click and when the network or tab
 *    returns;
 *  - someone writing offline sees the message waiting, and it goes out when
 *    it comes back;
 *  - a followed link stays in the sidebar, "waiting for entry", until the
 *    channel arrives, and can be canceled;
 *  - someone who just created the account sees how to reach someone.
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
  /** A session status, as the core emits it (`device-new`…). */
  estado: (payload: unknown) => void
}

function bancada(
  opcoes: {
    cofre?: "abre" | "pede-palavra" | "nao-existe"
    aplicacaoInstalada?: boolean
    destroy?: () => Promise<{ ok: boolean }>
    exportar?: boolean
    /** The account's devices, for the file banner and the new-device card. `null`: the manifest did not read. */
    aparelhos?: () => number | null
    /** This device came in by importing the account file (`pairing.status().entrouPorFicheiro`). */
    entrouPorFicheiro?: boolean
    revogar?: (deviceKey: string) => Promise<{ ok: boolean }>
  } = {},
): Bancada {
  const cofre = opcoes.cofre ?? "abre"
  const redeem = vi.fn(async () => ({ ok: true }))
  const connect = vi.fn(async () => ({ ok: true }))
  const send = vi.fn(async () => ({ ok: true }))
  let aoLigar: ((payload: unknown) => void) | null = null
  let aoEstado: ((payload: unknown) => void) | null = null
  let aosCanais: ((payload: unknown) => void) | null = null
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
      status: (handler: (payload: unknown) => void) => {
        aoEstado = handler
        return () => {}
      },
      connection: (handler: (payload: unknown) => void) => {
        aoLigar = handler
        return () => {}
      },
      channels: (handler: (payload: unknown) => void) => {
        aosCanais = handler
        return () => {}
      },
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    call: { on: () => () => {}, setMuted: () => {} },
    ...(opcoes.aparelhos
      ? {
          pairing: {
            status: async () => ({
              temChaveDeConta: true,
              servidorSuporta: true,
              servidorRevoga: true,
              ...(opcoes.entrouPorFicheiro ? { entrouPorFicheiro: true } : {}),
            }),
            devices: async () => {
              const quantos = opcoes.aparelhos!()
              if (quantos === null) return null
              return Array.from({ length: quantos }, (_, i) => ({ deviceKey: `aparelho-${i}`, addedAt: i, esteAparelho: i === 0 }))
            },
            ...(opcoes.revogar ? { revoke: opcoes.revogar } : {}),
          },
        }
      : {}),
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
    estado: (payload: unknown) => act(() => aoEstado?.(payload)),
    cair: () => act(() => aoLigar?.({ state: "reconnecting" })),
    canais: (lista) => act(() => aosCanais?.({ channels: lista })),
  }
}


/** The password step in Setup, and the confirmation step. */
async function dentro(): Promise<void> {
  await screen.findByRole("button", { name: strings.rail.social })
}

describe('a faixa "Sem ligação" com acção', () => {
  it('"Ligar agora" pede a ligação à ponte, e a faixa diz há quanto tempo caiu', async () => {
    const user = userEvent.setup()
    const { bridge, connect, ligar, cair } = bancada()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    cair()
    const antes = connect.mock.calls.length

    const faixa = await screen.findByText(strings.connection.semLigacaoHa("menos de 1 min"), { exact: false })
    expect(faixa).toBeTruthy()
    await user.click(screen.getAllByRole("button", { name: strings.connection.ligarAgora })[0]!)
    expect(connect.mock.calls.length).toBe(antes + 1)
  })

  it("a rede a voltar e o separador a ficar visível ligam já; ligada, não se mexe em nada", async () => {
    const { bridge, connect, ligar, cair } = bancada()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    const ligada = connect.mock.calls.length
    act(() => {
      window.dispatchEvent(new Event("online"))
    })
    // Connected: a `connect` here would close a socket that is working.
    expect(connect.mock.calls.length).toBe(ligada)

    cair()
    await act(async () => {
      window.dispatchEvent(new Event("online"))
      await Promise.resolve()
    })
    expect(connect.mock.calls.length).toBe(ligada + 1)

    // The first attempt is done (and the connection stays down): the tab becoming
    // visible tries again.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      await Promise.resolve()
    })
    expect(connect.mock.calls.length).toBe(ligada + 2)
  })

  it("rede e separador no mesmo instante, ou um duplo clique, dão UMA tentativa enquanto ela corre", async () => {
    const { bridge, connect, ligar, cair } = bancada()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    cair()
    // An attempt that takes time: the promise stays pending until told to stop.
    let acabar: () => void = () => {}
    connect.mockImplementation(() => new Promise((r) => (acabar = () => r({ ok: true }))))
    const antes = connect.mock.calls.length

    act(() => {
      window.dispatchEvent(new Event("online"))
      document.dispatchEvent(new Event("visibilitychange"))
    })
    const botao = screen.getAllByRole("button", { name: strings.connection.ligarAgora })[0]!
    fireEvent.click(botao)
    fireEvent.click(botao)
    expect(connect.mock.calls.length).toBe(antes + 1)

    await act(async () => {
      acabar()
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.click(botao)
    expect(connect.mock.calls.length).toBe(antes + 2)
  })
})

describe("a ligação meio aberta (1.3.6)", () => {
  /** The test bench bridge, with the connection check counting. */
  function comVerificacao(): Bancada & { verificar: ReturnType<typeof vi.fn> } {
    const banco = bancada()
    const verificar = vi.fn(async () => true)
    ;(banco.bridge.session as { verificarLigacao?: () => Promise<boolean> }).verificarLigacao = verificar
    return { ...banco, verificar }
  }

  function visibilidade(estado: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado })
  }

  afterEach(() => {
    visibilidade("visible")
    vi.useRealTimers()
  })

  it("ligada, o separador a voltar, a rede a voltar e a página a sair da cache verificam a ligação, sem a substituir", async () => {
    const { bridge, connect, ligar, verificar } = comVerificacao()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    const ligada = connect.mock.calls.length
    const antes = verificar.mock.calls.length

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      await Promise.resolve()
    })
    expect(verificar.mock.calls.length).toBe(antes + 1)

    await act(async () => {
      window.dispatchEvent(new Event("online"))
      await Promise.resolve()
    })
    expect(verificar.mock.calls.length).toBe(antes + 2)

    const voltou = new Event("pageshow") as Event & { persisted?: boolean }
    Object.defineProperty(voltou, "persisted", { value: true })
    await act(async () => {
      window.dispatchEvent(voltou)
      await Promise.resolve()
    })
    expect(verificar.mock.calls.length).toBe(antes + 3)
    // None of these replaces the socket: that would close a socket that may be fine.
    expect(connect.mock.calls.length).toBe(ligada)
  })

  it("enquanto se vê, verifica de tempos a tempos; escondida, não gasta bateria nem rede", async () => {
    const { bridge, ligar, verificar } = comVerificacao()
    render(<App bridge={bridge} />)
    await dentro()
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] })
    ligar()
    const antes = verificar.mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DO_PULSO_MS + 10)
    })
    expect(verificar.mock.calls.length).toBe(antes + 1)
    // Since 1.3.7 the pulse only asks after one minute of socket silence.
    expect(verificar.mock.calls.at(-1)).toEqual([{ silencioMinimoMs: SILENCIO_DO_PULSO_MS }])

    visibilidade("hidden")
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    const escondida = verificar.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DO_PULSO_MS * 4)
    })
    expect(verificar.mock.calls.length).toBe(escondida)
  })

  it("sem ligação não se verifica: liga-se, como antes", async () => {
    const { bridge, connect, ligar, cair, verificar } = comVerificacao()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    cair()
    const antes = connect.mock.calls.length
    const verificadas = verificar.mock.calls.length
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      await Promise.resolve()
    })
    expect(connect.mock.calls.length).toBe(antes + 1)
    expect(verificar.mock.calls.length).toBe(verificadas)
  })
})

describe("a volta ao primeiro plano (1.3.7)", () => {
  function visibilidade(estado: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado })
  }

  afterEach(() => {
    visibilidade("visible")
    vi.useRealTimers()
  })

  it("com `retomar` na ponte, a volta diz à sessão quanto tempo esteve escondida e se o aparelho suspende", async () => {
    const banco = bancada()
    const retomar = vi.fn(() => "nada")
    const verificar = vi.fn(async () => true)
    Object.assign(banco.bridge.session as object, { retomar, verificarLigacao: verificar })
    const nada = (): void => {}
    const toque = vi.fn(
      (consulta: string) =>
        ({ matches: consulta === "(pointer: coarse)", media: consulta, addEventListener: nada, removeEventListener: nada, addListener: nada, removeListener: nada }) as unknown as MediaQueryList,
    )
    const original = window.matchMedia
    window.matchMedia = toque as unknown as typeof window.matchMedia
    try {
      render(<App bridge={banco.bridge} />)
      await dentro()
      banco.ligar()
      vi.useFakeTimers({ toFake: ["Date"] })
      visibilidade("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
      vi.advanceTimersByTime(45_000)
      visibilidade("visible")
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"))
        await Promise.resolve()
      })
      expect(retomar).toHaveBeenCalledTimes(1)
      const [opcoes] = retomar.mock.calls[0] as unknown as [{ escondidaMs: number; suspende: boolean }]
      expect(opcoes.escondidaMs).toBeGreaterThanOrEqual(45_000)
      expect(opcoes.suspende).toBe(true)
      // The check is no longer called directly by the return: the session decides.
      expect(verificar).not.toHaveBeenCalled()
    } finally {
      window.matchMedia = original
    }
  })
})

describe("escrever sem ligação", () => {
  it('a mensagem aparece à espera, com "Descartar", e sai quando a ligação volta', async () => {
    const user = userEvent.setup()
    const { bridge, send, ligar, cair, canais } = bancada()
    bridge.channels.list = async () => [FEED, GERAL]
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    canais([FEED, GERAL])
    cair()

    const caixa = await screen.findByPlaceholderText(strings.connection.composerEspera)
    await user.type(caixa, "escrita no comboio{Enter}")
    expect(await screen.findByText(strings.chat.aEsperaDeLigacaoNota)).toBeTruthy()
    expect(screen.getByText("escrita no comboio")).toBeTruthy()
    expect(send).not.toHaveBeenCalled()

    ligar()
    await waitFor(() => expect(send).toHaveBeenCalledWith(GERAL, "escrita no comboio", undefined, undefined))
  })
})

describe("à espera de entrada", () => {
  it("um link seguido fica na barra lateral até o canal chegar, e aí dá lugar ao canal", async () => {
    const user = userEvent.setup()
    const { bridge, ligar, canais } = bancada()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()

    await user.click(screen.getByRole("button", { name: strings.sidebar.joinWithLink }))
    const janela = screen.getByRole("dialog")
    await user.type(within(janela).getByRole("textbox"), formatInviteLink("casa.pt", CANAL, CODIGO))
    await user.click(within(janela).getByRole("button", { name: strings.prompts.confirm }))

    // The usual toast stays, and the line remains.
    expect(await screen.findByText(strings.chat.joinPending)).toBeTruthy()
    expect(screen.getByText(strings.sidebar.aEsperaDeEntrada)).toBeTruthy()
    expect(screen.getByText("sala-nova")).toBeTruthy()

    canais([FEED, CANAL])
    await waitFor(() => expect(screen.queryByText(strings.sidebar.aEsperaDeEntrada)).toBeNull())
  })

  it("a channel of the account that waits for this device's seat stays in the list as joining, with no Cancel, until it opens", async () => {
    const { bridge, ligar, canais } = bancada()
    const OPACO = moradaDeTeste("canal da conta", "casa.pt")
    let pendentes = [OPACO]
    bridge.channels.pending = async () => pendentes
    bridge.channels.meta = (canal: string) => (canal === OPACO ? { name: "Clube de Leitura", updatedAt: 1 } : null)
    render(<App bridge={bridge} />)
    await dentro()
    ligar()

    expect(await screen.findByText(strings.sidebar.aEntrarNoCanal)).toBeTruthy()
    expect(screen.getByText("Clube de Leitura")).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.sidebar.cancelarEspera("Clube de Leitura") })).toBeNull()

    // The seat arrives: the channel enters the list and the line gives way to it.
    pendentes = []
    canais([FEED, OPACO])
    await waitFor(() => expect(screen.queryByText(strings.sidebar.aEntrarNoCanal)).toBeNull())
  })

  it('"Cancelar" tira a linha e diz que o canal ainda pode aparecer', async () => {
    const user = userEvent.setup()
    const { bridge, ligar } = bancada()
    render(<App bridge={bridge} />)
    await dentro()
    ligar()

    await user.click(screen.getByRole("button", { name: strings.sidebar.joinWithLink }))
    const janela = screen.getByRole("dialog")
    await user.type(within(janela).getByRole("textbox"), formatInviteLink("casa.pt", CANAL, CODIGO))
    fireEvent.submit(within(janela).getByRole("textbox").closest("form")!)
    await screen.findByText(strings.sidebar.aEsperaDeEntrada)

    await user.click(screen.getByRole("button", { name: strings.sidebar.cancelarEspera("sala-nova") }))
    expect(screen.queryByText(strings.sidebar.aEsperaDeEntrada)).toBeNull()
    expect(await screen.findByText(strings.sidebar.esperaCancelada)).toBeTruthy()
  })
})

describe("o ficheiro da conta, numa faixa dentro da app (21/11/2026)", () => {
  it("uma conta sem ficheiro guardado vê a faixa; fechar a folha não a tira, guardar tira", async () => {
    const user = userEvent.setup()
    URL.createObjectURL = vi.fn(() => "blob:conta")
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    const { bridge, ligar } = bancada({ exportar: true })
    render(<App bridge={bridge} />)
    ligar()
    expect((await screen.findAllByText(strings.entrada.faixa)).length).toBeGreaterThan(0)
    await user.click(screen.getAllByRole("button", { name: strings.entrada.faixaGuardar })[0]!)
    expect(await screen.findByRole("heading", { name: strings.entrada.guardarTitulo })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.common.close }))
    expect(screen.getAllByText(strings.entrada.faixa).length).toBeGreaterThan(0)
    await user.click(screen.getAllByRole("button", { name: strings.entrada.faixaGuardar })[0]!)
    const guardar = await screen.findByRole("button", { name: strings.entrada.guardarFicheiro })
    await waitFor(() => expect((guardar as HTMLButtonElement).disabled).toBe(false))
    await user.click(guardar)
    await waitFor(() => expect(screen.queryByText(strings.entrada.faixa)).toBeNull())
    cleanup()
    const outra = bancada({ exportar: true })
    render(<App bridge={outra.bridge} />)
    outra.ligar()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(screen.queryByText(strings.entrada.faixa)).toBeNull()
  })
})

describe("um aparelho que entrou noutro sítio (21/11/2026)", () => {
  const entrou = (chave: string) => ({
    detail: `${chave}|${Math.floor(Date.now() / 1000)}`,
    level: "info",
    code: "device-new",
    route: "log",
  })

  it('o cartão "Novo aparelho na tua conta" aparece no canto; "Fui eu" fecha-o', async () => {
    const user = userEvent.setup()
    const { bridge, ligar, estado } = bancada({ aparelhos: () => 1, revogar: vi.fn(async () => ({ ok: true })) })
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    estado(entrou("chave-nova"))
    const cartao = await screen.findByRole("status", { name: strings.juntarAparelho.novoNaConta })
    expect(within(cartao).getByRole("button", { name: strings.juntarAparelho.remover })).toBeTruthy()
    await user.click(within(cartao).getByRole("button", { name: strings.juntarAparelho.fuiEu }))
    await waitFor(() => expect(screen.queryByRole("status", { name: strings.juntarAparelho.novoNaConta })).toBeNull())
  })

  it('"Remover" usa a remoção de sempre, com a chave do aparelho', async () => {
    const user = userEvent.setup()
    const revogar = vi.fn(async () => ({ ok: true }))
    const { bridge, ligar, estado } = bancada({ aparelhos: () => 1, revogar })
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    estado(entrou("chave-nova"))
    const cartao = await screen.findByRole("status", { name: strings.juntarAparelho.novoNaConta })
    await user.click(within(cartao).getByRole("button", { name: strings.juntarAparelho.remover }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: strings.settings.revoke }))
    await waitFor(() => expect(revogar).toHaveBeenCalledWith("chave-nova"))
    await waitFor(() => expect(screen.queryByRole("status", { name: strings.juntarAparelho.novoNaConta })).toBeNull())
  })

  it('"Remover" asks first; "Cancel" removes nothing and keeps the card', async () => {
    const user = userEvent.setup()
    const revogar = vi.fn(async () => ({ ok: true }))
    const { bridge, ligar, estado } = bancada({ aparelhos: () => 1, revogar })
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    estado(entrou("chave-nova"))
    const cartao = await screen.findByRole("status", { name: strings.juntarAparelho.novoNaConta })
    await user.click(within(cartao).getByRole("button", { name: strings.juntarAparelho.remover }))
    const dialogo = await screen.findByRole("alertdialog")
    expect(within(dialogo).getByText(strings.settings.revokeTitle)).toBeTruthy()
    expect(revogar).not.toHaveBeenCalled()
    await user.click(within(dialogo).getByRole("button", { name: strings.common.cancel }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(revogar).not.toHaveBeenCalled()
    expect(screen.getByRole("status", { name: strings.juntarAparelho.novoNaConta })).toBeTruthy()
  })

  it("a faixa do ficheiro sai logo que entra um segundo aparelho, sem reabrir a app", async () => {
    let quantos = 1
    const { bridge, ligar, estado } = bancada({ exportar: true, aparelhos: () => quantos })
    render(<App bridge={bridge} />)
    ligar()
    expect((await screen.findAllByText(strings.entrada.faixa)).length).toBeGreaterThan(0)
    quantos = 2
    estado(entrou("chave-nova"))
    await waitFor(() => expect(screen.queryByText(strings.entrada.faixa)).toBeNull())
  })

  it("a device that came in by the account file never sees the banner, even with no mark here and the manifest unread (hotfix 1.3.26-2)", async () => {
    // Control: the same device, not imported, sees it (no mark in this browser, devices unknown).
    const antes = bancada({ exportar: true, aparelhos: () => null })
    render(<App bridge={antes.bridge} />)
    antes.ligar()
    expect((await screen.findAllByText(strings.entrada.faixa)).length).toBeGreaterThan(0)
    cleanup()
    const importado = bancada({ exportar: true, aparelhos: () => null, entrouPorFicheiro: true })
    render(<App bridge={importado.bridge} />)
    importado.ligar()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(screen.queryByText(strings.entrada.faixa)).toBeNull()
  })

  it("never in the phone layout, also with no file saved; on the desktop, only when the file was never saved nor imported (hotfix 1.3.26-2)", async () => {
    const nada = (): void => {}
    const telemovel = vi.fn(
      (consulta: string) =>
        ({ matches: consulta === "(max-width: 840px)", media: consulta, addEventListener: nada, removeEventListener: nada, addListener: nada, removeListener: nada }) as unknown as MediaQueryList,
    )
    const original = window.matchMedia
    window.matchMedia = telemovel as unknown as typeof window.matchMedia
    try {
      // The phone: an account with no file saved and one device, the case the desktop shows it for.
      const { bridge, ligar } = bancada({ exportar: true, aparelhos: () => 1 })
      render(<App bridge={bridge} />)
      ligar()
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(document.querySelector(".app.telemovel")).not.toBeNull()
      expect(screen.queryByText(strings.entrada.faixa)).toBeNull()
    } finally {
      window.matchMedia = original
    }
    cleanup()
    // The desktop, never saved nor imported: it shows.
    const nunca = bancada({ exportar: true, aparelhos: () => 1 })
    render(<App bridge={nunca.bridge} />)
    nunca.ligar()
    expect((await screen.findAllByText(strings.entrada.faixa)).length).toBeGreaterThan(0)
    cleanup()
    // The desktop, imported: it does not.
    const importado = bancada({ exportar: true, aparelhos: () => 1, entrouPorFicheiro: true })
    render(<App bridge={importado.bridge} />)
    importado.ligar()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(screen.queryByText(strings.entrada.faixa)).toBeNull()
  })
})

describe("the display name outside the vault (21/11/2026)", () => {
  it("is stored once the account is open, and goes with the account", async () => {
    const statusless = bancada({ cofre: "nao-existe" })
    const user = userEvent.setup()
    render(<App bridge={statusless.bridge} />)
    await criarContaNoPortao(user, { nome: "Vera" })
    await adiarOFicheiro(user)
    await dentro()
    await waitFor(() => expect(storedAccountName(SINGLE_ACCOUNT_ID)).toBe("Vera"))
  })
})

describe("a primeira vez", () => {
  /*
    The first-steps card ("How to reach someone") left in 1.3.26. Its three ways
    stay where they always were: Join with a link in the channel list, a friend
    by address in Friends, and the address in Settings and the profile.
  */
  it("depois de criar a conta, não há cartão de primeiros passos", async () => {
    const user = userEvent.setup()
    const { bridge, ligar } = bancada({ cofre: "nao-existe" })
    render(<App bridge={bridge} />)

    await criarContaNoPortao(user)
    await adiarOFicheiro(user)
    await dentro()
    ligar()

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(screen.queryByText("Como chegar a alguém")).toBeNull()
    expect(screen.queryByText("How to reach someone")).toBeNull()
    expect(document.querySelector(".primeiros-passos")).toBeNull()
    expect(screen.getByRole("button", { name: strings.sidebar.joinWithLink })).toBeTruthy()
  })
})

describe("à espera de entrada: um convite aceite", () => {
  const ANA = "@ana:casa.pt"
  const DM = DM_ANA
  const CLUBE = "!clube:casa.pt"

  /** Ana's invite and our yes, in the direct conversation history. */
  /** An invite + yes pair, at the given time. */
  function par(at: number, seq: number): unknown[] {
    return [
      { seq, sender: ANA, at, payload: { t: "message", invite: { channel: CLUBE, name: "Clube", at } } },
      { seq: seq + 1, sender: ME, at: at + 1, payload: { t: "message", inviteReply: { channel: CLUBE, accepted: true, at: at + 1 } } },
    ]
  }

  function comConviteAceite(bridge: EnclaveBridge, lista: string[]): void {
    const agora = Date.now()
    bridge.channels.list = async () => lista
    bridge.channels.history = async (canal: string) =>
      canal === DM ? (par(agora - 2000, 1) as never) : []
  }

  it("sem o canal, a linha aparece com o nome do convite", async () => {
    const { bridge, ligar } = bancada()
    comConviteAceite(bridge, [FEED, DM])
    render(<App bridge={bridge} />)
    await dentro()
    ligar()
    expect(await screen.findByText("Clube")).toBeTruthy()
    expect(screen.getByText(strings.sidebar.aEsperaDeEntrada)).toBeTruthy()
  })

  it("o canal chegou, a pessoa saiu dele, e recarregou: a linha não volta", async () => {
    const primeira = bancada()
    comConviteAceite(primeira.bridge, [FEED, DM, CLUBE])
    const { unmount } = render(<App bridge={primeira.bridge} />)
    await dentro()
    primeira.ligar()
    await waitFor(() => expect(JSON.parse(localStorage.getItem("enclave.esperasFeitas") ?? "{}")).toHaveProperty([CLUBE]))
    unmount()

    // Reload outside the channel: the fold still shows "accepted", but the store says it already waited.
    const segunda = bancada()
    comConviteAceite(segunda.bridge, [FEED, DM])
    render(<App bridge={segunda.bridge} />)
    await dentro()
    segunda.ligar()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(screen.queryByText(strings.sidebar.aEsperaDeEntrada)).toBeNull()
  })
})

describe("à espera de entrada: um convite novo para um canal de onde se saiu", () => {
  it("aceitar, entrar, sair, e aceitar outro convite mais tarde: a linha volta", async () => {
    const ANA = "@ana:casa.pt"
    const DM = DM_ANA
    const CLUBE = "!clube:casa.pt"
    const agora = Date.now()
    const par = (at: number, seq: number): unknown[] => [
      { seq, sender: ANA, at, payload: { t: "message", invite: { channel: CLUBE, name: "Clube", at } } },
      { seq: seq + 1, sender: ME, at: at + 1, payload: { t: "message", inviteReply: { channel: CLUBE, accepted: true, at: at + 1 } } },
    ]

    const primeira = bancada()
    primeira.bridge.channels.list = async () => [FEED, DM, CLUBE]
    primeira.bridge.channels.history = async (canal: string) => (canal === DM ? (par(agora - 2000, 1) as never) : [])
    const { unmount } = render(<App bridge={primeira.bridge} />)
    await dentro()
    primeira.ligar()
    await waitFor(() => expect(localStorage.getItem("enclave.esperasFeitas")).toContain(CLUBE))
    unmount()

    // Weeks later, outside the channel, a new invite (timestamp greater than the mark), accepted.
    const segunda = bancada()
    segunda.bridge.channels.list = async () => [FEED, DM]
    segunda.bridge.channels.history = async (canal: string) =>
      canal === DM ? ([...par(agora - 2000, 1), ...par(Date.now() + 60_000, 3)] as never) : []
    render(<App bridge={segunda.bridge} />)
    await dentro()
    segunda.ligar()
    expect(await screen.findByText(strings.sidebar.aEsperaDeEntrada)).toBeTruthy()
  })
})
