/**
 * One password on every device of the account (1.3.26), through the interface,
 * in three browsers (each one a device) with two tabs. No desktop app here: it
 * would open the system keychain on the screen.
 *
 *   npm run build && node scripts/e2e-palavra-passe-da-conta.mjs
 *
 *  1. Ana is born in Chromium; Bruno shares a channel with her;
 *  2. Firefox pairs: after the six words it asks for "Palavra-passe da conta",
 *     refuses another one (Erro 140), and takes the right one; WebKit pairs too;
 *  3. a second tab of Chromium waits, and does not act;
 *  4. WebKit is off (its page closed, its storage kept);
 *  5. Chromium changes the password in Settings: the note says "on all devices",
 *     and offers "Guardar um ficheiro novo da conta";
 *  6. Firefox, on, says the password changed on another device; in a new tab
 *     the old password is refused and the new one opens;
 *  7. WebKit comes back: it opens with what it had, adopts the change, and in
 *     a new tab only the new password opens it;
 *  8. all three still write, and Bruno reads them.
 */
// Every page is watched: the centre of the screen stays inside the app (1.3.27).
import "./screen-guard.mjs"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, dizer, irParaEmparelhar, ouviu, pedirAmizade, temCanal, verificador } from "./fase7-comum.mjs"
import { abrirJuntarUmAparelho, colarCodigo, confirmarEAbrir } from "./juntar-aparelho.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const ANTIGA = "frase-de-verificacao-2026"
const NOVA = "palavra-nova-da-conta-2026"
const SEGUINTE = /^(Continuar|Seguinte)$/
const ESPERA = "Já tens o Orwell aberto noutro separador."
const MUDOU = "A palavra-passe da conta mudou noutro aparelho"
const CANAL = "moinho"

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8572, servidor: 8573, etiqueta: "palavra-passe-da-conta" })
const browsers = []
const aparelhos = {}

async function abrir(motor, nome) {
  const browser = await motor.launch({ headless: true })
  browsers.push(browser)
  const ctx = await browser.newContext({ locale: "pt-PT" })
  const page = await ctx.newPage()
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  aparelhos[nome] = { nome, browser, ctx, page }
  return aparelhos[nome]
}

const texto = (page) => page.locator("body").innerText()

/** Close the device's tab and open another: a new tab has no tab key, so the gate asks for the password. */
async function novaPagina(aparelho) {
  await aparelho.page.close()
  const page = await aparelho.ctx.newPage()
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  return page
}

/** The gate with a password: returns whether the app opened. */
async function entrarCom(page, frase) {
  const campo = page.locator('.gate-card input[type="password"]').first()
  await campo.waitFor({ timeout: 30_000 })
  await campo.fill(frase)
  // Not remembered: the next tab must ask again, or it would open with the remembered key.
  const caixa = page.locator('.gate-card input[name="memorizar"]')
  if ((await caixa.count()) && (await caixa.isChecked())) await caixa.uncheck()
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  return (await dentro(page, 20_000).then(() => true, () => false))
}

async function emparelhar(ana, motor, nome, { errada } = {}) {
  await ana.page.keyboard.press("Escape").catch(() => {})
  const { folha, link } = await abrirJuntarUmAparelho(ana.page)
  const novo = await abrir(motor, nome)
  await irParaEmparelhar(novo.page)
  check(`${nome}: não pede palavra-passe antes das palavras`, (await novo.page.locator('input[type="password"]').count()) === 0)
  await colarCodigo(novo.page, folha, link)
  const { recusou } = await confirmarEAbrir(novo.page, folha, ANTIGA, errada ? { errada } : {})
  check(`${nome}: depois das palavras pede "Palavra-passe da conta"`, true)
  if (errada) check(`${nome}: outra palavra-passe é recusada com o Erro 140`, recusou === true)
  const feito = await dentro(novo.page).then(() => true, () => false)
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  check(`${nome}: emparelha com a palavra-passe da conta`, feito)
  return novo
}

try {
  // 1. Ana, Bruno and the channel.
  const ana = await abrir(chromium, "chromium")
  await criarConta(ana.page, { nome: "Ana", frase: ANTIGA, servidor: srv.NOME })
  await dentro(ana.page)
  const ctxBruno = await ana.browser.newContext({ locale: "pt-PT" })
  const bruno = await ctxBruno.newPage()
  await bruno.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(bruno, { nome: "Bruno", frase: ANTIGA, servidor: srv.NOME })
  await dentro(bruno)
  const [enderecoAna] = contasDoServidor(srv.base)
  await pedirAmizade(bruno, enderecoAna)
  check("a Ana aceita a amizade", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(bruno, CANAL)
  check("o Bruno convida a Ana", await convidar(bruno, CANAL, enderecoAna))
  check("a Ana entra no canal", await aceitarConvite(ana.page, CANAL, { espera: 60_000 }))

  // 2. Firefox (with a wrong try first) and WebKit.
  const ff = await emparelhar(ana, firefox, "firefox", { errada: "nao-e-esta-palavra" })
  const wk = await emparelhar(ana, webkit, "webkit")

  // 3. A second tab of Chromium waits.
  const segunda = await ana.ctx.newPage()
  await segunda.goto(srv.APP, { waitUntil: "domcontentloaded" })
  check("chromium: o segundo separador espera", (await ate(async () => (await texto(segunda)).includes(ESPERA), 20_000, 500)) >= 0)

  // Every device in the channel, before one goes off.
  for (const a of [ff, wk]) check(`${a.nome}: está no canal ${CANAL}`, await temCanal(a.page, CANAL, 90_000))

  // 4. WebKit is off: the page closes, the storage stays.
  await wk.page.close()

  // 5. Chromium changes the password.
  await ana.page.keyboard.press("Escape").catch(() => {})
  await ana.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await ana.page.getByRole("button", { name: "Conta e segurança", exact: true }).first().click()
  await ana.page.getByRole("button", { name: "Mudar a palavra-passe" }).click()
  const form = ana.page.getByRole("dialog", { name: "Mudar a palavra-passe" })
  await form.locator('input[name="current-password"]').fill(ANTIGA)
  await form.locator('input[name="new-password"]').fill(NOVA)
  await form.locator('input[name="confirm-password"]').fill(NOVA)
  await form.getByRole("button", { name: "Mudar a palavra-passe" }).click()
  const disse = await ate(async () => (await texto(ana.page)).includes("Palavra-passe mudada. Os teus outros aparelhos recebem-na quando se ligarem."), 30_000, 300)
  check('chromium: "Palavra-passe mudada. Os teus outros aparelhos recebem-na quando se ligarem."', disse >= 0)
  check('chromium: oferece "Guardar um ficheiro novo da conta"', (await ana.page.getByRole("button", { name: "Guardar um ficheiro novo da conta" }).count()) > 0)
  check("chromium: o segundo separador continua à espera", (await texto(segunda)).includes(ESPERA))

  // 6. Firefox, on: the notice; reloaded, only the new password opens.
  check("firefox: diz que a palavra-passe mudou noutro aparelho", (await ate(async () => (await texto(ff.page)).includes(MUDOU), 30_000, 300)) >= 0)
  await ff.page.waitForTimeout(1500)
  // A new tab, not a reload: the tab key survives F5 (it follows the new vault key), a new tab asks.
  ff.page = await novaPagina(ff)
  check("firefox: a palavra-passe antiga já não abre", !(await entrarCom(ff.page, ANTIGA)))
  check("firefox: a nova abre", await entrarCom(ff.page, NOVA))

  // 7. WebKit comes back: what it had opens it, it adopts the change, then only the new one.
  wk.page = await wk.ctx.newPage()
  await wk.page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  check("webkit: volta e abre com a que tinha", await entrarCom(wk.page, ANTIGA))
  const viuAviso = await ate(async () => (await texto(wk.page)).includes(MUDOU), 60_000, 300)
  check("webkit: diz que a palavra-passe mudou noutro aparelho", viuAviso >= 0)
  await wk.page.waitForTimeout(1500)
  wk.page = await novaPagina(wk)
  check("webkit: a antiga já não abre", !(await entrarCom(wk.page, ANTIGA)))
  check("webkit: a nova abre", await entrarCom(wk.page, NOVA))

  // 8. Everyone still writes, and Bruno reads them.
  await abrirCanal(bruno, CANAL)
  for (const [nome, page] of [["chromium", ana.page], ["firefox", ff.page], ["webkit", wk.page]]) {
    await page.keyboard.press("Escape").catch(() => {})
    await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
    await abrirCanal(page, CANAL)
    const frase = `do ${nome} depois da mudança ${Date.now().toString(36)}`
    await dizer(page, frase)
    check(`o Bruno lê o ${nome} depois da mudança`, (await ouviu(bruno, frase)) >= 0)
  }
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of Object.values(aparelhos)) {
    for (const p of a.ctx.pages()) {
      const t = await p.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
      console.log(`--- ${a.nome} mostra: "${t.replace(/\s+/g, " ").slice(0, 600)}"`)
    }
  }
}

for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
process.exit(resumo() ? 0 : 1)
