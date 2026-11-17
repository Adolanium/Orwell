import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../strings.js"
import { Lightbox } from "./Lightbox.js"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const ITEM = { name: "foto.png", mediaType: "image/png", inline: PNG }

describe("o visualizador de imagem", () => {
  it("tem copiar imagem e descarregar, e a ligação só quando há uma", () => {
    const { rerender } = render(<Lightbox item={ITEM} onClose={() => {}} />)
    expect(screen.getByRole("button", { name: strings.media.copiarImagem })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.media.descarregar })).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.media.copiarLigacao })).toBeNull()
    rerender(<Lightbox item={ITEM} onClose={() => {}} ligacao="https://orwell.pt/app/m#m=c//m1" />)
    expect(screen.getByRole("button", { name: strings.media.copiarLigacao })).toBeTruthy()
  })

  it("copiar imagem escreve um PNG na área de transferência com os bytes locais, sem rede", async () => {
    const escritos: { dados: Record<string, Promise<Blob>> }[][] = []
    vi.stubGlobal("ClipboardItem", class { constructor(public dados: Record<string, Promise<Blob>>) {} })
    vi.stubGlobal("navigator", { clipboard: { write: async (itens: never) => void escritos.push(itens) } })
    const fetchEspia = vi.fn()
    vi.stubGlobal("fetch", fetchEspia)
    render(<Lightbox item={ITEM} onClose={() => {}} />)
    await userEvent.click(screen.getByRole("button", { name: strings.media.copiarImagem }))
    await waitFor(() => expect(escritos).toHaveLength(1))
    expect((await escritos[0]?.[0]?.dados["image/png"])?.type).toBe("image/png")
    expect(fetchEspia).not.toHaveBeenCalled()
  })

  it("descarregar guarda o ficheiro com o nome da mensagem", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }))
    URL.createObjectURL = vi.fn(() => "blob:x")
    URL.revokeObjectURL = vi.fn()
    const nomes: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      nomes.push(this.download)
    })
    render(<Lightbox item={ITEM} onClose={() => {}} />)
    await userEvent.click(screen.getByRole("button", { name: strings.media.descarregar }))
    await waitFor(() => expect(nomes).toEqual(["foto.png"]))
  })

  it("copiar a ligação da mensagem põe o texto na área de transferência", async () => {
    const escrever = vi.fn(async () => {})
    vi.stubGlobal("navigator", { clipboard: { writeText: escrever } })
    render(<Lightbox item={ITEM} onClose={() => {}} ligacao="https://orwell.pt/app/m#m=c//m1" />)
    await userEvent.click(screen.getByRole("button", { name: strings.media.copiarLigacao }))
    await waitFor(() => expect(escrever).toHaveBeenCalledWith("https://orwell.pt/app/m#m=c//m1"))
  })
})
