import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { loadEmojiCatalog } from "../../components/EmojiPicker.js"
import { readPrefs } from "../../hooks/usePrefs.js"
import { strings } from "../../strings.js"
import { ReaccoesRapidas } from "./ReaccoesRapidas.js"

beforeAll(loadEmojiCatalog)
beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe("reacções rápidas nas Definições", () => {
  it("três casas vazias mostram as de fábrica, e escolher uma guarda-a sem contar como uso", async () => {
    const user = userEvent.setup()
    const onMudar = vi.fn()
    render(<ReaccoesRapidas escolhidas={["", "", ""]} onMudar={onMudar} />)
    expect(screen.getByRole("button", { name: strings.reaccoes.casa(1, null) }).textContent).toBe("👍")
    await user.click(screen.getByRole("button", { name: strings.reaccoes.casa(2, null) }))
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol{Enter}")
    expect(onMudar).toHaveBeenCalledWith(["", "🌻", ""])
    expect(readPrefs().emojiUsos).toEqual([])
  })

  it("o mesmo emoji não fica em duas casas, e cada casa esvazia-se ou repõem-se todas", async () => {
    const user = userEvent.setup()
    const onMudar = vi.fn()
    render(<ReaccoesRapidas escolhidas={["🌻", "", "🍺"]} onMudar={onMudar} />)
    await user.click(screen.getByRole("button", { name: strings.reaccoes.casa(3, "🍺") }))
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol{Enter}")
    expect(onMudar).toHaveBeenLastCalledWith(["", "", "🌻"])
    await user.click(screen.getByRole("button", { name: strings.reaccoes.limparCasa(1) }))
    expect(onMudar).toHaveBeenLastCalledWith(["", "", "🍺"])
    await user.click(screen.getByRole("button", { name: strings.reaccoes.repor }))
    expect(onMudar).toHaveBeenLastCalledWith(["", "", ""])
  })
})
