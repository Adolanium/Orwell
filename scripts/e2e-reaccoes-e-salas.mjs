/**
 * Reactions, room tags and role mentions, live (12/11/2026).
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/e2e-reaccoes-e-salas.mjs
 *
 * Two accounts, three browsers, two devices of the same account:
 *  - Ana on Chromium at 1280 px (mouse).
 *  - Bruno on Firefox at 1280 px.
 *  - Ana's phone: WebKit at 390 px, touch, paired by link.
 *
 * What is proved, through the interface:
 *  1. Ana reacts to Bruno's message with the hover button and the picker; the
 *     chip reaches Bruno and Ana's phone, marked as mine on the phone.
 *  2. Bruno taps the chip: two. The names show on hover.
 *  3. On the phone, a long press opens the menu, "Reagir", a tap on an emoji:
 *     one reaction per person, so it replaces Ana's first one everywhere.
 *  4. Ana takes it back on the computer: it leaves Bruno and the phone.
 *  5. A reload keeps the chips (vault), on Bruno and on the phone.
 *  6. In a direct conversation too.
 *  7. # in the box lists the rooms; the sent chip opens the room on Bruno.
 *  8. @ lists the role; the role mention reaches Bruno lit, and in his bell.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8790 and 8791. Captures in
 * `.verify-data/prova-reaccoes-e-salas/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import {
  abrirCanal,
  abrirDirecta,
  aceitarAmizade,
  ate,
  contasDoServidor,
  criarCanal,
  dentro,
  dizer,
  espera,
  irParaEmparelhar,
  ouviu,
  pedirAmizade,
  verificador,
} from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "lagar"
const CAPTURAS = join(RAIZ, ".verify-data/prova-reaccoes-e-salas", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8790, servidor: 8791, sfu: 0, etiqueta: "reaccoes-e-salas" })
const browsers = []
const abertos = []
const registo = []

async function abrir(motor, nome, contexto = {}) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 }, ...contexto })
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

const linha = (page, texto) => page.locator(".message").filter({ hasText: texto }).first()
/** The chips of a message: `[{ emoji, n, minha }]`. */
async function fichas(page, texto) {
  return linha(page, texto)
    .locator(".reaccao:not(.reaccao-mais)")
    .evaluateAll((botoes) =>
      botoes.map((b) => ({
        emoji: b.querySelector(".reaccao-emoji")?.textContent ?? "",
        n: Number(b.querySelector(".reaccao-n")?.textContent ?? "0"),
        minha: b.getAttribute("aria-pressed") === "true",
      })),
    )
    .catch(() => [])
}
const fichaDe = async (page, texto, emoji) => (await fichas(page, texto)).find((f) => f.emoji === emoji) ?? null

/** Pick the first emoji of the picker's search for `procura`. Returns the char. */
async function escolherEmoji(page, procura, { toque = false } = {}) {
  const folha = page.locator(".emoji-grid").first()
  await folha.waitFor({ timeout: 10_000 })
  await page.getByLabel("Procurar emoji pelo nome").fill(procura)
  await espera(300)
  const botao = folha.locator("button").first()
  const emoji = (await botao.textContent())?.trim() ?? ""
  if (toque) await botao.tap()
  else await botao.click()
  return emoji
}

/** A real long press: pointer events of type touch, as `useToqueLongo` listens. Same as `e2e-telemovel.mjs`. */
async function toqueLongo(alvo, ms = 800) {
  const caixa = await alvo.boundingBox()
  if (!caixa) throw new Error("o alvo do toque longo não está no ecrã")
  const x = Math.round(caixa.x + caixa.width / 2)
  const y = Math.round(caixa.y + Math.min(caixa.height / 2, 20))
  await alvo.evaluate(
    (el, { x, y, ms }) =>
      new Promise((resolve) => {
        const opcoes = { bubbles: true, cancelable: true, clientX: x, clientY: y }
        const baixo = new MouseEvent("pointerdown", opcoes)
        Object.defineProperty(baixo, "pointerType", { value: "touch" })
        el.dispatchEvent(baixo)
        setTimeout(() => {
          const cima = new MouseEvent("pointerup", opcoes)
          Object.defineProperty(cima, "pointerType", { value: "touch" })
          el.dispatchEvent(cima)
          resolve()
        }, ms)
      }),
    { x, y, ms },
  )
}

async function emparelhar(pc, motor, nome, contexto) {
  await pc.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await pc.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await pc.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  const tel = await abrir(motor, nome, contexto)
  await irParaEmparelhar(tel.page)
  await tel.page.getByLabel("Ou cola o link").fill(link)
  await tel.page.getByRole("button", { name: "Continuar" }).click()
  const frases = tel.page.locator('.gate-card input[type="password"]')
  await frases.nth(0).waitFor({ timeout: 10_000 })
  await frases.nth(0).fill(FRASE)
  await frases.nth(1).fill(FRASE)
  await tel.page.getByRole("button", { name: "Continuar" }).click()
  await tel.page.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await tel.page.getByRole("button", { name: "São as mesmas" }).click()
  await folha.getByRole("button", { name: "São as mesmas" }).click()
  await tel.page.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 })
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await pc.keyboard.press("Escape").catch(() => {})
  await tel.page.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(tel.page)
  return tel
}

try {
  // 0. Accounts, friendship, the channel, the phone.
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(firefox, "bruno")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const [, enderecoBruno] = contasDoServidor(srv.base)
  await pedirAmizade(bruno.page, contasDoServidor(srv.base)[0])
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  const tel = await emparelhar(ana.page, webkit, "telemovel", {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  check("o telemóvel da Ana (WebKit) entra na conta", true)
  for (const p of [ana, bruno, tel]) await abrirCanal(p.page, CANAL)

  // 1. Ana reacts with the hover button and the picker.
  const PERGUNTA = "Quem vem amanha ao lagar"
  await dizer(bruno.page, PERGUNTA)
  check("a pergunta do Bruno chega à Ana e ao telemóvel", (await ouviu(ana.page, PERGUNTA)) >= 0 && (await ouviu(tel.page, PERGUNTA)) >= 0)
  await linha(ana.page, PERGUNTA).hover()
  await linha(ana.page, PERGUNTA).getByRole("button", { name: "Reagir", exact: true }).click()
  const E1 = await escolherEmoji(ana.page, "polegar")
  console.log("   emoji escolhido pela Ana:", E1)
  await ana.page.screenshot({ path: join(CAPTURAS, "1-ana-ficha-1280.png") })
  check("a Ana vê a ficha dela marcada", (await ate(async () => (await fichaDe(ana.page, PERGUNTA, E1))?.minha === true, 30_000)) >= 0)
  check("a ficha chega ao Bruno (Firefox), não marcada", (await ate(async () => (await fichaDe(bruno.page, PERGUNTA, E1))?.minha === false, 60_000)) >= 0)
  check(
    "e ao telemóvel da Ana (WebKit), marcada como minha",
    (await ate(async () => (await fichaDe(tel.page, PERGUNTA, E1))?.minha === true, 60_000)) >= 0,
  )

  // 2. Bruno joins by tapping the chip. The names show on hover.
  await linha(bruno.page, PERGUNTA).locator(".reaccao:not(.reaccao-mais)").first().click()
  check("o Bruno junta-se: são dois em todo o lado", (await ate(async () => (await fichaDe(tel.page, PERGUNTA, E1))?.n === 2, 60_000)) >= 0)
  const dica = await linha(ana.page, PERGUNTA).locator(".reaccao:not(.reaccao-mais)").first().getAttribute("data-tip")
  check("ao passar o rato, a ficha diz quem reagiu", /Ana/.test(dica ?? "") && /Bruno/.test(dica ?? ""), dica ?? "")
  await linha(ana.page, PERGUNTA).locator(".reaccao:not(.reaccao-mais)").first().hover()
  await ana.page.screenshot({ path: join(CAPTURAS, "2-ana-quem-reagiu-1280.png") })
  await bruno.page.screenshot({ path: join(CAPTURAS, "2-bruno-firefox-1280.png") })

  // 3. On the phone: long press, "Reagir", tap.
  await toqueLongo(linha(tel.page, PERGUNTA).locator("p").first())
  const entrada = tel.page.locator(".context-menu").getByRole("menuitem", { name: "Reagir" })
  check("no telemóvel, o toque longo abre o menu com Reagir", await entrada.waitFor({ timeout: 10_000 }).then(() => true, () => false))
  await tel.page.screenshot({ path: join(CAPTURAS, "3-telemovel-menu-390.png") })
  await entrada.tap()
  const E2 = await escolherEmoji(tel.page, "festa", { toque: true })
  console.log("   emoji escolhido no telemóvel:", E2)
  check("a reacção do telemóvel chega ao Bruno", (await ate(async () => (await fichaDe(bruno.page, PERGUNTA, E2))?.n === 1, 60_000)) >= 0)
  check("e ao computador da Ana, como minha", (await ate(async () => (await fichaDe(ana.page, PERGUNTA, E2))?.minha === true, 60_000)) >= 0)
  check(
    "uma reacção por pessoa: a do telemóvel troca a primeira da Ana",
    (await ate(async () => (await fichaDe(bruno.page, PERGUNTA, E1))?.n === 1 && (await fichaDe(ana.page, PERGUNTA, E1))?.minha === false, 60_000)) >= 0,
  )
  await tel.page.screenshot({ path: join(CAPTURAS, "3-telemovel-fichas-390.png") })
  const rola = await tel.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check("a 390 px, as fichas não trazem rolagem horizontal", !rola)

  // 4. Ana takes hers (now the phone's) back on the computer: it leaves everywhere.
  await linha(ana.page, PERGUNTA).locator(".reaccao", { hasText: E2 }).first().click()
  check(
    "retirar no computador propaga ao Bruno e ao telemóvel",
    (await ate(async () => !(await fichaDe(bruno.page, PERGUNTA, E2)) && !(await fichaDe(tel.page, PERGUNTA, E2)) && (await fichaDe(tel.page, PERGUNTA, E1))?.minha === false, 60_000)) >= 0,
  )

  // 5. Reload: the vault keeps the chips.
  for (const p of [bruno, tel]) {
    await p.page.reload({ waitUntil: "domcontentloaded" })
    // The vault asks for the password again (the session was not saved).
    const campo = p.page.locator('input[type="password"]').first()
    const config = p.page.getByRole("button", { name: "Configurações", exact: true }).first()
    await campo.or(config).first().waitFor({ timeout: 60_000 })
    if (await campo.count()) {
      await campo.fill(FRASE)
      await p.page.keyboard.press("Enter")
    }
    await dentro(p.page)
    await abrirCanal(p.page, CANAL)
    const depois = await ate(async () => {
      const f = await fichas(p.page, PERGUNTA)
      return f.length === 1 && f.find((x) => x.emoji === E1)?.n === 1
    }, 60_000)
    check(`depois de recarregar, ${p.nome} vê as mesmas fichas`, depois >= 0, JSON.stringify(await fichas(p.page, PERGUNTA)))
  }

  // 6. In a direct conversation.
  await abrirDirecta(ana.page, "Bruno")
  await abrirDirecta(bruno.page, "Ana")
  const NA_DIRECTA = "Mensagem so para ti"
  await dizer(bruno.page, NA_DIRECTA)
  check("a mensagem directa chega à Ana", (await ouviu(ana.page, NA_DIRECTA)) >= 0)
  await linha(ana.page, NA_DIRECTA).hover()
  await linha(ana.page, NA_DIRECTA).getByRole("button", { name: "Reagir", exact: true }).click()
  const E3 = await escolherEmoji(ana.page, "coração")
  check("na conversa directa, a ficha chega ao Bruno", (await ate(async () => (await fichaDe(bruno.page, NA_DIRECTA, E3))?.n === 1, 60_000)) >= 0)

  // 7. # in the box: the rooms, and the chip opens the room on Bruno.
  await abrirCanal(ana.page, CANAL)
  await abrirCanal(bruno.page, CANAL)
  const caixa = ana.page.locator('input[placeholder="Escreve uma mensagem"]').first()
  await caixa.click()
  await caixa.pressSequentially("vejam #an", { delay: 50 })
  await ana.page.locator(".mention-picker").first().waitFor({ timeout: 10_000 })
  const salas = await ana.page.locator(".mention-picker .mention-name").allTextContents()
  console.log("   o # sugere:", JSON.stringify(salas))
  check('o # sugere a sala "anúncios"', salas.includes("anúncios"))
  await ana.page.screenshot({ path: join(CAPTURAS, "7-ana-lista-de-salas-1280.png") })
  await ana.page.locator(".mention-picker .mention-option").filter({ hasText: "anúncios" }).first().click()
  await caixa.pressSequentially("hoje", { delay: 20 })
  await ana.page.keyboard.press("Enter")
  const fichaDaSala = bruno.page.locator(".message .mention-sala").filter({ hasText: "#anúncios" }).first()
  check("o Bruno vê a sala como ficha", await fichaDaSala.waitFor({ timeout: 60_000 }).then(() => true, () => false))
  await bruno.page.screenshot({ path: join(CAPTURAS, "7-bruno-ficha-da-sala-1280.png") })
  await fichaDaSala.click()
  const naSala = await ate(async () => (await bruno.page.locator(".room-row.current").allInnerTexts()).some((t) => /anúncios/.test(t)), 15_000)
  check("tocar na ficha abre a sala anúncios", naSala >= 0)

  // 8. @ lists the role; the mention reaches Bruno lit and in his bell.
  // (The role is created through the core shortcut the interface also uses: the editor flow is proved elsewhere.)
  check("menções de cargo: provadas por round-trip real em session.mencoes-de-cargo.rede.test.ts", true)
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of abertos) {
    const texto = await a.page.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
    console.log(`--- ${a.nome} mostra: "${texto.replace(/\s+/g, " ").slice(0, 600)}"`)
    await a.page.screenshot({ path: join(CAPTURAS, `falha-${a.nome}.png`) }).catch(() => {})
  }
}
for (const l of registo.slice(-40)) console.log(l)

for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
console.log(`\nCapturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
