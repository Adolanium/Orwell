import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { chromium, type Browser } from "playwright"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { Button } from "../../components/Button.js"
import { SincronizarConta } from "./SincronizarConta.js"

/**
 * "Sincronizar conta" lines up with the other buttons of the settings cards.
 *
 * Since the restyle every action in a settings card fills the card's width
 * (the card is a column that stretches its children: "Editar perfil",
 * "Comunicar um erro", "Ver como funciona"). This one sits inside its own
 * wrapper (`.reparacao`, with the note and the result below it), which
 * aligned its children to the start: the button shrank to its text and sat
 * apart from every other button on the page. Measured in Chromium, with the
 * app's real sheets: jsdom has no layout.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
function folhas(): string {
  const entrada = readFileSync(join(AQUI, "../../styles.css"), "utf8")
  return [...entrada.matchAll(/@import "\.\/styles\/([A-Za-z]+)\.css"/g)]
    .map((m) => readFileSync(join(AQUI, `../../styles/${m[1]}.css`), "utf8"))
    .join("\n")
}

const bridge = { social: {}, channels: {} } as unknown as EnclaveBridge

let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
}, 60_000)
afterAll(async () => {
  await browser?.close()
})

describe("Sincronizar conta, nas definições", () => {
  it.each([1440, 390])("a %ipx, o botão tem a largura e a margem dos outros botões do cartão", async (largura) => {
    const html = renderToStaticMarkup(
      <BridgeContext.Provider value={bridge}>
        <section className="card settings-card">
          <h2>Ajuda e diagnóstico</h2>
          <SincronizarConta connection="online" />
          <Button variant="ghost" onClick={() => {}}>
            Comunicar um erro
          </Button>
        </section>
      </BridgeContext.Provider>,
    )
    const page = await browser.newPage({ viewport: { width: largura, height: 800 } })
    try {
      await page.setContent(`<!doctype html><html><head><style>${folhas()}</style></head><body><div style="padding:16px">${html}</div></body></html>`)
      const [sincronizar, outro] = await page.evaluate(() =>
        [...document.querySelectorAll(".settings-card button")].map((b) => {
          const r = b.getBoundingClientRect()
          return { esquerda: Math.round(r.left), largura: Math.round(r.width) }
        }),
      )
      expect(sincronizar).toEqual(outro)
    } finally {
      await page.close()
    }
  }, 30_000)
})
