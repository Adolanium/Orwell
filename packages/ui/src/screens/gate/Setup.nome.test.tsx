import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NOME_MAX, contarGrafemas } from "@enclave/client-core"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { strings } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import { Setup } from "./Setup.js"

/**
 * The name at the gate follows the display-name rule: at most 12 graphemes
 * (`NOME_MAX`, `nomeDeApresentacao.ts`), the same as the profile.
 *
 * The field already cuts what is typed or pasted (`CampoDeNome`). It does not
 * cut WHILE an input method composes, so as not to split a half-built
 * character; and on Android the keyboard composes every word. So 40 letters
 * could sit in the field, "Continuar" lit, and the account was created with
 * them; the profile cut them later. Found in an independent QA pass (PR #3).
 */
afterEach(cleanup)

function montar(): void {
  render(
    <ToastProvider>
      <BridgeContext.Provider
        value={
          {
            vault: { status: async () => ({ exists: false, supportsOsProtection: false }) },
          } as unknown as EnclaveBridge
        }
      >
        <Setup onDone={vi.fn()} onUnlockInstead={vi.fn()} />
      </BridgeContext.Provider>
    </ToastProvider>,
  )
}

const campo = (): HTMLInputElement => screen.getByPlaceholderText(strings.gate.namePlaceholder)
const continuar = (): HTMLButtonElement => screen.getByRole("button", { name: /^(Continuar|Seguinte|Continue|Next)$/ })
const QUARENTA = "Maximiliano Alexandre Vasconcelos Pereira"

describe("o nome no portão, com a regra do perfil", () => {
  it("colar 40 letras guarda só as 12 primeiras", async () => {
    montar()
    await waitFor(() => expect(campo()).toBeTruthy())
    fireEvent.change(campo(), { target: { value: QUARENTA } })
    expect(contarGrafemas(campo().value)).toBe(NOME_MAX)
  })

  it("a meio de uma composição (o teclado do Android), mais de 12 não acende o Continuar", async () => {
    montar()
    await waitFor(() => expect(campo()).toBeTruthy())
    fireEvent.input(campo(), { target: { value: QUARENTA }, isComposing: true })
    expect(campo().value).toBe(QUARENTA)
    expect(continuar().disabled).toBe(true)
    // Composition ends: the field cuts, and the button lights.
    fireEvent.compositionEnd(campo())
    expect(contarGrafemas(campo().value)).toBe(NOME_MAX)
    expect(continuar().disabled).toBe(false)
  })
})
