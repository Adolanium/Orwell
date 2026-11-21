/**
 * Captures for the composer-toques branch (20/11/2026), on a disposable server
 * (ports 8794 and 8795). Not an e2e: it measures and takes pictures.
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/capturar-composer-toques.mjs [etiqueta]
 *
 * Part 1, the reply bar: one account, one channel, thirty lines. For each theme
 * (Escuro, Claro, Aurora) and each width (1280, 390) it opens "Reply" on the
 * last line and measures:
 *   - the conversation scroller ends where the composer starts (no overlap);
 *   - the last line is still in view, at the bottom, with the bar open and
 *     after the bar closes.
 *
 * Part 1b, the box grows: thirty lines with Shift+Enter, at 1280 and 390. The
 * box grows, stops at half of the conversation area and scrolls inside; the
 * conversation stays at the bottom; Enter sends and the box is one line again;
 * the message keeps its line breaks. With a finger (a touch context), Enter
 * starts a new line and the send button sends.
 *
 * Part 2, the nudge: Ana and Bruno become friends and open a direct. Bruno
 * goes to Communities, Ana nudges him, and the Friends button on Bruno's rail
 * turns red with a description. Opening Friends clears it.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarAmizade, abrirDirecta, criarCanal, dentro, dizer, contasDoServidor, espera, ouviu, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { abrirComunidade, voltarAConversa } from "./separadores.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const ETIQUETA = process.argv[2] ?? "depois"
const CAPTURAS = join(RAIZ, ".verify-data/composer-toques", ETIQUETA)
mkdirSync(CAPTURAS, { recursive: true })
const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8794, servidor: 8795, sfu: 0, etiqueta: "composer-toques" })
const browser = await chromium.launch({ headless: true })

/** The geometry that matters, read in the page. */
async function medir(page) {
  return page.evaluate(() => {
    const rolo = document.querySelector(".timeline")
    const caixa = document.querySelector("form.chat-composer")
    const linhas = [...document.querySelectorAll(".timeline .message")]
    const ultima = linhas.at(-1)
    const r = rolo?.getBoundingClientRect()
    const c = caixa?.getBoundingClientRect()
    const u = ultima?.getBoundingClientRect()
    return {
      roloFim: r ? Math.round(r.bottom) : null,
      caixaTopo: c ? Math.round(c.top) : null,
      caixaFim: c ? Math.round(c.bottom) : null,
      ultimaFim: u ? Math.round(u.bottom) : null,
      ultimaTopo: u ? Math.round(u.top) : null,
      faltaRolar: rolo ? Math.round(rolo.scrollHeight - rolo.scrollTop - rolo.clientHeight) : null,
      barra: document.querySelector(".composer-resposta") !== null,
      posicao: caixa ? getComputedStyle(caixa).position : null,
      transborda: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
}

async function medirCaixa(page) {
  return page.evaluate(() => {
    const caixa = document.querySelector("form.chat-composer textarea")
    const form = document.querySelector("form.chat-composer")
    const rolo = document.querySelector(".timeline")
    if (!caixa || !form || !rolo) return null
    return {
      altura: Math.round(caixa.getBoundingClientRect().height),
      rola: getComputedStyle(caixa).overflowY,
      area: rolo.clientHeight + form.offsetHeight,
      faltaRolar: Math.round(rolo.scrollHeight - rolo.scrollTop - rolo.clientHeight),
      roloFim: Math.round(rolo.getBoundingClientRect().bottom),
      caixaTopo: Math.round(form.getBoundingClientRect().top),
    }
  })
}

async function tema(page, nome, canal) {
  await page.evaluate((t) => {
    const actual = JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}") ?? {}
    localStorage.setItem("enclave.prefs", JSON.stringify({ ...actual, tema: t }))
  }, nome)
  await page.reload({ waitUntil: "domcontentloaded" })
  await dentro(page)
  await espera(1500)
  // At 390 px the phone layout (tabs): the channel's conversation is pushed from its line.
  await abrirComunidade(page, canal, { timeout: 30_000 })
  await espera(1200)
}

try {
  // ---------------------------------------------------------- part 1
  const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome: "Ana", servidor: srv.NOME })
  await dentro(page)
  await criarCanal(page, "lagar")
  for (let i = 1; i <= 30; i++) await dizer(page, `Linha número ${i} da conversa, para encher o ecrã.`)
  check("as trinta linhas saem", (await ouviu(page, "Linha número 30 da conversa")) >= 0)

  for (const nome of ["escuro", "claro", "aurora"]) {
    for (const largura of [1280, 390]) {
      await page.setViewportSize({ width: largura, height: largura === 390 ? 844 : 860 })
      await tema(page, nome, "lagar")
      const nota = `${nome} ${largura}px`
      const antes = await medir(page)
      const ultima = page.locator(".timeline .message").last()
      await ultima.click({ button: "right" })
      await page.getByRole("menuitem", { name: "Responder", exact: true }).first().click()
      await page.locator(".composer-resposta").waitFor({ timeout: 10_000 })
      await espera(400)
      const aberta = await medir(page)
      await page.screenshot({ path: join(CAPTURAS, `resposta-${nome}-${largura}.png`) })
      await page.keyboard.press("Escape")
      await espera(400)
      const fechada = await medir(page)
      console.log(`\n  ${nota}\n    antes:   ${JSON.stringify(antes)}\n    aberta:  ${JSON.stringify(aberta)}\n    fechada: ${JSON.stringify(fechada)}`)
      check(`${nota}: a barra abre`, aberta.barra)
      check(`${nota}: a conversa acaba onde a caixa começa`, aberta.roloFim !== null && aberta.caixaTopo !== null && aberta.roloFim <= aberta.caixaTopo)
      check(`${nota}: com a barra, a última linha fica à vista`, aberta.ultimaFim !== null && aberta.roloFim !== null && aberta.ultimaFim <= aberta.roloFim + 1 && aberta.faltaRolar <= 2)
      check(`${nota}: ao fechar, continua no fundo`, fechada.faltaRolar <= 2 && !fechada.barra)
      check(`${nota}: a página não rola de lado`, aberta.transborda <= 0)
    }
  }
  // ---------------------------------------------------------- part 1b
  for (const largura of [1280, 390]) {
    await page.setViewportSize({ width: largura, height: largura === 390 ? 844 : 860 })
    await tema(page, "escuro", "lagar")
    const nota = `caixa ${largura}px`
    const caixa = page.locator('textarea[placeholder="Escreve uma mensagem"]')
    await caixa.click()
    const uma = await medirCaixa(page)
    const medidas = {}
    for (let i = 1; i <= 30; i++) {
      await page.keyboard.type(`linha ${i}`)
      if (i < 30) await page.keyboard.press("Shift+Enter")
      // Two frames: the scroller's ResizeObserver runs in the next frame.
      if (i === 3 || i === 30) medidas[i] = await espera(100).then(() => medirCaixa(page))
    }
    console.log(`\n  ${nota}\n    uma: ${JSON.stringify(uma)}\n    três: ${JSON.stringify(medidas[3])}\n    trinta: ${JSON.stringify(medidas[30])}`)
    check(`${nota}: Shift+Enter não envia`, (await caixa.inputValue()).split("\n").length === 30)
    check(`${nota}: três linhas, a caixa cresce e a conversa fica no fundo`, medidas[3].altura > uma.altura && medidas[3].rola === "hidden" && medidas[3].faltaRolar <= 2)
    check(`${nota}: trinta linhas, pára a metade da área e rola por dentro`, medidas[30].altura <= Math.floor(medidas[30].area / 2) + 1 && medidas[30].altura >= Math.floor(medidas[30].area / 2) - 2 && medidas[30].rola === "auto")
    check(`${nota}: a conversa continua no fundo e acaba onde a caixa começa`, medidas[30].faltaRolar <= 2 && medidas[30].roloFim <= medidas[30].caixaTopo)
    await page.screenshot({ path: join(CAPTURAS, `caixa-alta-${largura}.png`) })
    await page.keyboard.press("Enter")
    await ouviu(page, "linha 30")
    await espera(500)
    const depois = await medirCaixa(page)
    check(`${nota}: Enter envia e a caixa volta a uma linha`, (await caixa.inputValue()) === "" && depois.altura === uma.altura)
    check(`${nota}: a conversa continua no fundo depois de enviar`, depois.faltaRolar <= 2)
    const texto = await page.locator(".timeline .message-body p").last().textContent()
    check(`${nota}: a mensagem guarda as quebras de linha`, (texto ?? "").includes("linha 1\nlinha 2"))
    await page.screenshot({ path: join(CAPTURAS, `caixa-enviada-${largura}.png`) })
  }
  await ctx.close()

  const ctxT = await browser.newContext({ locale: "pt-PT", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const dedo = await ctxT.newPage()
  await dedo.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(dedo, { nome: "Dora", servidor: srv.NOME })
  await dentro(dedo)
  // The account is in the common room. On the phone its line is in the
  // Communities list, and a tap pushes its conversation, with the box.
  await voltarAConversa(dedo)
  const caixaT = dedo.locator('textarea[placeholder="Escreve uma mensagem"]')
  await caixaT.waitFor({ timeout: 60_000 })
  await caixaT.tap()
  await dedo.keyboard.type("com o dedo")
  await dedo.keyboard.press("Enter")
  await dedo.keyboard.type("segunda")
  check("dedo: Enter muda de linha", (await caixaT.inputValue()) === "com o dedo\nsegunda")
  await dedo.locator("form.chat-composer .composer-enviar").tap()
  check("dedo: o botão envia", (await ouviu(dedo, "com o dedo")) >= 0 && (await caixaT.inputValue()) === "")
  await dedo.screenshot({ path: join(CAPTURAS, "dedo-390.png") })
  await ctxT.close()

  // ---------------------------------------------------------- part 2
  if (process.argv.includes("--sem-toque")) throw new Error("fim pedido")
  const ctxA = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  const ctxB = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  const ana = await ctxA.newPage()
  const bruno = await ctxB.newPage()
  await ana.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(ana, { nome: "Carla", servidor: srv.NOME })
  await dentro(ana)
  const antes = new Set(contasDoServidor(srv.base))
  await bruno.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(bruno, { nome: "Bruno", servidor: srv.NOME })
  await dentro(bruno)
  const endereco = contasDoServidor(srv.base).find((a) => !antes.has(a)) ?? null
  check("o endereço do Bruno lê-se", endereco !== null, String(endereco))
  if (endereco) {
    await pedirAmizade(ana, endereco)
    check("o Bruno aceita", (await aceitarAmizade(bruno)) >= 0)
    await abrirDirecta(ana)
    await dizer(ana, "Olá Bruno")
    await abrirDirecta(bruno)
    check("o Bruno lê", (await ouviu(bruno, "Olá Bruno")) >= 0)
    await bruno.getByRole("button", { name: "Comunidades", exact: true }).first().click()
    await espera(800)
    await ana.locator(".composer-buzz").click()
    const vermelho = await bruno
      .locator(".rail-btn.tocado")
      .waitFor({ timeout: 15_000 })
      .then(() => true, () => false)
    check("o botão Amigos do Bruno fica com o contorno do toque", vermelho)
    const descricao = await bruno.evaluate(() => {
      const botao = document.querySelector(".rail-btn.tocado")
      const ids = botao?.getAttribute("aria-describedby")?.split(" ") ?? []
      return { nome: botao?.getAttribute("aria-label"), descricao: ids.map((id) => document.getElementById(id)?.textContent).join(" "), cor: botao ? getComputedStyle(botao).color : null }
    })
    console.log("   ", JSON.stringify(descricao))
    check("a descrição anuncia a cotovelada", /cotovelada/i.test(descricao.descricao ?? ""))
    await bruno.screenshot({ path: join(CAPTURAS, "toque-vermelho-1280.png") })
    await bruno.getByRole("button", { name: "Amigos", exact: true }).first().click()
    await espera(600)
    check("abrir os Amigos apaga o toque", (await bruno.locator(".rail-btn.tocado").count()) === 0)
    await ana.locator(".composer-line").screenshot({ path: join(CAPTURAS, "linha-da-directa-1280.png") })
  }
} catch (erro) {
  if (String(erro?.message) !== "fim pedido") check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}
await browser.close().catch(() => {})
srv.fechar()
process.exit(resumo() ? 0 : 1)
