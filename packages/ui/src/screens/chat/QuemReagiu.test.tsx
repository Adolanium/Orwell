import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { FichaDeReaccao } from "@enclave/client-core"
import type { Profile } from "../../bridge.js"
import { strings } from "../../strings.js"
import { QuemReagiu } from "./QuemReagiu.js"

afterEach(cleanup)

const NOMES: Record<string, string> = { "@ana:s": "Ana", "@bruno:s": "Bruno", "@carla:s": "Carla" }
const fichas: FichaDeReaccao[] = [
  { emoji: "👍", quem: ["@ana:s", "@bruno:s"], minha: true },
  { emoji: "🎉", quem: ["@carla:s"], minha: false },
]
const abrir = (inicial: string | null, lista = fichas, onClose = vi.fn()): ReturnType<typeof render> =>
  render(
    <QuemReagiu fichas={lista} inicial={inicial} nameFor={(a) => NOMES[a] ?? a} directory={new Map<string, Profile>()} onClose={onClose} />,
  )

const pessoas = (): string[] => within(screen.getByRole("tabpanel")).getAllByRole("listitem").map((li) => li.querySelector(".quem-reagiu-nome")?.textContent ?? "")

describe("quem reagiu", () => {
  it("abre no emoji pedido, com um separador por emoji e a contagem", () => {
    abrir("🎉")
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label"))).toEqual([
      strings.reaccoes.separador("👍", 2),
      strings.reaccoes.separador("🎉", 1),
    ])
    expect(screen.getByRole("tab", { selected: true }).getAttribute("aria-label")).toBe(strings.reaccoes.separador("🎉", 1))
    expect(pessoas()).toEqual(["Carla"])
  })

  it("sem emoji pedido, abre no primeiro; as setas mudam de separador", async () => {
    const user = userEvent.setup()
    abrir(null)
    expect(pessoas()).toEqual(["Ana", "Bruno"])
    screen.getByRole("tab", { selected: true }).focus()
    await user.keyboard("{ArrowDown}")
    expect(pessoas()).toEqual(["Carla"])
  })

  it("segue as fichas ao vivo: quando o emoji aberto fica sem ninguém, passa ao primeiro", () => {
    const { rerender } = abrir("🎉")
    rerender(
      <QuemReagiu fichas={[fichas[0] as FichaDeReaccao]} inicial="🎉" nameFor={(a) => NOMES[a] ?? a} directory={new Map()} onClose={vi.fn()} />,
    )
    expect(pessoas()).toEqual(["Ana", "Bruno"])
  })

  it("fecha pelo botão e com Escape", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    abrir(null, fichas, onClose)
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: strings.reaccoes.fechar }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
