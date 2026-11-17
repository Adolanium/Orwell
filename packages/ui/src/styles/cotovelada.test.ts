import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Where the nudge button shows (12/11/2026).
 *
 * In a direct, the line gets its own nudge button with its own icon. On a narrow
 * screen it hides and the "+" menu entry stays: at 390 px the line is the text box
 * and the two everyday buttons, by the choice of 12/08/2026. The reduced
 * motion half of the nudge is in `movimentoReduzido.test.ts`.
 */
// A path, not `new URL(...)`: under jsdom the global `URL` is not the one `fileURLToPath` expects.
const ecras = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "screens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")

describe("o botão da cotovelada na linha", () => {
  it("esconde-se num ecrã estreito", () => {
    expect(ecras).toMatch(/@media \(max-width: 480px\)\s*\{\s*\.composer-line \.composer-buzz\s*\{\s*display:\s*none;\s*\}\s*\}/)
  })
})
