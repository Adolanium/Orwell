import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ContaNaLista } from "@enclave/client-core"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { pagina } from "./MudarDeConta.js"
import { rememberAccountName } from "../../lib/accountNames.js"
import { CHAVE_DA_INTENCAO } from "./outraEntrada.js"
import { AparelhoRemovido, MANTER_SESSAO_POR_OMISSAO, Unlock } from "./Unlock.js"

/**
 * Back to this device (21/11/2026, mock-up `Voltar`): "Olá", the password,
 * "Manter sessão iniciada" off, "Entrar". "Esqueci-me da palavra-passe" and
 * "Usar outra conta" never delete the account: they add an empty one next to it.
 */
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

interface Opcoes {
  unlock?: (secret: string | null) => Promise<{ ok: boolean }>
  connect?: () => Promise<{ ok: boolean }>
  contas?: ContaNaLista[] | null
  memoria?: boolean
}

function ponte(opcoes: Opcoes = {}): EnclaveBridge & { destroy: ReturnType<typeof vi.fn>; acrescentar: ReturnType<typeof vi.fn>; memorizar: ReturnType<typeof vi.fn> } {
  const destroy = vi.fn(async () => ({ ok: true }))
  const acrescentar = vi.fn(async () => ({ ok: true }))
  const memorizar = vi.fn(async () => ({ ok: true }))
  const bridge = {
    vault: {
      status: async () => ({ exists: true, supportsOsProtection: false, protection: "passphrase", memoriaDisponivel: opcoes.memoria ?? false }),
      unlock: opcoes.unlock ?? (async (secret: string | null) => (secret === null ? Promise.reject(new Error("this vault needs a passphrase")) : { ok: true })),
      destroy,
      memorizar,
      import: vi.fn(),
    },
    identity: { load: async () => ({ address: "@abc:orwell.pt", accountId: "abc" }) },
    session: { connect: opcoes.connect ?? (async () => ({ ok: true })) },
    ...(opcoes.contas === null
      ? {}
      : {
          contas: {
            listar: async () => ({ contas: opcoes.contas ?? [{ id: "principal", nome: "", activa: true, temCofre: true, memorizada: false }] }),
            mudar: async () => ({ ok: true }),
            acrescentar,
          },
        }),
  } as unknown as EnclaveBridge
  return Object.assign(bridge, { destroy, acrescentar, memorizar })
}

function montar(bridge: EnclaveBridge, onDone = vi.fn(), onLigacaoFalhou = vi.fn()): void {
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <Unlock onDone={onDone} onLigacaoFalhou={onLigacaoFalhou} />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
}

describe("Voltar a este aparelho", () => {
  it("com sessão lembrada entra sozinho, e mesmo com o servidor em baixo", async () => {
    const onDone = vi.fn()
    const onLigacaoFalhou = vi.fn()
    montar(ponte({ unlock: async () => ({ ok: true }), connect: async () => Promise.reject(new Error("could not reach the homeserver")) }), onDone, onLigacaoFalhou)
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("@abc:orwell.pt"))
    await waitFor(() => expect(onLigacaoFalhou).toHaveBeenCalledWith(expect.any(Error)))
  })

  it('"Olá" com o nome quando o aparelho o sabe, a palavra-passe, e "Manter sessão iniciada" desligada', async () => {
    montar(ponte({ memoria: true, contas: [{ id: "a", nome: "Duarte", activa: true, temCofre: true, memorizada: false }] }))
    expect(await screen.findByRole("heading", { name: strings.entrada.ola("Duarte") })).toBeTruthy()
    expect(screen.getByLabelText(strings.entrada.palavraPasse)).toBeTruthy()
    const caixa = screen.getByRole("checkbox", { name: strings.entrada.manterSessao }) as HTMLInputElement
    expect(MANTER_SESSAO_POR_OMISSAO).toBe(false)
    expect(caixa.checked).toBe(false)
    expect(screen.getByRole("button", { name: strings.entrada.esqueci })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.entrada.outraConta })).toBeTruthy()
  })

  it('"Hello, <name>" from the name kept outside the vault, even with one account', async () => {
    rememberAccountName("principal", "Duarte")
    montar(ponte())
    expect(await screen.findByRole("heading", { name: strings.entrada.ola("Duarte") })).toBeTruthy()
  })

  it('sem nome no aparelho diz só "Olá"', async () => {
    montar(ponte())
    expect(await screen.findByRole("heading", { name: strings.entrada.olaSemNome })).toBeTruthy()
  })

  it("palavra-passe errada: Erro 104 junto ao campo, e a pessoa fica", async () => {
    const onDone = vi.fn()
    montar(
      ponte({ unlock: async (secret) => Promise.reject(new Error(secret === null ? "this vault needs a passphrase" : "wrong passphrase, or the vault is damaged")) }),
      onDone,
    )
    fireEvent.change(await screen.findByLabelText(strings.entrada.palavraPasse), { target: { value: "errada-123" } })
    fireEvent.click(screen.getByRole("button", { name: strings.entrada.entrar }))
    const erro = await screen.findByRole("alert")
    expect(erro.textContent).toContain("104")
    expect(erro.textContent).toContain(strings.entrada.palavraPasse.slice(0, 5))
    expect(onDone).not.toHaveBeenCalled()
  })

  it('a palavra-passe certa entra; com "Manter sessão iniciada" marcada, lembra a sessão', async () => {
    const onDone = vi.fn()
    const bridge = ponte({ memoria: true })
    montar(bridge, onDone)
    fireEvent.change(await screen.findByLabelText(strings.entrada.palavraPasse), { target: { value: "certa-123" } })
    fireEvent.click(screen.getByRole("checkbox", { name: strings.entrada.manterSessao }))
    fireEvent.click(screen.getByRole("button", { name: strings.entrada.entrar }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("@abc:orwell.pt"))
    expect(bridge.memorizar).toHaveBeenCalledWith(true)
  })

  it('enquanto abre, o botão diz "A abrir…" com o anel', async () => {
    montar(ponte({ unlock: (secret) => (secret === null ? Promise.reject(new Error("this vault needs a passphrase")) : new Promise(() => {})) }))
    fireEvent.change(await screen.findByLabelText(strings.entrada.palavraPasse), { target: { value: "segredo" } })
    fireEvent.click(screen.getByRole("button", { name: strings.entrada.entrar }))
    const botao = await screen.findByRole("button", { name: strings.entrada.aAbrir })
    expect((botao as HTMLButtonElement).disabled).toBe(true)
    expect(botao.querySelector(".anel-ocupado")).toBeTruthy()
  })
})

describe("Esqueci-me da palavra-passe: dois caminhos que guardam a conta", () => {
  it("abre a escolha, e nenhum dos caminhos apaga o cofre: acrescenta uma conta vazia e recarrega", async () => {
    const user = userEvent.setup()
    const recarregar = vi.spyOn(pagina, "recarregar").mockImplementation(() => {})
    const bridge = ponte()
    montar(bridge)
    await user.click(await screen.findByRole("button", { name: strings.entrada.esqueci }))
    expect(screen.getByRole("heading", { name: strings.entrada.esquecesteTitulo })).toBeTruthy()
    expect(screen.getByText(strings.entrada.esquecesteTexto)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.entrada.comFicheiro }))
    await waitFor(() => expect(recarregar).toHaveBeenCalledOnce())
    expect(bridge.acrescentar).toHaveBeenCalledOnce()
    expect(bridge.destroy).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(CHAVE_DA_INTENCAO)).toBe("ficheiro")
  })

  it('"Entrar com outro aparelho" guarda a mesma conta e vai para o emparelhamento', async () => {
    const user = userEvent.setup()
    vi.spyOn(pagina, "recarregar").mockImplementation(() => {})
    const bridge = ponte()
    montar(bridge)
    await user.click(await screen.findByRole("button", { name: strings.entrada.esqueci }))
    await user.click(screen.getByRole("button", { name: strings.entrada.comOutroAparelho }))
    await waitFor(() => expect(bridge.acrescentar).toHaveBeenCalledOnce())
    expect(sessionStorage.getItem(CHAVE_DA_INTENCAO)).toBe("outro-aparelho")
    expect(bridge.destroy).not.toHaveBeenCalled()
  })

  it('"Voltar" regressa ao "Olá"', async () => {
    const user = userEvent.setup()
    montar(ponte())
    await user.click(await screen.findByRole("button", { name: strings.entrada.esqueci }))
    await user.click(screen.getByRole("button", { name: new RegExp(strings.entrada.voltar) }))
    expect(await screen.findByRole("heading", { name: strings.entrada.olaSemNome })).toBeTruthy()
  })
})

describe("Usar outra conta", () => {
  it("acrescenta uma conta vazia e recarrega para a entrada; esta fica no aparelho", async () => {
    const user = userEvent.setup()
    const recarregar = vi.spyOn(pagina, "recarregar").mockImplementation(() => {})
    const bridge = ponte()
    montar(bridge)
    await user.click(await screen.findByRole("button", { name: strings.entrada.outraConta }))
    await waitFor(() => expect(recarregar).toHaveBeenCalledOnce())
    expect(bridge.acrescentar).toHaveBeenCalledOnce()
    expect(bridge.destroy).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(CHAVE_DA_INTENCAO)).toBe("inicio")
  })

  it("sem contas na ponte, o link não aparece (nunca apaga para fazer espaço)", async () => {
    montar(ponte({ contas: null }))
    await screen.findByRole("heading", { name: strings.entrada.olaSemNome })
    expect(screen.queryByRole("button", { name: strings.entrada.outraConta })).toBeNull()
  })
})

describe("Este aparelho saiu da conta", () => {
  it("diz o que aconteceu e dá os dois caminhos de volta", async () => {
    const user = userEvent.setup()
    const onFicheiro = vi.fn()
    const onOutroAparelho = vi.fn()
    render(
      <BridgeContext.Provider value={ponte()}>
        <AparelhoRemovido onFicheiro={onFicheiro} onOutroAparelho={onOutroAparelho} />
      </BridgeContext.Provider>,
    )
    expect(screen.getByRole("heading", { name: strings.entrada.removido })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.entrada.comFicheiro }))
    await user.click(screen.getByRole("button", { name: strings.entrada.comOutroAparelho }))
    expect(onFicheiro).toHaveBeenCalledOnce()
    expect(onOutroAparelho).toHaveBeenCalledOnce()
  })
})
