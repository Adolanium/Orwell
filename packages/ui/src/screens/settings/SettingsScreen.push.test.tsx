import { CALAR_PARA_SEMPRE } from "@enclave/protocol"
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BridgeContext } from "../../App.js"
import type { ConnectionState, DefinicoesDoPush, EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { readPrefs, writePrefs } from "../../hooks/usePrefs.js"
import { definicoesDoPush, usePushFechada } from "../../hooks/usePushFechada.js"
import { registerSystemNoticeHost } from "../../lib/notifications.js"
import { strings } from "../../strings.js"
import { SettingsScreen } from "./SettingsScreen.js"

/**
 * "Notifications when the app is closed" (Web Push) in Settings › Notifications,
 * and the hook that keeps the subscription in step with the app.
 */

type Estado = Awaited<ReturnType<NonNullable<EnclaveBridge["push"]>["estado"]>>

function ponteDoPush(estado: Estado = "pronto") {
  return {
    estado: vi.fn(async () => estado),
    ligar: vi.fn(async (_definicoes: DefinicoesDoPush) => ({ ok: true as const })),
    renovar: vi.fn(async (_definicoes: DefinicoesDoPush) => ({ ok: true })),
    desligar: vi.fn(async () => ({ ok: true as const })),
    fecharAvisos: vi.fn(async () => {}),
  }
}

let permissao: NotificationPermission = "granted"
const pedir = vi.fn(async () => permissao)

beforeEach(() => {
  localStorage.clear()
  permissao = "granted"
  pedir.mockClear()
  // A getter, read live: `Object.assign` would copy the value once.
  const falsa = Object.defineProperties(function Notification() {}, {
    permission: { get: () => permissao },
    requestPermission: { value: pedir },
  })
  vi.stubGlobal("Notification", falsa)
  // "System notifications" on: the push toggle only shows under it.
  writePrefs({ ...readPrefs(), notifications: true })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function montar(push: ReturnType<typeof ponteDoPush> | undefined): void {
  const bridge = { applyMediaPrefs: vi.fn(), ...(push ? { push } : {}) } as unknown as EnclaveBridge
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <SettingsScreen
          address="@me:casa.pt"
          connection="online"
          connectionDetail={null}
          onLock={() => {}}
          micMuted={false}
          soundOff={false}
          onToggleMic={() => {}}
          onToggleSound={() => {}}
          premirParaFalar={{ ligado: false, onMudar: () => {} }}
          seccao="avisos"
        />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
}

const interruptor = () => screen.queryByRole("switch", { name: strings.settings.pushFechada })

describe("o interruptor", () => {
  it("aparece na web com a capacidade, desligado, com a nota sem nome nem texto", async () => {
    montar(ponteDoPush())
    await waitFor(() => expect(interruptor()).not.toBeNull())
    expect(interruptor()?.getAttribute("aria-checked")).toBe("false")
    expect(screen.getByText(strings.settings.pushFechadaNota)).toBeTruthy()
    expect(screen.getByText(strings.settings.pushSalaNota)).toBeTruthy()
  })

  it.each<Estado>(["sem-servidor", "sem-browser"])("com %s não aparece", async (estado) => {
    const push = ponteDoPush(estado)
    montar(push)
    await waitFor(() => expect(push.estado).toHaveBeenCalled())
    expect(interruptor()).toBeNull()
    expect(screen.queryByText(strings.settings.pushIosNota)).toBeNull()
  })

  it("no Safari do iOS, onde nem há Notification, a nota aparece na mesma", async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal("Notification", undefined)
    montar(ponteDoPush("ios-fora-do-ecra"))
    await waitFor(() => expect(screen.getByText(strings.settings.pushIosNota)).toBeTruthy())
    expect(screen.getByText(strings.settings.notifUnsupported)).toBeTruthy()
    expect(interruptor()).toBeNull()
  })

  it("no iOS fora do ecrã principal mostra a nota, e não o interruptor", async () => {
    montar(ponteDoPush("ios-fora-do-ecra"))
    await waitFor(() => expect(screen.getByText(strings.settings.pushIosNota)).toBeTruthy())
    expect(interruptor()).toBeNull()
  })

  it("na secretária (anfitrião de avisos) não aparece, nem sem bridge.push nem com ele", async () => {
    registerSystemNoticeHost({ show: () => {} } as never)
    try {
      montar(undefined)
      await new Promise((r) => setTimeout(r, 20))
      expect(interruptor()).toBeNull()
      cleanup()
      montar(ponteDoPush())
      await new Promise((r) => setTimeout(r, 20))
      expect(interruptor()).toBeNull()
    } finally {
      registerSystemNoticeHost(null)
    }
  })

  it("só com as notificações do sistema ligadas", async () => {
    writePrefs({ ...readPrefs(), notifications: false })
    const push = ponteDoPush()
    montar(push)
    await new Promise((r) => setTimeout(r, 20))
    expect(interruptor()).toBeNull()
  })
})

describe("ligar e desligar", () => {
  it("com a permissão dada, ligar subscreve com a língua, os silenciados e a pausa, e fica ligado", async () => {
    const user = userEvent.setup()
    writePrefs({ ...readPrefs(), notifications: true, silenciados: ["!a:casa.pt"], pausaAte: Date.now() + 60_000 })
    const push = ponteDoPush()
    montar(push)
    await waitFor(() => expect(interruptor()).not.toBeNull())
    await user.click(interruptor() as HTMLElement)
    await waitFor(() => expect(readPrefs().pushFechada).toBe(true))
    expect(pedir).not.toHaveBeenCalled()
    expect(push.ligar).toHaveBeenCalledTimes(1)
    expect(push.ligar.mock.calls[0]?.[0]).toMatchObject({ silenciados: ["!a:casa.pt"] })
    expect(push.ligar.mock.calls[0]?.[0].calarAte).toBeGreaterThan(Date.now())
  })

  it("o browser recusa a subscrição: 791 no ecrã, e fica desligado", async () => {
    // The toggle only shows with the permission granted ("System notifications"
    // asked for it); what the browser can still refuse is the subscription.
    const user = userEvent.setup()
    const push = ponteDoPush()
    push.ligar.mockRejectedValueOnce(new Error("the browser refused the notification subscription"))
    montar(push)
    await waitFor(() => expect(interruptor()).not.toBeNull())
    await user.click(interruptor() as HTMLElement)
    await waitFor(() => expect(screen.getByText(/791/)).toBeTruthy())
    expect(pedir).not.toHaveBeenCalled()
    expect(readPrefs().pushFechada).toBe(false)
  })

  it("o servidor recusa: 792 no ecrã, e fica desligado", async () => {
    const user = userEvent.setup()
    const push = ponteDoPush()
    push.ligar.mockRejectedValueOnce(new Error("the server refused the notification subscription"))
    montar(push)
    await waitFor(() => expect(interruptor()).not.toBeNull())
    await user.click(interruptor() as HTMLElement)
    await waitFor(() => expect(screen.getByText(/792/)).toBeTruthy())
    expect(readPrefs().pushFechada).toBe(false)
  })

  it("desligar cancela e fica desligado", async () => {
    const user = userEvent.setup()
    writePrefs({ ...readPrefs(), notifications: true, pushFechada: true })
    const push = ponteDoPush()
    montar(push)
    await waitFor(() => expect(interruptor()?.getAttribute("aria-checked")).toBe("true"))
    await user.click(interruptor() as HTMLElement)
    await waitFor(() => expect(push.desligar).toHaveBeenCalledTimes(1))
    expect(readPrefs().pushFechada).toBe(false)
  })
})

describe("definicoesDoPush", () => {
  it("Ocupado cala para sempre; uma pausa a correr cala até ao fim; uma passada não cala", () => {
    const agora = 1_000_000
    expect(definicoesDoPush({ silenciados: [], pausaAte: 0, activity: "ocupado" }, "pt", agora).calarAte).toBe(CALAR_PARA_SEMPRE)
    expect(definicoesDoPush({ silenciados: [], pausaAte: agora + 5, activity: "online" }, "en", agora)).toEqual({
      lingua: "en",
      silenciados: [],
      calarAte: agora + 5,
    })
    expect(definicoesDoPush({ silenciados: [], pausaAte: agora - 5, activity: "online" }, "pt", agora).calarAte).toBe(0)
  })
})

describe("usePushFechada", () => {
  function correr(push: ReturnType<typeof ponteDoPush>, connection: ConnectionState = "online", avisar = vi.fn()) {
    return renderHook(({ c }) => usePushFechada({ push }, c, avisar), { initialProps: { c: connection } })
  }

  it("desligado, não renova nada, mas fecha os avisos do push ao ligar", async () => {
    const push = ponteDoPush()
    correr(push)
    await waitFor(() => expect(push.fecharAvisos).toHaveBeenCalledTimes(1))
    expect(push.renovar).not.toHaveBeenCalled()
  })

  it("ligado, renova ao ligar e quando muda um silenciado, a pausa ou o Ocupado", async () => {
    writePrefs({ ...readPrefs(), pushFechada: true })
    const push = ponteDoPush()
    const { rerender } = correr(push, "reconnecting")
    expect(push.renovar).not.toHaveBeenCalled()
    rerender({ c: "online" })
    await waitFor(() => expect(push.renovar).toHaveBeenCalledTimes(1))
    act(() => writePrefs({ ...readPrefs(), silenciados: ["!x:casa.pt"] }))
    await waitFor(() => expect(push.renovar).toHaveBeenCalledTimes(2))
    expect(push.renovar.mock.calls[1]?.[0]).toMatchObject({ silenciados: ["!x:casa.pt"] })
    act(() => writePrefs({ ...readPrefs(), activity: "ocupado" }))
    await waitFor(() => expect(push.renovar).toHaveBeenCalledTimes(3))
    expect(push.renovar.mock.calls[2]?.[0]).toMatchObject({ calarAte: CALAR_PARA_SEMPRE })
    act(() => writePrefs({ ...readPrefs(), activity: "online", pausaAte: Date.now() + 3_600_000 }))
    await waitFor(() => expect(push.renovar).toHaveBeenCalledTimes(4))
    // The same settings again send nothing.
    act(() => writePrefs({ ...readPrefs() }))
    await new Promise((r) => setTimeout(r, 20))
    expect(push.renovar).toHaveBeenCalledTimes(4)
  })

  it("ligado contra um servidor sem push: desliga e diz o 790, uma vez", async () => {
    writePrefs({ ...readPrefs(), pushFechada: true })
    const push = ponteDoPush("sem-servidor")
    const avisar = vi.fn()
    correr(push, "online", avisar)
    await waitFor(() => expect(avisar).toHaveBeenCalledTimes(1))
    expect((avisar.mock.calls[0]?.[0] as Error).message).toBe("this server does not send notifications when the app is closed")
    expect(readPrefs().pushFechada).toBe(false)
    expect(push.renovar).not.toHaveBeenCalled()
  })

  it("ligado com a permissão bloqueada: desliga em silêncio", async () => {
    writePrefs({ ...readPrefs(), pushFechada: true })
    permissao = "denied"
    const push = ponteDoPush()
    const avisar = vi.fn()
    correr(push, "online", avisar)
    await waitFor(() => expect(readPrefs().pushFechada).toBe(false))
    expect(avisar).not.toHaveBeenCalled()
    expect(push.renovar).not.toHaveBeenCalled()
  })
})
