import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, PairEvento } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { JuntarContas } from "./JuntarContas.js"

afterEach(cleanup)

/**
 * "Link to another account" (phase 8.2), on screen: the explanation comes first,
 * "delete" is written before starting, and the order of the three steps. Key point:
 * if pairing fails, the bridge does not hear `juntarAvisar` or `juntarTrocar`.
 * Nothing is warned and nothing is deleted.
 */
const LINK = "https://orwell.pt/app/emparelhar#6gzjKC5Y-jxiXv_ZLoIzYX6ZL4PeZ24HirzSb__z6VY"
const DORA = "@dora:orwell.pt"

function ponte(): { bridge: EnclaveBridge; emitir: (evento: PairEvento) => void; chamadas: string[] } {
  const chamadas: string[] = []
  let ouvinte: ((evento: PairEvento) => void) | null = null
  const bridge = {
    vault: { status: vi.fn(async () => ({ exists: true, supportsOsProtection: false })) },
    pairing: {
      juntar: vi.fn(async (link: string) => {
        chamadas.push(`juntar ${link}`)
        return { ok: true }
      }),
      juntarAvisar: vi.fn(async () => {
        chamadas.push("avisar")
        return { ok: true }
      }),
      juntarTrocar: vi.fn(async (frase: string | null) => {
        chamadas.push(`trocar ${frase}`)
        return { address: DORA }
      }),
      joinCheckPassword: vi.fn(async (frase: string) => {
        chamadas.push(`check ${frase}`)
        if (frase === "wrong-password") throw new Error("this is not the account password")
        return { accountPassword: true }
      }),
      juntarCancelar: vi.fn(async () => {
        chamadas.push("cancelar")
        return { ok: true }
      }),
      confirm: vi.fn(async () => {
        chamadas.push("confirm")
        return { ok: true }
      }),
      refuse: vi.fn(async () => ({ ok: true })),
      cancel: vi.fn(async () => ({ ok: true })),
      status: vi.fn(),
      host: vi.fn(),
      join: vi.fn(),
      done: vi.fn(),
      devices: vi.fn(),
    },
    on: {
      pair: (handler: (evento: PairEvento) => void) => {
        ouvinte = handler
        return () => {
          ouvinte = null
        }
      },
    },
  } as unknown as EnclaveBridge
  return { bridge, emitir: (evento) => act(() => ouvinte?.(evento)), chamadas }
}

function montar(bridge: EnclaveBridge): { onDone: ReturnType<typeof vi.fn> } {
  const onDone = vi.fn()
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <JuntarContas onClose={() => {}} onDone={onDone} />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
  return { onDone }
}

/** From the explanation to the six words, with the "delete" written along the way. */
async function ateAsPalavras(emitir: (evento: PairEvento) => void): Promise<void> {
  expect(screen.getByText(strings.juntar.naoPassa)).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: strings.juntar.comecar }))
  fireEvent.change(screen.getByLabelText(strings.pairing.pasteLabel), { target: { value: LINK } })
  fireEvent.click(screen.getByRole("button", { name: strings.pairing.pasteAction }))
  // No password before the words (1.3.26): only "apagar", then the pairing.
  expect(document.querySelector('input[type="password"]')).toBeNull()
  fireEvent.change(screen.getByLabelText(strings.settings.destroyConfirmLabel), { target: { value: strings.settings.destroyConfirmWord } })
  fireEvent.click(screen.getByRole("button", { name: strings.settings.destroyConfirm }))
  await waitFor(() => expect(screen.getByText(strings.pairing.connecting)).toBeTruthy())
  emitir({ fase: "ligado" })
  emitir({ fase: "sas", palavras: "uma-duas-tres-quatro-cinco-seis" })
  await waitFor(() => expect(screen.getByRole("button", { name: strings.pairing.sasSame })).toBeTruthy())
}

/** "Palavra-passe da conta", after the words: the main account's, one field. */
async function typePassword(frase: string): Promise<void> {
  const field = await screen.findByLabelText(strings.juntarAparelho.palavraPasseDaConta)
  fireEvent.change(field, { target: { value: frase } })
  fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.continuar }))
}

describe("juntar a outra conta", () => {
  it("emparelha, avisa e só no fim apaga, por esta ordem", async () => {
    const { bridge, emitir, chamadas } = ponte()
    const { onDone } = montar(bridge)
    await ateAsPalavras(emitir)
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.sasSame }))
    emitir({ fase: "certificado", address: DORA, palavraPasse: "conta" })
    await typePassword("account-password-1")
    await waitFor(() => expect(screen.getByText(strings.juntar.feito(DORA))).toBeTruthy())
    expect(chamadas).toEqual([`juntar ${LINK}`, "confirm", "check account-password-1", "avisar", "trocar account-password-1"])
    fireEvent.click(screen.getByRole("button", { name: strings.juntar.continuar }))
    expect(onDone).toHaveBeenCalled()
  })

  it("se o emparelhamento falhar, nada se avisa e nada se apaga", async () => {
    const { bridge, emitir, chamadas } = ponte()
    montar(bridge)
    await ateAsPalavras(emitir)
    emitir({ fase: "falhou", razao: "palavras-diferentes" })
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(chamadas).not.toContain("avisar")
    expect(chamadas.some((chamada) => chamada.startsWith("trocar"))).toBe(false)
  })

  it("se não sair de todos os canais, não apaga, e diz o erro com código", async () => {
    const { bridge, emitir, chamadas } = ponte()
    ;(bridge.pairing!.juntarAvisar as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("could not leave every channel, nothing was deleted", { cause: { canais: 2 } }),
    )
    montar(bridge)
    await ateAsPalavras(emitir)
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.sasSame }))
    emitir({ fase: "certificado", address: DORA, palavraPasse: "conta" })
    await typePassword("account-password-1")
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("121"))
    expect(chamadas.some((chamada) => chamada.startsWith("trocar"))).toBe(false)
    expect(chamadas).toContain("cancelar")
  })

  it("a wrong account password is Error 140 by the field, and nothing is warned or deleted", async () => {
    const { bridge, emitir, chamadas } = ponte()
    montar(bridge)
    await ateAsPalavras(emitir)
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.sasSame }))
    emitir({ fase: "certificado", address: DORA, palavraPasse: "conta" })
    await typePassword("wrong-password")
    expect((await screen.findByRole("alert")).textContent).toContain("140")
    expect(chamadas).not.toContain("avisar")
    expect(screen.getByLabelText(strings.juntarAparelho.palavraPasseDaConta)).toBeTruthy()
  })

  it("with no record from the main account, a new password is chosen, typed twice", async () => {
    const { bridge, emitir, chamadas } = ponte()
    ;(bridge.pairing!.joinCheckPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ accountPassword: false })
    montar(bridge)
    await ateAsPalavras(emitir)
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.sasSame }))
    emitir({ fase: "certificado", address: DORA, palavraPasse: "nova" })
    fireEvent.change(await screen.findByLabelText(strings.juntarAparelho.palavraPasseDaConta), { target: { value: "new-password-1" } })
    fireEvent.change(screen.getByLabelText(strings.entrada.palavraPasseOutraVez), { target: { value: "other-password" } })
    fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.continuar }))
    expect((await screen.findByRole("alert")).textContent).toBe(strings.entrada.diferentes)
    fireEvent.change(screen.getByLabelText(strings.entrada.palavraPasseOutraVez), { target: { value: "new-password-1" } })
    fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.continuar }))
    await waitFor(() => expect(chamadas).toContain("trocar new-password-1"))
  })
})
