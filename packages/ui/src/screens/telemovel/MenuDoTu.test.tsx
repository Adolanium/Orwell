import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MenuDoTu } from "./MenuDoTu.js"

afterEach(cleanup)

describe("MenuDoTu", () => {
  it("the three account destinations of the desktop rail, and the account card under them", () => {
    const onAbrir = vi.fn()
    render(<MenuDoTu cartao={<p>cartão da conta</p>} comentarios={0} onAbrir={onAbrir} />)
    expect(screen.getAllByRole("button").map((botao) => botao.getAttribute("aria-label"))).toEqual([
      "O teu perfil",
      "Feed",
      "Configurações",
    ])
    expect(screen.getByText("cartão da conta")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "O teu perfil" }))
    fireEvent.click(screen.getByRole("button", { name: "Feed" }))
    fireEvent.click(screen.getByRole("button", { name: "Configurações" }))
    expect(onAbrir.mock.calls).toEqual([["perfil"], ["social"], ["config"]])
  })

  it("comments that wait for me show on the Feed entry, as on the rail", () => {
    render(<MenuDoTu cartao={null} comentarios={3} onAbrir={() => {}} />)
    const mural = screen.getByRole("button", { name: "Feed" })
    expect(mural.querySelector(".rail-count")?.textContent).toBe("3")
  })
})
