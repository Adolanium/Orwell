/**
 * The communities icon (`ChatIcon`, in the rail) fits its 24x24 box.
 *
 * Its arcs had radii too small for their end points: the browser scales such
 * an arc up until it fits (SVG 1.1, F.6.6), and the stretched arc bulged past
 * the left edge of the viewBox, where it was cut off, and left a step at the
 * top. jsdom has no geometry, so this measures in Chromium: the path's box,
 * plus half the 1.7 stroke, must lie inside 0..24.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { chromium, type Browser } from "playwright"
import { ChatIcon } from "./icons.js"

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

describe("o ícone das comunidades", () => {
  it("cabe na caixa de 24, com metade do traço", async () => {
    const page = await browser.newPage()
    try {
      await page.setContent(`<!doctype html><body>${renderToStaticMarkup(<ChatIcon size={24} />)}</body>`)
      const caixa = await page.evaluate(() => {
        const b = document.querySelector("svg path") as SVGPathElement
        const r = b.getBBox()
        return { x: r.x, y: r.y, direita: r.x + r.width, fundo: r.y + r.height }
      })
      const meio = 1.7 / 2
      expect(caixa.x - meio).toBeGreaterThanOrEqual(0)
      expect(caixa.y - meio).toBeGreaterThanOrEqual(0)
      expect(caixa.direita + meio).toBeLessThanOrEqual(24)
      expect(caixa.fundo + meio).toBeLessThanOrEqual(24)
    } finally {
      await page.close()
    }
  }, 30_000)
})
