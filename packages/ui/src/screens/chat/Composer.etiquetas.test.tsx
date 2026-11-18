import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { Composer } from "./Composer.js"
import type { EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import { strings } from "../../strings.js"
import { candidatoDeCargo, candidatoDeSala } from "../../lib/etiquetas.js"

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const bridge = { social: { linkPreview: vi.fn().mockRejectedValue(new Error("não")) } } as unknown as EnclaveBridge
const ANA = { address: "@ana-b-c-d:s", name: "Ana" }
const PORTEIRO = candidatoDeCargo({ role: "porteiro", name: "Porteiro", powers: [] })
const SALAS = [candidatoDeSala({ room: "", name: "geral" }), candidatoDeSala({ room: "forum-alfa-beta", name: "anúncios" })]

function Harness({
  onSend,
  pessoas = [ANA],
  salas = SALAS,
}: {
  onSend: (body: string, extras?: unknown) => void
  pessoas?: readonly { address: string; name: string }[]
  salas?: typeof SALAS
}): React.JSX.Element {
  const [value, setValue] = useState("")
  return (
    <BridgeContext.Provider value={bridge}>
      <Composer
        connection="online"
        value={value}
        onChange={setValue}
        onSend={onSend}
        mentionable={pessoas}
        cargos={[PORTEIRO]}
        salas={salas}
        podeMencionarTodos
      />
    </BridgeContext.Provider>
  )
}

const caixa = (): HTMLInputElement => screen.getByPlaceholderText(strings.chat.composerPlaceholder) as HTMLInputElement

describe("a caixa de escrita: # salas e @ cargos", () => {
  it("# abre as salas que vejo, e a escolhida viaja como <#id>", async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSend={onSend} />)
    await user.type(caixa(), "vejam #an")
    expect(screen.getAllByRole("option")).toHaveLength(1)
    await user.click(screen.getByRole("option", { name: "anúncios" }))
    expect(caixa().value).toBe("vejam #anúncios ")
    await user.click(screen.getByRole("button", { name: strings.chat.send }))
    expect(onSend).toHaveBeenCalledWith("vejam <#forum-alfa-beta>")
  })

  it("@ sugere pessoas, depois cargos, depois @all; o cargo viaja como <@&id> e &id", async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSend={onSend} />)
    await user.type(caixa(), "@")
    // The face's initial is hidden from listeners; the rest is the order read.
    expect(screen.getAllByRole("option").map((opcao) => opcao.textContent?.replace(/^A(?=Ana)/, ""))).toEqual([
      "Ana",
      `@Porteiro${strings.etiquetas.cargo}`,
      `@all${strings.chat.mencionarTodos}`,
      "anúncios",
      "geral",
    ])
    await user.type(caixa(), "por")
    await user.keyboard("{Enter}")
    await user.type(caixa(), "abre")
    await user.keyboard("{Enter}")
    expect(onSend).toHaveBeenCalledWith("<@&porteiro> abre", expect.objectContaining({ mentions: ["&porteiro"] }))
  })

  it("@ traz a secção Canais depois das pessoas, dos cargos e de @all; a sala viaja como <#id>, sem menção", async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<Harness onSend={onSend} />)
    await user.type(caixa(), "@")
    const lista = container.querySelector(".mention-picker") as HTMLElement
    const linhas = [...lista.children].map((li) => li.textContent?.replace(/^A(?=Ana)/, ""))
    expect(linhas).toEqual([
      "Ana",
      `@Porteiro${strings.etiquetas.cargo}`,
      `@all${strings.chat.mencionarTodos}`,
      strings.etiquetas.seccaoCanais,
      "anúncios",
      "geral",
    ])
    // The section title is not an option: arrows and Enter skip it.
    expect(screen.getAllByRole("option")).toHaveLength(5)
    await user.type(caixa(), "anu")
    await user.keyboard("{Enter}")
    expect(caixa().value).toBe("#anúncios ")
    await user.type(caixa(), "já")
    await user.keyboard("{Enter}")
    expect(onSend).toHaveBeenCalledWith("<#forum-alfa-beta> já")
  })

  it("# mostra só canais, com o título da secção", async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness onSend={vi.fn()} />)
    await user.type(caixa(), "#")
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["anúncios", "geral"])
    expect(container.querySelector(".mention-seccao")?.textContent).toBe(strings.etiquetas.seccaoCanais)
  })

  it("com 200 salas e 400 pessoas, o # e o @ abrem a lista em menos de 50 ms", () => {
    const salas = Array.from({ length: 200 }, (_, i) => candidatoDeSala({ room: `forum-a${i}-b${i}`, name: `sala ${i}` }))
    const pessoas = Array.from({ length: 400 }, (_, i) => ({ address: `@p${i}-b-c-d:s`, name: `Pessoa ${i}` }))
    render(<Harness onSend={vi.fn()} pessoas={pessoas} salas={salas} />)
    for (const sinal of ["#", "@"]) {
      fireEvent.change(caixa(), { target: { value: "" } })
      const inicio = performance.now()
      act(() => {
        fireEvent.change(caixa(), { target: { value: sinal, selectionStart: 1, selectionEnd: 1 } })
      })
      const ms = performance.now() - inicio
      expect(screen.getAllByRole("option").length).toBeGreaterThan(0)
      expect(ms).toBeLessThan(50)
    }
  })
})
