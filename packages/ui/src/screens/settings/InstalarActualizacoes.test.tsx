import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, ModoDeActualizacao } from "../../bridge.js"
import { strings } from "../../strings.js"
import { InstalarActualizacoes } from "./InstalarActualizacoes.js"

afterEach(cleanup)

function montar(actualizacao: Partial<NonNullable<EnclaveBridge["actualizacao"]>> | undefined): void {
  render(
    <BridgeContext.Provider value={{ ...(actualizacao ? { actualizacao } : {}) } as unknown as EnclaveBridge}>
      <InstalarActualizacoes />
    </BridgeContext.Provider>,
  )
}

const chip = (modo: ModoDeActualizacao): HTMLElement => screen.getByRole("button", { name: strings.settings.modosDeActualizacao[modo] })

describe("Instalar actualizações (Windows)", () => {
  it("fora do Windows empacotado, ou sem preload que o traga, não aparece", async () => {
    montar({ modo: async () => ({ disponivel: false, modo: "perguntar" }), definirModo: vi.fn() })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(strings.settings.instalarActualizacoes)).toBeNull()
    cleanup()
    montar(undefined)
    expect(screen.queryByText(strings.settings.instalarActualizacoes)).toBeNull()
  })

  it("mostra a escolha guardada, e escolher grava-a", async () => {
    const definirModo = vi.fn(async () => ({ ok: true }))
    montar({ modo: async () => ({ disponivel: true, modo: "perguntar" }), definirModo })
    await waitFor(() => expect(chip("perguntar").getAttribute("aria-pressed")).toBe("true"))
    fireEvent.click(chip("automaticamente"))
    await waitFor(() => expect(chip("automaticamente").getAttribute("aria-pressed")).toBe("true"))
    expect(definirModo).toHaveBeenCalledWith("automaticamente")
  })

  it("diz que a app contacta o GitHub", async () => {
    montar({ modo: async () => ({ disponivel: true, modo: "perguntar" }), definirModo: vi.fn() })
    await waitFor(() => expect(screen.getByText(strings.settings.actualizacoesNota)).toBeTruthy())
    expect(strings.settings.actualizacoesNota).toMatch(/GitHub/)
    // The floor is 24 hours (an urgent fix), the rule 72, and both count from when THIS device sees it (review M2).
    expect(strings.settings.actualizacoesNota).toMatch(/24 horas.*72 horas|24 hours.*72 hours/)
    expect(strings.settings.actualizacoesNota).toMatch(/este aparelho|this device sees/)
  })

  it("se não grava, diz o erro com código e não finge a mudança", async () => {
    montar({ modo: async () => ({ disponivel: true, modo: "perguntar" }), definirModo: async () => ({ ok: false }) })
    await waitFor(() => expect(chip("perguntar")).toBeTruthy())
    fireEvent.click(chip("automaticamente"))
    const alerta = await screen.findByRole("alert")
    expect(alerta.textContent).toMatch(/801/)
    expect(chip("perguntar").getAttribute("aria-pressed")).toBe("true")
  })
})
