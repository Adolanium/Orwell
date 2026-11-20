import { describe, expect, it, vi } from "vitest"

/**
 * The module loaded from zero, before any host and before the setup file.
 *
 * Its own file because `vi.resetModules()` gives a second copy of `strings.ts`:
 * in `lingua.test.ts` it would split the module the other cases import.
 */
describe("a língua por omissão, com o módulo acabado de carregar", () => {
  it("é o inglês, sem ninguém pedir nada", async () => {
    vi.resetModules()
    const fresco = await import("./strings.js")
    expect(fresco.linguaActual()).toBe("en")
    expect(fresco.strings.menu.leave).toBe("Leave the channel")
    expect(fresco.translateError("vault is locked")).toBe("Error 101\nThe vault is locked.")
  })
})
