/**
 * The account file (.enclave) at sign-up, and the one-time notice (16/11/2026).
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/e2e-ficheiro-da-conta.mjs
 *
 * Three browsers, through the interface:
 *  1. WebKit at 390 px, touch (the iPhone): a new account stops on "Guarda o
 *     ficheiro da conta". "Continuar" is off; the box alone does not turn it on;
 *     the download alone does not either; both do. The file is an account file.
 *     Reloading does not show the notice.
 *  2. Firefox at 390 px: an account that never saved its file (the mark taken
 *     away, as for an account from before this step) gets the notice once, with
 *     the same button; closing it is final.
 *  3. Chromium at 1280 px: the file from step 1 imports with the password, and
 *     the app opens with no notice.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8722 and 8723. Captures in
 * `.verify-data/prova-ficheiro-da-conta/`.
 */
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta, passarOFicheiroDaConta } from "./conta.mjs"
import { dentro, espera, irParaONome, verificador } from "./fase7-comum.mjs"
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
const aviso = (page) => page.getByRole("heading", { name: "Ainda não guardaste o ficheiro da conta" })
const continuar = (page) => page.getByRole("button", { name: "Continuar", exact: true })
const caixa = (page) => page.getByRole("checkbox", { name: "Guardei o ficheiro num sítio seguro." })
const semRolagem = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

/** Reload, type the password if the gate asks, and wait for the app. */
async function recarregar(page) {
  await page.reload({ waitUntil: "domcontentloaded" })
  const campo = page.locator('input[type="password"]').first()
  const config = page.getByRole("button", { name: "Configurações", exact: true }).first()
  await campo.or(config).first().waitFor({ timeout: 60_000 })
  if (await campo.count()) {
    await campo.fill(FRASE)
    await page.keyboard.press("Enter")
  }
  await dentro(page)
}

/** The notice shows within a few seconds of opening, or not at all. */
async function avisoAparece(page, ms = 6_000) {
  return aviso(page)
    .waitFor({ timeout: ms })
    .then(() => true, () => false)
}

let ficheiro = null
try {
  // 1. WebKit at 390 px: the step.
  const ana = await abrir(webkit, "webkit-390", TELEMOVEL)
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME, ficheiro: false })
  check("depois de criar a conta, aparece o passo do ficheiro", await titulo(ana.page).waitFor({ timeout: 90_000 }).then(() => true, () => false))
  await ana.page.screenshot({ path: join(CAPTURAS, "1-passo-webkit-390.png"), fullPage: true })
  check("a 390 px, o passo não traz rolagem horizontal", await semRolagem(ana.page))
  check('"Continuar" começa desligado', await continuar(ana.page).isDisabled())
  await caixa(ana.page).check()
  check('só a caixa não liga "Continuar"', await continuar(ana.page).isDisabled())
  await caixa(ana.page).uncheck()
  const botao = ana.page.getByRole("button", { name: "Descarregar o ficheiro da conta" })
  await botao.and(ana.page.locator(":enabled")).waitFor({ timeout: 30_000 })
  const [descarga] = await Promise.all([ana.page.waitForEvent("download", { timeout: 30_000 }), botao.tap()])
  ficheiro = join(CAPTURAS, "conta.enclave")
  await descarga.saveAs(ficheiro)
  const texto = readFileSync(ficheiro, "utf8")
  check("o ficheiro descarregado é um ficheiro de conta", texto.includes('"format":"enclave-vault"'), descarga.suggestedFilename())
  check("o ficheiro não traz a palavra-passe", !texto.includes(FRASE))
  check('só a descarga não liga "Continuar"', await continuar(ana.page).isDisabled())
  const partilha = await ana.page.getByRole("button", { name: "Partilhar", exact: true }).count()
  console.log(`   "Partilhar" no WebKit sem folha de partilha: ${partilha ? "visível" : "escondido"}`)
  await caixa(ana.page).check()
  await ana.page.screenshot({ path: join(CAPTURAS, "2-passo-pronto-webkit-390.png"), fullPage: true })
  check('descarga e caixa ligam "Continuar"', await continuar(ana.page).isEnabled())
  await continuar(ana.page).tap()
  check("Continuar abre a app", await dentro(ana.page).then(() => true, () => false))
  check("na app, a conta nova não recebe o aviso", !(await avisoAparece(ana.page)))
  await recarregar(ana.page)
  check("depois de recarregar, o aviso também não aparece", !(await avisoAparece(ana.page)))

  // 2. Firefox at 390 px: an account from before the step gets the notice once.
  const bruno = await abrir(firefox, "firefox-390", TELEMOVEL)
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  await bruno.page.evaluate(() => localStorage.removeItem("enclave.ficheiroDaConta"))
  await recarregar(bruno.page)
  check("uma conta sem o ficheiro guardado recebe o aviso ao abrir", await avisoAparece(bruno.page, 30_000))
  await bruno.page.screenshot({ path: join(CAPTURAS, "3-aviso-firefox-390.png") })
  check("a 390 px, o aviso não traz rolagem horizontal", await semRolagem(bruno.page))
  check("o aviso tem o mesmo botão", (await bruno.page.getByRole("button", { name: "Descarregar o ficheiro da conta" }).count()) === 1)
  await bruno.page.locator(".ficheiro-da-conta-aviso").getByRole("button", { name: "Fechar", exact: true }).click()
  check("o aviso fecha", await aviso(bruno.page).waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false))
  await recarregar(bruno.page)
  check("fechado uma vez, não volta", !(await avisoAparece(bruno.page)))

  // 3. Chromium at 1280 px: the file from step 1 is the account.
  const outro = await abrir(chromium, "chromium-1280")
  await irParaONome(outro.page)
  await outro.page.locator('.import-account input[type="file"]').setInputFiles(ficheiro)
  await outro.page.locator('input[name="import-password"]').fill(FRASE)
  await outro.page.getByRole("button", { name: "Importar", exact: true }).click()
  check("o ficheiro importa com a palavra-passe, noutro browser", await dentro(outro.page).then(() => true, () => false))
  check("uma conta importada do ficheiro não recebe o aviso", !(await avisoAparece(outro.page)))
  await outro.page.screenshot({ path: join(CAPTURAS, "4-importada-chromium-1280.png") })
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
