/**
 * A mention lights while unread, and the unread bar leaves after reading, live
 * (17/11/2026, the owner: "it is a reply, but it stays marked forever" and "the
 * unread badge at the top does not go away after reading").
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/prova-mencao-vista.mjs chromium|webkit [antes|depois]
 *
 * Ana (Chromium) writes; Bruno reads on the engine named in the first argument.
 *
 * Part 1, the highlight:
 *   R1  Ana replies to Bruno with "@ Mention" on: lit, and the quote says "@Bruno";
 *       Bruno leaves the room and comes back: no longer lit;
 *   M2  "@Bruno ...": lit; after a few seconds in view, with the window in front,
 *       the light fades (alpha 0 at the end);
 *       reload: R1 and M2 stay dark;
 *   M3  a new mention after the reload: lit.
 *
 * Part 2, the unread bar, in a second channel ("cave"):
 *   a) N lines arrive with "cave" closed; Bruno opens it: the bar shows; he goes
 *      up a little and down to the end: the bar leaves, the sidebar count and
 *      the tab title have no unread; reload and open "cave": no bar.
 *   b) the same with "cave" open and the window covered while the lines arrive
 *      (visible, no frames, no focus: the 1.3.17 real-time case).
 *
 * The window "in front" is driven from the test (`__frente`), as in
 * `medir-tempo-real.mjs`: headless has no other window to cover it.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8960-8963. Captures in
 * `.verify-data/prova-mencao-vista/<motor>-<etiqueta>-<data>/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, espera, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const MOTOR = process.argv[2] ?? "chromium"
const ETIQUETA = process.argv[3] ?? "depois"
const PORTAS = { chromium: [8960, 8961], webkit: [8962, 8963] }
const FRASE = "frase-de-verificacao-2026"
const CANAL = "adega"
const CAVE = "cave"
const N = 120
const CAPTURAS = join(RAIZ, ".verify-data/prova-mencao-vista", `${MOTOR}-${ETIQUETA}-${new Date().toISOString().replace(/[:.]/g, "-")}`)
mkdirSync(CAPTURAS, { recursive: true })

const T = {
  B1: "Quem traz o pao amanha?",
  R1: "Eu levo o pao de Mafra.",
  M2: "traz o saca-rolhas, se faz favor.",
  M3: "e as velas tambem.",
}

const { check, resumo } = verificador()
const [FRENTE, SERV] = PORTAS[MOTOR]
const srv = await levantarServidor({ frente: FRENTE, servidor: SERV, sfu: 0, etiqueta: `mencao-vista-${MOTOR}` })
const browsers = []
const abertos = []
const registo = []

/** In the page before anything: the window in front or covered, driven by the test. */
function janelaControlada() {
  const rafOriginal = window.requestAnimationFrame.bind(window)
  const parados = []
  let frente = true
  window.requestAnimationFrame = (f) => {
    if (!frente) {
      parados.push(f)
      return -parados.length
    }
    return rafOriginal(f)
  }
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => frente })
  window.__frente = (sim) => {
    frente = sim
    window.dispatchEvent(new Event(sim ? "focus" : "blur"))
    if (sim) for (const f of parados.splice(0)) rafOriginal(f)
  }
}

async function abrir(motor, nome, comControlo = false) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1440, height: 900 } })
  if (comControlo) await ctx.addInitScript(janelaControlada)
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser: b, ctx, page }
  abertos.push(aparelho)
  return aparelho
}

const caixa = (page) => page.locator(".chat-composer .composer-line input:not([type])").first()
const linha = (page, texto) => page.locator(".message").filter({ hasText: texto }).first()

async function dizer(page, texto) {
  await caixa(page).click()
  await caixa(page).fill(texto)
  await page.keyboard.press("Enter")
}

async function responder(page, original, texto) {
  const alvo = linha(page, original)
  await alvo.hover()
  await alvo.getByRole("button", { name: "Responder" }).click()
  const barra = page.locator(".composer-resposta")
  await barra.waitFor({ timeout: 5_000 })
  const botao = barra.getByRole("button", { name: /@ Mencionar/ })
  if ((await botao.getAttribute("aria-pressed")) !== "true") await botao.click()
  await caixa(page).pressSequentially(texto, { delay: 8 })
  await page.keyboard.press("Enter")
  await ate(async () => (await barra.count()) === 0, 10_000)
}

async function mencionar(page, procura, escolha, resto) {
  const campo = caixa(page)
  await campo.click()
  await campo.pressSequentially(`@${procura}`, { delay: 60 })
  await page.locator(".mention-picker").first().waitFor({ timeout: 10_000 })
  await page.locator(".mention-picker .mention-option").filter({ hasText: escolha }).first().click()
  await campo.pressSequentially(` ${resto}`, { delay: 8 })
  await page.keyboard.press("Enter")
}

/** The lit state of a line: class, faded, and the alpha of its ground. */
async function luz(page, texto) {
  return linha(page, texto).evaluate((el) => {
    const cor = getComputedStyle(el).backgroundColor
    const barra = /\/\s*([\d.]+)\)$/.exec(cor)
    const rgba = /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(cor)
    const alfa = cor === "transparent" ? 0 : barra ? Number(barra[1]) : rgba ? Number(rgba[1]) : 1
    return {
      acesa: el.classList.contains("menciona-me"),
      vista: el.classList.contains("mencao-vista"),
      alfa,
      citacao: el.querySelector(".message-citacao-nome")?.textContent ?? null,
    }
  })
}

async function irParaSala(page, nome) {
  await page.locator(".room-row button.room", { hasText: nome }).first().click()
  await espera(800)
}

const barraPorLer = (page) => page.locator(".timeline-unread-jump")

/** Up a little, then down to the end, as a reader does. */
async function lerAteAoFim(page) {
  await page.locator(".timeline").evaluate((el) => {
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 300)
  })
  await espera(500)
  await page.locator(".timeline").evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await espera(800)
}

async function porLerNaColuna(page, nome) {
  return page.evaluate((canal) => {
    const nome = [...document.querySelectorAll(".channel-name")].find((el) => el.getAttribute("title") === canal)
    return nome?.closest("button")?.querySelector(".badge")?.textContent?.trim() ?? ""
  }, nome)
}

try {
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(MOTOR === "webkit" ? webkit : chromium, "bruno", true)
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const [enderecoAna, enderecoBruno] = contasDoServidor(srv.base)
  await pedirAmizade(bruno.page, enderecoAna)
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno para a adega", await convidar(ana.page, CANAL, enderecoBruno))
  check("o Bruno entra na adega", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  await criarCanal(ana.page, CAVE)
  check("a Ana convida o Bruno para a cave", await convidar(ana.page, CAVE, enderecoBruno))
  check("o Bruno entra na cave", await aceitarConvite(bruno.page, CAVE, { espera: 60_000 }))
  for (const p of [ana, bruno]) await abrirCanal(p.page, CANAL)

  // ---------------------------------------------------------------- Part 1
  await dizer(bruno.page, T.B1)
  await ate(() => linha(ana.page, T.B1).isVisible(), 60_000)
  // Bruno is covered while R1 arrives, so it cannot fade before it is measured.
  await bruno.page.evaluate(() => window.__frente(false))
  await responder(ana.page, T.B1, T.R1)
  check("R1 chega ao Bruno", (await ate(() => linha(bruno.page, T.R1).isVisible(), 60_000)) >= 0)
  await bruno.page.evaluate(() => window.__frente(true))
  await espera(400)
  const r1 = await luz(bruno.page, T.R1)
  check("R1 (resposta ao Bruno com @ Mencionar) acende", r1.acesa && !r1.vista && r1.alfa > 0.02, JSON.stringify(r1))
  check("a citação de R1 diz porquê: @Bruno", r1.citacao === "@Bruno", JSON.stringify(r1.citacao))
  await bruno.page.screenshot({ path: join(CAPTURAS, "1-R1-acesa-com-arroba.png") })

  // Out and back in: a new visit, the read mark passed it.
  await irParaSala(bruno.page, "conversa")
  await irParaSala(bruno.page, "geral")
  await ate(() => linha(bruno.page, T.R1).isVisible(), 10_000)
  const r1Volta = await luz(bruno.page, T.R1)
  check("sair e voltar: R1 já não acende", !r1Volta.acesa, JSON.stringify(r1Volta))
  check("e a citação continua a dizer @Bruno", r1Volta.citacao === "@Bruno", JSON.stringify(r1Volta.citacao))
  await bruno.page.screenshot({ path: join(CAPTURAS, "2-R1-apagada-depois-de-voltar.png") })

  // M2: lit, then it fades while in view with the window in front.
  await mencionar(ana.page, "Bru", "Bruno", T.M2)
  check("M2 chega ao Bruno", (await ate(() => linha(bruno.page, T.M2).isVisible(), 60_000)) >= 0)
  await espera(300)
  const m2 = await luz(bruno.page, T.M2)
  check("M2 (@Bruno) acende ao chegar", m2.acesa && m2.alfa > 0.02, JSON.stringify(m2))
  await bruno.page.screenshot({ path: join(CAPTURAS, "3-M2-acesa.png") })
  await espera(8000)
  const m2Vista = await luz(bruno.page, T.M2)
  check("M2 à vista uns segundos, com a janela à frente: a luz apaga-se", m2Vista.vista && m2Vista.alfa < 0.01, JSON.stringify(m2Vista))
  await bruno.page.screenshot({ path: join(CAPTURAS, "4-M2-apagada-a-vista.png") })

  await bruno.page.reload({ waitUntil: "domcontentloaded" })
  await dentro(bruno.page)
  await abrirCanal(bruno.page, CANAL)
  await ate(() => linha(bruno.page, T.M2).isVisible(), 30_000)
  await espera(1000)
  const depoisDeRecarregar = { R1: await luz(bruno.page, T.R1), M2: await luz(bruno.page, T.M2) }
  check("depois de recarregar, R1 e M2 continuam apagadas", !depoisDeRecarregar.R1.acesa && !depoisDeRecarregar.M2.acesa, JSON.stringify(depoisDeRecarregar))
  await bruno.page.screenshot({ path: join(CAPTURAS, "5-recarregada.png") })

  await mencionar(ana.page, "Bru", "Bruno", T.M3)
  check("M3 chega ao Bruno", (await ate(() => linha(bruno.page, T.M3).isVisible(), 60_000)) >= 0)
  await espera(300)
  const m3 = await luz(bruno.page, T.M3)
  check("uma menção nova (M3) acende", m3.acesa && m3.alfa > 0.02, JSON.stringify(m3))
  await bruno.page.screenshot({ path: join(CAPTURAS, "6-M3-nova-acesa.png") })

  // ---------------------------------------------------------------- Part 2a
  // Bruno has been in "cave" once (a channel never opened has no read mark, and no bar), then leaves it.
  await abrirCanal(bruno.page, CAVE)
  await espera(800)
  await abrirCanal(bruno.page, CANAL)
  await espera(800)
  await abrirCanal(ana.page, CAVE)
  for (let n = 1; n <= N; n++) await dizer(ana.page, `cave linha ${n}`)
  await ate(() => linha(ana.page, `cave linha ${N}`).isVisible(), 30_000)
  await espera(3000)
  await abrirCanal(bruno.page, CAVE)
  await ate(() => linha(bruno.page, `cave linha ${N}`).isVisible(), 60_000)
  await espera(1000)
  check("a) com a cave fechada, chegam N linhas; ao abrir, a barra de por ler aparece", (await barraPorLer(bruno.page).count()) === 1)
  await bruno.page.screenshot({ path: join(CAPTURAS, "7a-barra-ao-abrir.png") })
  await lerAteAoFim(bruno.page)
  const barraA = await barraPorLer(bruno.page).count()
  check("a) descer até ao fim tira a barra", barraA === 0, `barras: ${barraA}`)
  await bruno.page.screenshot({ path: join(CAPTURAS, "7b-barra-depois-de-ler.png") })
  await abrirCanal(bruno.page, CANAL)
  await espera(800)
  check("a) noutra conversa: o título do separador não tem por ler", !/^\(\d+\)/.test(await bruno.page.title()), await bruno.page.title())
  check("a) e a coluna não mostra por ler na cave", (await porLerNaColuna(bruno.page, CAVE)) === "", await porLerNaColuna(bruno.page, CAVE))
  await bruno.page.reload({ waitUntil: "domcontentloaded" })
  await dentro(bruno.page)
  await abrirCanal(bruno.page, CAVE)
  await ate(() => linha(bruno.page, `cave linha ${N}`).isVisible(), 60_000)
  await espera(1500)
  check("a) recarregar: continua sem barra", (await barraPorLer(bruno.page).count()) === 0)
  await bruno.page.screenshot({ path: join(CAPTURAS, "7c-recarregada-sem-barra.png") })

  // ---------------------------------------------------------------- Part 2b
  await bruno.page.evaluate(() => window.__frente(false))
  for (let n = 1; n <= N; n++) await dizer(ana.page, `tapada linha ${n}`)
  await ate(() => linha(ana.page, `tapada linha ${N}`).isVisible(), 30_000)
  await espera(4000)
  await bruno.page.evaluate(() => window.__frente(true))
  await ate(() => linha(bruno.page, `tapada linha ${N}`).isVisible(), 60_000)
  await espera(1000)
  await bruno.page.screenshot({ path: join(CAPTURAS, "8a-tapada-ao-destapar.png") })
  await lerAteAoFim(bruno.page)
  const barraB = await barraPorLer(bruno.page).count()
  check("b) janela tapada na chegada: depois de descer até ao fim, sem barra", barraB === 0, `barras: ${barraB}`)
  await bruno.page.screenshot({ path: join(CAPTURAS, "8b-tapada-depois-de-ler.png") })
  await bruno.page.reload({ waitUntil: "domcontentloaded" })
  await dentro(bruno.page)
  await abrirCanal(bruno.page, CAVE)
  await ate(() => linha(bruno.page, `tapada linha ${N}`).isVisible(), 60_000)
  await espera(1500)
  check("b) recarregar: continua sem barra", (await barraPorLer(bruno.page).count()) === 0)
  await abrirCanal(bruno.page, CANAL)
  await espera(800)
  check("b) noutra conversa: o título do separador não tem por ler", !/^\(\d+\)/.test(await bruno.page.title()), await bruno.page.title())
  check("b) e a coluna não mostra por ler na cave", (await porLerNaColuna(bruno.page, CAVE)) === "", await porLerNaColuna(bruno.page, CAVE))
  await bruno.page.screenshot({ path: join(CAPTURAS, "8c-tapada-recarregada.png") })

  check("ninguém tem erros na página", registo.filter((l) => l.includes("PAGEERROR")).length === 0, registo.filter((l) => l.includes("PAGEERROR")).join(" | "))
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of abertos) await a.page.screenshot({ path: join(CAPTURAS, `falha-${a.nome}.png`) }).catch(() => {})
}
for (const l of registo.slice(-20)) console.log(l)
for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
console.log(`\nCapturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
