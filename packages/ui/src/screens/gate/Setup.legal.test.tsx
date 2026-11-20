import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { definirLingua, strings } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import { eOServidorDeOmissao, Setup } from "./Setup.js"

/**
 * The Privacy Policy and the Terms, from the screen that creates the account
 * (GDPR art. 13: the information is there when the data is asked for). The
 * links open outside the app: `target="_blank"`, which the desktop app sends
 * to the system browser (`links-externos.ts`). On the last step, before
 * "Create", one note says the minimum age of the Terms (16) and that creating
 * the account accepts the Terms.
 *
 * They are orwell.pt's pages, so they show only for an account on orwell.pt
 * (from 1.3.25). The page is opened as `?servidor=orwell.pt`, the
 * same server the packaged app and orwell.pt/app prefill.
 */
const ENDERECO_INICIAL = window.location.href
beforeEach(() => {
  window.history.replaceState(null, "", "/?servidor=orwell.pt")
})
afterEach(() => {
  cleanup()
  definirLingua("pt")
  window.history.replaceState(null, "", ENDERECO_INICIAL)
})

function montar(onJoinInstead?: () => void): void {
  render(
    <ToastProvider>
      <BridgeContext.Provider
        value={
          {
            vault: { status: async () => ({ exists: false, supportsOsProtection: false }) },
            // A host that does not ask who may register (1.3.25): the gate goes on as before.
            session: {},
          } as unknown as EnclaveBridge
        }
      >
        <Setup onDone={vi.fn()} onUnlockInstead={vi.fn()} {...(onJoinInstead ? { onJoinInstead } : {})} />
      </BridgeContext.Provider>
    </ToastProvider>,
  )
}

const ligacao = (nome: string): HTMLAnchorElement => screen.getByRole("link", { name: nome }) as HTMLAnchorElement

function abreFora(a: HTMLAnchorElement, href: string): void {
  expect(a.getAttribute("href")).toBe(href)
  expect(a.getAttribute("target")).toBe("_blank")
  expect(a.getAttribute("rel")).toContain("noopener")
}

describe("Setup: a Privacidade e os Termos", () => {
  it("em inglês, as duas ligações vão para as páginas em inglês", async () => {
    definirLingua("en")
    montar()
    await waitFor(() => expect(screen.getByPlaceholderText(strings.gate.namePlaceholder)).toBeTruthy())
    abreFora(ligacao("Privacy"), "https://orwell.pt/privacy.html")
    abreFora(ligacao("Terms"), "https://orwell.pt/terms.html")
  })

  it("em português, as duas ligações vão para as páginas em português", async () => {
    definirLingua("pt")
    montar()
    await waitFor(() => expect(screen.getByPlaceholderText(strings.gate.namePlaceholder)).toBeTruthy())
    abreFora(ligacao("Privacidade"), "https://orwell.pt/pt/privacidade.html")
    abreFora(ligacao("Termos"), "https://orwell.pt/pt/termos.html")
  })

  it("já na primeira pergunta (outro aparelho?), antes de escolher criar conta", async () => {
    definirLingua("en")
    montar(vi.fn())
    await waitFor(() => expect(screen.getByText(strings.gate.outroAparelhoPergunta)).toBeTruthy())
    abreFora(ligacao("Privacy"), "https://orwell.pt/privacy.html")
    abreFora(ligacao("Terms"), "https://orwell.pt/terms.html")
  })

  it("a idade mínima e a aceitação dos Termos só aparecem no último passo, antes de Criar", async () => {
    definirLingua("en")
    const pessoa = userEvent.setup()
    montar()
    await waitFor(() => expect(screen.getByPlaceholderText(strings.gate.namePlaceholder)).toBeTruthy())
    const frase = "You must be 16 or older to use Orwell. When you create the account, you accept the Terms."
    expect(screen.queryByText(frase)).toBeNull()

    await pessoa.type(screen.getByPlaceholderText(strings.gate.namePlaceholder), "Ana{Enter}")
    await pessoa.click(screen.getByRole("button", { name: strings.gate.skipPhoto }))
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(strings.gate.askConfirm)
    expect(screen.getByText(frase)).toBeTruthy()
    // No Terms checkbox: the button is the acceptance, as the Terms say ("If
    // you use it, you accept these rules"). The official channel box stays.
    expect(screen.queryByRole("checkbox", { name: /terms|termos|16/i })).toBeNull()
  })

  it("em português, a mesma frase", async () => {
    definirLingua("pt")
    expect(strings.legal.idadeEAceitacao).toBe("Tens de ter 16 anos ou mais para usar o Orwell. Ao criar a conta, aceitas os Termos.")
  })
})

describe("Setup: a Privacidade, os Termos e a idade só no orwell.pt", () => {
  const FRASE = "You must be 16 or older to use Orwell. When you create the account, you accept the Terms."

  it("o servidor de omissão é o orwell.pt, com ou sem a porta 443 e em qualquer caixa", () => {
    expect(eOServidorDeOmissao("orwell.pt")).toBe(true)
    expect(eOServidorDeOmissao(" Orwell.PT ")).toBe(true)
    expect(eOServidorDeOmissao("orwell.pt:443")).toBe(true)
    expect(eOServidorDeOmissao("chat.example.org")).toBe(false)
    expect(eOServidorDeOmissao("orwell.pt.example.org")).toBe(false)
    expect(eOServidorDeOmissao("orwell.pt:8448")).toBe(false)
    expect(eOServidorDeOmissao("localhost:8448")).toBe(false)
  })

  it("outro servidor nas opções avançadas: as ligações saem, e a frase dos 16 anos não aparece no último passo", async () => {
    definirLingua("en")
    const pessoa = userEvent.setup()
    montar()
    await waitFor(() => expect(screen.getByPlaceholderText(strings.gate.namePlaceholder)).toBeTruthy())
    expect(screen.getByRole("link", { name: "Terms" })).toBeTruthy()

    await pessoa.click(screen.getByRole("button", { name: strings.gate.advanced }))
    const servidor = screen.getByLabelText(strings.gate.server)
    await pessoa.clear(servidor)
    await pessoa.type(servidor, "chat.example.org")
    expect(screen.queryByRole("link", { name: "Privacy" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Terms" })).toBeNull()

    await pessoa.type(screen.getByPlaceholderText(strings.gate.namePlaceholder), "Ana{Enter}")
    await pessoa.click(screen.getByRole("button", { name: strings.gate.skipPhoto }))
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(strings.gate.askConfirm)
    expect(screen.queryByText(FRASE)).toBeNull()
    expect(screen.queryByRole("link", { name: "Terms" })).toBeNull()
  })

  it("outro servidor pelo endereço (?servidor=), já na primeira pergunta: sem ligações", async () => {
    window.history.replaceState(null, "", "/?servidor=chat.example.org")
    definirLingua("en")
    montar(vi.fn())
    await waitFor(() => expect(screen.getByText(strings.gate.outroAparelhoPergunta)).toBeTruthy())
    expect(screen.queryByRole("link", { name: "Privacy" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Terms" })).toBeNull()
  })
})
