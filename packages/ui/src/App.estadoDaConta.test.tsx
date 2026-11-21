import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rememberAccountName, SINGLE_ACCOUNT_ID, storedAccountName } from "./lib/accountNames.js"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { AvisoDeSuspensao } from "@enclave/protocol"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { cacheDeMedia } from "./lib/cacheDeMedia.js"
import { LAST_READ_KEY, desligarEstadoDaConta, lerEstadoDaConta } from "./lib/estadoDaConta.js"
import { DM_CLOSED_KEY } from "./lib/directs.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")
const DM_EU_ZE = moradaDeTeste("directa eu ze", "casa.pt")

const EU = "@eu:casa.pt"
const LAGAR = "!lagar:casa.pt"

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  desligarEstadoDaConta()
})

/**
 * The shell and the account state (phase 5): what the interface does with what
 * wave 1 left in the session.
 *
 *  - When the account opens, the marks that were in the browser enter via
 *    session and the old key is erased (one-time migration).
 *  - `device-revoked`: the device was removed from the account on another
 *    device. The vault locks, the gate opens but stops, and the message is
 *    there, with the toast and code.
 *  - `account-suspended`: the server suspended the account. The vault stays
 *    open, and the gate shows the alert with "Request review".
 */
function ponte(opcoes: {
  statusRef?: { current: ((status: unknown) => void) | null }
  estado?: NonNullable<EnclaveBridge["estado"]>
  lock?: () => Promise<{ ok: boolean }>
  connect?: () => Promise<{ ok: boolean }>
  unlock?: (secret: string | null) => Promise<{ ok: boolean }>
  destroy?: () => Promise<{ ok: boolean }>
  canais?: string[]
  denuncias?: NonNullable<EnclaveBridge["denuncias"]>
}): EnclaveBridge {
  return {
    vault: {
      status: async () => ({ exists: true, supportsOsProtection: true }),
      unlock: vi.fn(opcoes.unlock ?? (async () => ({ ok: true }))),
      create: async () => ({ ok: true }),
      lock: opcoes.lock ?? (async () => ({ ok: true })),
      destroy: opcoes.destroy ?? (async () => ({ ok: true })),
    },
    identity: {
      load: async () => ({ address: EU, accountId: "eu" }),
      create: async () => ({ address: EU, accountId: "eu" }),
    },
    session: {
      connect: opcoes.connect ?? (async () => ({ ok: true })),
      capabilities: async () => ["mls"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
      list: async () => opcoes.canais ?? [LAGAR],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
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
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      deafChannels: async () => [],
      feedChannel: async () => MURAL_EU,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({}),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    ...(opcoes.estado ? { estado: opcoes.estado } : {}),
    ...(opcoes.denuncias ? { denuncias: opcoes.denuncias } : {}),
    on: {
      message: () => () => {},
      epoch: () => () => {},
      status: (handler: (status: unknown) => void) => {
        if (opcoes.statusRef) opcoes.statusRef.current = handler
        return () => {}
      },
      connection: () => () => {},
      channels: () => () => {},
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
      lidas: () => () => {},
      arquivo: () => () => {},
      preferencias: () => () => {},
    },
    call: { on: () => () => {}, setMuted: () => {} },
  } as unknown as EnclaveBridge
}

function estadoFalso(): NonNullable<EnclaveBridge["estado"]> & { lidasGuardadas: Record<string, number> } {
  const lidasGuardadas: Record<string, number> = {}
  return {
    lidasGuardadas,
    lidas: async () => ({ ...lidasGuardadas }),
    marcarLido: vi.fn(async (channel: string, at: number) => {
      if ((lidasGuardadas[channel] ?? -1) < at) lidasGuardadas[channel] = at
      return { ok: true }
    }),
    arquivo: async () => ({}),
    arquivar: vi.fn(async () => ({ ok: true })),
    desarquivar: vi.fn(async () => ({ ok: true })),
    preferencias: async () => ({}),
    definirPreferencia: vi.fn(async () => ({ ok: true })),
  }
}

describe("a concha liga o estado da conta quando a conta abre", () => {
  it("migra as marcas do browser para a sessão, uma vez, e apaga as chaves antigas", async () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!velho:casa.pt": 1234 }))
    localStorage.setItem(DM_CLOSED_KEY, JSON.stringify({ [DM_EU_ZE]: 99 }))
    const estado = estadoFalso()
    render(<App bridge={ponte({ estado, canais: [LAGAR, "!velho:casa.pt", DM_EU_ZE] })} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await waitFor(() => expect(localStorage.getItem(LAST_READ_KEY)).toBeNull())
    expect(localStorage.getItem(DM_CLOSED_KEY)).toBeNull()
    expect(estado.marcarLido).toHaveBeenCalledWith("!velho:casa.pt", 1234)
    // Using the browser clock: "now" hid unread messages.
    expect(estado.arquivar).toHaveBeenCalledWith(DM_EU_ZE, 99)
    // And opening the channel marks it read in the session, not in the browser.
    await waitFor(() => expect(lerEstadoDaConta().lidas[LAGAR]).toBeGreaterThan(0))
    expect(estado.lidasGuardadas[LAGAR]).toBeGreaterThan(0)
    expect(localStorage.getItem(LAST_READ_KEY)).toBeNull()
  })
})

describe("um aparelho revogado volta ao portão", () => {
  it("tranca o cofre, mostra a frase com o código, e o portão não abre sozinho", async () => {
    const statusRef: { current: ((status: unknown) => void) | null } = { current: null }
    const lock = vi.fn(async () => ({ ok: true }))
    const bridge = ponte({ statusRef, lock })
    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    const desbloqueiosAntes = vi.mocked(bridge.vault.unlock).mock.calls.length
    act(() => {
      statusRef.current?.({
        detail: "este aparelho foi tirado da conta noutro aparelho",
        level: "error",
        code: "device-revoked",
        route: "toast",
      })
    })
    await waitFor(() => expect(lock).toHaveBeenCalled())
    // Its own screen since 21/11/2026, with the two ways back, and no toast repeating it.
    expect(await screen.findByRole("heading", { name: strings.entrada.removido })).toBeTruthy()
    expect(screen.queryAllByText(/748/)).toHaveLength(0)
    // Stopped: no silent attempt, which would enter again and be rejected.
    expect(vi.mocked(bridge.vault.unlock).mock.calls.length).toBe(desbloqueiosAntes)
    expect(screen.queryByRole("button", { name: strings.rail.chat })).toBeNull()
  })

  it("ao trancar, as imagens decifradas da cache de media são revogadas (Task 10)", async () => {
    const statusRef: { current: ((status: unknown) => void) | null } = { current: null }
    const lock = vi.fn(async () => ({ ok: true }))
    const bridge = ponte({ statusRef, lock })
    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    const url = await cacheDeMedia.obter("sha-teste-trancar", "image/png", async () => new Uint8Array([1]))
    expect(cacheDeMedia.ainda("sha-teste-trancar", url!)).toBe(true)
    act(() => {
      statusRef.current?.({ detail: "este aparelho foi tirado da conta noutro aparelho", level: "error", code: "device-revoked", route: "toast" })
    })
    await waitFor(() => expect(lock).toHaveBeenCalled())
    await waitFor(() => expect(cacheDeMedia.ainda("sha-teste-trancar", url!)).toBe(false))
  })
})

describe("um aparelho removido, com a prova (1.3.16)", () => {
  it("sai da conta e apaga o cofre: tranca, apaga, e fica no registo com a frase", async () => {
    const statusRef: { current: ((status: unknown) => void) | null } = { current: null }
    const ordem: string[] = []
    const lock = vi.fn(async () => {
      ordem.push("lock")
      return { ok: true }
    })
    const destroy = vi.fn(async () => {
      ordem.push("destroy")
      return { ok: true }
    })
    const bridge = ponte({ statusRef, lock, destroy })
    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    act(() => {
      statusRef.current?.({
        detail: "este aparelho foi tirado da conta noutro aparelho",
        level: "error",
        code: "device-revoked",
        route: "toast",
        removido: true,
      })
    })
    await waitFor(() => expect(destroy).toHaveBeenCalledTimes(1))
    expect(ordem).toEqual(["lock", "destroy"])
    // Its own screen: this device no longer has the account, and the two ways back are there.
    expect(await screen.findByRole("heading", { name: strings.entrada.removido })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.entrada.comFicheiro })).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.rail.chat })).toBeNull()
  })

  it("com um canal aberto, o ecrã não pede nada à sessão depois de trancar (16/11/2026)", async () => {
    const statusRef: { current: ((status: unknown) => void) | null } = { current: null }
    let trancado = false
    const lock = vi.fn(async () => {
      trancado = true
      return { ok: true }
    })
    const bridge = ponte({ statusRef, lock })
    // Like the real session: with the vault locked, there is no identity to ask.
    bridge.channels.mayEdit = () => {
      if (trancado) throw new Error("no identity loaded")
      return false
    }
    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await act(async () => {
      screen.getByRole("button", { name: strings.rail.chat }).click()
      await Promise.resolve()
    })
    const linha = document.querySelector<HTMLElement>(".channel-name")
    await act(async () => {
      linha?.click()
      await Promise.resolve()
    })
    act(() => {
      statusRef.current?.({ detail: "x", level: "error", code: "device-revoked", route: "toast", removido: true })
    })
    expect(await screen.findByRole("heading", { name: strings.entrada.removido })).toBeTruthy()
  })

  it("nem pergunta se pode criar votações depois de trancar (20/11/2026)", async () => {
    const statusRef: { current: ((status: unknown) => void) | null } = { current: null }
    let trancado = false
    const lock = vi.fn(async () => {
      trancado = true
      return { ok: true }
    })
    const bridge = ponte({ statusRef, lock })
    // `mayCreatePoll` (1.3.21) is asked on every render: with the vault locked the session throws.
    bridge.channels.mayCreatePoll = () => {
      if (trancado) throw new Error("no identity loaded")
      return true
    }
    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    await act(async () => {
      screen.getByRole("button", { name: strings.rail.chat }).click()
      await Promise.resolve()
    })
    const linha = document.querySelector<HTMLElement>(".channel-name")
    await act(async () => {
      linha?.click()
      await Promise.resolve()
    })
    act(() => {
      statusRef.current?.({ detail: "x", level: "error", code: "device-revoked", route: "toast", removido: true })
    })
    expect(await screen.findByRole("heading", { name: strings.entrada.removido })).toBeTruthy()
  })

  it("sem a prova (cópia substituída, servidor antigo): só tranca, não apaga", async () => {
    const statusRef: { current: ((status: unknown) => void) | null } = { current: null }
    const lock = vi.fn(async () => ({ ok: true }))
    const destroy = vi.fn(async () => ({ ok: true }))
    const bridge = ponte({ statusRef, lock, destroy })
    render(<App bridge={bridge} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    act(() => {
      statusRef.current?.({ detail: "x", level: "error", code: "device-revoked", route: "toast" })
    })
    await waitFor(() => expect(lock).toHaveBeenCalled())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(destroy).not.toHaveBeenCalled()
  })
})

describe("um aparelho revogado no arranque a frio", () => {
  /*
    The core order: the status comes out first, only then `connect()` rejects.
    `vault.lock()` takes longer than that. Unlock calls `enter` while the vault
    is still locking, and `enter` can't open the app or clear the revocation.
  */
  it("fica no portão, parado e com a frase, sem ciclo de tentativas", async () => {
    const statusRef: { current: ((status: unknown) => void) | null } = { current: null }
    let soltarLock: () => void = () => {}
    const lock = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          soltarLock = () => resolve({ ok: true })
        }),
    )
    const connect = vi.fn(async () => {
      statusRef.current?.({
        detail: "este aparelho foi tirado da conta noutro aparelho",
        level: "error",
        code: "device-revoked",
        route: "toast",
      })
      throw new Error("device-revoked")
    })
    const bridge = ponte({ statusRef, lock, connect })
    render(<App bridge={bridge} />)
    await waitFor(() => expect(lock).toHaveBeenCalled())
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    // `enter` already ran: the app didn't open.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(screen.queryByRole("button", { name: strings.rail.chat })).toBeNull()
    // The vault just finished locking, after `enter`.
    await act(async () => {
      soltarLock()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(await screen.findByRole("heading", { name: strings.entrada.removido })).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.rail.chat })).toBeNull()
    // One silent attempt only: the gate doesn't retry on its own.
    expect(vi.mocked(bridge.vault.unlock).mock.calls.length).toBe(1)
    expect(connect).toHaveBeenCalledTimes(1)
  })
})

describe("apagar a conta esquece as marcas do browser", () => {
  /*
    The `enclave.lastRead` and `enclave.dmClosed` keys are from the browser,
    not from the account. After "Delete account", the new account in this
    browser inherited them.
    */
  it("no aparelho removido: depois do destroy, as duas chaves saem", async () => {
    // The gate itself no longer deletes anything (21/11/2026): the removed device is the destroy left at the gate.
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!velho:casa.pt": 1234 }))
    localStorage.setItem(DM_CLOSED_KEY, JSON.stringify({ [DM_EU_ZE]: 99 }))
    rememberAccountName(SINGLE_ACCOUNT_ID, "Ana")
    const statusRef: { current: ((status: unknown) => void) | null } = { current: null }
    const destroy = vi.fn(async () => ({ ok: true }))
    render(<App bridge={ponte({ statusRef, destroy })} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    act(() => {
      statusRef.current?.({ detail: "x", level: "error", code: "device-revoked", route: "toast", removido: true })
    })
    await waitFor(() => expect(destroy).toHaveBeenCalledOnce())
    await waitFor(() => expect(localStorage.getItem(LAST_READ_KEY)).toBeNull())
    expect(localStorage.getItem(DM_CLOSED_KEY)).toBeNull()
    // And the display name kept outside the vault (21/11/2026).
    expect(storedAccountName(SINGLE_ACCOUNT_ID)).toBe("")
  })
})

describe("uma conta suspensa vê o aviso e pede revisão", () => {
  const aviso: AvisoDeSuspensao = {
    v: 1,
    endereco: EU,
    motivo: 3,
    medida: "suspensao-da-conta",
    desde: "2026-11-03",
    ate: null,
    ambito: "A conta não entra neste servidor.",
    factos: "Insultos repetidos.",
    origem: "denuncia",
    semMeiosAutomaticos: true,
    norma: "Termos de utilização, ponto 4.",
    revisao: { pedida: null, decisao: "pendente", nota: "" },
  }
  const suspensa = { detail: "suspensa", level: "error", code: "account-suspended", route: "toast", aviso }

  it("no arranque a frio: o status chega antes de o connect rejeitar, e a app fica no aviso com o cofre aberto", async () => {
    const statusRef: { current: ((status: unknown) => void) | null } = { current: null }
    const lock = vi.fn(async () => ({ ok: true }))
    const pedirRevisao = vi.fn(async () => ({ ok: true as const }))
    const connect = vi.fn(async () => {
      statusRef.current?.(suspensa)
      throw new Error("the server refused the login")
    })
    const denuncias = {
      preparar: vi.fn(),
      enviar: vi.fn(),
      lista: async () => [],
      marcarLida: async () => {},
      pedirRevisao,
      suspensao: async () => aviso,
    } as unknown as NonNullable<EnclaveBridge["denuncias"]>
    const user = userEvent.setup()
    render(<App bridge={ponte({ statusRef, lock, connect, denuncias })} />)
    expect(await screen.findByText("Factos: Insultos repetidos.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.rail.chat })).toBeNull()
    expect(lock).not.toHaveBeenCalled()

    await user.type(screen.getByRole("textbox"), "Peço revisão.")
    await user.click(screen.getByRole("button", { name: strings.contaSuspensa.pedirRevisao }))
    expect(await screen.findByText(strings.contaSuspensa.revisaoEnviada)).toBeTruthy()
    expect(pedirRevisao).toHaveBeenCalledWith("Peço revisão.")

    // "Try again": still suspended, returns to the alert.
    await user.click(screen.getByRole("button", { name: strings.contaSuspensa.tentarOutraVez }))
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    expect(await screen.findByText("Factos: Insultos repetidos.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.rail.chat })).toBeNull()
  })

  it("já dentro da app: a suspensão leva ao aviso, e levantada, 'Tentar outra vez' volta a entrar", async () => {
    const statusRef: { current: ((status: unknown) => void) | null } = { current: null }
    const user = userEvent.setup()
    render(<App bridge={ponte({ statusRef })} />)
    await screen.findByRole("button", { name: strings.rail.chat })
    act(() => {
      statusRef.current?.(suspensa)
    })
    expect(await screen.findByText("Factos: Insultos repetidos.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.rail.chat })).toBeNull()

    await user.click(screen.getByRole("button", { name: strings.contaSuspensa.tentarOutraVez }))
    await screen.findByRole("button", { name: strings.rail.chat })
  })
})
