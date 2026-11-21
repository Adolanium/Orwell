import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../App.js"
import type { EnclaveBridge } from "../bridge.js"
import { FICHEIRO_DA_CONTA_KEY, ficheiroPorTratar } from "../lib/ficheiroDaConta.js"
import { strings } from "../strings.js"
import { ToastProvider } from "./Toast.js"
import { FolhaDoFicheiroDaConta, GuardarFicheiroDaConta } from "./FicheiroDaConta.js"

/**
 * The account file right after the account is created, and the sheet the banner
 * inside the app opens (21/11/2026, mock-up `Main`). One button, "Guardar o
 * ficheiro", which shares where the browser shares files and downloads
 * elsewhere; "Fazer mais tarde" goes on without counting as saved; a keychain
 * vault asks a password for the file first.
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
        <GuardarFicheiroDaConta address={ENDERECO} onContinuar={onContinuar} />
      </BridgeContext.Provider>
    </ToastProvider>,
  )
  return onContinuar
}

const botao = (): HTMLButtonElement => screen.getByRole("button", { name: strings.entrada.guardarFicheiro }) as HTMLButtonElement

describe("Guarda o ficheiro da conta, logo depois de criar", () => {
  it("o título, uma frase, o botão e Fazer mais tarde", async () => {
    passo()
    expect(screen.getByRole("heading", { name: strings.entrada.guardarTitulo })).toBeTruthy()
    expect(screen.getByText(strings.entrada.guardarTexto)).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.entrada.maisTarde })).toBeTruthy()
    await waitFor(() => expect(botao().disabled).toBe(false))
  })

  it("Guardar descarrega o ficheiro, marca-o como guardado e segue", async () => {
    const onContinuar = passo()
    await waitFor(() => expect(botao().disabled).toBe(false))
    fireEvent.click(botao())
    await waitFor(() => expect(onContinuar).toHaveBeenCalledOnce())
    expect(descargas).toEqual([strings.ficheiroDaConta.nomeDoFicheiro])
    expect(await ficheiroPorTratar(ENDERECO)).toBe(false)
    expect(localStorage.getItem(FICHEIRO_DA_CONTA_KEY)).not.toContain("ana")
  })

  it("Fazer mais tarde segue sem marcar: a faixa dentro da app fica", async () => {
    const onContinuar = passo()
    fireEvent.click(screen.getByRole("button", { name: strings.entrada.maisTarde }))
    expect(onContinuar).toHaveBeenCalledOnce()
    expect(await ficheiroPorTratar(ENDERECO)).toBe(true)
  })

  it("um cofre guardado pelo sistema pede antes uma palavra-passe só para o ficheiro", async () => {
    proteccao = "os"
    const onContinuar = passo()
    const campo = await screen.findByLabelText(strings.entrada.palavraPasse)
    expect(botao().disabled).toBe(true)
    fireEvent.change(campo, { target: { value: "frase-do-ficheiro" } })
    fireEvent.click(botao())
    await waitFor(() => expect(onContinuar).toHaveBeenCalledOnce())
    expect(exportar).toHaveBeenCalledWith("frase-do-ficheiro")
  })

  it("onde o browser partilha ficheiros (iPhone), o mesmo botão abre a folha de partilha", async () => {
    const partilhar = vi.fn(async () => {})
    Object.assign(navigator, { share: partilhar, canShare: () => true })
    const onContinuar = passo()
    await waitFor(() => expect(exportar).toHaveBeenCalled())
    await waitFor(() => expect(botao().disabled).toBe(false))
    fireEvent.click(botao())
    await waitFor(() => expect(onContinuar).toHaveBeenCalledOnce())
    expect(partilhar).toHaveBeenCalledOnce()
    expect(descargas).toEqual([])
  })

  it("fechar a folha de partilha não conta como guardado", async () => {
    const erro = Object.assign(new Error("cancelado"), { name: "AbortError" })
    Object.assign(navigator, { share: vi.fn(async () => Promise.reject(erro)), canShare: () => true })
    const onContinuar = passo()
    await waitFor(() => expect(exportar).toHaveBeenCalled())
    await waitFor(() => expect(botao().disabled).toBe(false))
    fireEvent.click(botao())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onContinuar).not.toHaveBeenCalled()
    expect(await ficheiroPorTratar(ENDERECO)).toBe(true)
  })
})

describe("a folha da faixa", () => {
  it("fechar não conta como guardado; guardar conta", async () => {
    const onGuardado = vi.fn()
    const onFechar = vi.fn()
    render(
      <ToastProvider>
        <BridgeContext.Provider value={ponte()}>
          <FolhaDoFicheiroDaConta address={ENDERECO} onGuardado={onGuardado} onFechar={onFechar} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )
    expect(screen.getByRole("heading", { name: strings.entrada.guardarTitulo })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: strings.common.close }))
    expect(onFechar).toHaveBeenCalledOnce()
    expect(await ficheiroPorTratar(ENDERECO)).toBe(true)
    await waitFor(() => expect(botao().disabled).toBe(false))
    fireEvent.click(botao())
    await waitFor(() => expect(onGuardado).toHaveBeenCalledOnce())
    expect(await ficheiroPorTratar(ENDERECO)).toBe(false)
  })
})
