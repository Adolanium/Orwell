/**
 * The official badge and visibility by category, in a real Chrome.
 *
 * Against a LOCAL server (8449) and local vite (5175), never production. The
 * common channel is what gives the official status, so the server starts with
 * `ENCLAVE_COMMON_ROOM=orwell` and that is where the badge appears.
 *
 * Takes screenshots at 390 pixels wide and at 1280, because the two widths break
 * in different ways: the narrow one overflows, the wide one hides.
 */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"
import { escolherComunidade, noTelemovel } from "./separadores.mjs"

const WEB = comLingua(process.env.ORWELL_WEB ?? "http://127.0.0.1:5175")
const SERVIDOR = process.env.ORWELL_HOME ?? "localhost:8449"
const FRASE = "verificacao-selo-2026"
const MARCA = Date.now().toString(36)
const SAIDA = new URL("../.dev-data/retratos", import.meta.url).pathname
mkdirSync(SAIDA, { recursive: true })

const largura = Number(process.env.ORWELL_LARGURA ?? 1280)
const altura = Number(process.env.ORWELL_ALTURA ?? 900)

/**
 * Disposable profile, not a folder of ours.
 *
 * A folder chosen by hand inside the repository makes Chrome refuse IndexedDB,  * "Internal error opening backing store", and the app never reaches the account
 * creation screen. The vault lives in IndexedDB, so without it there is nothing
 * to see. An empty string gives a temporary profile that Chrome accepts.
 */
const ctx = await chromium.launchPersistentContext("", {
  headless: true,
  viewport: { width: largura, height: altura },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const erros = []
page.on("console", (m) => {
  if (m.type() === "error") erros.push(m.text().slice(0, 200))
})
page.on("pageerror", (e) => erros.push(`PAGEERROR: ${String(e.message).slice(0, 200)}`))

await page.goto(WEB, { waitUntil: "domcontentloaded" })
// The account creation screen only appears after the vault is probed, and the
// splash stays on screen until then. Poll in a loop instead of waiting for a
// number: in a fresh profile folder startup is much slower than in a reused one.
for (let i = 0; i < 40; i++) {
  if (await page.getByRole("heading", { name: "Bem-vindo ao Orwell" }).count()) break
  await page.waitForTimeout(1000)
}
// If it doesn't appear, show what's on screen. A boot error is silent otherwise, and a timeout that expires tells you nothing.
if (!(await page.getByRole("heading", { name: "Bem-vindo ao Orwell" }).count())) {
  console.log("=== não é o ecrã de criar conta ===")
  console.log((await page.locator("body").innerText()).slice(0, 800))
  console.log("erros:", erros)
  await page.screenshot({ path: `${SAIDA}/arranque.png` })
  await ctx.close()
  process.exit(1)
}

// Create account. The server no longer appears on screen. It gets filled in from where the app was served. The `criarConta` opens advanced settings to change it.
await criarContaEEntrar(page, { nome: `Selo ${MARCA.slice(-3)}`, frase: FRASE, servidor: SERVIDOR })
console.log("conta criada")

/**
 * On a phone (840 px or less, option B) the common room's line lives in the
 * Communities list, with its face chosen on the rail: show it. Without this the
 * seal is not in the DOM (the sidebar lists only the chosen community there).
 * On a computer the sidebar is a column, and there is nothing to do.
 */
async function abrirGaveta() {
  if (!(await noTelemovel(page))) return
  await escolherComunidade(page, /orwell/i, { timeout: 1_000 }).catch(() => {})
}

// Wait for the main channel. It's the only one where the seal appears.
for (let i = 0; i < 40; i++) {
  await abrirGaveta()
  if (await page.locator("button.channel").filter({ hasText: /orwell/i }).count()) break
  await page.waitForTimeout(1000)
}
await abrirGaveta()
const canal = page.locator("button.channel").filter({ hasText: /orwell/i }).first()
console.log("canal comum:", (await canal.count()) ? "sim" : "NAO", "· visível:", await canal.isVisible().catch(() => false))
if (!(await canal.isVisible().catch(() => false))) {
  console.log("botões visíveis:", (await page.getByRole("button").allTextContents()).join(" | ").slice(0, 300))
  await page.screenshot({ path: `${SAIDA}/lista-${largura}.png` })
}
await canal.click()
await page.waitForTimeout(1200)

// ------------------------------------------------------------------- the seal
const selo = page.getByRole("img", { name: "oficial" }).first()
const contagem = await selo.count()
console.log("selos no ecrã:", await page.getByRole("img", { name: "oficial" }).count())
if (contagem) {
  const caixa = await selo.boundingBox()
  const cor = await selo.evaluate((el) => getComputedStyle(el).color)
  const arcos = await selo.evaluate((el) => el.querySelector("path")?.getAttribute("d")?.match(/A/g)?.length ?? 0)
  const titulo = await selo.getAttribute("title")
  console.log("selo:", JSON.stringify({ caixa, cor, arcos, titulo: titulo?.slice(0, 40) }))
}

/**
 * Real overflow: is the document wider than the window?
 *
 * The first version listed everything that crossed the right edge and blamed the
 * drawers. The member panel and sidebar are positioned OFF screen on purpose at
 * narrow widths, moved with transform. What matters is `scrollWidth`: if it
 * equals `clientWidth`, there's no horizontal scrollbar and nothing overflows,
 * no matter what's parked out of view.
 */
const transbordo = await page.evaluate(() => {
  const doc = document.documentElement
  return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, transborda: doc.scrollWidth > doc.clientWidth }
})
console.log("transbordo:", JSON.stringify(transbordo))

await page.screenshot({ path: `${SAIDA}/canal-${largura}.png` })
console.log("retrato:", `${SAIDA}/canal-${largura}.png`)

// The seal enlarged, to see the design.
if (contagem) {
  await selo.screenshot({ path: `${SAIDA}/selo-${largura}.png` }).catch(() => {})
}

console.log("erros de consola:", erros.length ? erros : "nenhum")
await ctx.close()
