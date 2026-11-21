import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { Unlock } from "./Unlock.js"

afterEach(cleanup)

/**
 * The "Remember session" checkbox in the gate (F1), and finding 9 (F0).
 *
 * The gate asks the host for vault state on mount. The checkbox only appears
 * with memory on the platform and a vault with password; it comes enabled;
 * remembering happens after unlocking and before connecting; and a failure to
 * remember does not block entry.
 */

type Estado = Awaited<ReturnType<EnclaveBridge["vault"]["status"]>>

function ponte(
  estado: Estado,
  extras: { memorizar?: (ligar: boolean) => Promise<{ ok: boolean }>; chamadas?: string[] } = {},
): EnclaveBridge {
  const chamadas = extras.chamadas ?? []
  return {
    vault: {
      status: async () => estado,
      unlock: async (secret: string | null) => {
        chamadas.push(secret === null ? "unlock silencioso" : "unlock")
        if (secret === null) throw new Error("this vault needs a passphrase")
        return { ok: true }
      },
      destroy: async () => ({ ok: true }),
      ...(extras.memorizar ? { memorizar: extras.memorizar } : {}),
    },
    identity: {
      load: async () => {
        chamadas.push("load")
        return { address: "@ana:orwell.pt", accountId: "ana" }
      },
    },
    session: {
      connect: async () => {
        chamadas.push("connect")
        return { ok: true }
      },
    },
  } as unknown as EnclaveBridge
}

const COM_MEMORIA: Estado = {
  exists: true,
  supportsOsProtection: false,
  versao: "orwv2",
  protection: "passphrase",
  memoriaDisponivel: true,
  sessaoMemorizada: false,
}

function montar(bridge: EnclaveBridge, props: Partial<Parameters<typeof Unlock>[0]> = {}): { onDone: ReturnType<typeof vi.fn> } {
  const onDone = vi.fn()
  render(
    <ToastProvider>
      <BridgeContext.Provider value={bridge}>
        <Unlock onDone={onDone} {...props} />
      </BridgeContext.Provider>
    </ToastProvider>,
  )
  return { onDone }
}

function caixa(): HTMLInputElement | null {
  return document.querySelector('input[name="memorizar"]')
}

async function entrarComFrase(): Promise<void> {
  await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull())
  const campo = document.querySelector('input[type="password"]') as HTMLInputElement
  fireEvent.change(campo, { target: { value: "a frase certa" } })
  fireEvent.submit(campo.closest("form") as HTMLFormElement)
}

describe('o portão: "Manter sessão iniciada"', () => {
  it("aparece DESLIGADA (21/11/2026), sem nota; marcada, memoriza depois de abrir e antes de ligar", async () => {
    const chamadas: string[] = []
    const memorizar = vi.fn(async (ligar: boolean) => {
      chamadas.push(`memorizar ${ligar}`)
      return { ok: true }
    })
    const { onDone } = montar(ponte(COM_MEMORIA, { memorizar, chamadas }))
    await waitFor(() => expect(caixa()).not.toBeNull())
    expect(caixa()?.checked).toBe(false)
    expect(screen.getByText(strings.entrada.manterSessao)).toBeTruthy()
    fireEvent.click(caixa() as HTMLInputElement)
    // Inside the form, after the field: Enter key still opens it.
    expect(caixa()?.closest("form")).toBe(document.querySelector('input[type="password"]')?.closest("form"))

    await entrarComFrase()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("@ana:orwell.pt"))
    expect(chamadas).toEqual(["unlock silencioso", "unlock", "memorizar true", "load", "connect"])
  })

  it("desligada (como vem), não memoriza", async () => {
    const memorizar = vi.fn(async () => ({ ok: true }))
    const { onDone } = montar(ponte(COM_MEMORIA, { memorizar }))
    await waitFor(() => expect(caixa()).not.toBeNull())
    expect(caixa()?.checked).toBe(false)
    await entrarComFrase()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(memorizar).not.toHaveBeenCalled()
  })

  it("uma falha a memorizar não impede entrar: diz-se, e segue", async () => {
    const memorizar = vi.fn(async () => {
      throw new Error("this device cannot remember the session")
    })
    const { onDone } = montar(ponte(COM_MEMORIA, { memorizar }))
    await waitFor(() => expect(caixa()).not.toBeNull())
    fireEvent.click(caixa() as HTMLInputElement)
    await entrarComFrase()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("@ana:orwell.pt"))
    expect(memorizar).toHaveBeenCalled()
  })

  it("não aparece sem memória na plataforma, num cofre `os`, nem numa ponte que não sabe memorizar", async () => {
    const memorizar = vi.fn(async () => ({ ok: true }))
    for (const [estado, comMemorizar] of [
      [{ ...COM_MEMORIA, memoriaDisponivel: false }, true],
      [{ ...COM_MEMORIA, protection: "os" as const }, true],
      [COM_MEMORIA, false],
    ] as const) {
      montar(ponte(estado, comMemorizar ? { memorizar } : {}))
      await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull())
      // State reads after the first render: gives it a turn.
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(caixa()).toBeNull()
      cleanup()
    }
  })
})
