/**
 * Captures of every screen of the new way in (21/11/2026), to set beside the
 * approved mock-ups: 1280 and 390 px, in the dark, light and Aurora themes.
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/capturar-entrada-nova.mjs <pasta> [temas=escuro,claro,aurora] [larguras=1280,390]
 *
 * Names: `<NN>-<ecra>-<tema>-<largura>.png`. Chromium, ALL LOCAL AND DISPOSABLE:
 * three servers on ports 8501 to 8506, never production.
 */
import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { chromium } from "playwright"
import { criarConta, passarOFicheiroDaConta } from "./conta.mjs"
import { dentro, espera } from "./fase7-comum.mjs"
import { abrirJuntarUmAparelho, colarCodigo } from "./juntar-aparelho.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const PASTA = resolve(process.argv[2] ?? join(RAIZ, "capturas/entrada-nova"))
const TEMAS = (process.argv[3] ?? "escuro,claro,aurora").split(",")
const LARGURAS = (process.argv[4] ?? "1280,390").split(",").map(Number)
const FRASE = "frase-de-verificacao-2026"
mkdirSync(PASTA, { recursive: true })

const aberto = await levantarServidor({ frente: 8501, servidor: 8502, etiqueta: "capturas-aberto" })
const fechado = await levantarServidor({ frente: 8503, servidor: 8504, etiqueta: "capturas-fechado", env: { ENCLAVE_REGISTO: "fechado" } })
const versao = await levantarServidor({ frente: 8505, servidor: 8506, etiqueta: "capturas-versao", env: { ENCLAVE_VERSAO_MINIMA_DO_CLIENTE: "9.0.0" } })
const browser = await chromium.launch({ headless: true })
let feitas = 0
const falhas = []

async function contexto(tema, largura) {
  const telemovel = largura < 600
  const ctx = await browser.newContext({
    locale: "pt-PT",
    acceptDownloads: true,
    viewport: { width: largura, height: telemovel ? 844 : 860 },
    ...(telemovel ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  })
  // The theme the way the app keeps it (`tema-cedo.ts`): the prefs in `localStorage`, before the page.
  await ctx.addInitScript((t) => {
    try {
      const prefs = JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}")
      localStorage.setItem("enclave.prefs", JSON.stringify({ ...prefs, tema: t }))
    } catch {
      // A context without storage keeps the default theme.
    }
  }, tema)
  return ctx
}

async function abrir(ctx, srv) {
  const page = await ctx.newPage()
  await page.goto(`${srv.APP}&servidor=${srv.NOME}`, { waitUntil: "domcontentloaded" })
  return page
}

/** Wait for the opening animation to leave and the card to settle, then capture. */
async function retratar(page, nn, ecra, tema, largura) {
  await page.locator(".abertura").first().waitFor({ state: "detached", timeout: 30_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready).catch(() => {})
  await espera(700)
  const nome = `${nn}-${ecra}-${tema}-${largura}.png`
  await page.screenshot({ path: join(PASTA, nome) })
  feitas++
}

const bemVindo = (page) => page.getByRole("heading", { name: "Bem-vindo ao Orwell" })

async function umaVolta(tema, largura) {
  const cap = (page, nn, ecra) => retratar(page, nn, ecra, tema, largura)
  const ctxA = await contexto(tema, largura)
  const ctxB = await contexto(tema, largura)
  const ctxC = await contexto(tema, largura)
  try {
    // The first screen, and "Criar conta".
    let a = await abrir(ctxA, aberto)
    await bemVindo(a).waitFor({ timeout: 60_000 })
    await cap(a, "01", "entrada")
    await a.getByRole("button", { name: "Criar conta", exact: true }).click()
    await a.locator('.gate input[autocomplete="nickname"]').fill("Duarte")
    await a.locator('input[name="new-password"]').fill(FRASE)
    await a.locator('input[name="confirm-password"]').fill(FRASE)
    await cap(a, "02", "criar-conta")
    await a.getByRole("button", { name: "Tenho um código de convite" }).click()
    await cap(a, "03", "criar-conta-convite")
    await a.locator('input[name="confirm-password"]').fill("outra-coisa-2026")
    await a.locator(".gate form").getByRole("button", { name: "Criar conta", exact: true }).click()
    await a.locator(".gate .error").first().waitFor({ timeout: 10_000 })
    await cap(a, "04", "criar-conta-erro")
    await a.locator('input[name="confirm-password"]').fill(FRASE)
    await a.locator('input[name="convite-de-registo"]').fill("")
    await a.locator(".gate form").getByRole("button", { name: "Criar conta", exact: true }).click()
    await a.getByRole("heading", { name: "Guarda o ficheiro da conta" }).waitFor({ timeout: 90_000 })
    await cap(a, "07", "guarda-o-ficheiro")
    await a.getByRole("button", { name: "Fazer mais tarde" }).click()
    await dentro(a)
    // On a computer the banner rides in the main column; with no channel open it may not draw (said in the log).
    const comFaixa = await a.locator(".faixa-do-ficheiro:visible").first().waitFor({ timeout: 20_000 }).then(() => true, () => false)
    if (!comFaixa) falhas.push(`${tema} ${largura}: a faixa do ficheiro não aparece no ecrã inicial da app`)
    await cap(a, "08", "faixa-do-ficheiro")

    // Settings › Conta e segurança, and "Mudar a palavra-passe".
    const config = a.getByRole("button", { name: "Configurações", exact: true }).first()
    if (await config.isVisible().catch(() => false)) await config.click()
    else {
      await a.locator(".separadores").getByRole("button", { name: "Tu", exact: true }).click()
      await a.getByRole("button", { name: "Configurações" }).first().click()
    }
    await a.getByRole("button", { name: "Conta e segurança", exact: true }).first().click()
    await a.locator(".conta-e-seguranca").waitFor({ timeout: 15_000 })
    await cap(a, "19", "conta-e-seguranca")
    await a.getByRole("button", { name: "Mudar a palavra-passe" }).click()
    await cap(a, "20", "mudar-a-palavra-passe")
    await a.locator(".sheet").getByRole("button", { name: "Fechar", exact: true }).click()
    await a.locator(".sheet").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {})
    // The account file, saved from Settings, for the file screens.
    await a.getByRole("button", { name: "Guardar o ficheiro da conta" }).click()
    const [descarga] = await Promise.all([
      a.waitForEvent("download", { timeout: 60_000 }),
      a.locator(".sheet").getByRole("button", { name: "Guardar o ficheiro", exact: true }).click(),
    ])
    const ficheiro = join(PASTA, `.conta-${tema}-${largura}.enclave`)
    await descarga.saveAs(ficheiro)

    // Another device: the code, the words on both, "Estás dentro".
    const { folha, link } = await abrirJuntarUmAparelho(a)
    let b = await abrir(ctxB, aberto)
    await bemVindo(b).waitFor({ timeout: 60_000 })
    await b.getByRole("button", { name: "Entrar com outro aparelho" }).click()
    await b.getByLabel("Ou cola o código").waitFor({ timeout: 10_000 })
    await cap(b, "16", "outro-aparelho-codigo")
    await cap(a, "16b", "juntar-um-aparelho-qr")
    await colarCodigo(b, folha, link)
    await cap(b, "17", "palavras-no-aparelho-novo")
    await cap(a, "17b", "palavras-no-aparelho-com-a-conta")
    await b.getByRole("button", { name: "Sim, juntar o aparelho" }).click()
    await folha.getByRole("button", { name: "Sim, juntar o aparelho" }).click()
    await b.getByRole("heading", { name: "Estás dentro" }).waitFor({ timeout: 90_000 })
    // The account password (one on all devices); with no record yet, a new one typed twice.
    const daConta = b.locator('input[name="current-password"]')
    if (await daConta.count()) await daConta.fill(FRASE)
    else {
      await b.locator('input[name="new-password"]').fill(FRASE)
      await b.locator('input[name="confirm-password"]').fill(FRASE)
    }
    await cap(b, "18", "estas-dentro")
    await b.getByRole("button", { name: "Abrir o Orwell" }).click()
    await dentro(b)
    // The device with the account publishes the new one only after "ready": close its sheet after that.
    await folha.getByText("O aparelho novo já está na conta.").waitFor({ timeout: 90_000 }).catch(() => {})
    await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})

    // Back on this device: "Olá", the error, "Esqueceste-te", "Usar outra conta".
    await a.close()
    a = await abrir(ctxA, aberto)
    await a.getByRole("heading", { name: /^Olá/ }).waitFor({ timeout: 60_000 })
    await cap(a, "12", "voltar")
    await a.locator('input[name="password"]').fill("errada-de-proposito")
    await a.getByRole("button", { name: "Entrar", exact: true }).click()
    await a.getByRole("alert").first().waitFor({ timeout: 60_000 })
    await cap(a, "13", "voltar-erro")
    await a.getByRole("button", { name: "Esqueci-me da palavra-passe" }).click()
    await a.getByRole("heading", { name: "Esqueceste-te da palavra-passe?" }).waitFor({ timeout: 10_000 })
    await cap(a, "14", "esqueceste")
    await a.getByRole("button", { name: "Voltar" }).click()
    await Promise.all([a.waitForEvent("load", { timeout: 30_000 }), a.getByRole("button", { name: "Usar outra conta" }).click()])
    await bemVindo(a).waitFor({ timeout: 60_000 })
    await cap(a, "15", "usar-outra-conta")

    // The account file, on the empty account.
    await a.getByRole("button", { name: "Entrar com o ficheiro da conta" }).click()
    await a.locator('input[name="import-password"]').waitFor({ timeout: 10_000 })
    await cap(a, "09", "ficheiro-vazio")
    await a.locator('.gate input[type="file"]').setInputFiles(ficheiro)
    await a.locator(".entrada-ficheiro-escolhido").waitFor({ timeout: 10_000 })
    await a.locator('input[name="import-password"]').fill(FRASE)
    await cap(a, "10", "ficheiro-escolhido")
    await a.locator('input[name="import-password"]').fill("errada-de-proposito")
    await a.getByRole("button", { name: "Entrar", exact: true }).click()
    await a.locator(".gate .error").first().waitFor({ timeout: 60_000 })
    await cap(a, "11", "ficheiro-erro")

    // The removed device: the account on the first browser revokes the second.
    await b.close()
    const c = await abrir(ctxC, aberto)
    await bemVindo(c).waitFor({ timeout: 60_000 })
    await c.getByRole("button", { name: "Entrar com o ficheiro da conta" }).click()
    await c.locator('.gate input[type="file"]').setInputFiles(ficheiro)
    await c.locator('input[name="import-password"]').fill(FRASE)
    await c.getByRole("button", { name: "Entrar", exact: true }).click()
    await dentro(c)
    // The device that did not add it sees "Novo aparelho na tua conta", with "Fui eu" and "Remover".
    b = await abrir(ctxB, aberto)
    await b.getByRole("heading", { name: /^Olá/ }).waitFor({ timeout: 60_000 })
    await b.locator('input[name="password"]').fill(FRASE)
    await b.getByRole("button", { name: "Entrar", exact: true }).click()
    await dentro(b)
    const cartao = b.locator(".cartao-aparelho-novo")
    if (await cartao.waitFor({ timeout: 60_000 }).then(() => true, () => false)) {
      await cap(b, "22", "aparelho-novo-na-conta")
      await cartao.getByRole("button", { name: "Fui eu" }).click()
    } else falhas.push(`${tema} ${largura}: o cartão "Novo aparelho na tua conta" não apareceu`)
    await b.close()
    const cfg = c.getByRole("button", { name: "Configurações", exact: true }).first()
    if (await cfg.isVisible().catch(() => false)) await cfg.click()
    else {
      await c.locator(".separadores").getByRole("button", { name: "Tu", exact: true }).click()
      await c.getByRole("button", { name: "Configurações" }).first().click()
    }
    await c.getByRole("button", { name: "Conta e segurança", exact: true }).first().click()
    await c.getByRole("button", { name: /^Aparelhos/ }).click()
    await c.locator(".aparelhos-lista li").nth(1).waitFor({ timeout: 15_000 })
    const outros = c.locator(".aparelhos-lista li:not(.este)").getByRole("button", { name: /^Revogar/ })
    const quantos = await outros.count()
    for (let i = 0; i < quantos; i++) {
      await outros.first().click()
      await c.getByRole("alertdialog").getByRole("button", { name: "Revogar" }).click()
      await c.getByText("O aparelho foi revogado.").first().waitFor({ timeout: 30_000 }).catch(() => {})
      await espera(1500)
    }
    b = await abrir(ctxB, aberto)
    await b.getByRole("heading", { name: /^Olá/ }).waitFor({ timeout: 60_000 })
    await b.locator('input[name="password"]').fill(FRASE)
    await b.getByRole("button", { name: "Entrar", exact: true }).click()
    await b.getByRole("heading", { name: "Este aparelho saiu da conta." }).waitFor({ timeout: 60_000 })
    await cap(b, "21", "aparelho-removido")
  } catch (erro) {
    falhas.push(`${tema} ${largura}: ${String(erro?.message ?? erro).split("\n").slice(0, 3).join(" ")}`)
    for (const [i, p] of ctxA.pages().entries()) await p.screenshot({ path: join(PASTA, `.falha-${tema}-${largura}-${i}.png`) }).catch(() => {})
  } finally {
    await ctxA.close().catch(() => {})
    await ctxB.close().catch(() => {})
    await ctxC.close().catch(() => {})
  }

  // A closed server, and an app older than the server's minimum.
  const ctxD = await contexto(tema, largura)
  try {
    const d = await abrir(ctxD, fechado)
    await bemVindo(d).waitFor({ timeout: 60_000 })
    await d.getByRole("button", { name: "Criar conta", exact: true }).click()
    await d.locator(".gate .error").first().waitFor({ timeout: 30_000 })
    await cap(d, "05", "servidor-fechado")
    const v = await abrir(ctxD, versao)
    await bemVindo(v).waitFor({ timeout: 60_000 })
    await v.getByRole("button", { name: "Criar conta", exact: true }).click()
    await v.getByText("Esta versão do Orwell é antiga. Actualiza para criar conta.").waitFor({ timeout: 30_000 })
    await cap(v, "06", "versao-antiga")
  } catch (erro) {
    falhas.push(`${tema} ${largura} (fechado/versão): ${String(erro?.message ?? erro).split("\n")[0]}`)
  } finally {
    await ctxD.close().catch(() => {})
  }
}

try {
  for (const tema of TEMAS) for (const largura of LARGURAS) await umaVolta(tema, largura)
} finally {
  await browser.close()
  for (const srv of [aberto, fechado, versao]) srv.fechar()
  console.log(`${feitas} capturas em ${PASTA}`)
  for (const f of falhas) console.log(`  !! ${f}`)
  process.exitCode = falhas.length ? 1 : 0
}
