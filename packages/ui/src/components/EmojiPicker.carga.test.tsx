import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { EmojiPicker } from "./EmojiPicker.js"
import { PREFS_KEY } from "../hooks/usePrefs.js"
import { strings } from "../strings.js"

// Own file: the catalog loads once per module, and here it must start unloaded.
beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe("EmojiPicker: first open loads the catalog", () => {
  it("abre já, com as abas e os recentes pelo glifo, e enche a grelha quando o catálogo chega", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ emojiRecents: ["🌻"] }))
    render(<EmojiPicker onPick={vi.fn()} onClose={vi.fn()} />)

    // Immediately: dialog, search box and tabs are there; the recent shows by its glyph.
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByLabelText(strings.emoji.categorias.bandeiras)).toBeTruthy()
    expect(within(screen.getByRole("group")).getByText("🌻").getAttribute("aria-label")).toBe("🌻")
    expect(screen.queryByText(strings.emoji.noResults)).toBeNull()

    // Then the catalog arrives and the same recent gets its Portuguese name.
    await waitFor(() => expect(within(screen.getByRole("group")).getByText("🌻").getAttribute("aria-label")).toBe("girassol"))
  })
})
