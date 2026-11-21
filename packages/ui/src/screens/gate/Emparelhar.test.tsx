import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, PairEvento } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { Emparelhar } from "./Emparelhar.js"

afterEach(cleanup)

/**
 * "Entrar com outro aparelho" on the new device (21/11/2026, mock-up `Emparelhar`).
 *
 * What holds: a code that is not for adding a device does not pass; a good one
 * starts at once with a provisional vault and no password; the screen shows THREE
 * words with both answers; and the account password is asked at the end, on
 * "Estás dentro", where `pairing.seal` checks it (Erro 140) or, with no record
 * from the other device, a new one is chosen twice. Nothing deletes an account.
 */
const LINK = "https://orwell.pt/app/emparelhar#6gzjKC5Y-jxiXv_ZLoIzYX6ZL4PeZ24HirzSb__z6VY"
const SEIS = "lua-pedra-rio-sol-mar-vento"

function ponte(): {
  bridge: EnclaveBridge
  emitir: (evento: PairEvento) => void
  chamadas: string[]
  selos: string[]
} {
  const chamadas: string[] = []
  const selos: string[] = []
  let ouvinte: ((evento: PairEvento) => void) | null = null
  const bridge = {
    vault: {
      status: vi.fn(async () => ({ exists: false, supportsOsProtection: false })),
      createProvisionalToSeal: vi.fn(async () => {
        chamadas.push("provisorio")
        return { ok: true }
      }),
      create: vi.fn(async () => {
        chamadas.push("vault.create")
        return { ok: true }
      }),
      destroy: vi.fn(async () => {
        chamadas.push("vault.destroy")
        return { ok: true }
      }),
    },
    identity: { load: vi.fn(async () => ({ address: "@a:orwell.pt", accountId: "a" })) },
    session: { connect: vi.fn(async () => ({ ok: true })) },
    pairing: {
      join: vi.fn(async (link: string) => {
        chamadas.push(`join ${link}`)
        return { ok: true }
      }),
      confirm: vi.fn(async () => {
        chamadas.push("confirm")
        return { ok: true }
      }),
      refuse: vi.fn(async () => {
        chamadas.push("refuse")
        return { ok: true }
      }),
      cancel: vi.fn(async () => {
        chamadas.push("cancel")
        return { ok: true }
      }),
      seal: vi.fn(async (frase: string) => {
        selos.push(frase)
        if (frase === "errada-123") throw new Error("this is not the account password")
        return { ok: true }
      }),
      done: vi.fn(async () => {
        chamadas.push("done")
        return { ok: true }
      }),
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
  return { bridge, emitir: (evento) => act(() => ouvinte?.(evento)), chamadas, selos }
}

function montar(bridge: EnclaveBridge, onBack = vi.fn()): { onDone: ReturnType<typeof vi.fn>; onBack: ReturnType<typeof vi.fn>; unmount: () => void } {
  const onDone = vi.fn()
  const { unmount } = render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <Emparelhar onDone={onDone} onBack={onBack} />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
  return { onDone, onBack, unmount }
}

async function colar(chamadas: string[], link = LINK): Promise<void> {
  fireEvent.change(screen.getByLabelText(strings.juntarAparelho.colarCodigo), { target: { value: link } })
  fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.continuar }))
  if (link === LINK) await waitFor(() => expect(chamadas).toContain(`join ${LINK}`))
}

async function ateDentro(p: ReturnType<typeof ponte>, palavraPasse: "conta" | "nova" = "conta"): Promise<void> {
  await colar(p.chamadas)
  p.emitir({ fase: "sas", palavras: SEIS })
  fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.sim }))
  p.emitir({ fase: "certificado", address: "@a:orwell.pt", palavraPasse })
  await screen.findByRole("heading", { name: strings.juntarAparelho.estasDentro })
}

describe("Entrar com outro aparelho, no aparelho novo", () => {
  it("diz onde está o código no outro aparelho, com a câmara e o campo para colar, e sem palavra-passe", () => {
    montar(ponte().bridge)
    expect(screen.getByRole("heading", { name: strings.entrada.comOutroAparelho })).toBeTruthy()
    expect(screen.getByText(strings.juntarAparelho.novoLead)).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.juntarAparelho.lerCamara })).toBeTruthy()
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })

  it("um código que não é para juntar aparelhos não passa, e não cria nada", () => {
    const { bridge, chamadas } = ponte()
    montar(bridge)
    fireEvent.change(screen.getByLabelText(strings.juntarAparelho.colarCodigo), { target: { value: "https://orwell.pt/app/convite#x/y" } })
    fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.continuar }))
    expect(screen.getByText(strings.juntarAparelho.codigoInvalido)).toBeTruthy()
    expect(chamadas).toEqual([])
  })

  it("um código bom começa logo, num cofre provisório sem palavra-passe; nada vai ao disco", async () => {
    const p = ponte()
    montar(p.bridge)
    await colar(p.chamadas)
    expect(p.chamadas.slice(0, 2)).toEqual(["provisorio", `join ${LINK}`])
    expect(p.chamadas).not.toContain("vault.create")
    expect(screen.getByText(strings.juntarAparelho.aLigar)).toBeTruthy()
  })

  it("as palavras: só três, com os dois botões; sim confirma", async () => {
    const p = ponte()
    montar(p.bridge)
    await colar(p.chamadas)
    p.emitir({ fase: "sas", palavras: SEIS })
    expect(screen.getByRole("heading", { name: strings.juntarAparelho.palavrasTitulo })).toBeTruthy()
    const lista = document.querySelector(".sas-palavras") as HTMLElement
    expect(lista.getAttribute("data-palavras")).toBe("lua-pedra-rio")
    expect(lista.querySelectorAll("li")).toHaveLength(3)
    fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.sim }))
    await waitFor(() => expect(p.chamadas).toContain("confirm"))
    expect(screen.getByText(strings.juntarAparelho.confirmadoAqui)).toBeTruthy()
  })

  it('"Não são iguais" recusa e mostra a falha, com "Tentar de novo"', async () => {
    const p = ponte()
    montar(p.bridge)
    await colar(p.chamadas)
    p.emitir({ fase: "sas", palavras: SEIS })
    fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.nao }))
    await waitFor(() => expect(p.chamadas).toContain("refuse"))
    expect(screen.getByRole("heading", { name: strings.juntarAparelho.falhou })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.common.retry })).toBeTruthy()
  })

  it('"Estás dentro": a palavra-passe da conta errada dá Erro 140 e fica; a certa sela, guarda e abre', async () => {
    const p = ponte()
    const { onDone } = montar(p.bridge)
    await ateDentro(p, "conta")
    const campo = screen.getByLabelText(strings.juntarAparelho.palavraPasseDaConta)
    expect(campo.getAttribute("autocomplete")).toBe("current-password")
    expect(screen.queryByLabelText(strings.entrada.palavraPasseOutraVez)).toBeNull()
    fireEvent.change(campo, { target: { value: "errada-123" } })
    fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.abrir }))
    expect((await screen.findByRole("alert")).textContent).toContain("140")
    expect(p.chamadas).not.toContain("done")
    fireEvent.change(campo, { target: { value: "a-palavra-da-conta" } })
    fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.abrir }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("@a:orwell.pt"))
    expect(p.selos).toEqual(["errada-123", "a-palavra-da-conta"])
    expect(p.chamadas).toContain("done")
  })

  it("after Erro 140 it says what to do without the password, and Cancel leaves the pairing", async () => {
    const p = ponte()
    const { onBack } = montar(p.bridge)
    await ateDentro(p, "conta")
    // Before a wrong password, nothing about forgetting it.
    expect(screen.queryByText(strings.juntarAparelho.forgotAccountPassword)).toBeNull()
    fireEvent.change(screen.getByLabelText(strings.juntarAparelho.palavraPasseDaConta), { target: { value: "errada-123" } })
    fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.abrir }))
    expect((await screen.findByRole("alert")).textContent).toContain("140")
    expect(screen.getByText(strings.juntarAparelho.forgotAccountPassword)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: strings.common.cancel }))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
    expect(p.chamadas).toContain("cancel")
    expect(p.chamadas).not.toContain("done")
    expect(p.chamadas).not.toContain("vault.destroy")
  })

  it("sem registo do outro aparelho, escolhe-se a palavra-passe da conta, duas vezes", async () => {
    const p = ponte()
    const { onDone } = montar(p.bridge)
    await ateDentro(p, "nova")
    fireEvent.change(screen.getByLabelText(strings.juntarAparelho.palavraPasseDaConta), { target: { value: "nova-frase-1" } })
    fireEvent.change(screen.getByLabelText(strings.entrada.palavraPasseOutraVez), { target: { value: "outra-frase" } })
    fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.abrir }))
    expect((await screen.findByRole("alert")).textContent).toBe(strings.entrada.diferentes)
    fireEvent.change(screen.getByLabelText(strings.entrada.palavraPasseOutraVez), { target: { value: "nova-frase-1" } })
    fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.abrir }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(p.selos).toEqual(["nova-frase-1"])
  })

  it('"Voltar" e sair a meio cancelam o emparelhamento, e nunca apagam um cofre', async () => {
    const p = ponte()
    const { onBack, unmount } = montar(p.bridge)
    await colar(p.chamadas)
    unmount()
    await waitFor(() => expect(p.chamadas).toContain("cancel"))
    expect(p.chamadas).not.toContain("vault.destroy")
    expect(onBack).not.toHaveBeenCalled()
  })

  it("depois de abrir, sair já não cancela nada: a conta está no disco", async () => {
    const p = ponte()
    const { unmount } = montar(p.bridge)
    await ateDentro(p)
    fireEvent.change(screen.getByLabelText(strings.juntarAparelho.palavraPasseDaConta), { target: { value: "a-palavra-da-conta" } })
    fireEvent.click(screen.getByRole("button", { name: strings.juntarAparelho.abrir }))
    await waitFor(() => expect(p.chamadas).toContain("done"))
    const antes = p.chamadas.length
    unmount()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(p.chamadas.slice(antes)).not.toContain("cancel")
  })
})
