import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { BlockedButton, TIP_OPEN_MS } from "./BlockedButton.js"

const larguraOriginal = window.innerWidth
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Object.defineProperty(window, "innerWidth", { configurable: true, value: larguraOriginal })
})

const TIP = "Criaste 5 canais. Uma conta não pode criar mais."
const AQUI = dirname(fileURLToPath(import.meta.url))
const css = (nome: string) => readFileSync(join(AQUI, "../styles", nome), "utf8")

function montar() {
  render(
    <BlockedButton className="header-add" tip={TIP} label="Criar canal" side="below-end">
      +
    </BlockedButton>,
  )
  return screen.getByRole("button", { name: "Criar canal" })
}

describe("BlockedButton", () => {
  it("stays a button, takes focus, and is aria-disabled, not disabled", () => {
    const botao = montar()
    expect(botao.getAttribute("aria-disabled")).toBe("true")
    expect(botao.hasAttribute("disabled")).toBe(false)
    botao.focus()
    expect(document.activeElement).toBe(botao)
    expect(botao.className).toContain("no-tecto")
  })

  it("the reason is its description, for screen readers", () => {
    const botao = montar()
    const id = botao.getAttribute("aria-describedby")
    expect(id).toBeTruthy()
    expect(document.getElementById(id as string)?.textContent).toBe(TIP)
  })

  it("hover and keyboard focus: the existing tooltip shows the reason (data-tip, :hover and :focus-visible)", () => {
    const botao = montar()
    expect(botao.getAttribute("data-tip")).toBe(TIP)
    expect(botao.getAttribute("data-tip-side")).toBe("below-end")
    const regras = css("components.css")
    expect(regras).toMatch(/\[data-tip\]:hover::after/)
    expect(regras).toMatch(/\[data-tip\]:focus-visible::after/)
  })

  const bolha = () => document.body.querySelector(".dica-tocada")

  it("a tap opens the reason in a bubble, another tap closes it, and it closes on its own", () => {
    vi.useFakeTimers()
    const botao = montar()
    fireEvent.click(botao)
    expect(bolha()?.textContent).toBe(TIP)
    // The bubble is fixed to the window, outside the column that would clip it.
    expect(bolha()?.parentElement).toBe(document.body)
    fireEvent.click(botao)
    expect(bolha()).toBeNull()
    fireEvent.click(botao)
    act(() => {
      vi.advanceTimersByTime(TIP_OPEN_MS + 10)
    })
    expect(bolha()).toBeNull()
  })

  it("the bubble stays inside a narrow window", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 })
    const botao = montar()
    botao.getBoundingClientRect = () => ({ left: 370, right: 390, top: 0, bottom: 20, width: 20, height: 20, x: 370, y: 0, toJSON: () => ({}) })
    fireEvent.click(botao)
    const estilo = (bolha() as HTMLElement).style
    expect(Number.parseFloat(estilo.left) + Number.parseFloat(estilo.maxWidth)).toBeLessThanOrEqual(390 - 8)
    expect(Number.parseFloat(estilo.left)).toBeGreaterThanOrEqual(8)
  })

  it("leaving the button closes the bubble", () => {
    const botao = montar()
    fireEvent.click(botao)
    fireEvent.blur(botao)
    expect(bolha()).toBeNull()
  })

  it("with less motion the tip and the bubble fade slower, they do not stop; the targets are 44 px", () => {
    const base = css("base.css")
    expect(base).toMatch(/\.no-tecto::after,\s*\.no-tecto::before\s*\{\s*transition-duration: 450ms !important;/)
    expect(base).toMatch(/\.dica-tocada\s*\{\s*animation-duration: 450ms !important;/)
    const componentes = css("components.css")
    expect(componentes).toMatch(/\.header-add\.no-tecto\s*\{\s*width: 44px;\s*height: 44px;/)
    expect(componentes).toMatch(/\.category-criar\.no-tecto\s*\{\s*width: 44px;\s*min-height: 44px;/)
    expect(componentes).toMatch(/\.room-new\.no-tecto\s*\{\s*min-height: 44px;/)
  })
})
