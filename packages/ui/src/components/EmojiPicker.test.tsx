import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { EmojiPicker, loadEmojiCatalog } from "./EmojiPicker.js"
import { PREFS_KEY, readPrefs } from "../hooks/usePrefs.js"
import { strings } from "../strings.js"

// Catalog already loaded; the wait for it has its own file (EmojiPicker.carga.test.tsx).
beforeAll(loadEmojiCatalog)
beforeEach(() => localStorage.clear())
afterEach(cleanup)

function open(onPick = vi.fn(), onClose = vi.fn()): { onPick: typeof onPick; onClose: typeof onClose } {
  render(<EmojiPicker onPick={onPick} onClose={onClose} />)
  return { onPick, onClose }
}

/** Grid cells, in the order they appear. */
function cells(): HTMLElement[] {
  return within(screen.getByRole("group")).getAllByRole("button")
}

describe("EmojiPicker", () => {
  it("abre como diálogo com o foco na pesquisa", () => {
    open()
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true")
    expect(document.activeElement).toBe(screen.getByLabelText(strings.emoji.searchLabel))
  })

  it("mostra a primeira categoria quando não há recentes", () => {
    open()
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe("Rostos")
    expect(cells().length).toBeGreaterThan(20)
  })

  it("filtra pela pesquisa, sem exigir acentos", async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol")
    const found = cells()
    expect(found.length).toBe(1)
    expect(found[0]?.textContent).toBe("🌻")
  })

  it("diz quando não encontra nada", async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "zzzzq")
    expect(screen.getByText(strings.emoji.noResults)).toBeTruthy()
  })

  it("entrega o emoji escolhido e fecha", async () => {
    const user = userEvent.setup()
    const { onPick, onClose } = open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol")
    await user.click(cells()[0] as HTMLElement)
    expect(onPick).toHaveBeenCalledWith("🌻")
    expect(onClose).toHaveBeenCalled()
  })

  it("guarda o que foi usado, do mais recente para o mais antigo", async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol")
    await user.click(cells()[0] as HTMLElement)
    expect(readPrefs().emojiRecents).toEqual(["🌻"])

    cleanup()
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "café")
    await user.click(cells()[0] as HTMLElement)
    expect(readPrefs().emojiRecents).toEqual(["☕", "🌻"])
  })

  it("promove um emoji repetido em vez de o duplicar", async () => {
    const user = userEvent.setup()
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, emojiRecents: ["☕", "🌻"] }))
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol")
    await user.click(cells()[0] as HTMLElement)
    expect(readPrefs().emojiRecents).toEqual(["🌻", "☕"])
  })

  it("abre nos usados com frequência quando já os há, à frente de todas as categorias", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, emojiRecents: ["🌻", "☕"] }))
    open()
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe(strings.emoji.recents)
    expect(cells().slice(0, 2).map((cell) => cell.textContent)).toEqual(["🌻", "☕"])
    // Then the categories follow in the same list, like Discord.
    expect(cells()[2]?.textContent).toBe("😀")
  })

  it("ordena os usados com frequência pela contagem, não pela hora", () => {
    const agora = Date.now()
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        chosen: true,
        emojiUsos: [
          { e: "☕", n: 1, t: agora },
          { e: "🌻", n: 7, t: agora - 1000 },
        ],
      }),
    )
    open()
    expect(cells().slice(0, 2).map((cell) => cell.textContent)).toEqual(["🌻", "☕"])
  })

  it("mostra um usado que o catálogo já não conheça, em vez de o perder", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, emojiRecents: ["🫥"] }))
    open()
    expect(cells()[0]?.textContent).toBe("🫥")
  })

  it("ignora usados que não sejam emojis credíveis", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ chosen: true, emojiRecents: ["🌻", 7, "", "uma frase inteira que não é um emoji"] }),
    )
    open()
    expect(cells().slice(0, 2).map((cell) => cell.textContent)).toEqual(["🌻", "😀"])
  })

  it("só desenha as linhas à vista: o catálogo tem 1870 emojis e o DOM pouco mais de cem", () => {
    open()
    expect(cells().length).toBeGreaterThan(40)
    expect(cells().length).toBeLessThan(160)
    expect(screen.getByText("Rostos")).toBeTruthy()
  })

  // Keys always go to the focused element: the grid is a <div>, and clicking it
  // would move focus to the card, which is what `user.type` does.
  it("anda pela grelha com as setas, em linha e em coluna", async () => {
    const user = userEvent.setup()
    open()
    const at = (i: number): HTMLElement | null => document.querySelector(`button[data-i="${i}"]`)

    await user.keyboard("{ArrowDown}") // From search to grid.
    expect(document.activeElement).toBe(at(0))

    await user.keyboard("{ArrowRight}")
    expect(document.activeElement).toBe(at(1))

    // One row below is eight cells, the same as the stylesheet draws.
    await user.keyboard("{ArrowDown}")
    expect(document.activeElement).toBe(at(9))

    await user.keyboard("{ArrowUp}")
    expect(document.activeElement).toBe(at(1))

    // The end of the whole catalog: drawn on demand, and focused.
    await user.keyboard("{End}")
    expect(document.activeElement?.getAttribute("data-i")).toBe("1869")

    await user.keyboard("{Home}")
    expect(document.activeElement).toBe(at(0))
  })

  it("desce de uma categoria para a seguinte, na mesma coluna ou na última da linha curta", async () => {
    const user = userEvent.setup()
    open()
    // "Rostos" has 166 emojis: its last row has 6 (160 to 165). The next section starts at 166.
    await user.keyboard("{ArrowDown}")
    for (let i = 0; i < 20; i++) await user.keyboard("{ArrowDown}")
    expect(document.activeElement?.getAttribute("data-i")).toBe("160")
    await user.keyboard("{ArrowDown}")
    expect(document.activeElement?.getAttribute("data-i")).toBe("166")
    for (let i = 0; i < 7; i++) await user.keyboard("{ArrowRight}")
    expect(document.activeElement?.getAttribute("data-i")).toBe("173")
    await user.keyboard("{ArrowUp}")
    // Column 7 does not exist in the short row above: the last cell of that row.
    expect(document.activeElement?.getAttribute("data-i")).toBe("165")
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe("Rostos")
  })

  it("pára nos extremos em vez de dar a volta", async () => {
    const user = userEvent.setup()
    open()

    await user.keyboard("{ArrowDown}")
    await user.keyboard("{ArrowLeft}")
    expect(document.activeElement?.getAttribute("data-i")).toBe("0")

    await user.keyboard("{End}")
    await user.keyboard("{ArrowRight}")
    expect(document.activeElement?.getAttribute("data-i")).toBe("1869")
  })

  it("escolhe o tom de pele, guarda-o, e mostra e entrega o emoji nesse tom", async () => {
    const user = userEvent.setup()
    const { onPick } = open()
    await user.click(screen.getByLabelText(strings.emoji.tom(strings.emoji.tons[0] ?? "")))
    await user.click(screen.getByRole("radio", { name: strings.emoji.tons[3] ?? "" }))
    expect(readPrefs().tomDePele).toBe(3)
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "polegar para cima")
    expect(cells()[0]?.textContent).toBe("👍🏽")
    await user.click(cells()[0] as HTMLElement)
    expect(onPick).toHaveBeenCalledWith("👍🏽")
    expect(readPrefs().emojiUsos[0]?.e).toBe("👍🏽")
  })

  it("o tom não toca no que não o leva", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, tomDePele: 5 }))
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol")
    expect(cells()[0]?.textContent).toBe("🌻")
  })

  it("a aba da categoria salta para ela e fica marcada", async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole("button", { name: "Bandeiras" }))
    expect(screen.getByRole("button", { name: "Bandeiras" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "Rostos" }).getAttribute("aria-pressed")).toBe("false")
    expect(cells().some((cell) => cell.textContent === "🏁")).toBe(true)
    expect(cells().some((cell) => cell.textContent === "😀")).toBe(false)
  })

  it("deixa só uma casa alcançável pelo Tab", () => {
    open()
    const tabbable = cells().filter((cell) => cell.getAttribute("tabindex") === "0")
    expect(tabbable.length).toBe(1)
  })

  it("escolhe o primeiro resultado com Enter na pesquisa", async () => {
    const user = userEvent.setup()
    const { onPick } = open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol{Enter}")
    expect(onPick).toHaveBeenCalledWith("🌻")
  })

  it("troca de categoria e larga a pesquisa a meio", async () => {
    const user = userEvent.setup()
    open()
    await user.type(screen.getByLabelText(strings.emoji.searchLabel), "girassol")
    await user.click(screen.getByRole("button", { name: "Comida e bebida" }))
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe("Comida e bebida")
    expect(screen.getByRole("button", { name: "Comida e bebida" }).getAttribute("aria-pressed")).toBe("true")
    expect((screen.getByLabelText(strings.emoji.searchLabel) as HTMLInputElement).value).toBe("")
  })

  it("fecha com Escape e pelo botão, sem escolher nada", async () => {
    const user = userEvent.setup()
    const { onPick, onClose } = open()
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalled()

    await user.click(screen.getByText(strings.emoji.close))
    expect(onPick).not.toHaveBeenCalled()
  })
})
