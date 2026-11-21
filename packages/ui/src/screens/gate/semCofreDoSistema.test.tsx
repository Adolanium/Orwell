import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { Emparelhar } from "./Emparelhar.js"
import { ateAPalavraPasse, comEmparelhamento } from "../../../testes/emparelharAtePalavraPasse.js"
import { Setup } from "./Setup.js"

afterEach(cleanup)

/**
 * F3: a new account always starts with a password, even on a host with a
 * keychain (the desktop). And the "Remember session" checkbox comes enabled,
 * and remembers after the vault is born.
 */

const FRASE = "uma frase comprida de teste"

function ponte(chamadas: string[]): EnclaveBridge {
  return {
    vault: {
      status: async () => ({ exists: false, supportsOsProtection: true, memoriaDisponivel: true }),
      create: async (frase: string | null) => {
        chamadas.push(`create ${frase === null ? "SEM FRASE" : frase}`)
        return { ok: true }
      },
      memorizar: async (ligar: boolean) => {
        chamadas.push(`memorizar ${ligar}`)
        return { ok: true }
      },
      destroy: async () => ({ ok: true }),
      // The step after the vault is born offers the account file: it calls export.
      export: async () => ({ data: "ficheiro" }),
    },
    identity: { create: async () => ({ address: "@ana:localhost", accountId: "ana" }) },
    session: { connect: async () => ({ ok: true }) },
    profile: { set: async () => ({ ok: true }) },
    pairing: { join: async () => ({ ok: true }), cancel: async () => ({ ok: true }) },
    on: { pair: () => () => {} },
  } as unknown as EnclaveBridge
}

describe("F3: contas novas sem cofre sem frase", () => {
  it("o registo na secretária cria o cofre com a palavra-passe, e não memoriza sem pedirem (21/11/2026)", async () => {
    const chamadas: string[] = []
    render(
      <ToastProvider>
        <BridgeContext.Provider value={ponte(chamadas)}>
          <Setup onDone={vi.fn()} onUnlockInstead={vi.fn()} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )
    fireEvent.click(await screen.findByRole("button", { name: strings.entrada.criarConta }))
    fireEvent.change(await screen.findByLabelText(strings.entrada.nome), { target: { value: "Ana" } })
    expect(document.querySelector('input[name="memorizar"]')).toBeNull()
    const campo = document.querySelector('input[name="new-password"]') as HTMLInputElement
    fireEvent.change(campo, { target: { value: FRASE } })
    fireEvent.change(document.querySelector('input[name="confirm-password"]') as HTMLInputElement, { target: { value: FRASE } })
    fireEvent.submit(campo.closest("form") as HTMLFormElement)
    await waitFor(() => expect(chamadas).toContain(`create ${FRASE}`))
    expect(chamadas).not.toContain("memorizar true")
    expect(chamadas).not.toContain("create SEM FRASE")
  })

  it("emparelhar na secretária também sela o cofre com uma palavra-passe, nunca sem frase", async () => {
    const chamadas: string[] = []
    const { bridge, emitir } = comEmparelhamento(ponte(chamadas), chamadas)
    render(
      <ToastProvider>
        <BridgeContext.Provider value={bridge}>
          <Emparelhar linkInicial="https://orwell.pt/app/emparelhar#6gzjKC5Y-jxiXv_ZLoIzYX6ZL4PeZ24HirzSb__z6VY" onDone={vi.fn()} onBack={vi.fn()} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )
    await ateAPalavraPasse(emitir, "conta")
    const campo = document.querySelector('input[name="current-password"]') as HTMLInputElement
    fireEvent.change(campo, { target: { value: FRASE } })
    fireEvent.submit(campo.closest("form") as HTMLFormElement)
    await waitFor(() => expect(chamadas).toContain(`seal ${FRASE}`))
    expect(chamadas).not.toContain("create SEM FRASE")
  })
})
