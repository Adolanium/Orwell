/**
 * The mention highlight on replies, live (17/11/2026).
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/prova-destaque-respostas.mjs chromium|webkit [antes|depois]
 *
 * Three accounts. Ana (founder) and Carla on Chromium; Bruno, the reader whose
 * view is measured, on the engine named in the first argument. Bruno writes
 * two grouped lines, Carla one. Ana then sends, via the interface:
 *   R1  a reply to Bruno with "@ Mention" on       -> lit for Bruno
 *   R2  a reply to Bruno with "@ Mention" off      -> not lit
 *   R3  a reply to Carla with "@ Mention" on       -> not lit for Bruno
 *   R4  "@all ..."                                  -> lit for Bruno
 *   M5  a plain line grouped under R4               -> not lit
 *   M6  "@Bruno ..." grouped under M5              -> lit for Bruno
 *
 * On Bruno, at 1440 and 390 px, with and without reduced motion: which lines
 * are lit, that the ground stays on hover, that the bar does not sit on the
 * face, that the quote is inside the lit area, that lit lines in one group
 * share the same left edge, and that nothing flickers while idle, scrolling
 * and jumping to the original.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8950-8953. Captures in
 * `.verify-data/prova-destaque-respostas/<motor>-<etiqueta>-<data>/`.
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
const PORTAS = { chromium: [8950, 8951], webkit: [8952, 8953] }
const FRASE = "frase-de-verificacao-2026"
const CANAL = "adega"
const CAPTURAS = join(RAIZ, ".verify-data/prova-destaque-respostas", `${MOTOR}-${ETIQUETA}-${new Date().toISOString().replace(/[:.]/g, "-")}`)
mkdirSync(CAPTURAS, { recursive: true })

const T = {
  B1: "Quem traz o pao amanha?",
  B2: "E o vinho tambem, por favor.",
  C1: "Eu levo o queijo da serra.",
  R1: "Eu levo o pao de Mafra.",
  R2: "Posso levar tambem broa.",
  R3: "Boa, Carla, esse queijo e o melhor.",
  R4: "reuniao na adega as nove.",
  M5: "Tragam casacos que faz frio.",
  M6: "traz o saca-rolhas, se faz favor.",
  R7: "Vinho tinto ou branco?",
}
const ACESAS = ["R1", "R4", "M6"]
const APAGADAS = ["B1", "B2", "C1", "R2", "R3", "M5"]

const { check, resumo } = verificador()
const [FRENTE, SERV] = PORTAS[MOTOR]
const srv = await levantarServidor({ frente: FRENTE, servidor: SERV, sfu: 0, etiqueta: `destaque-${MOTOR}` })
const browsers = []
const abertos = []
const registo = []

async function abrir(motor, nome, browser = null, contexto = {}) {
  const b = browser ?? (await motor.launch({ headless: true }))
  if (!browser) browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1440, height: 900 }, ...contexto })
  /*
    Since 17/11/2026 a lit line fades after a few seconds in view with the window
    in front (`useMencoesVistas`). This proof measures how a lit line is DRAWN
    (hover, touch, the bar, the jump), over many seconds, so the readers' window
    is kept "behind" and nothing fades. The fade has its own proof:
    `prova-mencao-vista.mjs`.
  */
  if (nome !== "ana") await ctx.addInitScript(() => Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false }))
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  page.on("console", (m) => {
    if (m.type() === "error") registo.push(`${nome} CONSOLA ${m.text().slice(0, 300)}`)
  })
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser: b, ctx, page }
  abertos.push(aparelho)
  return aparelho
}

const caixa = (page) => page.locator(".chat-composer .composer-line input:not([type])").first()
const linha = (page, texto) => page.locator(".message").filter({ hasText: texto }).first()
const errosDe = (nome) => registo.filter((l) => l.startsWith(`${nome} PAGEERROR`))

async function dizer(page, texto) {
  await caixa(page).click()
  await caixa(page).pressSequentially(texto, { delay: 8 })
  await page.keyboard.press("Enter")
}

/** Reply from the action bar; `mencionar` false turns "@ Mention" off first. */
async function responder(page, original, texto, mencionar) {
  const alvo = linha(page, original)
  await alvo.hover()
  await alvo.getByRole("button", { name: "Responder" }).click()
  const barra = page.locator(".composer-resposta")
  await barra.waitFor({ timeout: 5_000 })
  const botao = barra.getByRole("button", { name: /@ Mencionar/ })
  if (((await botao.getAttribute("aria-pressed")) === "true") !== mencionar) await botao.click()
  await caixa(page).pressSequentially(texto, { delay: 8 })
  await page.keyboard.press("Enter")
  await ate(async () => (await barra.count()) === 0, 10_000)
}

/** Picks a mention from the @ list and finishes the line. */
async function mencionar(page, procura, escolha, resto) {
  const campo = caixa(page)
  await campo.click()
  await campo.pressSequentially(`@${procura}`, { delay: 60 })
  await page.locator(".mention-picker").first().waitFor({ timeout: 10_000 })
  await page.locator(".mention-picker .mention-option").filter({ hasText: escolha }).first().click()
  await campo.pressSequentially(` ${resto}`, { delay: 8 })
  await page.keyboard.press("Enter")
}

/** Everything measured on one lit or unlit line, read in the page. */
async function medir(page, texto) {
  return linha(page, texto).evaluate((el) => {
    const r = el.getBoundingClientRect()
    const estilo = getComputedStyle(el)
    const cara = el.querySelector(".message-avatar-botao, .avatar-wrap, .message-gutter")
    const caraR = cara?.getBoundingClientRect()
    const citacao = el.querySelector(".message-citacao")
    const citR = citacao?.getBoundingClientRect()
    return {
      acesa: el.classList.contains("menciona-me"),
      agrupada: el.classList.contains("grouped"),
      fundo: estilo.backgroundColor,
      sombra: estilo.boxShadow,
      esquerda: Math.round(r.left),
      topo: Math.round(r.top),
      fundoBaixo: Math.round(r.bottom),
      caraEsquerda: caraR ? Math.round(caraR.left) : null,
      citacaoDentro: citR ? citR.top >= r.top - 0.5 && citR.bottom <= r.bottom + 0.5 && citR.left >= r.left : null,
    }
  })
}

/** The alpha of a computed colour: `rgba(…, a)`, `color(srgb … / a)`, `rgb(…)` is 1, transparent is 0. */
function alfa(cor) {
  if (cor === "transparent") return 0
  const barra = /\/\s*([\d.]+)\)$/.exec(cor)
  if (barra) return Number(barra[1])
  const rgba = /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(cor)
  if (rgba) return Number(rgba[1])
  return 1
}

const transparente = (cor) => cor === "rgba(0, 0, 0, 0)" || cor === "transparent"

/** The checks of one viewport and motion setting. */
async function bateria(page, rotulo) {
  for (const k of ACESAS) {
    await ate(() => linha(page, T[k]).evaluate((el) => el.classList.contains("menciona-me")), 15_000, 200)
  }
  const medidas = {}
  for (const k of [...ACESAS, ...APAGADAS]) medidas[k] = await medir(page, T[k])
  check(`${rotulo}: acesas só ${ACESAS.join(", ")}`, ACESAS.every((k) => medidas[k].acesa) && APAGADAS.every((k) => !medidas[k].acesa),
    Object.entries(medidas).map(([k, m]) => `${k}=${m.acesa ? "acesa" : "-"}`).join(" "))
  check(`${rotulo}: a resposta R1 tem fundo e barra em repouso`, !transparente(medidas.R1.fundo) && /inset/.test(medidas.R1.sombra), `${medidas.R1.fundo} | ${medidas.R1.sombra}`)
  for (const k of ACESAS) {
    const m = medidas[k]
    check(`${rotulo}: a barra de ${k} não fica em cima da cara (cara a ${m.caraEsquerda - m.esquerda}px da borda)`, m.caraEsquerda !== null && m.caraEsquerda - m.esquerda >= 6)
  }
  check(`${rotulo}: a citação de R1 fica dentro da área acesa`, medidas.R1.citacaoDentro === true)
  check(`${rotulo}: R4 e M6 (mesmo grupo) têm a barra na mesma coluna`, medidas.R4.esquerda === medidas.M6.esquerda && medidas.M6.agrupada, `${medidas.R4.esquerda} vs ${medidas.M6.esquerda}`)

  // Hover: the ground must stay (Discord darkens it a little, never drops it).
  const r1 = linha(page, T.R1)
  await r1.scrollIntoViewIfNeeded()
  await r1.hover()
  await espera(400)
  const sobre = await medir(page, T.R1)
  check(`${rotulo}: com o rato por cima, R1 continua com fundo`, !transparente(sobre.fundo), sobre.fundo)
  check(`${rotulo}: com o rato por cima, R1 continua com barra`, /inset/.test(sobre.sombra), sobre.sombra)
  await page.screenshot({ path: join(CAPTURAS, `${rotulo}-rato-sobre-R1.png`) })
  await page.mouse.move(2, 2)
  await espera(300)

  // Stability: count class changes on the lit lines while idle and scrolling.
  await page.evaluate(() => {
    window.__mudancas = 0
    window.__vigia?.disconnect()
    window.__vigia = new MutationObserver((ms) => {
      for (const m of ms) {
        const antes = (m.oldValue ?? "").includes("menciona-me")
        const agora = m.target.classList.contains("menciona-me")
        if (antes !== agora) window.__mudancas++
      }
    })
    for (const el of document.querySelectorAll(".message")) window.__vigia.observe(el, { attributes: true, attributeFilter: ["class"], attributeOldValue: true })
  })
  await espera(1500)
  const lista = page.locator(".message").first()
  await lista.evaluate((el) => {
    const rolo = el.closest("[class*='timeline'], .chat-messages") ?? el.parentElement
    rolo.scrollTop = 0
  })
  await espera(400)
  await lista.evaluate((el) => {
    const rolo = el.closest("[class*='timeline'], .chat-messages") ?? el.parentElement
    rolo.scrollTop = rolo.scrollHeight
  })
  await espera(600)
  const mudancas = await page.evaluate(() => window.__mudancas)
  check(`${rotulo}: o destaque não pisca (parado e a rolar)`, mudancas === 0, `mudanças: ${mudancas}`)
  await page.screenshot({ path: join(CAPTURAS, `${rotulo}-conversa.png`) })

  // Jump to the original from R1's quote: the original lights briefly (search
  // highlight), it never takes the mention highlight, and R1 keeps its own.
  await linha(page, T.R1).locator(".message-citacao").click()
  await ate(() => page.locator(".message.destacada").count().then((n) => n === 1), 5_000, 50)
  await espera(300)
  const original = await medir(page, T.B1)
  const r1Depois = await medir(page, T.R1)
  check(`${rotulo}: o original citado nunca fica com o destaque de menção`, !original.acesa)
  check(`${rotulo}: R1 mantém o destaque depois do salto`, r1Depois.acesa)
  await page.screenshot({ path: join(CAPTURAS, `${rotulo}-salto-ao-original.png`) })
  await ate(() => page.locator(".message.destacada").count().then((n) => n === 0), 7_000, 100)

  // The lit ground stays inside the scroller (the line reaches into its padding).
  const recorte = await linha(page, T.R1).evaluate((el) => {
    const rolo = el.closest(".timeline")
    return rolo ? Math.round(el.getBoundingClientRect().left - rolo.getBoundingClientRect().left) : null
  })
  check(`${rotulo}: a área acesa não é cortada pelo rolo`, recorte !== null && recorte >= 0, `folga ${recorte}px`)

  // From search to a lit line: the jump's fade must land on the lit ground,
  // never go clear in the middle and snap back at the end.
  await page.getByRole("button", { name: "Procurar nesta conversa" }).click()
  await page.locator(".procura-panel").waitFor({ timeout: 10_000 })
  await page.locator(".procura-caixa").fill("Mafra")
  await page.locator(".procura-linha").first().waitFor({ timeout: 10_000 })
  await page.locator(".procura-linha").first().click()
  const achou = await ate(() => page.locator(".message.destacada.menciona-me").count().then((n) => n === 1), 8_000, 50)
  check(`${rotulo}: a procura leva a R1, acesa`, achou >= 0)
  if (achou >= 0) {
    const amostras = await page.locator(".message.destacada.menciona-me").first().evaluate(async (el) => {
      const lidas = []
      const fim = performance.now() + 6200
      while (performance.now() < fim) {
        lidas.push(getComputedStyle(el).backgroundColor)
        await new Promise((r) => setTimeout(r, 80))
      }
      return lidas
    })
    const alfas = amostras.map(alfa)
    const repouso = alfa((await medir(page, T.R1)).fundo)
    const minimo = Math.min(...alfas)
    check(`${rotulo}: durante e depois do salto a linha acesa nunca fica mais clara que em repouso`, minimo >= repouso * 0.9, `mínimo ${minimo.toFixed(3)}, repouso ${repouso.toFixed(3)}`)
    await page.screenshot({ path: join(CAPTURAS, `${rotulo}-depois-do-salto-a-R1.png`) })
  }
  await page.keyboard.press("Escape").catch(() => {})
}

try {
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  // Carla reads on a touch screen: the tapped line keeps `:hover`, which is where a lit line lost its ground for good.
  const carla = await abrir(MOTOR === "webkit" ? webkit : chromium, "carla", null, { hasTouch: true })
  await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
  await dentro(carla.page)
  const bruno = await abrir(MOTOR === "webkit" ? webkit : chromium, "bruno")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const [, enderecoCarla, enderecoBruno] = contasDoServidor(srv.base)
  await pedirAmizade(bruno.page, contasDoServidor(srv.base)[0])
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await pedirAmizade(carla.page, contasDoServidor(srv.base)[0])
  check("a Ana aceita a amizade da Carla", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("a Ana convida a Carla", await convidar(ana.page, CANAL, enderecoCarla))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  check("a Carla entra no canal", await aceitarConvite(carla.page, CANAL, { espera: 60_000 }))
  for (const p of [ana, bruno, carla]) await abrirCanal(p.page, CANAL)

  await dizer(bruno.page, T.B1)
  await dizer(bruno.page, T.B2)
  await ate(() => linha(carla.page, T.B2).isVisible(), 60_000)
  await dizer(carla.page, T.C1)
  await ate(() => linha(ana.page, T.C1).isVisible(), 60_000)
  await ate(() => linha(ana.page, T.B2).isVisible(), 60_000)

  await responder(ana.page, T.B1, T.R1, true)
  await responder(ana.page, T.B1, T.R2, false)
  await responder(ana.page, T.C1, T.R3, true)
  await mencionar(ana.page, "al", "@all", T.R4)
  await dizer(ana.page, T.M5)
  await mencionar(ana.page, "Bru", "Bruno", T.M6)
  check("as linhas da Ana chegam ao Bruno", (await ate(() => linha(bruno.page, T.M6).isVisible(), 60_000)) >= 0)
  await espera(1500)

  for (const [largura, altura] of [[1440, 900], [390, 844]]) {
    for (const reduzido of [false, true]) {
      await bruno.page.emulateMedia({ reducedMotion: reduzido ? "reduce" : "no-preference" })
      await bruno.page.setViewportSize({ width: largura, height: altura })
      await espera(500)
      await bateria(bruno.page, `${largura}${reduzido ? "-reduzido" : ""}`)
    }
  }
  // The owner's "they get stuck" (17/11/2026): read, change room, come back,
  // scroll, receive more than the sliding window holds, jump to a quote. The
  // lit lines must stay the right ones, and nothing (jump flash, action bar,
  // hover) may stay on after the gesture is over.
  await bruno.page.emulateMedia({ reducedMotion: "no-preference" })
  await bruno.page.setViewportSize({ width: 1440, height: 900 })
  await bruno.page.locator(".room-row button.room", { hasText: "conversa" }).first().click()
  await espera(800)
  await bruno.page.locator(".room-row button.room", { hasText: "geral" }).first().click()
  await espera(800)
  for (let n = 1; n <= 34; n++) await dizer(ana.page, `linha de enchimento ${n}`)
  await responder(ana.page, T.B2, T.R7, true)
  check("a resposta R7 chega ao Bruno depois de 34 linhas", (await ate(() => linha(bruno.page, T.R7).isVisible(), 60_000)) >= 0)
  await espera(1500)
  const acesasAgora = await bruno.page.locator(".message.menciona-me").allInnerTexts()
  // Since 17/11/2026 R1, R4 and M6 are read by now (a new visit to the room): only R7 may be lit.
  check("depois de mudar de sala, voltar e a janela deslizar, a acesa visível é a R7 e só as de menção",
    acesasAgora.some((t) => t.includes(T.R7)) && acesasAgora.every((t) => [T.R1, T.R4, T.M6, T.R7].some((k) => t.includes(k))),
    acesasAgora.map((t) => t.replace(/\s+/g, " ").slice(-40)).join(" | "))
  const encheu = await bruno.page.locator(".message").filter({ hasText: "linha de enchimento" }).evaluateAll((els) => els.filter((el) => el.classList.contains("menciona-me")).length)
  check("nenhuma linha de enchimento fica acesa", encheu === 0, `${encheu}`)
  await bruno.page.screenshot({ path: join(CAPTURAS, "preso-1-depois-de-34-linhas.png") })
  await linha(bruno.page, T.R7).locator(".message-citacao").click()
  const saltou = await ate(() => bruno.page.locator(".message.destacada").count().then((n) => n === 1), 8_000, 50)
  check("a citação de R7 salta para B2, fora da janela", saltou >= 0)
  await bruno.page.mouse.move(2, 2)
  await espera(6500)
  const preso = await bruno.page.evaluate(() => ({
    destacadas: document.querySelectorAll(".message.destacada").length,
    barras: [...document.querySelectorAll(".message .msg-actions")].filter((b) => getComputedStyle(b).opacity !== "0").length,
    foco: document.activeElement?.closest(".message")?.textContent?.slice(0, 40) ?? null,
  }))
  check("6,5 s depois do salto não fica realce preso", preso.destacadas === 0, JSON.stringify(preso))
  check("6,5 s depois do salto, com o rato fora, nenhuma barra de acções fica à vista", preso.barras === 0, JSON.stringify(preso))
  await bruno.page.screenshot({ path: join(CAPTURAS, "preso-2-6s-depois-do-salto.png") })
  await bruno.page.locator(".chat-composer .composer-line input:not([type])").first().click()
  await espera(300)
  const depoisDoClique = await bruno.page.evaluate(() => [...document.querySelectorAll(".message .msg-actions")].filter((b) => getComputedStyle(b).opacity !== "0").length)
  check("e depois de clicar na caixa também não", depoisDoClique === 0, `${depoisDoClique}`)

  // Carla on touch: R3 (a reply to her, mention on) and R4 (@all) lit for her; a tap keeps the ground.
  await abrirCanal(carla.page, CANAL).catch(() => {})
  await carla.page.setViewportSize({ width: 390, height: 844 })
  await espera(800)
  const daCarla = {}
  for (const k of ["R1", "R3", "R4", "M6"]) daCarla[k] = (await medir(carla.page, T[k]).catch(() => ({ acesa: null }))).acesa
  check("a Carla vê acesas só a resposta a ela (R3) e o @all (R4)", daCarla.R3 === true && daCarla.R4 === true && daCarla.R1 === false && daCarla.M6 === false, JSON.stringify(daCarla))
  await linha(carla.page, T.R4).scrollIntoViewIfNeeded()
  await linha(carla.page, T.R4).tap()
  await espera(400)
  const tocada = await medir(carla.page, T.R4)
  check("ao toque, R4 continua com fundo (o :hover que fica do toque não o apaga)", !transparente(tocada.fundo), tocada.fundo)
  await carla.page.screenshot({ path: join(CAPTURAS, "toque-carla-390-R4.png") })

  check("ninguém tem erros na página", ["ana", "bruno", "carla"].every((n) => errosDe(n).length === 0), registo.filter((l) => l.includes("PAGEERROR")).join(" | "))
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of abertos) await a.page.screenshot({ path: join(CAPTURAS, `falha-${a.nome}.png`) }).catch(() => {})
}
for (const l of registo.slice(-20)) console.log(l)
for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
console.log(`\nCapturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
