/**
 * Look at the demo (`demo-servidor.mjs` + `demo-semear.mjs`) the way its owner does: a clean
 * browser, "Importar conta" with `ana.json`, then the community, its rooms, the polls page and
 * the composer menu. Screenshots in `capturas/demo-*.png`.
 *
 *   node scripts/demo-verificar.mjs [frente=8492]
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { irParaONome } from "./fase7-comum.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const PORTA = process.argv[2] ?? "8492"
const OUT = (n) => join(RAIZ, `capturas/demo-${n}.png`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await chromium.launch()
const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.on("pageerror", (e) => console.log("pageerror:", e.message))
await page.goto(`http://127.0.0.1:${PORTA}/app/?lingua=pt`, { waitUntil: "domcontentloaded" })
await irParaONome(page)
await page.locator('.import-account input[type="file"]').setInputFiles(join(RAIZ, ".dev-data/demo-votacoes/contas/ana.json"))
await page.locator('input[name="import-password"]').fill("demo-orwell-2026")
await page.getByRole("button", { name: "Importar", exact: true }).click()
await page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
await wait(8000)
console.log("canais:", await page.locator(".channel-name").allInnerTexts())
const linha = page.locator(".channel-row", { has: page.locator(".channel-name", { hasText: "demo-votacoes" }) }).first()
console.log("tem a comunidade:", (await linha.count()) === 1)
await linha.click()
await wait(5000)
await page.screenshot({ path: OUT("01-sala-principal") })
console.log("imagens na sala principal:", await page.locator(".message img").count(), "| votações no chat:", await page.locator(".votacao-pergunta").count())
console.log("linha «Votações» visível na barra:", await page.locator(".room-votacoes").isVisible())
await page.screenshot({ path: OUT("02-barra-com-votacoes") })
await page.locator(".room-votacoes").click()
await wait(2500)
await page.screenshot({ path: OUT("03-sala-de-votacoes-abertas") })
console.log("abertas:", await page.locator(".votacoes-pagina-cartao .votacao-pergunta").allInnerTexts(), "| caixa de escrita:", await page.locator('input[placeholder="Escreve uma mensagem"]').count())
await page.getByRole("tab", { name: /Fechadas/ }).click()
await wait(500)
await page.screenshot({ path: OUT("04-sala-de-votacoes-fechadas") })
console.log("fechadas:", await page.locator(".votacoes-pagina-cartao .votacao-pergunta").allInnerTexts())
await linha.click({ button: "right" })
await wait(500)
console.log("menu da comunidade:", await page.getByRole("menuitem").allInnerTexts())
await page.keyboard.press("Escape")
await page.locator(".room-tree .room-name").first().click()
await wait(800)
await page.getByRole("button", { name: "Anexar ou abanar" }).click()
await wait(500)
console.log("menu do + (sem «Criar votação»):", await page.getByRole("menuitem").allInnerTexts())
await page.screenshot({ path: OUT("05-caixa-de-escrita-menu") })
await page.keyboard.press("Escape")
// The phone: the drawer shows the same row.
await page.setViewportSize({ width: 390, height: 844 })
await wait(800)
await page.getByRole("button", { name: "Abrir o painel lateral" }).click()
await wait(600)
console.log("no telemóvel, linha visível:", await page.locator(".room-votacoes").isVisible())
await page.screenshot({ path: OUT("06-telemovel-gaveta") })
await page.locator(".room-votacoes").click()
await wait(1200)
await page.screenshot({ path: OUT("07-telemovel-sala-de-votacoes") })
await b.close()
