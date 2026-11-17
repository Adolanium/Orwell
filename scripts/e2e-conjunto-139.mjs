/**
 * The 1.3.9 joint proof: three accounts, three engines, two tabs.
 *
 *   npm run build && node scripts/e2e-conjunto-139.mjs
 *
 * Ana in Chromium, Bruno in Firefox, Carla in WebKit. Via the interface:
 *  0. without `?lingua=`, a browser in Portuguese opens in English (1.3.9);
 *  1. three accounts, friendships, a channel, two invites;
 *  2. Ana writes; Bruno and Carla read it;
 *  3. Bruno reacts; Ana and Carla see the chip with 1; Carla joins: 2;
 *  4. Ana pins the message; Bruno and Carla see the pin;
 *  5. a second tab of Ana takes over and shows the message, the chip and the pin;
 *  6. Carla writes from WebKit; Ana's second tab and Bruno read it.
 *
 * Everything local and disposable, ports 8711 and 8712. Screenshots in
 * `.verify-data/prova-conjunto-139/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, espera, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "conjunto"
const CAPTURAS = join(RAIZ, ".verify-data/prova-conjunto-139", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8711, servidor: 8712, sfu: 0, etiqueta: "conjunto-139" })
const browsers = []
const abertos = []
const registo = []

function vigiar(page, nome) {
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  page.on("console", (m) => {
    if (m.type() === "error") registo.push(`${nome} CONSOLA ${m.text().slice(0, 300)}`)
  })
}

async function abrir(motor, nome) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  vigiar(page, nome)
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser: b, ctx, page }
  abertos.push(aparelho)
  return aparelho
}

const linha = (page, texto) => page.locator(".message").filter({ hasText: texto }).first()
const viu = (page, texto) => linha(page, texto).isVisible().catch(() => false)
const caixa = (page) => page.locator('input[placeholder="Escreve uma mensagem"]').first()
const botaoFixadas = (page) => page.getByRole("button", { name: "Ver o que está fixado nesta sala" })
const temFixada = (page) => ate(async () => (await botaoFixadas(page).count()) > 0, 60_000, 400).then((t) => t >= 0)

async function escrever(page, texto) {
  await caixa(page).click()
  await caixa(page).fill(texto)
  await page.keyboard.press("Enter")
}

/** The chips of a message: `[{ emoji, n, minha }]`. Same reading as `e2e-reaccoes-e-salas.mjs`. */
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
const contagem = async (page, texto, emoji) => (await fichas(page, texto)).find((f) => f.emoji === emoji)?.n ?? 0

try {
  // 0. Without ?lingua=, a Portuguese browser opens in English.
  {
    const b = await chromium.launch({ headless: true })
    browsers.push(b)
    const ctx = await b.newContext({ locale: "pt-PT" })
    const page = await ctx.newPage()
    await page.goto(`http://${srv.NOME}/app/`, { waitUntil: "domcontentloaded" })
    const lang = await ate(async () => (await page.evaluate(() => document.documentElement.lang)) === "en", 20_000).then((t) => t >= 0)
    const ingles = await page.getByRole("button", { name: /^(No, create an account|Create account)$/ }).first().waitFor({ timeout: 30_000 }).then(() => true, () => false)
    check("sem ?lingua=, um browser em português abre em inglês", lang && ingles)
    await page.screenshot({ path: join(CAPTURAS, "00-lingua-pt-PT.png") })
    await ctx.close()
  }

  // 1. Accounts, friendships, the channel and the invites.
  const ana = await abrir(chromium, "ana-chromium")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(firefox, "bruno-firefox")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const carla = await abrir(webkit, "carla-webkit")
  await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
  await dentro(carla.page)
  const [enderecoAna, enderecoBruno, enderecoCarla] = contasDoServidor(srv.base)
  await pedirAmizade(bruno.page, enderecoAna)
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await pedirAmizade(carla.page, enderecoAna)
  check("a Ana aceita a amizade da Carla", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("a Ana convida a Carla", await convidar(ana.page, CANAL, enderecoCarla))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  check("a Carla entra no canal", await aceitarConvite(carla.page, CANAL, { espera: 60_000 }))
  for (const p of [ana, bruno, carla]) await abrirCanal(p.page, CANAL)

  // 2. A message, in three engines.
  const DITA = "mensagem do conjunto 1.3.9"
  await escrever(ana.page, DITA)
  for (const p of [bruno, carla]) check(`${p.nome} lê a mensagem da Ana`, (await ate(() => viu(p.page, DITA), 60_000)) >= 0)

  // 3. Reactions.
  await linha(bruno.page, DITA).hover()
  await linha(bruno.page, DITA).getByRole("button", { name: "Reagir", exact: true }).click()
  const grelha = bruno.page.locator(".emoji-grid").first()
  await grelha.waitFor({ timeout: 10_000 })
  await bruno.page.getByLabel("Procurar emoji pelo nome").fill("polegar")
  await espera(300)
  const emoji = ((await grelha.locator("button").first().textContent()) ?? "").trim()
  await grelha.locator("button").first().click()
  check("o Bruno escolheu um emoji", emoji.length > 0, emoji)
  for (const p of [ana, carla]) check(`${p.nome} vê a ficha com 1`, (await ate(async () => (await contagem(p.page, DITA, emoji)) === 1, 60_000)) >= 0)
  await linha(carla.page, DITA).locator(".reaccao:not(.reaccao-mais)").first().click()
  for (const p of [ana, bruno, carla]) check(`${p.nome} vê a ficha com 2`, (await ate(async () => (await contagem(p.page, DITA, emoji)) === 2, 60_000)) >= 0)
  await ana.page.screenshot({ path: join(CAPTURAS, "01-ana-reaccoes.png") })

  // 4. Pin.
  await linha(ana.page, DITA).click({ button: "right" })
  await ana.page.locator(".context-menu").first().waitFor({ timeout: 10_000 })
  await ana.page.locator(".context-menu").getByText("Fixar na sala", { exact: true }).first().click()
  for (const p of [ana, bruno, carla]) check(`${p.nome} vê a fixada`, await temFixada(p.page))

  // 5. Ana's second tab takes over.
  const ana2 = await ana.ctx.newPage()
  vigiar(ana2, "ana-chromium-2")
  await ana2.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await ana2.getByRole("button", { name: "Usar este separador" }).waitFor({ timeout: 30_000 })
  await ana2.getByRole("button", { name: "Usar este separador" }).click()
  const campo = ana2.locator('.gate-card input[type="password"]').first()
  await campo.or(ana2.getByRole("button", { name: "Configurações", exact: true }).first()).first().waitFor({ timeout: 60_000 })
  if (await campo.isVisible().catch(() => false)) {
    await campo.fill(FRASE)
    await ana2.getByRole("button", { name: "Entrar", exact: true }).click()
  }
  await dentro(ana2)
  await abrirCanal(ana2, CANAL)
  check("o segundo separador lê a mensagem", (await ate(() => viu(ana2, DITA), 60_000)) >= 0)
  check("o segundo separador vê a ficha com 2", (await ate(async () => (await contagem(ana2, DITA, emoji)) === 2, 60_000)) >= 0)
  check("o segundo separador vê a fixada", await temFixada(ana2))
  await ana2.screenshot({ path: join(CAPTURAS, "02-ana-segundo-separador.png") })

  // 6. Carla writes from WebKit; the second tab and Bruno read it.
  const DA_CARLA = "a Carla responde do WebKit"
  await escrever(carla.page, DA_CARLA)
  check("o segundo separador da Ana lê a Carla", (await ate(() => viu(ana2, DA_CARLA), 60_000)) >= 0)
  check("o Bruno lê a Carla", (await ate(() => viu(bruno.page, DA_CARLA), 60_000)) >= 0)
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
