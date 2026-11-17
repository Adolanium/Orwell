import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../App.js"
import type { EnclaveBridge } from "../bridge.js"
import { FICHEIRO_DA_CONTA_KEY, ficheiroPorTratar } from "../lib/ficheiroDaConta.js"
import { strings } from "../strings.js"
import { ToastProvider } from "./Toast.js"
import { AvisoDoFicheiroDaConta, PassoDoFicheiroDaConta } from "./FicheiroDaConta.js"

/**
 * The account file right after the account is created, and the one-time notice
 * (16/11/2026). "Continue" only after the file went out AND the box is ticked; a
 * keychain vault asks a password for the file first; the share sheet where the
 * browser has one.
 */

const ENDERECO = "@ana:orwell.test"
const exportar = vi.fn(async (_frase?: string) => ({ data: "ficheiro-da-conta" }))
let proteccao: "os" | "passphrase" = "passphrase"
const descargas: string[] = []

function ponte(): EnclaveBridge {
  return {
    vault: {
      status: async () => ({ exists: true, supportsOsProtection: proteccao === "os", protection: proteccao }),
      export: exportar,
    },
  } as unknown as EnclaveBridge
}

beforeEach(() => {
  localStorage.clear()
  exportar.mockClear()
  exportar.mockImplementation(async (frase?: string) => {
    if (proteccao === "os" && !frase) throw new Error("an export passphrase is required")
    return { data: `ficheiro${frase ? `-${frase}` : ""}` }
  })
  proteccao = "passphrase"
  descargas.length = 0
  URL.createObjectURL = vi.fn(() => "blob:conta")
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    descargas.push(this.download)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, "share")
  Reflect.deleteProperty(navigator, "canShare")
})

function passo(onContinuar = vi.fn()): typeof onContinuar {
  render(
    <ToastProvider>
      <BridgeContext.Provider value={ponte()}>
        <PassoDoFicheiroDaConta address={ENDERECO} onContinuar={onContinuar} />
      </BridgeContext.Provider>
    </ToastProvider>,
  )
  return onContinuar
}

const continuar = (): HTMLButtonElement => screen.getByRole("button", { name: strings.ficheiroDaConta.continuar }) as HTMLButtonElement
const descarregar = (): HTMLButtonElement => screen.getByRole("button", { name: strings.ficheiroDaConta.descarregar }) as HTMLButtonElement

describe("o passo do ficheiro da conta", () => {
  it("diz o que é o ficheiro, e Continuar só depois de descarregar E marcar a caixa", async () => {
    const onContinuar = passo()
    expect(screen.getByRole("heading", { name: strings.ficheiroDaConta.titulo })).toBeTruthy()
    expect(screen.getByText(strings.ficheiroDaConta.texto)).toBeTruthy()
    expect(screen.getByText(strings.ficheiroDaConta.nota)).toBeTruthy()
    expect(continuar().disabled).toBe(true)
    // The box alone is not enough.
    fireEvent.click(screen.getByRole("checkbox", { name: strings.ficheiroDaConta.guardei }))
    expect(continuar().disabled).toBe(true)
    await waitFor(() => expect(descarregar().disabled).toBe(false))
    fireEvent.click(descarregar())
    await waitFor(() => expect(descargas).toEqual([strings.ficheiroDaConta.nomeDoFicheiro]))
    expect(continuar().disabled).toBe(false)
    // The download alone is not enough either.
    fireEvent.click(screen.getByRole("checkbox", { name: strings.ficheiroDaConta.guardei }))
    expect(continuar().disabled).toBe(true)
    fireEvent.click(screen.getByRole("checkbox", { name: strings.ficheiroDaConta.guardei }))
    fireEvent.click(continuar())
    expect(onContinuar).toHaveBeenCalledTimes(1)
    // One export, made before the tap; the notice is no longer owed.
    expect(exportar).toHaveBeenCalledTimes(1)
    expect(exportar).toHaveBeenCalledWith(undefined)
    await waitFor(async () => expect(await ficheiroPorTratar(ENDERECO)).toBe(false))
  })

  it("um cofre guardado pelo sistema pede antes uma palavra-passe só para o ficheiro", async () => {
    proteccao = "os"
    passo()
    const campo = (await screen.findByLabelText(strings.ficheiroDaConta.fraseLabel)) as HTMLInputElement
    expect(descarregar().disabled).toBe(true)
    fireEvent.change(campo, { target: { value: "curta" } })
    expect(descarregar().disabled).toBe(true)
    fireEvent.change(campo, { target: { value: "frase-do-ficheiro" } })
    fireEvent.click(descarregar())
    await waitFor(() => expect(descargas).toHaveLength(1))
    expect(exportar).toHaveBeenCalledWith("frase-do-ficheiro")
  })

  it("onde o browser partilha ficheiros (iPhone), Partilhar abre a folha e também conta", async () => {
    const partilha = vi.fn(async (_dados: ShareData) => {})
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true })
    Object.defineProperty(navigator, "share", { configurable: true, value: partilha })
    passo()
    const botao = await screen.findByRole("button", { name: strings.ficheiroDaConta.partilhar })
    fireEvent.click(botao)
    await waitFor(() => expect(partilha).toHaveBeenCalledTimes(1))
    const ficheiro = (partilha.mock.calls[0]![0].files ?? [])[0]!
    expect(ficheiro.name).toBe(strings.ficheiroDaConta.nomeDoFicheiro)
    fireEvent.click(screen.getByRole("checkbox", { name: strings.ficheiroDaConta.guardei }))
    await waitFor(() => expect(continuar().disabled).toBe(false))
  })

  it("fechar a folha de partilha não conta como guardado", async () => {
    const fechada = Object.assign(new Error("closed"), { name: "AbortError" })
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true })
    Object.defineProperty(navigator, "share", { configurable: true, value: vi.fn(async () => Promise.reject(fechada)) })
    passo()
    fireEvent.click(await screen.findByRole("button", { name: strings.ficheiroDaConta.partilhar }))
    fireEvent.click(screen.getByRole("checkbox", { name: strings.ficheiroDaConta.guardei }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(continuar().disabled).toBe(true)
  })
})

describe("o aviso único nas contas que já existem", () => {
  it("tem o mesmo botão, fecha-se, e fechar conta como visto", async () => {
    expect(await ficheiroPorTratar(ENDERECO)).toBe(true)
    const onFechar = vi.fn()
    render(
      <ToastProvider>
        <BridgeContext.Provider value={ponte()}>
          <AvisoDoFicheiroDaConta address={ENDERECO} onFechar={onFechar} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )
    expect(screen.getByRole("heading", { name: strings.ficheiroDaConta.aviso })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.ficheiroDaConta.descarregar })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: strings.ficheiroDaConta.fechar }))
    expect(onFechar).toHaveBeenCalled()
    await waitFor(async () => expect(await ficheiroPorTratar(ENDERECO)).toBe(false))
    expect(localStorage.getItem(FICHEIRO_DA_CONTA_KEY)).not.toContain("ana")
  })
})
