/**
 * The phone layout, option B (20/11/2026), at 390 x 844 with a finger, and the
 * computer at 1280 x 900, in the Dark, Light and Aurora themes.
 *
 * One account on a local server. It creates a community with a category and
 * rooms, and then walks the phone: the Communities list (rail of communities
 * and channels), a channel pushed full screen, the members pushed over it,
 * the back arrow, the browser back button, a long press on a room (the menu
 * as a sheet, with "Mover"), the "Tu" tab, Messages and Friends. Each step is
 * measured (boxes, overflow, 44 px targets) and captured for the eye.
 *
 * Local only. It never talks to production.
 *
 *   ORWELL_SERVIDOR=localhost:8471 (a server of your own, see `dev-reiniciar-servidor.sh`)
 *   npm run dev -w @enclave/web -- --port 5191 --strictPort
 *   ORWELL_APP=http://127.0.0.1:5191/app/ ORWELL_SERVIDOR=localhost:8471 node scripts/capturar-telemovel-b.mjs
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua, SERVIDOR } from "./ambiente.mjs"

const APP = comLingua(process.env.ORWELL_APP ?? "http://127.0.0.1:5173/app/")
const MARCA = Date.now().toString(36)
const COMUNIDADE = `Lagar ${MARCA}`
const CAPTURAS = join(".verify-data", "prova-telemovel-b", MARCA)
mkdirSync(CAPTURAS, { recursive: true })

const falhas = []
function verificar(descricao, condicao, extra = "") {
  console.log(`  ${condicao ? "ok  " : "FALHA"}  ${descricao}${extra ? `  ${extra}` : ""}`)
  if (!condicao) falhas.push(descricao)
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()
const erros = []
page.on("pageerror", (e) => erros.push(String(e.message).slice(0, 200)))

const foto = (nome) => page.screenshot({ path: join(CAPTURAS, `${nome}.png`) })
const espera = (ms) => page.waitForTimeout(ms)

/** A long press: the finger lands, stays 700 ms, and lifts. */
async function toqueLongo(locator) {
  const caixa = await locator.boundingBox()
  if (!caixa) throw new Error("sem caixa para o toque longo")
  const ponto = { clientX: caixa.x + caixa.width / 2, clientY: caixa.y + caixa.height / 2, pointerType: "touch", isPrimary: true, bubbles: true }
  await locator.dispatchEvent("pointerdown", ponto)
  await espera(700)
  await locator.dispatchEvent("pointerup", ponto)
  await espera(300)
}

/** No horizontal page scroll, and every visible button at least 44 px on its smaller side. */
async function medir(nota, seletorDosAlvos) {
  const medida = await page.evaluate((seletor) => {
    const raiz = document.documentElement
    const pequenos = [...document.querySelectorAll(seletor)]
      .filter((el) => {
        const caixa = el.getBoundingClientRect()
        return caixa.width > 0 && caixa.height > 0 && getComputedStyle(el).visibility !== "hidden"
      })
      .map((el) => {
        const caixa = el.getBoundingClientRect()
        return { nome: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30), w: Math.round(caixa.width), h: Math.round(caixa.height) }
      })
      .filter((alvo) => Math.min(alvo.w, alvo.h) < 44)
    return { transborda: raiz.scrollWidth - raiz.clientWidth, pequenos }
  }, seletorDosAlvos)
  verificar(`${nota}: a página não rola de lado`, medida.transborda <= 0, `(${medida.transborda})`)
  verificar(`${nota}: alvos de toque com 44 px`, medida.pequenos.length === 0, JSON.stringify(medida.pequenos))
}

await page.goto(APP, { waitUntil: "domcontentloaded" })
await criarContaEEntrar(page, { nome: "Ana", frase: `telemovel-b-${MARCA}`, servidor: SERVIDOR, timeout: 60_000 })
await espera(2500)

verificar("a app está no modo telemóvel", await page.locator(".app.telemovel").count() === 1)
verificar("quatro separadores em baixo", (await page.locator(".separadores .separador").count()) === 4)
verificar("sem o hambúrguer do carril", !(await page.locator(".rail-menu").isVisible().catch(() => false)))

// A community of our own, from the "+" at the end of the rail of communities.
await page.getByRole("button", { name: "Criar canal" }).click()
await page.getByRole("dialog").getByLabel("Nome").fill(COMUNIDADE)
await page.getByRole("dialog").getByLabel("Nome").press("Enter")
await espera(3500)
verificar("a comunidade nova abre a conversa por cima", (await page.locator(".ecra-empurrado").count()) === 1)
await foto("01-comunidade-nova-conversa")
await page.locator(".topbar-voltar").first().click()
await espera(800)

// A category and two rooms, through the community menu (long press on its face).
await toqueLongo(page.locator(`.carril-comunidade[aria-label="${COMUNIDADE}"]`))
const folha = page.locator(".context-menu.context-folha")
verificar("o toque longo na comunidade abre o menu numa folha", (await folha.count()) === 1)
await foto("02-menu-da-comunidade-folha")
await page.getByRole("menuitem", { name: "Nova categoria" }).click()
await page.getByRole("dialog").getByLabel("Nome").fill("Cozinha")
await page.getByRole("dialog").getByLabel("Nome").press("Enter")
await espera(2000)
for (const sala of ["prensa", "barricas"]) {
  await toqueLongo(page.locator(".channel-row").first())
  await page.getByRole("menuitem", { name: "Nova sala" }).click()
  await page.getByRole("dialog").getByLabel("Nome").fill(sala)
  await page.getByRole("dialog").getByLabel("Nome").press("Enter")
  await espera(2000)
  if (await page.locator(".ecra-empurrado").count()) {
    await page.locator(".topbar-voltar").first().click()
    await espera(800)
  }
}
await foto("03-lista-de-comunidades")
await medir("lista de comunidades", ".separador, .carril-comunidade, .sidebar button.room, .sidebar button.channel")

// A channel pushed full screen.
await page.locator("button.room", { hasText: "prensa" }).first().click()
await espera(1200)
const topo = await page.evaluate(() => {
  const t = document.querySelector(".ecra-empurrado .topbar")
  const c = document.querySelector(".ecra-empurrado")?.getBoundingClientRect()
  return {
    seta: Boolean(t?.querySelector(".topbar-voltar")),
    titulo: t?.querySelector("h1")?.textContent,
    comunidade: t?.querySelector(".topbar-comunidade")?.textContent,
    comunidadeVisivel: (() => {
      const el = t?.querySelector(".topbar-comunidade")
      return el ? el.getBoundingClientRect().height > 0 : false
    })(),
    largura: c ? Math.round(c.width) : 0,
    separadores: Boolean(document.querySelector(".separadores")),
  }
})
console.log("  topo:", JSON.stringify(topo))
verificar("a conversa ocupa o ecrã todo", topo.largura === 390)
verificar("seta, canal e comunidade por baixo", topo.seta && topo.titulo === "prensa" && topo.comunidadeVisivel)
verificar("sem separadores na conversa", !topo.separadores)
await foto("04-conversa")
await medir("conversa", ".ecra-empurrado .topbar button, .composer-line button")

// Search, a popover from the header: it fits at 390.
await page.getByRole("button", { name: "Procurar nesta conversa" }).click()
await espera(600)
const procura = await page.evaluate(() => {
  const painel = document.querySelector(".procura-painel, .pinned-panel, [role=dialog]")?.getBoundingClientRect()
  return painel ? { x: Math.round(painel.x), w: Math.round(painel.width) } : null
})
verificar("a procura cabe no ecrã", procura !== null && procura.x >= 0 && procura.x + procura.w <= 390, JSON.stringify(procura))
await foto("04b-procura")
await page.keyboard.press("Escape")
await espera(400)

// Members pushed over the conversation.
await page.getByRole("button", { name: "Membros" }).click()
await espera(800)
const membros = await page.evaluate(() => document.querySelector(".members.open")?.getBoundingClientRect().width ?? 0)
verificar("os membros abrem em ecrã inteiro", Math.round(membros) === 390)
await foto("05-membros")
await page.goBack()
await espera(800)
verificar("o voltar do browser fecha os membros", (await page.locator(".members.open").count()) === 0 && (await page.locator(".ecra-empurrado").count()) === 1)
await page.goBack()
await espera(800)
verificar("o voltar do browser fecha a conversa", (await page.locator(".ecra-empurrado").count()) === 0)

// Long press on a room: the full menu as a sheet, with "Mover".
await toqueLongo(page.locator("button.room", { hasText: "barricas" }).first())
const entradas = await page.locator(".context-folha [role=menuitem]").allTextContents()
console.log("  menu da sala:", JSON.stringify(entradas))
verificar("o menu da sala tem Mover", entradas.some((e) => e.startsWith("Mover")))
await foto("06-menu-da-sala-folha")
await page.mouse.click(195, 100)
await espera(500)

// "Tu", Messages, Friends.
for (const [separador, nome] of [["Tu", "07-tu"], ["Mensagens", "08-mensagens"], ["Amigos", "09-amigos"]]) {
  await page.locator(".separadores").getByRole("button", { name: separador }).click()
  await espera(1000)
  await foto(nome)
  await medir(separador, ".separador, .menu-do-tu-entrada, .people-tab")
}
await page.locator(".separadores").getByRole("button", { name: "Tu" }).click()
await espera(600)
await page.locator(".menu-do-tu .me-faixa").getByRole("button", { name: /Notificações|notificações/ }).first().click()
await espera(800)
const sino = await page.evaluate(() => {
  const painel = document.querySelector(".notif-janela, .notif-panel")?.getBoundingClientRect()
  return painel ? { x: Math.round(painel.x), w: Math.round(painel.width), y: Math.round(painel.y), h: Math.round(painel.height) } : null
})
verificar("as notificações cabem no ecrã", sino !== null && sino.x >= 0 && sino.x + sino.w <= 390 && sino.y >= 0, JSON.stringify(sino))
await foto("07b-notificacoes")
await page.keyboard.press("Escape")
await espera(400)
await page.locator(".menu-do-tu-entrada", { hasText: "Configurações" }).click()
await espera(800)
verificar("Configurações abre por cima, com a barra Voltar", (await page.locator(".barra-do-telemovel").count()) === 1)
await foto("10-configuracoes")

// The themes, at 390.
for (const tema of ["claro", "aurora"]) {
  await page.evaluate((t) => {
    const actual = JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}") ?? {}
    localStorage.setItem("enclave.prefs", JSON.stringify({ ...actual, tema: t }))
  }, tema)
  await page.reload({ waitUntil: "domcontentloaded" })
  await espera(3500)
  await page.locator(".separadores").getByRole("button", { name: "Comunidades" }).click().catch(() => {})
  await espera(800)
  await page.locator(`.carril-comunidade[aria-label="${COMUNIDADE}"]`).click()
  await espera(800)
  await foto(`11-${tema}-lista`)
  await medir(`${tema} lista`, ".separador, .carril-comunidade")
  await page.locator("button.room", { hasText: "prensa" }).first().click().catch(() => {})
  await espera(1000)
  await foto(`12-${tema}-conversa`)
  verificar(`${tema}: a conversa ocupa o ecrã todo`, Math.round((await page.locator(".ecra-empurrado").boundingBox())?.width ?? 0) === 390)
}

// The computer: nothing of this.
const computador = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const pc = await computador.newPage()
await pc.goto(APP, { waitUntil: "domcontentloaded" })
await espera(1500)
console.log("  (o computador abre noutro perfil, sem conta: só se mede a casca)")
verificar("no computador não há .telemovel", (await pc.locator(".app.telemovel").count()) === 0)
await computador.close()

if (erros.length > 0) {
  console.log("\n  erros de página:")
  for (const erro of erros) console.log(`    ${erro}`)
  falhas.push("erros de página")
}
console.log(`\ncapturas: ${CAPTURAS}`)
console.log(`${falhas.length === 0 ? "TUDO OK" : `FALHAS (${falhas.length}):`}`)
for (const falha of falhas) console.log(`  - ${falha}`)
await browser.close()
process.exit(falhas.length === 0 ? 0 : 1)
