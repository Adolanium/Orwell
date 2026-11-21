import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { CallChip } from "./CallChip.js"

afterEach(cleanup)

/**
 * The call card's voice wave (1.3.26). It sat in the top-right corner, under
 * the "⋯", by absolute position. Now it lives in the label, in a row with the
 * name, and the corner is the "⋯"'s alone. The boxes are measured in a real
 * browser by `scripts/measure-call-card.mjs`; this pins the structure.
 */
describe("the call card's voice wave", () => {
  it("is in the label, in the name's row, never a direct child of the card", () => {
    const { container } = render(<CallChip label="Ana" profile={undefined} texto="connected" onMenu={() => {}} />)
    const card = container.querySelector(".call-chip") as HTMLElement
    const onda = card.querySelector(".call-chip-onda") as HTMLElement
    expect(onda).not.toBeNull()
    expect(onda.parentElement?.classList.contains("call-chip-name-row")).toBe(true)
    expect(onda.closest(".call-chip-labels")).not.toBeNull()
    expect(onda.previousElementSibling?.classList.contains("call-chip-name")).toBe(true)
    expect(card.querySelector(":scope > .call-chip-onda")).toBeNull()
    // The corner is the "⋯"'s: a direct child of the card, outside the label.
    expect(card.querySelector(":scope > .call-chip-mais")).not.toBeNull()
  })

  it("is not drawn with the microphone off", () => {
    const { container } = render(<CallChip label="Rui" profile={undefined} texto="connected" micCalado onMenu={() => {}} />)
    expect(container.querySelector(".call-chip-onda")).toBeNull()
    expect(container.querySelector(".call-chip-name")?.textContent).toBe("Rui")
  })
})
