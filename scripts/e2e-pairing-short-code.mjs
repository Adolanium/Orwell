/**
 * Short-code pairing end to end (1.3.26), in Chromium, Firefox and WebKit.
 *
 *   npm run build && node scripts/e2e-pairing-short-code.mjs
 *   node scripts/e2e-pairing-short-code.mjs --only=firefox        (one engine)
 *
 * In each engine, two devices (two browser contexts, so two separate
 * storages) and two tabs on the device with the account:
 *  1. Ana creates her account in tab 1, and opens the app in tab 2 too.
 *  2. The new device (a 390 px phone) chooses "Entrar com outro aparelho",
 *     then "Mostrar um código neste aparelho", and shows "K7P · 4QM" and the
 *     QR. No password yet: the account password comes after the words.
 *  3. Tab 1 opens Settings › Conta e segurança › Juntar um aparelho and types
 *     the code in "Ou escreve o código" (lower case, with the dot, as a person
 *     types it).
 *  4. Both screens show the same words; "Sim, juntar o aparelho" on both;
 *     "Estás dentro" with the account password; the new device enters the
 *     account, and no account is created on the server.
 *  5. Tab 2 is still a sane app (the app or the "other tab" screen, no error).
 * In Chromium only, the promises of the code: a wrong code fails on both
 * screens with Error 770, and the right code typed after it finds nothing
 * (Error 771): one guess per code.
 *
 * No system dialog may open (alert, confirm, prompt, beforeunload): any one
 * is a failure. The camera is not used: the typed code is the path here, and
 * the QR link is proved in `session.pair-code.rede.test.ts`.
 *
 * The app runs in Portuguese (`?lingua=pt`), so the names the script looks
 * for are the Portuguese interface texts.
 *
 * LOCAL AND DISPOSABLE: `servidor-descartavel.mjs`, its own ports, 127.0.0.1.
 */
// Every page is watched: the centre of the screen stays inside the app (1.3.27).
import "./screen-guard.mjs"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { contasDoServidor, dentro, escutar, irParaEmparelhar, verificador } from "./fase7-comum.mjs"
import { abrirJuntarUmAparelho, confirmarEAbrir } from "./juntar-aparelho.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const PASSWORD = "frase-de-verificacao-2026"
const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1]
const ENGINES = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
].filter(([name]) => !only || only === name)

const { check, resumo: summary } = verificador()
const log = []
const srv = await levantarServidor({
  frente: Number(process.env.E2E_FRONT_PORT ?? 8592),
  servidor: Number(process.env.E2E_SERVER_PORT ?? 8593),
  etiqueta: "pairing-short-code",
})
const NEW_DEVICE_APP = `http://${srv.NOME}/app/?lingua=pt&servidor=${encodeURIComponent(srv.NOME)}`

/** Every page: any system dialog is a failure, and it is dismissed so the run goes on. */
const dialogs = []
function noDialogs(page, label) {
  page.on("dialog", (dialog) => {
    dialogs.push(`${label}: ${dialog.type()} "${dialog.message()}"`)
    void dialog.dismiss().catch(() => {})
  })
}

async function newContext(browser, label, options = {}) {
  const context = await browser.newContext({ locale: "pt-PT", ...options })
  escutar(context, log, label)
  context.on("page", (page) => noDialogs(page, label))
  return context
}

/** The new device, up to the code on screen. Returns the page and the code. */
async function newDeviceWithCode(browser, label) {
  // The new device is a phone: 390 x 844, like the mock-up.
  const context = await newContext(browser, label, { viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  noDialogs(page, label)
  await page.goto(NEW_DEVICE_APP, { waitUntil: "domcontentloaded" })
  await irParaEmparelhar(page)
  await page.getByRole("button", { name: "Mostrar um código neste aparelho" }).click()
  const text = page.locator(".short-code-text")
  await text.waitFor({ timeout: 30_000 })
  const code = await text.getAttribute("data-code")
  // Nothing wider than the phone.
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  check(`${label}: the code screen fits in 390 px`, width <= 390, `${width} px`)
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${label}-code.png` })
  return { context, page, code, shown: (await text.innerText()).trim() }
}

/** Settings › Conta e segurança › Juntar um aparelho, on the tab with the account, up to the code field. */
async function openJoinSheet(page) {
  const { folha: sheet } = await abrirJuntarUmAparelho(page)
  await sheet.getByLabel("Ou escreve o código").waitFor({ timeout: 20_000 })
  if (process.env.E2E_SCREENSHOTS) await sheet.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/join-${Date.now()}.png` })
  return sheet
}

/** As a person types it: lower case, with the middle dot. */
const asTyped = (code) => `${code.slice(0, 3)} · ${code.slice(3)}`.toLowerCase()

const appeared = (locator) => locator.waitFor({ timeout: 30_000 }).then(() => true, () => false)

const toClose = []
try {
  for (const [name, engine] of ENGINES) {
    console.log(`\n=== ${name} ===`)
    const browser = await engine.launch({ headless: true })
    toClose.push(() => browser.close())

    // 1. Ana, in two tabs of the same browser.
    const accountsBefore = contasDoServidor(srv.base).length
    const anaContext = await newContext(browser, `${name}-ana`)
    const tab1 = await anaContext.newPage()
    noDialogs(tab1, `${name}-ana-1`)
    await tab1.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await criarConta(tab1, { nome: `Ana ${name}`.slice(0, 12), frase: PASSWORD, servidor: srv.NOME })
    await dentro(tab1)
    const tab2 = await anaContext.newPage()
    noDialogs(tab2, `${name}-ana-2`)
    await tab2.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await tab2.waitForTimeout(2_000)
    await tab1.bringToFront()

    // 2. The new device shows the code.
    const device = await newDeviceWithCode(browser, `${name}-new`)
    check(`${name}: the new device shows a 6-character code`, /^[2-9A-HJKMNP-Z]{6}$/.test(device.code ?? ""), device.code)
    check(`${name}: in two groups of three`, device.shown === `${device.code.slice(0, 3)} · ${device.code.slice(3)}`, device.shown)
    check(`${name}: with the QR`, (await device.page.locator(".short-code .qr-code").count()) === 1)
    check(
      `${name}: with the mock-up text`,
      (await device.page.locator("body").innerText()).includes("No aparelho onde tens a conta, abre Configurações › Juntar um aparelho."),
    )

    // 3. Ana types it.
    const sheet = await openJoinSheet(tab1)
    await sheet.getByLabel("Ou escreve o código").fill(asTyped(device.code))
    await sheet.getByRole("button", { name: "Continuar" }).click()

    // 4. The words, both yeses, and the new device inside.
    const t0 = Date.now()
    await device.page.locator(".sas-palavras").waitFor({ timeout: 30_000 })
    await sheet.locator(".sas-palavras").waitFor({ timeout: 30_000 })
    const wordsDevice = await device.page.locator(".sas-palavras").getAttribute("data-palavras")
    const wordsAccount = await sheet.locator(".sas-palavras").getAttribute("data-palavras")
    check(`${name}: the same words on both screens`, Boolean(wordsDevice) && wordsDevice === wordsAccount, `${wordsDevice} (${Date.now() - t0} ms)`)
    // "Sim, juntar o aparelho" on both, then "Estás dentro" with the account password.
    const joined = await confirmarEAbrir(device.page, sheet, PASSWORD).then(
      () => true,
      () => false,
    )
    check(`${name}: the new device belongs to the account`, joined, `${Date.now() - t0} ms`)
    await dentro(device.page)
    check(`${name}: no new account on the server`, contasDoServidor(srv.base).length === accountsBefore + 1)
    await sheet.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})

    // 5. The second tab is still sane.
    const tab2Text = await tab2.locator("body").innerText({ timeout: 5_000 }).catch(() => "")
    check(`${name}: the second tab shows no error`, !/Erro \d{3}/.test(tab2Text), tab2Text.replace(/\s+/g, " ").slice(0, 120))

    // The promises of the code, once.
    if (name === "chromium") {
      const other = await newDeviceWithCode(browser, `${name}-new-2`)
      const last = other.code[5] === "2" ? "3" : "2"
      const wrong = `${other.code.slice(0, 5)}${last}`
      const sheet2 = await openJoinSheet(tab1)
      await sheet2.getByLabel("Ou escreve o código").fill(wrong)
      await sheet2.getByRole("button", { name: "Continuar" }).click()
      const failedAccount = await appeared(sheet2.locator("[role=alert]", { hasText: "O código não está certo" }))
      const failedDevice = await appeared(other.page.locator("[role=alert]", { hasText: "O código não está certo" }))
      check(`${name}: a wrong code fails on the device with the account`, failedAccount)
      check(`${name}: and on the new device`, failedDevice)
      check(
        `${name}: with the number 770 on both screens`,
        (await sheet2.innerText()).includes("770") && (await other.page.locator("body").innerText()).includes("770"),
      )
      check(`${name}: and nobody saw words`, (await other.page.locator(".sas-palavras").count()) === 0)
      await sheet2.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
      const sheet3 = await openJoinSheet(tab1)
      await sheet3.getByLabel("Ou escreve o código").fill(other.code)
      await sheet3.getByRole("button", { name: "Continuar" }).click()
      const spent = await appeared(sheet3.locator("[role=alert]", { hasText: "Este código está errado, expirou ou já foi usado" }))
      check(`${name}: the right code after the wrong one no longer works`, spent)
      check(`${name}: with the number 771`, (await sheet3.innerText()).includes("771"))
      await sheet3.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
    }

    await browser.close()
    toClose.pop()
  }
} catch (error) {
  check("the script reached the end", false, String(error?.message ?? error).split("\n")[0])
  for (const line of log.filter((l) => /PAGEERROR|CONSOLA error/.test(l)).slice(-15)) console.log(line)
}

check("no system dialog", dialogs.length === 0, dialogs.join("; "))
// The code never crosses whole: the server sees only the nameplate.
const frames = log.filter((l) => l.includes("TRAMA>") && l.includes("pair.code"))
check("the server only receives the code's nameplate", frames.length > 0 && frames.every((l) => /"nameplate":"[2-9A-HJKMNP-Z]{2}"/.test(l)), `${frames.length} frames`)

while (toClose.length) await toClose.pop()().catch(() => {})
srv.fechar()
process.exit(summary() ? 0 : 1)
