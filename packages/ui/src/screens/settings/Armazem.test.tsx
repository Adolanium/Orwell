import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { EstadoDoArmazem } from "@enclave/client-core"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { ConfirmarProvider } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import { Armazem } from "./Armazem.js"

afterEach(cleanup)

/**
 * The media store ceiling in Settings › Devices (design §8 and §13): a
 * selector with the five options, the "In use" row, and "Free up space" with a
 * confirmation. It is a choice for this device: it goes only to the bridge
 * (`media`), never to the account preferences.
 */

const ESTADO: EstadoDoArmazem = {
  tecto: 500_000_000,
  tectoEfectivo: 500_000_000,
  usados: 312_000_000,
  usadosPelasMinis: 41_000_000,
  originais: 80,
  minis: 300,
  emFalta: 0,
}

function ponte(estado: Partial<EstadoDoArmazem> = {}) {
  let actual: EstadoDoArmazem = { ...ESTADO, ...estado }
  const media = {
    estado: vi.fn(async () => actual),
    definirTecto: vi.fn(async (bytes: number) => {
      actual = { ...actual, tecto: bytes, tectoEfectivo: bytes }
    }),
    libertar: vi.fn(async () => {
      actual = { ...actual, usados: 0, originais: 0 }
    }),
  }
  return { media, bridge: { media } as unknown as EnclaveBridge }
}

function montar(bridge: EnclaveBridge): void {
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <ConfirmarProvider>
          <Armazem />
        </ConfirmarProvider>
      </ToastProvider>
    </BridgeContext.Provider>,
  )
}

const seletor = (): HTMLSelectElement => screen.getByRole("combobox", { name: strings.settings.armazem.titulo }) as HTMLSelectElement

describe("o tecto do armazém em Aparelhos", () => {
  it("mostra as cinco opções, com 500 MB escolhido por omissão", async () => {
    montar(ponte().bridge)
    await waitFor(() => expect(seletor().value).toBe("500000000"))
    const opcoes = [...seletor().options].map((o) => [o.value, o.textContent])
    expect(opcoes).toEqual([
      ["250000000", "250 MB"],
      ["500000000", "500 MB"],
      ["1000000000", "1 GB"],
      ["2000000000", "2 GB"],
      ["0", strings.settings.armazem.semTecto],
    ])
  })

  it("mudar a escolha chama media.definirTecto com o número", async () => {
    const { media, bridge } = ponte()
    montar(bridge)
    await waitFor(() => expect(seletor().value).toBe("500000000"))
    fireEvent.change(seletor(), { target: { value: "0" } })
    await waitFor(() => expect(media.definirTecto).toHaveBeenCalledWith(0))
    fireEvent.change(seletor(), { target: { value: "2000000000" } })
    await waitFor(() => expect(media.definirTecto).toHaveBeenLastCalledWith(2_000_000_000))
    await waitFor(() => expect(seletor().value).toBe("2000000000"))
  })

  it("a linha Em uso lê o estado", async () => {
    montar(ponte().bridge)
    expect(await screen.findByText(strings.settings.armazem.emUso("312 MB", "41 MB"))).toBeTruthy()
  })

  it("Libertar espaço pede confirmação e só depois chama media.libertar", async () => {
    const { media, bridge } = ponte()
    montar(bridge)
    fireEvent.click(await screen.findByRole("button", { name: strings.settings.armazem.libertar }))
    const pergunta = await screen.findByRole("alertdialog")
    expect(within(pergunta).getByText(strings.settings.armazem.libertarCorpo)).toBeTruthy()
    expect(media.libertar).not.toHaveBeenCalled()
    fireEvent.click(within(pergunta).getByRole("button", { name: strings.settings.armazem.libertar }))
    await waitFor(() => expect(media.libertar).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(strings.settings.armazem.emUso("0 B", "41 MB"))).toBeTruthy()
  })

  it("cancelar a confirmação não liberta nada", async () => {
    const { media, bridge } = ponte()
    montar(bridge)
    fireEvent.click(await screen.findByRole("button", { name: strings.settings.armazem.libertar }))
    const pergunta = await screen.findByRole("alertdialog")
    fireEvent.click(within(pergunta).getByRole("button", { name: strings.confirmar.cancelar }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(media.libertar).not.toHaveBeenCalled()
  })

  it("com a quota do browser menor do que o tecto, mostra a nota com o tecto efectivo", async () => {
    montar(ponte({ tectoEfectivo: 250_000_000 }).bridge)
    expect(await screen.findByText(strings.settings.armazem.quota("250 MB"))).toBeTruthy()
  })

  it("sem quota a apertar, não há nota", async () => {
    montar(ponte().bridge)
    await screen.findByText(strings.settings.armazem.emUso("312 MB", "41 MB"))
    expect(screen.queryByText(strings.settings.armazem.quota("500 MB"))).toBeNull()
  })

  it("uma ponte sem media não mostra a secção", () => {
    montar({} as EnclaveBridge)
    expect(screen.queryByText(strings.settings.armazem.titulo)).toBeNull()
  })
})
