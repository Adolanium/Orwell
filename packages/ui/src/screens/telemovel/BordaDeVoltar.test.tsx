import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { useRef } from "react"
import { BordaDeVoltar, LARGURA_DA_BORDA } from "./BordaDeVoltar.js"
import { arrastar, ponteiro } from "../../testes/ponteiro.js"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * The swipe from the left edge goes back (option B, 20/11/2026), like the
 * back arrow and the browser button. It follows the finger: the screen moves
 * under it while it is down, and only then decides.
 */
function Ecra({ onVoltar }: { onVoltar: () => void }): React.JSX.Element {
  const ecra = useRef<HTMLDivElement>(null)
  return (
    <div ref={ecra} data-testid="ecra" style={{ width: 390 }}>
      <BordaDeVoltar alvo={ecra} onVoltar={onVoltar} />
      <pre data-testid="codigo">a long line of code that scrolls sideways</pre>
    </div>
  )
}

const borda = (): HTMLElement => screen.getByTestId("borda-de-voltar")

describe("BordaDeVoltar", () => {
  it("is a strip at the left edge, at least as wide as a thumb's edge", () => {
    render(<Ecra onVoltar={() => {}} />)
    expect(LARGURA_DA_BORDA).toBeGreaterThanOrEqual(16)
    expect(borda().getAttribute("aria-hidden")).toBe("true")
  })

  it("a swipe to the right goes back", () => {
    const onVoltar = vi.fn()
    render(<Ecra onVoltar={onVoltar} />)
    arrastar(borda(), { x: 4, y: 400 }, { x: 260, y: 410 })
    expect(onVoltar).toHaveBeenCalledOnce()
  })

  it("the screen follows the finger while it is down", () => {
    render(<Ecra onVoltar={() => {}} />)
    ponteiro(borda(), "pointerdown", { clientX: 4, clientY: 400 })
    ponteiro(borda(), "pointermove", { clientX: 30, clientY: 401 })
    ponteiro(borda(), "pointermove", { clientX: 104, clientY: 402 })
    expect(screen.getByTestId("ecra").style.transform).toBe("translateX(100px)")
  })

  it("a short swipe does not go back, and the screen returns to its place", () => {
    const onVoltar = vi.fn()
    render(<Ecra onVoltar={onVoltar} />)
    // Slow and short: 40 px over 5 steps with no time between is still fast, so
    // the distance alone must stay under the line.
    ponteiro(borda(), "pointerdown", { clientX: 4, clientY: 400 })
    ponteiro(borda(), "pointermove", { clientX: 20, clientY: 400 })
    ponteiro(borda(), "pointermove", { clientX: 30, clientY: 400 })
    ponteiro(borda(), "pointerup", { clientX: 30, clientY: 400 })
    expect(onVoltar).not.toHaveBeenCalled()
    expect(screen.getByTestId("ecra").style.transform).toBe("")
  })

  it("a finger that goes down the edge is a scroll, not a back", () => {
    const onVoltar = vi.fn()
    render(<Ecra onVoltar={onVoltar} />)
    arrastar(borda(), { x: 4, y: 200 }, { x: 40, y: 600 })
    expect(onVoltar).not.toHaveBeenCalled()
    expect(screen.getByTestId("ecra").style.transform).toBe("")
  })

  it("the mouse does not swipe: a computer has the arrow", () => {
    const onVoltar = vi.fn()
    render(<Ecra onVoltar={onVoltar} />)
    arrastar(borda(), { x: 4, y: 400 }, { x: 300, y: 400 }, 5, "mouse")
    expect(onVoltar).not.toHaveBeenCalled()
  })

  it("a sideways swipe inside the conversation (a code block, a gallery) is not a back", () => {
    const onVoltar = vi.fn()
    render(<Ecra onVoltar={onVoltar} />)
    arrastar(screen.getByTestId("codigo"), { x: 120, y: 400 }, { x: 380, y: 400 })
    expect(onVoltar).not.toHaveBeenCalled()
  })

  it("a lifted pointer that the browser took (pointercancel) puts the screen back", () => {
    const onVoltar = vi.fn()
    render(<Ecra onVoltar={onVoltar} />)
    ponteiro(borda(), "pointerdown", { clientX: 4, clientY: 400 })
    ponteiro(borda(), "pointermove", { clientX: 150, clientY: 400 })
    ponteiro(borda(), "pointercancel", { clientX: 150, clientY: 400 })
    expect(onVoltar).not.toHaveBeenCalled()
    expect(screen.getByTestId("ecra").style.transform).toBe("")
  })

  it("with reduced motion the screen still moves and still goes back (slower, never stopped)", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((consulta: string) => ({
        matches: consulta.includes("reduced-motion"),
        media: consulta,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    )
    const onVoltar = vi.fn()
    render(<Ecra onVoltar={onVoltar} />)
    ponteiro(borda(), "pointerdown", { clientX: 4, clientY: 400 })
    ponteiro(borda(), "pointermove", { clientX: 60, clientY: 400 })
    expect(screen.getByTestId("ecra").style.transform).toBe("translateX(56px)")
    ponteiro(borda(), "pointermove", { clientX: 280, clientY: 400 })
    ponteiro(borda(), "pointerup", { clientX: 280, clientY: 400 })
    expect(onVoltar).toHaveBeenCalledOnce()
  })
})
