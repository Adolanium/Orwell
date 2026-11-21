import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CABECALHO_DO_COFRE } from "@enclave/client-core"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { EntrarComFicheiro } from "./EntrarComFicheiro.js"
import "../../testes/blobDoJsdom.js"

/**
 * "Entrar com o ficheiro da conta" (21/11/2026, mock-ups `Ficheiro` and `Desktop`):
 * choose (or drag) the file, the password, "Entrar". The button lights only with
 * both. Since 1.3.26 the core makes this device a new device of the account, so
 * no warning and no "apagar": nothing leaves.
 */
const FICHEIRO = CABECALHO_DO_COFRE + JSON.stringify({
  format: "enclave-vault",
  formatVersion: 1,
  exportedAt: 0,
  vault: { version: 1, protection: "passphrase", salt: "c2Fs", nonce: "bm9uY2U=", ciphertext: "Y2lmcmFkbw==" },
})

beforeEach(() => localStorage.clear())
afterEach(cleanup)

function ponte(importar: (dados: unknown, frase: string) => Promise<{ ok: boolean }> = async () => ({ ok: true })): EnclaveBridge & { chamadas: string[] } {
  const chamadas: string[] = []
  const bridge = {
    vault: {
      import: vi.fn(async (dados: unknown, frase: string) => {
        chamadas.push(`import:${frase}`)
        return importar(dados, frase)
      }),
      unlock: vi.fn(async (frase: string) => {
        chamadas.push(`unlock:${frase}`)
        return { ok: true }
      }),
      destroy: vi.fn(async () => {
        chamadas.push("destroy")
        return { ok: true }
      }),
    },
    identity: { load: async () => ({ address: "@abc:orwell.pt", accountId: "abc" }) },
    session: {
      connect: async () => {
        chamadas.push("connect")
        return { ok: true }
      },
    },
  } as unknown as EnclaveBridge
  return Object.assign(bridge, { chamadas })
}

function montar(bridge: EnclaveBridge): ReturnType<typeof vi.fn> {
  const onDone = vi.fn()
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <EntrarComFicheiro onDone={onDone} onVoltar={vi.fn()} />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
  return onDone
}

async function escolher(conteudo = FICHEIRO, nome = "conta.enclave"): Promise<void> {
  const entrada = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(entrada, { target: { files: [new File([conteudo], nome, { type: "application/json" })] } })
}

const botaoEntrar = (): HTMLButtonElement => screen.getByRole("button", { name: strings.entrada.entrar }) as HTMLButtonElement

describe("Entrar com o ficheiro da conta", () => {
  it('o título e "Escolher ficheiro"; "Entrar" apagado até haver ficheiro E palavra-passe', async () => {
    montar(ponte())
    expect(screen.getByRole("heading", { name: strings.entrada.comFicheiro })).toBeTruthy()
    expect(screen.getByRole("button", { name: new RegExp(strings.entrada.escolherFicheiro) })).toBeTruthy()
    expect(botaoEntrar().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(strings.entrada.palavraPasse), { target: { value: "frase-da-conta" } })
    expect(botaoEntrar().disabled).toBe(true)
    await escolher()
    expect(await screen.findByText("conta.enclave")).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.entrada.trocar })).toBeTruthy()
    expect(botaoEntrar().disabled).toBe(false)
  })

  it("um ficheiro que não é uma conta diz-se com o código, debaixo da caixa", async () => {
    montar(ponte())
    await escolher("isto não é uma conta", "foto.jpg")
    expect((await screen.findByRole("alert")).textContent).toContain("107")
    expect(botaoEntrar().disabled).toBe(true)
  })

  it("entra: importa (aparelho novo), abre, liga, e marca o ficheiro como guardado; nada é apagado", async () => {
    const bridge = ponte()
    const onDone = montar(bridge)
    await escolher()
    await screen.findByText("conta.enclave")
    fireEvent.change(screen.getByLabelText(strings.entrada.palavraPasse), { target: { value: "frase-da-conta" } })
    fireEvent.click(botaoEntrar())
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("@abc:orwell.pt"))
    expect(bridge.chamadas).toEqual(["import:frase-da-conta", "unlock:frase-da-conta", "connect"])
    await waitFor(() => expect(localStorage.getItem("enclave.ficheiroGuardado")).not.toBeNull())
  })

  it("palavra-passe errada: Erro 104 junto ao campo, e o ficheiro fica escolhido", async () => {
    montar(ponte(async () => Promise.reject(new Error("wrong passphrase, or the vault is damaged"))))
    await escolher()
    await screen.findByText("conta.enclave")
    fireEvent.change(screen.getByLabelText(strings.entrada.palavraPasse), { target: { value: "errada" } })
    fireEvent.click(botaoEntrar())
    const erro = await screen.findByRole("alert")
    expect(erro.textContent).toContain("104")
    expect(erro.textContent).toContain("Palavra-passe errada.")
    expect(screen.getByText("conta.enclave")).toBeTruthy()
  })

  it("o ficheiro de um aparelho que saiu: Erro 763, a frase das maquetes", async () => {
    montar(ponte(async () => Promise.reject(new Error("this account file is from a device that left the account"))))
    await escolher()
    await screen.findByText("conta.enclave")
    fireEvent.change(screen.getByLabelText(strings.entrada.palavraPasse), { target: { value: "frase" } })
    fireEvent.click(botaoEntrar())
    const erro = await screen.findByRole("alert")
    expect(erro.textContent).toContain("763")
    expect(erro.textContent).toContain("Este ficheiro já não abre a conta. Usa um mais recente.")
  })

  it("no computador, o ficheiro também entra arrastado para a caixa", async () => {
    montar(ponte())
    const caixa = document.querySelector(".entrada-largar") as HTMLElement
    fireEvent.dragOver(caixa)
    expect(caixa.classList.contains("por-cima")).toBe(true)
    fireEvent.drop(caixa, { dataTransfer: { files: [new File([FICHEIRO], "arrastado.enclave")] } })
    expect(await screen.findByText("arrastado.enclave")).toBeTruthy()
  })
})
