import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { ContaESeguranca } from "./ContaESeguranca.js"

/**
 * Configurações › Conta e segurança (21/11/2026, mock-up `Voltar`): the four
 * rows, each opening its own screen; "Mudar a palavra-passe" with the current one
 * and the new one twice, and a new file offered after.
 */
afterEach(cleanup)

function ponte(mudarPalavraPasse: EnclaveBridge["vault"]["mudarPalavraPasse"] = vi.fn(async () => ({ ok: true }))): EnclaveBridge {
  return {
    vault: { status: async () => ({ exists: true, supportsOsProtection: false, protection: "passphrase" }), mudarPalavraPasse },
    pairing: {
      status: async () => ({ temChaveDeConta: true, servidorSuporta: true, servidorRevoga: true }),
      devices: async () => [
        { deviceKey: "aaaaaaaaaaaaaaaa", addedAt: 1, esteAparelho: true },
        { deviceKey: "bbbbbbbbbbbbbbbb", addedAt: 2, esteAparelho: false },
        { deviceKey: "cccccccccccccccc", addedAt: 3, esteAparelho: false },
      ],
      host: vi.fn(async () => new Promise(() => {})),
      cancel: vi.fn(async () => ({ ok: true })),
    },
    on: { pair: () => () => {} },
  } as unknown as EnclaveBridge
}

function montar(bridge: EnclaveBridge, onGuardarFicheiro = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <ToastProvider>
      <BridgeContext.Provider value={bridge}>
        <ContaESeguranca podeGuardar onGuardarFicheiro={onGuardarFicheiro} />
      </BridgeContext.Provider>
    </ToastProvider>,
  )
  return onGuardarFicheiro
}

describe("Conta e segurança", () => {
  it("tudo o que é da conta num só sítio: as quatro linhas, e Aparelhos com a contagem", async () => {
    const guardar = montar(ponte())
    const lista = screen.getByRole("heading", { name: strings.contaESeguranca.titulo }).closest("section")!
    expect(await within(lista).findByRole("button", { name: strings.contaESeguranca.mudar })).toBeTruthy()
    expect(await within(lista).findByRole("button", { name: strings.contaESeguranca.juntar })).toBeTruthy()
    await waitFor(() => expect(within(lista).getByRole("button", { name: /Aparelhos\s*3/ })).toBeTruthy())
    fireEvent.click(within(lista).getByRole("button", { name: strings.contaESeguranca.guardarFicheiro }))
    expect(guardar).toHaveBeenCalledOnce()
  })

  it("Aparelhos abre a lista, com o caminho de volta", async () => {
    montar(ponte())
    fireEvent.click(await screen.findByRole("button", { name: /Aparelhos/ }))
    await waitFor(() => expect(document.querySelectorAll(".aparelhos-lista li")).toHaveLength(3))
    fireEvent.click(screen.getByRole("button", { name: new RegExp(strings.contaESeguranca.titulo) }))
    expect(await screen.findByRole("heading", { name: strings.contaESeguranca.titulo })).toBeTruthy()
  })

  it("Juntar um aparelho abre a folha com o código para o aparelho novo", async () => {
    montar(ponte())
    fireEvent.click(await screen.findByRole("button", { name: strings.contaESeguranca.juntar }))
    expect(await screen.findByRole("heading", { name: strings.juntarAparelho.titulo })).toBeTruthy()
  })

  it("Mudar a palavra-passe: actual, nova, outra vez; depois oferece um ficheiro novo", async () => {
    const mudar = vi.fn(async () => ({ ok: true }))
    const guardar = montar(ponte(mudar))
    fireEvent.click(await screen.findByRole("button", { name: strings.contaESeguranca.mudar }))
    const folha = await screen.findByRole("dialog", { name: strings.contaESeguranca.mudar })
    expect(within(folha).getByText(strings.contaESeguranca.nota)).toBeTruthy()
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.actual), { target: { value: "antiga-123" } })
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.nova), { target: { value: "nova-4567890" } })
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.novaOutraVez), { target: { value: "nova-4567890" } })
    fireEvent.click(within(folha).getByRole("button", { name: strings.contaESeguranca.mudar }))
    await waitFor(() => expect(mudar).toHaveBeenCalledWith("antiga-123", "nova-4567890"))
    expect(await screen.findByText(strings.contaESeguranca.mudada)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: strings.contaESeguranca.guardarNovo }))
    expect(guardar).toHaveBeenCalledOnce()
  })

  it('"I forgot the current password": no current field, the bridge changes it with the open vault', async () => {
    const change = vi.fn(async () => ({ ok: true }))
    const bridge = ponte()
    ;(bridge.vault as { changePasswordWithOpenVault?: unknown }).changePasswordWithOpenVault = change
    montar(bridge)
    fireEvent.click(await screen.findByRole("button", { name: strings.contaESeguranca.mudar }))
    const folha = await screen.findByRole("dialog", { name: strings.contaESeguranca.mudar })
    fireEvent.click(within(folha).getByRole("button", { name: strings.contaESeguranca.forgotCurrent }))
    expect(within(folha).queryByLabelText(strings.contaESeguranca.actual)).toBeNull()
    expect(within(folha).getByText(strings.contaESeguranca.forgotCurrentNote)).toBeTruthy()
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.nova), { target: { value: "nova-4567890" } })
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.novaOutraVez), { target: { value: "nova-4567890" } })
    fireEvent.click(within(folha).getByRole("button", { name: strings.contaESeguranca.mudar }))
    await waitFor(() => expect(change).toHaveBeenCalledWith("nova-4567890"))
    expect(await screen.findByText(strings.contaESeguranca.mudada)).toBeTruthy()
  })

  it("without the bridge method there is no forgot button", async () => {
    montar(ponte())
    fireEvent.click(await screen.findByRole("button", { name: strings.contaESeguranca.mudar }))
    const folha = await screen.findByRole("dialog", { name: strings.contaESeguranca.mudar })
    expect(within(folha).queryByRole("button", { name: strings.contaESeguranca.forgotCurrent })).toBeNull()
  })

  it("a device that is behind: Erro 142 with the sentence, and nothing changes", async () => {
    const mudar = vi.fn(async () => {
      throw new Error("sync this device before you change the password")
    })
    montar(ponte(mudar))
    fireEvent.click(await screen.findByRole("button", { name: strings.contaESeguranca.mudar }))
    const folha = await screen.findByRole("dialog", { name: strings.contaESeguranca.mudar })
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.actual), { target: { value: "antiga-123" } })
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.nova), { target: { value: "nova-4567890" } })
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.novaOutraVez), { target: { value: "nova-4567890" } })
    fireEvent.click(within(folha).getByRole("button", { name: strings.contaESeguranca.mudar }))
    const alerta = (await within(folha).findByRole("alert")).textContent ?? ""
    expect(alerta).toContain("142")
    expect(alerta).toContain("Sincronize o aparelho antes de mudar a password")
    expect(screen.queryByText(strings.contaESeguranca.mudada)).toBeNull()
  })

  it("a actual errada: Erro 138 na folha, e nada muda", async () => {
    const mudar = vi.fn(async () => {
      throw new Error("the current passphrase is not right")
    })
    montar(ponte(mudar))
    fireEvent.click(await screen.findByRole("button", { name: strings.contaESeguranca.mudar }))
    const folha = await screen.findByRole("dialog", { name: strings.contaESeguranca.mudar })
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.actual), { target: { value: "errada" } })
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.nova), { target: { value: "nova-4567890" } })
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.novaOutraVez), { target: { value: "nova-4567890" } })
    fireEvent.click(within(folha).getByRole("button", { name: strings.contaESeguranca.mudar }))
    expect((await within(folha).findByRole("alert")).textContent).toContain("138")
    expect(screen.queryByText(strings.contaESeguranca.mudada)).toBeNull()
  })

  it("duas novas diferentes não chamam a ponte", async () => {
    const mudar = vi.fn(async () => ({ ok: true }))
    montar(ponte(mudar))
    fireEvent.click(await screen.findByRole("button", { name: strings.contaESeguranca.mudar }))
    const folha = await screen.findByRole("dialog", { name: strings.contaESeguranca.mudar })
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.nova), { target: { value: "nova-4567890" } })
    fireEvent.change(within(folha).getByLabelText(strings.contaESeguranca.novaOutraVez), { target: { value: "outra-4567890" } })
    fireEvent.click(within(folha).getByRole("button", { name: strings.contaESeguranca.mudar }))
    expect((await within(folha).findByRole("alert")).textContent).toBe(strings.entrada.diferentes)
    expect(mudar).not.toHaveBeenCalled()
  })
})
