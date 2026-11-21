/**
 * The account file (.enclave) at sign-up, and the banner that stays (21/11/2026).
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/e2e-ficheiro-da-conta.mjs
 *
 * Three browsers, through the interface:
 *  1. Chromium at 390 px, touch: a new account stops on "Guarda o
 *     ficheiro da conta". "Guardar o ficheiro" saves it and opens the app. The
 *     file is an account file. No banner, now or after reloading.
 *  2. Firefox at 390 px: "Fazer mais tarde" opens the app with the banner "Ainda
 *     não guardaste o ficheiro da conta.". It stays after reloading and after
 *     closing its sheet; it goes when the file is saved, and does not come back.
 *  3. WebKit at 1280 px: the file from step 1 signs in with the password, and
 *     the app opens with no banner.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8722 and 8723. Captures in
 * `.verify-data/prova-ficheiro-da-conta/`.
 */
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { dentro, espera, importarFicheiro, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CAPTURAS = join(RAIZ, ".verify-data/prova-ficheiro-da-conta", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8722, servidor: 8723, sfu: 0, etiqueta: "ficheiro-da-conta" })
const browsers = []
const registo = []
const TELEMOVEL = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }

async function abrir(motor, nome, contexto = {}) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  // `isMobile` exists only in Chromium and WebKit.
  const extra = motor === firefox ? { viewport: contexto.viewport, hasTouch: contexto.hasTouch } : contexto
  const ctx = await b.newContext({ locale: "pt-PT", acceptDownloads: true, viewport: { width: 1280, height: 860 }, ...extra })
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  page.on("console", (m) => {
    if (m.type() === "error") registo.push(`${nome} CONSOLA ${m.text().slice(0, 300)}`)
  })
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  return { nome, ctx, page }
}

const titulo = (page) => page.getByRole("heading", { name: "Guarda o ficheiro da conta" })
const faixa = (page) => page.locator(".faixa-do-ficheiro:visible").filter({ hasText: "Ainda não guardaste o ficheiro da conta." }).first()
const guardar = (page) => page.getByRole("button", { name: "Guardar o ficheiro", exact: true })
const semRolagem = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

/** Reload, type the password if the gate asks, and wait for the app. */
async function recarregar(page) {
  await page.reload({ waitUntil: "domcontentloaded" })
  const campo = page.locator('input[type="password"]').first()
  await campo.or(page.locator(".app")).first().waitFor({ timeout: 60_000 })
  if (await campo.count()) {
    await campo.fill(FRASE)
    await page.keyboard.press("Enter")
  }
  await dentro(page)
}

/** The banner shows within a few seconds of opening, or not at all. */
async function faixaAparece(page, ms = 6_000) {
  return faixa(page)
    .waitFor({ timeout: ms })
    .then(() => true, () => false)
}

let ficheiro = null
try {
  /*
    1. Chromium at 390 px: the step, saved at once. Not WebKit: there the button
    opens the share sheet ("Save to Files" on the iPhone), which a headless
    browser never closes, so nothing downloads.
  */
  const ana = await abrir(chromium, "chromium-390", TELEMOVEL)
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME, ficheiro: false })
  check("depois de criar a conta, aparece o passo do ficheiro", await titulo(ana.page).waitFor({ timeout: 90_000 }).then(() => true, () => false))
  await ana.page.screenshot({ path: join(CAPTURAS, "1-passo-chromium-390.png"), fullPage: true })
  check("a 390 px, o passo não traz rolagem horizontal", await semRolagem(ana.page))
  check('o passo diz "Precisas dele para entrar na tua conta noutro aparelho."', (await ana.page.getByText("Precisas dele para entrar na tua conta noutro aparelho.").count()) === 1)
  check('e tem "Fazer mais tarde"', (await ana.page.getByRole("button", { name: "Fazer mais tarde" }).count()) === 1)
  await guardar(ana.page).and(ana.page.locator(":enabled")).waitFor({ timeout: 30_000 })
  const [descarga] = await Promise.all([ana.page.waitForEvent("download", { timeout: 30_000 }), guardar(ana.page).tap()])
  ficheiro = join(CAPTURAS, "conta.enclave")
  await descarga.saveAs(ficheiro)
  const texto = readFileSync(ficheiro, "utf8")
  check("o ficheiro guardado é um ficheiro de conta", texto.includes('"format":"enclave-vault"'), descarga.suggestedFilename())
  check("o ficheiro não traz a palavra-passe", !texto.includes(FRASE))
  check("guardar abre a app", await dentro(ana.page).then(() => true, () => false))
  check("na app, quem guardou não vê a faixa", !(await faixaAparece(ana.page)))
  await recarregar(ana.page)
  check("depois de recarregar, a faixa também não aparece", !(await faixaAparece(ana.page)))

  // 2. Firefox at 390 px: "Fazer mais tarde" leaves the banner, until a file is saved.
  const bruno = await abrir(firefox, "firefox-390", TELEMOVEL)
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME, ficheiro: false })
  await titulo(bruno.page).waitFor({ timeout: 90_000 })
  await bruno.page.getByRole("button", { name: "Fazer mais tarde" }).click()
  await dentro(bruno.page)
  check('"Fazer mais tarde": a faixa aparece dentro da app', await faixaAparece(bruno.page, 30_000))
  await bruno.page.screenshot({ path: join(CAPTURAS, "3-faixa-firefox-390.png") })
  check("a 390 px, a faixa não traz rolagem horizontal", await semRolagem(bruno.page))
  await recarregar(bruno.page)
  check("a faixa fica depois de recarregar", await faixaAparece(bruno.page, 30_000))
  await faixa(bruno.page).getByRole("button", { name: "Guardar", exact: true }).click()
  const folha = bruno.page.locator(".ficheiro-da-conta-aviso")
  await folha.getByRole("button", { name: "Fechar", exact: true }).click()
  check("fechar a folha sem guardar não tira a faixa", await faixaAparece(bruno.page, 5_000))
  await faixa(bruno.page).getByRole("button", { name: "Guardar", exact: true }).click()
  await Promise.all([bruno.page.waitForEvent("download", { timeout: 30_000 }), folha.getByRole("button", { name: "Guardar o ficheiro", exact: true }).click()])
  check("guardado o ficheiro, a faixa sai", await faixa(bruno.page).waitFor({ state: "detached", timeout: 15_000 }).then(() => true, () => false))
  await recarregar(bruno.page)
  check("e não volta", !(await faixaAparece(bruno.page)))

  // 3. Chromium at 1280 px: the file from step 1 is the account.
  const outro = await abrir(webkit, "webkit-1280")
  await importarFicheiro(outro.page, ficheiro, FRASE)
  check("o ficheiro entra com a palavra-passe, noutro browser", await dentro(outro.page).then(() => true, () => false))
  check("uma conta que entrou pelo ficheiro não vê a faixa", !(await faixaAparece(outro.page)))
  await outro.page.screenshot({ path: join(CAPTURAS, "4-pelo-ficheiro-webkit-1280.png") })
  await espera(500)
} catch (erro) {
  check("o guião correu até ao fim", false, String(erro?.message ?? erro).slice(0, 300))
} finally {
  for (const linhaDoRegisto of registo.slice(-20)) console.log(linhaDoRegisto)
  for (const b of browsers) await b.close().catch(() => {})
  await srv.fechar?.()
  console.log(`\nCapturas: ${CAPTURAS}`)
  process.exitCode = resumo() ? 0 : 1
}
