/**
 * Captures of the "edited" mark and the day separator (12/11/2026), at 1280
 * and 390 px, on a disposable server (ports 8792 and 8793).
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/capturar-editada-e-dia.mjs
 *
 * The browser clock starts yesterday at 23:58 (Playwright `clock`), so the
 * first message is said yesterday and the next ones today, after midnight.
 * A message that writes "(editada)" in its text sits next to a real edit.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { criarCanal, dentro, dizer, espera, ouviu, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const CAPTURAS = join(RAIZ, ".verify-data/editada-e-dia")
mkdirSync(CAPTURAS, { recursive: true })
const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8792, servidor: 8793, sfu: 0, etiqueta: "editada-e-dia" })
const browser = await chromium.launch({ headless: true })
try {
  const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  const ontem = new Date()
  ontem.setDate(ontem.getDate() - 1)
  ontem.setHours(23, 58, 0, 0)
  await page.clock.install({ time: ontem })
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome: "Ana", servidor: srv.NOME })
  await dentro(page)
  await criarCanal(page, "lagar")
  await dizer(page, "Ontem, antes da meia-noite")
  check("a primeira mensagem sai", (await ouviu(page, "Ontem, antes da meia-noite")) >= 0)
  await page.clock.fastForward("05:00")
  await dizer(page, "Hoje, depois da meia-noite")
  await dizer(page, "Esta escreve (editada) no texto")
  await dizer(page, "Esta vai ser corrigda")
  await ouviu(page, "Esta vai ser corrigda")
  const linha = page.locator(".message").filter({ hasText: "corrigda" }).first()
  await linha.click({ button: "right" })
  await page.locator(".context-menu").getByRole("menuitem", { name: "Editar" }).click()
  await page.locator(".sheet input").first().fill("Esta vai ser corrigida")
  await page.locator(".sheet button[type=submit]").click()
  await ouviu(page, "Esta vai ser corrigida")
  await espera(500)
  const dias = await page.locator(".timeline-dia").allInnerTexts()
  console.log("   separadores:", JSON.stringify(dias))
  check("dois separadores, ontem e hoje", dias.length === 2)
  check("a marca de editada está numa linha própria", (await page.locator(".message-editada").count()) === 1)
  check("o texto (editada) escrito à mão não ganha a marca", (await page.locator(".message").filter({ hasText: "escreve (editada)" }).locator(".message-editada").count()) === 0)
  await page.screenshot({ path: join(CAPTURAS, "editada-e-dia-1280.png") })
  await page.setViewportSize({ width: 390, height: 844 })
  await espera(500)
  await page.screenshot({ path: join(CAPTURAS, "editada-e-dia-390.png") })
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}
await browser.close().catch(() => {})
srv.fechar()
process.exit(resumo() ? 0 : 1)
