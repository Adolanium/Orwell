import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { codigoDoErro } from "../../lib/codigosDeErro.js"
import { definirLingua, strings } from "../../strings.js"
import { abrirCriarConta, adiarOFicheiro, enviarCriarConta, FRASE_DE_TESTE, preencherCriarConta } from "../../testes/portao.js"
import { CHAVE_DA_INTENCAO } from "./outraEntrada.js"
import { Setup } from "./Setup.js"

/**
 * The gate of a device with no vault (21/11/2026, mock-ups `Main` and `Desktop`):
 * "Bem-vindo ao Orwell" and three ways in; "Criar conta" in one form; the
 * server asked before the vault exists; "Guarda o ficheiro da conta", which can
 * wait.
 */

type Modo = "aberto" | "convite" | "fechado" | "versao-antiga" | null

interface Registo {
  ordem: string[]
  criados: (string | null)[]
  perfis: unknown[]
  destruidos: number
}

let registo: Registo
const ENDERECO_INICIAL = window.location.href

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  definirLingua("pt")
  registo = { ordem: [], criados: [], perfis: [], destruidos: 0 }
})
afterEach(() => {
  cleanup()
  window.history.replaceState(null, "", ENDERECO_INICIAL)
  definirLingua("pt")
})

function ponte({
  modo = "aberto",
  connect,
  preparar,
  existe = false,
}: {
  modo?: Modo | "sem-sonda"
  connect?: () => Promise<{ ok: boolean }>
  preparar?: ((aoProgresso: (fraccao: number) => void) => Promise<boolean>) | null
  existe?: boolean
} = {}): EnclaveBridge {
  let cofre = existe
  return {
    vault: {
      status: async () => ({ exists: cofre, supportsOsProtection: false }),
      create: async (frase: string | null) => {
        registo.criados.push(frase)
        registo.ordem.push("cofre")
        cofre = true
        return { ok: true }
      },
      destroy: async () => {
        registo.destruidos++
        cofre = false
        return { ok: true }
      },
      export: async () => ({ data: "ficheiro" }),
      import: vi.fn(),
    },
    identity: { create: async () => ({ address: "@abc:localhost:8448", accountId: "abc" }) },
    session: {
      connect:
        connect ??
        (async () => {
          registo.ordem.push("connect")
          return { ok: true }
        }),
      ...(modo === "sem-sonda" ? {} : { sondarRegisto: async () => modo }),
      escolherSalaComum: async (entrar: boolean) => {
        registo.ordem.push(`sala:${entrar}`)
        return { ok: true }
      },
      definirConviteDeRegisto: async (codigo: string | null) => {
        registo.ordem.push(`convite:${codigo}`)
        return { ok: true }
      },
      definirConviteDeComunidade: async (link: string | null) => {
        registo.ordem.push(`comunidade:${link}`)
        return { ok: true }
      },
      ...(preparar === null ? {} : { prepararContaNova: preparar ?? (async () => true) }),
    },
    profile: {
      set: async (perfil: unknown) => {
        registo.perfis.push(perfil)
        return { ok: true }
      },
    },
  } as unknown as EnclaveBridge
}

function montar(
  bridge: EnclaveBridge,
  props: Partial<React.ComponentProps<typeof Setup>> = {},
): { onDone: ReturnType<typeof vi.fn>; onJoinInstead: ReturnType<typeof vi.fn> } {
  const onDone = vi.fn()
  const onJoinInstead = vi.fn()
  render(
    <ToastProvider>
      <BridgeContext.Provider value={bridge}>
        <Setup onDone={onDone} onUnlockInstead={vi.fn()} onJoinInstead={onJoinInstead} {...props} />
      </BridgeContext.Provider>
    </ToastProvider>,
  )
  return { onDone, onJoinInstead }
}

describe("Entrada: um ecrã, três caminhos", () => {
  it('"Bem-vindo ao Orwell" e os três botões, sem nenhum campo', async () => {
    montar(ponte())
    expect(await screen.findByRole("heading", { name: strings.entrada.bemVindo })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.entrada.criarConta })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.entrada.comFicheiro })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.entrada.comOutroAparelho })).toBeTruthy()
    expect(document.querySelector("input")).toBeNull()
  })

  it('"Entrar com outro aparelho" vai para o emparelhamento; sem ele, o botão não aparece', async () => {
    const user = userEvent.setup()
    const { onJoinInstead } = montar(ponte())
    await user.click(await screen.findByRole("button", { name: strings.entrada.comOutroAparelho }))
    expect(onJoinInstead).toHaveBeenCalledOnce()
    cleanup()
    render(
      <ToastProvider>
        <BridgeContext.Provider value={ponte()}>
          <Setup onDone={vi.fn()} onUnlockInstead={vi.fn()} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )
    await screen.findByRole("heading", { name: strings.entrada.bemVindo })
    expect(screen.queryByRole("button", { name: strings.entrada.comOutroAparelho })).toBeNull()
  })

  it('"Entrar com o ficheiro da conta" abre o ecrã do ficheiro, e "Voltar" regressa', async () => {
    const user = userEvent.setup()
    montar(ponte())
    await user.click(await screen.findByRole("button", { name: strings.entrada.comFicheiro }))
    expect(await screen.findByRole("heading", { name: strings.entrada.comFicheiro })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: new RegExp(strings.entrada.voltar) }))
    expect(await screen.findByRole("heading", { name: strings.entrada.bemVindo })).toBeTruthy()
  })

  it("a escolha feita antes de recarregar (Usar outra conta, Esqueci-me) abre o ecrã certo, uma vez", async () => {
    sessionStorage.setItem(CHAVE_DA_INTENCAO, "ficheiro")
    montar(ponte())
    expect(await screen.findByRole("heading", { name: strings.entrada.comFicheiro })).toBeTruthy()
    expect(sessionStorage.getItem(CHAVE_DA_INTENCAO)).toBeNull()
    cleanup()
    sessionStorage.setItem(CHAVE_DA_INTENCAO, "outro-aparelho")
    const { onJoinInstead } = montar(ponte())
    await waitFor(() => expect(onJoinInstead).toHaveBeenCalledOnce())
  })

  it("um cofre que já existe nunca leva outro por cima: só entrar na conta deste aparelho", async () => {
    montar(ponte({ existe: true }))
    expect(await screen.findByText(strings.gate.vaultExists)).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.gate.goToUnlock })).toBeTruthy()
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })
})

describe("Criar conta: nome e palavra-passe num ecrã", () => {
  it("os campos das maquetes, o mínimo por baixo, e o convite escondido atrás do link", async () => {
    const user = userEvent.setup()
    montar(ponte())
    await abrirCriarConta(user)
    expect(screen.getByLabelText(strings.entrada.nome)).toBeTruthy()
    expect(screen.getByLabelText(strings.entrada.palavraPasse)).toBeTruthy()
    expect(screen.getByLabelText(strings.entrada.palavraPasseOutraVez)).toBeTruthy()
    expect(screen.getByText(strings.entrada.minimo)).toBeTruthy()
    expect(screen.queryByLabelText(strings.entrada.codigoDeConvite)).toBeNull()
    await user.click(screen.getByRole("button", { name: strings.entrada.tenhoConvite }))
    expect(screen.getByLabelText(strings.entrada.codigoDeConvite)).toBeTruthy()
    // The picture is in the profile now, not in sign-up.
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it("cria a conta com a palavra-passe do campo, o nome no perfil e sem imagem, e mostra o passo do ficheiro", async () => {
    const user = userEvent.setup()
    const { onDone } = montar(ponte())
    await abrirCriarConta(user)
    await preencherCriarConta(user, { nome: "Vera" })
    enviarCriarConta()
    expect(await screen.findByRole("heading", { name: strings.entrada.guardarTitulo })).toBeTruthy()
    expect(registo.criados).toEqual([FRASE_DE_TESTE])
    expect(registo.perfis).toEqual([{ displayName: "Vera", donations: [] }])
    await adiarOFicheiro(user)
    expect(onDone).toHaveBeenCalledWith("@abc:localhost:8448")
  })

  it("uma palavra-passe curta não cria nada, e diz porquê junto aos campos", async () => {
    const user = userEvent.setup()
    montar(ponte())
    await abrirCriarConta(user)
    await preencherCriarConta(user, { frase: "curta" })
    enviarCriarConta()
    expect((await screen.findByRole("alert")).textContent).toBe(strings.entrada.curta)
    expect(registo.criados).toEqual([])
  })

  it("duas palavras-passe diferentes não criam nada", async () => {
    const user = userEvent.setup()
    montar(ponte())
    await abrirCriarConta(user)
    await preencherCriarConta(user, { frase: "uma frase comprida", outraVez: "outra frase comprida" })
    enviarCriarConta()
    expect((await screen.findByRole("alert")).textContent).toBe(strings.entrada.diferentes)
    expect(registo.criados).toEqual([])
  })

  it("o canal oficial vem desmarcado, e a escolha vai ao núcleo antes da ligação", async () => {
    const user = userEvent.setup()
    montar(ponte())
    await abrirCriarConta(user)
    const caixa = screen.getByRole("checkbox", { name: strings.gate.canalOficial }) as HTMLInputElement
    expect(caixa.checked).toBe(false)
    await user.click(caixa)
    await preencherCriarConta(user)
    enviarCriarConta()
    await screen.findByRole("heading", { name: strings.entrada.guardarTitulo })
    expect(registo.ordem.indexOf("sala:true")).toBeLessThan(registo.ordem.indexOf("connect"))
  })

  it("o servidor continua nas opções avançadas", async () => {
    const user = userEvent.setup()
    montar(ponte())
    await abrirCriarConta(user)
    await user.click(screen.getByRole("button", { name: strings.gate.advanced }))
    expect(screen.getByLabelText(strings.gate.server)).toBeTruthy()
  })

  it('"Voltar" depois de uma conta a meio (antes do servidor a ver) apaga esse cofre vazio; depois de ligada, não', async () => {
    const user = userEvent.setup()
    montar(ponte({ connect: async () => Promise.reject(new Error("could not reach the homeserver")) }))
    await abrirCriarConta(user)
    await preencherCriarConta(user)
    enviarCriarConta()
    expect((await screen.findByRole("alert")).textContent).toContain(String(codigoDoErro("could not reach the homeserver")))
    await user.click(screen.getByRole("button", { name: new RegExp(strings.entrada.voltar) }))
    await screen.findByRole("heading", { name: strings.entrada.bemVindo })
    expect(registo.destruidos).toBe(1)
  })
})

describe("Criar conta: o que o servidor diz, antes do cofre", () => {
  it("convite: o campo do código aparece sozinho, e o código vai à sessão antes de ligar", async () => {
    const user = userEvent.setup()
    montar(ponte({ modo: "convite" }))
    await abrirCriarConta(user)
    const campo = await screen.findByLabelText(strings.entrada.codigoDeConvite)
    expect(screen.queryByRole("button", { name: strings.entrada.tenhoConvite })).toBeNull()
    await preencherCriarConta(user)
    await user.type(campo, "ABCD-EFGH-IJKL-MNOP")
    enviarCriarConta()
    await screen.findByRole("heading", { name: strings.entrada.guardarTitulo })
    expect(registo.ordem.indexOf("convite:ABCD-EFGH-IJKL-MNOP")).toBeLessThan(registo.ordem.indexOf("connect"))
  })

  it("fechado: Erro 230 no ecrã, o botão parado, e nenhum cofre", async () => {
    const user = userEvent.setup()
    montar(ponte({ modo: "fechado" }))
    await abrirCriarConta(user)
    expect((await screen.findByRole("alert")).textContent).toContain("230")
    await preencherCriarConta(user)
    expect((screen.getByRole("button", { name: strings.entrada.criarConta }) as HTMLButtonElement).disabled).toBe(true)
    enviarCriarConta()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(registo.criados).toEqual([])
  })

  it("versão antiga: diz para actualizar, com o botão, e não cria o cofre", async () => {
    const user = userEvent.setup()
    montar(ponte({ modo: "versao-antiga" }))
    await user.click(await screen.findByRole("button", { name: strings.entrada.criarConta }))
    expect(await screen.findByText(strings.entrada.versaoAntiga)).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.entrada.actualizar })).toBeTruthy()
    expect(registo.criados).toEqual([])
  })

  it("um servidor sem sonda que recusa sem código: o campo abre com o erro, e repetir retoma na ligação", async () => {
    const user = userEvent.setup()
    let tentativa = 0
    montar(
      ponte({
        modo: "sem-sonda",
        connect: async () => {
          tentativa++
          registo.ordem.push(`connect:${tentativa}`)
          if (tentativa === 1) throw new Error("this server needs a registration invite")
          return { ok: true }
        },
      }),
    )
    await abrirCriarConta(user)
    await preencherCriarConta(user)
    enviarCriarConta()
    const erro = await screen.findByRole("alert")
    expect(erro.textContent).toContain("231")
    const campo = screen.getByLabelText(strings.entrada.codigoDeConvite)
    await user.type(campo, "CODIGO-BOM")
    enviarCriarConta()
    await screen.findByRole("heading", { name: strings.entrada.guardarTitulo })
    // The vault was made once: the retry resumed at the connection.
    expect(registo.criados).toHaveLength(1)
    expect(registo.ordem).toContain("convite:CODIGO-BOM")
  })

  it("na nova tentativa, a sala comum que ainda não pode entrar (202) não pára a conta: o fim do aperto de mão entra", async () => {
    const user = userEvent.setup()
    const bridge = ponte()
    let vez = 0
    bridge.session.escolherSalaComum = async (entrar: boolean) => {
      vez++
      registo.ordem.push(`sala:${entrar}`)
      if (vez > 1) throw new Error("no connection to the server")
      return { ok: true }
    }
    let tentativa = 0
    bridge.session.connect = async () => {
      tentativa++
      if (tentativa === 1) throw new Error("the registration invite is not valid")
      registo.ordem.push("connect")
      return { ok: true }
    }
    montar(bridge)
    await abrirCriarConta(user)
    await user.click(screen.getByRole("checkbox", { name: strings.gate.canalOficial }))
    await preencherCriarConta(user)
    enviarCriarConta()
    expect((await screen.findByRole("alert")).textContent).toContain("232")
    await user.type(screen.getByLabelText(strings.entrada.codigoDeConvite), "CODIGO-BOM")
    enviarCriarConta()
    await screen.findByRole("heading", { name: strings.entrada.guardarTitulo })
    expect(registo.ordem).toContain("connect")
  })

  it("Erro 234 (a rede no limite): uma ligação de convite colada vai como convite de comunidade", async () => {
    const user = userEvent.setup()
    let tentativa = 0
    montar(
      ponte({
        connect: async () => {
          tentativa++
          if (tentativa === 1) throw new Error("this network created many accounts today")
          registo.ordem.push("connect")
          return { ok: true }
        },
      }),
    )
    await abrirCriarConta(user)
    await preencherCriarConta(user)
    enviarCriarConta()
    expect((await screen.findByRole("alert")).textContent).toContain("234")
    const ligacao = "https://orwell.example/app/c#ab2cd3ef.0123456789abcdef"
    fireEvent.change(screen.getByLabelText(strings.entrada.codigoDeConvite), { target: { value: ligacao } })
    enviarCriarConta()
    await screen.findByRole("heading", { name: strings.entrada.guardarTitulo })
    expect(registo.ordem).toContain(`comunidade:${ligacao}`)
  })

  it("a página aberta por uma ligação de convite traz o campo aberto e preenchido", async () => {
    const user = userEvent.setup()
    montar(ponte(), { conviteInicial: "https://casa.pt/convite#canal/CODIGO" })
    await abrirCriarConta(user)
    expect((screen.getByLabelText(strings.entrada.codigoDeConvite) as HTMLInputElement).value).toBe("https://casa.pt/convite#canal/CODIGO")
  })

  it("a prova de trabalho mostra o progresso no botão, e só depois liga", async () => {
    const user = userEvent.setup()
    let soltar: () => void = () => {}
    montar(
      ponte({
        preparar: (aoProgresso) =>
          new Promise<boolean>((resolve) => {
            aoProgresso(0.42)
            soltar = () => resolve(true)
          }),
      }),
    )
    await abrirCriarConta(user)
    await preencherCriarConta(user)
    enviarCriarConta()
    expect(await screen.findByRole("button", { name: strings.gate.aPrepararConta(42) })).toBeTruthy()
    expect(registo.ordem).not.toContain("connect")
    soltar()
    await screen.findByRole("heading", { name: strings.entrada.guardarTitulo })
    expect(registo.ordem).toContain("connect")
  })
})

describe("a Privacidade, os Termos e a idade só no orwell.pt", () => {
  it("no orwell.pt aparecem na entrada e no Criar conta, com a idade antes do botão", async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, "", "/?servidor=orwell.pt")
    montar(ponte())
    await screen.findByRole("heading", { name: strings.entrada.bemVindo })
    expect(screen.getByRole("link", { name: strings.legal.privacidade }).getAttribute("href")).toBe(strings.legal.privacidadeUrl)
    await abrirCriarConta(user)
    expect(screen.getByText(strings.legal.idadeEAceitacao)).toBeTruthy()
    expect(screen.getByRole("link", { name: strings.legal.termos })).toBeTruthy()
  })

  it('a entrada já não tem o "Como funciona" por baixo do cartão; a Privacidade e os Termos ficam', async () => {
    window.history.replaceState(null, "", "/?servidor=orwell.pt")
    montar(ponte())
    await screen.findByRole("heading", { name: strings.entrada.bemVindo })
    const rodape = document.querySelector(".gate-rodape") as HTMLElement
    expect(within(rodape).queryByRole("button", { name: "Como funciona" })).toBeNull()
    expect(rodape.textContent).not.toContain("Como funciona")
    expect(within(rodape).getByRole("link", { name: strings.legal.privacidade })).toBeTruthy()
    expect(within(rodape).getByRole("link", { name: strings.legal.termos })).toBeTruthy()
  })

  it("noutro servidor não aparecem", async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, "", "/?servidor=casa.pt")
    montar(ponte())
    await screen.findByRole("heading", { name: strings.entrada.bemVindo })
    expect(screen.queryByRole("link", { name: strings.legal.privacidade })).toBeNull()
    await abrirCriarConta(user)
    expect(screen.queryByText(strings.legal.idadeEAceitacao)).toBeNull()
  })

  it("em inglês, a entrada é a das maquetes em inglês", async () => {
    definirLingua("en")
    montar(ponte())
    const cartao = (await screen.findByRole("heading", { name: "Welcome to Orwell" })).closest(".gate-card") as HTMLElement
    expect(within(cartao).getByRole("button", { name: "Create account" })).toBeTruthy()
    expect(within(cartao).getByRole("button", { name: "Sign in with the account file" })).toBeTruthy()
    expect(within(cartao).getByRole("button", { name: "Sign in with another device" })).toBeTruthy()
  })
})

describe("Guarda o ficheiro da conta", () => {
  it('"Guardar o ficheiro" descarrega e entra; "Fazer mais tarde" entra sem marcar', async () => {
    const user = userEvent.setup()
    URL.createObjectURL = vi.fn(() => "blob:conta")
    URL.revokeObjectURL = vi.fn()
    const clicar = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    const { onDone } = montar(ponte())
    await abrirCriarConta(user)
    await preencherCriarConta(user)
    enviarCriarConta()
    await screen.findByText(strings.entrada.guardarTexto)
    const guardar = screen.getByRole("button", { name: strings.entrada.guardarFicheiro })
    await waitFor(() => expect((guardar as HTMLButtonElement).disabled).toBe(false))
    await user.click(guardar)
    expect(clicar).toHaveBeenCalled()
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(localStorage.getItem("enclave.ficheiroGuardado")).not.toBeNull()
  })
})
