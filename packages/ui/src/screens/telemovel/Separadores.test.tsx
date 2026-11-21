import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Separadores } from "./Separadores.js"

afterEach(cleanup)

describe("Separadores", () => {
  it("draws the four tabs in order, and marks the open one", () => {
    render(<Separadores actual="mensagens" avisos={{}} onEscolher={() => {}} />)
    const botoes = screen.getAllByRole("button")
    expect(botoes.map((botao) => botao.getAttribute("aria-label"))).toEqual(["Comunidades", "Mensagens", "Amigos", "Tu"])
    expect(screen.getByRole("button", { name: "Mensagens" }).getAttribute("aria-current")).toBe("page")
    expect(screen.getByRole("navigation", { name: "Secções principais" })).toBeTruthy()
  })

  it("carries the rail's notices with the same shapes: pill, pastille, nudge, call", () => {
    render(
      <Separadores
        actual="tu"
        avisos={{
          comunidades: { quantas: 0, porLer: true },
          mensagens: { quantas: 2 },
          amigos: { quantas: 0, toque: "Carla deu-te uma cotovelada." },
          tu: { quantas: 0, chamada: true },
        }}
        onEscolher={() => {}}
      />,
    )
    const comunidades = screen.getByRole("button", { name: "Comunidades" })
    expect(comunidades.querySelector(".rail-pill")).not.toBeNull()
    const mensagens = screen.getByRole("button", { name: "Mensagens" })
    expect(mensagens.querySelector(".rail-count")?.textContent).toBe("2")
    expect(document.getElementById(mensagens.getAttribute("aria-describedby") ?? "")?.textContent).toBe("2 por atender")
    const amigos = screen.getByRole("button", { name: "Amigos" })
    expect(amigos.className).toContain("tocado")
    expect(amigos.querySelector(".rail-toque")).not.toBeNull()
    // The open tab draws no unread pill, like the open destination on the rail.
    expect(screen.getByRole("button", { name: "Tu" }).querySelector(".rail-chamada")).not.toBeNull()
  })

  it("tapping a tab chooses it, the open one too (the shell takes it back to its list)", () => {
    const onEscolher = vi.fn()
    render(<Separadores actual="amigos" avisos={{}} onEscolher={onEscolher} />)
    fireEvent.click(screen.getByRole("button", { name: "Comunidades" }))
    fireEvent.click(screen.getByRole("button", { name: "Amigos" }))
    expect(onEscolher.mock.calls).toEqual([["comunidades"], ["amigos"]])
  })
})
