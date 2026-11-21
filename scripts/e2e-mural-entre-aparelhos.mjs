/**
 * Posts between two devices of ONE account, in the browser (16/11/2026):
 * "what I post on the computer does not appear on the paired phone".
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/e2e-mural-entre-aparelhos.mjs
 *
 *  - Ana on Chromium at 1280 px (the main device);
 *  - Ana's phone: WebKit at 390 px, touch, paired by link;
 *  - Carla on Firefox at 1280 px, Ana's friend (each reads the other's feed).
 *
 * Carla posts before the pairing; then Ana posts on the computer, Carla posts
 * again, the phone reloads, and the phone posts. Each post on every screen that
 * should have it, live and after the reload.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8798 and 8799.
 */
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarAmizade, contasDoServidor, dentro, espera, irParaEmparelhar, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"
import { juntarComPalavras } from "./juntar-aparelho.mjs"

const FRASE = "frase-de-verificacao-2026"
const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8798, servidor: 8799, sfu: 0, etiqueta: "mural-entre-aparelhos" })
const browsers = []
const registo = []

async function abrir(motor, nome, contexto = {}) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 }, ...contexto })
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  return { nome, browser: b, ctx, page }
}

async function feed(page) {
  await page.getByRole("button", { name: "Feed", exact: true }).first().click()
  await page.getByPlaceholder(/Escreve uma publicação/).waitFor({ timeout: 30_000 })
}

async function publicar(page, texto) {
  await feed(page)
  await page.getByPlaceholder(/Escreve uma publicação/).fill(texto)
  await page.getByRole("button", { name: "Publicar" }).click()
}

const noFeed = (page, texto, ms = 60_000) =>
  page.locator(".card.post").filter({ hasText: texto }).first().waitFor({ timeout: ms }).then(() => true, () => false)

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

async function emparelhar(pc, motor, nome, contexto) {
  await pc.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await pc.getByRole("button", { name: "Conta e segurança", exact: true }).click()
  await pc.getByRole("button", { name: "Juntar um aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  const tel = await abrir(motor, nome, contexto)
  await irParaEmparelhar(tel.page)
  await juntarComPalavras(tel.page, folha, link, FRASE)
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await pc.keyboard.press("Escape").catch(() => {})
  await dentro(tel.page)
  return tel
}

try {
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const carla = await abrir(firefox, "carla")
  await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
  await dentro(carla.page)
  const [enderecoAna] = contasDoServidor(srv.base)
  await pedirAmizade(carla.page, enderecoAna)
  check("a Ana aceita a amizade da Carla", (await aceitarAmizade(ana.page)) >= 0)
  await publicar(carla.page, "Da Carla, antes do telemovel")
  await feed(ana.page)
  check("o post da Carla chega ao computador da Ana", await noFeed(ana.page, "Da Carla, antes do telemovel"))

  const tel = await emparelhar(ana.page, webkit, "telemovel", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  check("o telemóvel da Ana (WebKit) entra na conta", true)
  await feed(tel.page)
  check("o telemóvel tem o post anterior da Carla", await noFeed(tel.page, "Da Carla, antes do telemovel"))

  await publicar(ana.page, "Do computador da Ana")
  check("o post do computador aparece no computador", await noFeed(ana.page, "Do computador da Ana"))
  await feed(carla.page)
  check("e na Carla", await noFeed(carla.page, "Do computador da Ana"))
  check("e no telemóvel da Ana, ao vivo", await noFeed(tel.page, "Do computador da Ana"))

  await publicar(carla.page, "Da Carla, depois do telemovel")
  check("um post novo da Carla chega ao telemóvel", await noFeed(tel.page, "Da Carla, depois do telemovel"))

  await recarregar(tel.page)
  await feed(tel.page)
  for (const texto of ["Da Carla, antes do telemovel", "Do computador da Ana", "Da Carla, depois do telemovel"]) {
    check(`depois de recarregar, o telemóvel tem "${texto}"`, await noFeed(tel.page, texto, 30_000))
  }
  await tel.page.screenshot({ path: ".verify-data/mural-telemovel-390.png" }).catch(() => {})

  await publicar(tel.page, "Do telemovel da Ana")
  check("o post do telemóvel chega ao computador", await noFeed(ana.page, "Do telemovel da Ana"))
  check("e à Carla", await noFeed(carla.page, "Do telemovel da Ana"))
  await recarregar(ana.page)
  await feed(ana.page)
  check("depois de recarregar, o computador tem o post do telemóvel", await noFeed(ana.page, "Do telemovel da Ana", 30_000))
  await espera(300)
} catch (erro) {
  check("o guião correu até ao fim", false, String(erro?.message ?? erro).split("\n")[0])
} finally {
  for (const linha of registo.slice(-20)) console.log(linha)
  for (const b of browsers) await b.close().catch(() => {})
  srv.fechar()
  process.exitCode = resumo() ? 0 : 1
}
