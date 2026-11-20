import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode, useState } from "react"
import { Composer } from "./Composer.js"
import type { EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import { strings } from "../../strings.js"

/**
 * Shift+Enter starts a new line (20/11/2026, the owner).
 *
 * The box is a text area that grows with the text. On a keyboard, Enter
 * sends and Shift+Enter starts a new line. With a finger (the phone's virtual
 * keyboard), Enter starts a new line and the send button sends, like Discord.
 */

const bridge = { social: { linkPreview: vi.fn().mockRejectedValue(new Error("não")) } } as unknown as EnclaveBridge
const matchMediaOriginal = window.matchMedia

afterEach(() => {
  cleanup()
  window.matchMedia = matchMediaOriginal
})

/** A finger, not a mouse: `(hover: none) and (pointer: coarse)` matches. */
function comDedo(): void {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes("pointer: coarse"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia
}

function Harness({ onSend, initial = "" }: { onSend: (body: string) => void; initial?: string }): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <StrictMode>
      <BridgeContext.Provider value={bridge}>
        <Composer connection="online" value={value} onChange={setValue} onSend={onSend} />
      </BridgeContext.Provider>
    </StrictMode>
  )
}

const caixa = (): HTMLTextAreaElement => screen.getByPlaceholderText(strings.chat.composerPlaceholder) as HTMLTextAreaElement

describe("a caixa de escrita com várias linhas", () => {
  it("é uma área de texto de uma linha", () => {
    render(<Harness onSend={vi.fn()} />)
    expect(caixa().tagName).toBe("TEXTAREA")
    expect(caixa().getAttribute("rows")).toBe("1")
  })

  it("Enter envia, como sempre", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await user.type(caixa(), "olá{Enter}")
    expect(onSend).toHaveBeenCalledWith("olá")
    expect(caixa().value).toBe("")
  })

  it("Shift+Enter muda de linha e não envia", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await user.type(caixa(), "primeira{Shift>}{Enter}{/Shift}segunda")
    expect(onSend).not.toHaveBeenCalled()
    expect(caixa().value).toBe("primeira\nsegunda")
  })

  it("a mensagem sai com as quebras de linha", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await user.type(caixa(), "primeira{Shift>}{Enter}{/Shift}segunda{Enter}")
    expect(onSend).toHaveBeenCalledWith("primeira\nsegunda")
  })

  it("Enter a meio de uma composição (IME) não envia", () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} initial="かな" />)
    fireEvent.keyDown(caixa(), { key: "Enter", isComposing: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it("com o dedo, Enter muda de linha e o botão envia", async () => {
    comDedo()
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    await user.type(caixa(), "primeira{Enter}segunda")
    expect(onSend).not.toHaveBeenCalled()
    expect(caixa().value).toBe("primeira\nsegunda")
    await user.click(screen.getByRole("button", { name: strings.chat.send }))
    expect(onSend).toHaveBeenCalledWith("primeira\nsegunda")
  })
})

/**
 * Empty, the box is one line, even when the placeholder would wrap (measured
 * live at 390 px: "Escreve uma mensagem" took two lines, and the empty box
 * stayed two lines tall after sending). jsdom has no layout: the text area's
 * `scrollHeight` is faked here, two lines whatever the text.
 */
describe("a caixa vazia", () => {
  it("fica com uma linha, mesmo que o texto de exemplo não caiba", () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight")
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", { configurable: true, get: () => 60 })
    try {
      render(<Harness onSend={vi.fn()} />)
      expect(caixa().style.height).toBe("")
    } finally {
      delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>)["scrollHeight"]
      if (!original) delete (HTMLElement.prototype as unknown as Record<string, unknown>)["scrollHeight"]
    }
  })

  it("o texto de exemplo não muda de linha", () => {
    const folha = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../styles/caixaDeEscrita.css"), "utf8")
    expect(folha).toMatch(/\.composer-line > textarea::placeholder\s*\{[^}]*white-space:\s*nowrap/)
  })
})
