/**
 * The desktop splash in both themes, at the download phase, as PNG.
 *
 *   npx tsx scripts/retratar-arranque-tema.mts
 *
 * Saves `capturas/tema-claro/arranque/arranque-<tema>.png`.
 */
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { codigoDoEstado, htmlDoArranque } from "../apps/client/src/main/ecra-de-arranque.js"

const SAIDA = join(dirname(fileURLToPath(import.meta.url)), "../capturas/tema-claro/arranque")
mkdirSync(SAIDA, { recursive: true })
const browser = await chromium.launch()
for (const tema of ["escuro", "claro"] as const) {
  const page = await browser.newPage({ viewport: { width: 320, height: 400 }, deviceScaleFactor: 2 })
  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDoArranque(tema))}`)
  await page.evaluate(codigoDoEstado({ fase: "a-descarregar", versao: "1.3.19", recebidos: 40e6, total: 100e6 }))
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(SAIDA, `arranque-${tema}.png`) })
  await page.close()
}
await browser.close()
console.log(`capturas em ${SAIDA}`)
