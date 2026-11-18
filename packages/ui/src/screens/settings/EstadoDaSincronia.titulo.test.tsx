import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { chromium, type Browser } from "playwright"
import { strings } from "../../strings.js"

/**
 * "Igual aos outros membros", in Help and diagnostics, is a heading inside a
 * settings card: no larger than the card's own title, and with air before the
 * note below it. It is an `h3` the sheets never styled: the browser drew it at
 * 18.7 px, bigger than the card title (14 px), touching the note. Measured in
 * Chromium with the app's sheets, in the three themes. The markup is the one
 * `EstadoDaSincronia` draws (it renders nothing until the bridge answers).
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
function folhas(): string {
  // On Aurora the document also holds `styles-aurora.css`, after the main sheet
  // (`folha-da-aurora.ts`); its rules only match under that theme.
  const entrada = readFileSync(join(AQUI, "../../styles.css"), "utf8") + readFileSync(join(AQUI, "../../styles-aurora.css"), "utf8")
  return [...entrada.matchAll(/@import "\.\/styles\/([A-Za-z.]+)\.css"/g)]
    .map((m) => readFileSync(join(AQUI, `../../styles/${m[1]}.css`), "utf8"))
    .join("\n")
}

let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
}, 60_000)
afterAll(async () => {
  await browser?.close()
})

describe("o título da sincronia, em Ajuda e diagnóstico", () => {
  it.each(["escuro", "claro", "aurora"])("no tema %s, não é maior do que o título do cartão e não toca na nota", async (tema) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 800 } })
    try {
      await page.setContent(
        `<!doctype html><html data-theme="${tema}"><head><style>${folhas()}</style></head><body><div style="padding:16px">` +
          `<section class="card settings-card"><h2>${strings.settings.ajuda}</h2>` +
          `<div class="estado-sincronia"><h3>${strings.sincronia.titulo}</h3><p class="field-note">${strings.sincronia.nota}</p></div>` +
          `</section></div></body></html>`,
      )
      const m = await page.evaluate(() => {
        const h2 = document.querySelector("h2")!
        const h3 = document.querySelector(".estado-sincronia h3")!
        const nota = document.querySelector(".estado-sincronia .field-note")!
        return {
          h2: Number.parseFloat(getComputedStyle(h2).fontSize),
          h3: Number.parseFloat(getComputedStyle(h3).fontSize),
          ar: nota.getBoundingClientRect().top - h3.getBoundingClientRect().bottom,
        }
      })
      expect(m.h3).toBeLessThanOrEqual(m.h2)
      expect(m.ar).toBeGreaterThanOrEqual(4)
    } finally {
      await page.close()
    }
  }, 30_000)
})
