import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
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

function Harness({ onSend }: { onSend: (body: string, extras?: unknown) => void }): React.JSX.Element {
  const [value, setValue] = useState("")
  return (
    <BridgeContext.Provider value={bridge}>
      <Composer
        connection="online"
        value={value}
        onChange={setValue}
        onSend={onSend}
        mentionable={[ANA]}
        cargos={[PORTEIRO]}
        salas={SALAS}
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
    ])
    await user.type(caixa(), "por")
    await user.keyboard("{Enter}")
    await user.type(caixa(), "abre")
    await user.keyboard("{Enter}")
    expect(onSend).toHaveBeenCalledWith("<@&porteiro> abre", expect.objectContaining({ mentions: ["&porteiro"] }))
  })
})
