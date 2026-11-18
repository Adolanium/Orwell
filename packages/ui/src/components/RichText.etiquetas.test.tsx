import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../strings.js"
import { RichText, type Etiquetas } from "./RichText.js"

afterEach(cleanup)

const etiquetas = (extra: Partial<Etiquetas> = {}): Etiquetas => ({
  cargoDe: (role) => (role === "porteiro" ? { nome: "Porteiro", cor: "#ff0000" } : undefined),
  mencoes: ["&porteiro"],
  salaDe: (room) => (room === "forum-alfa-beta" ? { nome: "anúncios" } : room === "" ? { nome: "geral" } : null),
  ...extra,
})

describe("RichText: cargos e salas", () => {
  it("um cargo mencionado é uma ficha com a cor do cargo", () => {
    const { container } = render(<RichText etiquetas={etiquetas()}>{"olá <@&porteiro>!"}</RichText>)
    const ficha = container.querySelector(".mention-cargo") as HTMLElement
    expect(ficha.textContent).toBe("@Porteiro")
    expect(ficha.style.getPropertyValue("--role-tint")).toBe("#ff0000")
  })

  it("um cargo que o receptor não validou lê-se como texto simples", () => {
    const { container } = render(<RichText etiquetas={etiquetas({ mencoes: [] })}>{"<@&porteiro> ajuda"}</RichText>)
    expect(container.querySelector(".mention-cargo")).toBeNull()
    expect(container.textContent).toBe("@Porteiro ajuda")
  })

  it("uma sala que vejo abre-se ao tocar, e a sala por omissão também", async () => {
    const user = userEvent.setup()
    const onSala = vi.fn()
    render(<RichText etiquetas={etiquetas({ onSala })}>{"vejam <#forum-alfa-beta> e <#>"}</RichText>)
    await user.click(screen.getByRole("button", { name: strings.etiquetas.irParaSala("anúncios") }))
    expect(onSala).toHaveBeenCalledWith("forum-alfa-beta")
    await user.click(screen.getByRole("button", { name: strings.etiquetas.irParaSala("geral") }))
    expect(onSala).toHaveBeenLastCalledWith("")
  })

  it("uma sala que não vejo, apagada ou inexistente lê-se #sala-sem-acesso, sem o nome nem o id", () => {
    const { container } = render(<RichText etiquetas={etiquetas({ onSala: vi.fn() })}>{"<#forum-secreta-sala>"}</RichText>)
    expect(strings.etiquetas.semAcesso).toBe("sala-sem-acesso")
    expect(container.textContent).toBe("#sala-sem-acesso")
    expect(container.innerHTML).not.toContain("secreta")
    // Not a button: the link opens nothing and says nothing about the room.
    expect(container.querySelector("button")).toBeNull()
    expect(container.querySelector("[aria-label],[title]")).toBeNull()
  })

  it("sem etiquetas (um sítio sem contexto), o token fica como texto", () => {
    const { container } = render(<RichText>{"vejam <#forum-alfa-beta>"}</RichText>)
    expect(container.textContent).toBe("vejam <#forum-alfa-beta>")
  })
})
