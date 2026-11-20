/**
 * Room links, live (17/11/2026): `@` and `#` in the box, the chip, the click,
 * a room the reader cannot open, and an old client beside.
 *
 *   npm run build && ORWELL_DIST_ANTIGO=<apps/web/dist of 1.3.7> \
 *     node --dns-result-order=ipv4first scripts/prova-ligar-salas.mjs chromium|webkit
 *
 * Ana (founder, Chromium) organises: a room "actas" in a category only admins
 * see, and a room "rascunho" she deletes later. Bruno, the reader measured, runs
 * on the engine named in the first argument, at 1440 and at 390 px. Carla runs
 * the OLD web on the same origin. Through the interface:
 *  1. Bruno's `#` lists the rooms he sees, under "Canais", and never "actas";
 *     his `@` lists people, then the "Canais" section. Ana's `#` has "actas".
 *  2. Ana sends "#anúncios", "#actas" and "#rascunho" with the lists, then
 *     deletes "rascunho".
 *  3. Bruno reads "#anúncios" as a button, and "#sala-sem-acesso" for the
 *     other two: no "actas" or "rascunho" anywhere in his page. The line is not
 *     lit as a mention. Clicking the chip opens "anúncios".
 *  4. Carla (old) reads the raw `<#id>`: no room name in her page either.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8964-8967. Captures in
 * `.verify-data/prova-ligar-salas/<motor>-<data>/`.
 */
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, espera, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const MOTOR = process.argv[2] ?? "chromium"
const PORTAS = { chromium: [8964, 8965], webkit: [8966, 8967] }
const FRASE = "frase-de-verificacao-2026"
const CANAL = "adega"
const CATEGORIA = "Direccao"
const ESCONDIDA = "actas"
const APAGADA = "rascunho"
const CAPTURAS = join(RAIZ, ".verify-data/prova-ligar-salas", `${MOTOR}-${new Date().toISOString().replace(/[:.]/g, "-")}`)
mkdirSync(CAPTURAS, { recursive: true })
const DIST_ANTIGO = process.env.ORWELL_DIST_ANTIGO ?? ""
const COM_ANTIGO = DIST_ANTIGO !== "" && existsSync(join(DIST_ANTIGO, "index.html"))

const { check, resumo } = verificador()
const [FRENTE, SERV] = PORTAS[MOTOR]
const srv = await levantarServidor({ frente: FRENTE, servidor: SERV, sfu: 0, etiqueta: `ligar-salas-${MOTOR}`, ...(COM_ANTIGO ? { distAntiga: DIST_ANTIGO } : {}) })
const browsers = []
const abertos = []
const registo = []

async function abrir(motor, nome, antiga = false) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1440, height: 900 } })
  if (antiga) await ctx.addCookies([{ name: "orwell-dist", value: "antiga", url: `http://${srv.NOME}` }])
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser: b, ctx, page }
  abertos.push(aparelho)
  return aparelho
}

const retratar = (page, nome) => page.screenshot({ path: join(CAPTURAS, `${nome}.png`) }).catch(() => {})
const caixa = (page) => page.locator(".chat-composer .composer-line textarea").first()
const linhaDaSala = (page, nome) => page.locator(".room-row", { has: page.locator(`.room-name:text-is("${nome}")`) }).first()
const linhaDoCanal = (page) => page.locator(".channel-row", { has: page.locator(".channel-name", { hasText: CANAL }) }).first()
const salaActual = (page) => page.locator(".room-row.current .room-name").first().innerText().catch(() => "")
const opcoes = (page) => page.locator(".mention-picker .mention-option").allInnerTexts()
const linhasDaLista = (page) => page.locator(".mention-picker > li").allInnerTexts()

/** Opens the sidebar on a phone if it is closed, runs `fazer`, and closes it again. */
async function naGaveta(page, fazer) {
  const gaveta = page.getByRole("button", { name: "Abrir o painel lateral" })
  const fechada = (await gaveta.isVisible().catch(() => false)) && (await gaveta.getAttribute("aria-expanded").catch(() => null)) !== "true"
  if (fechada) await gaveta.click().catch(() => {})
  await espera(400)
  try {
    return await fazer()
  } finally {
    if (fechada && (await gaveta.getAttribute("aria-expanded").catch(() => null)) === "true") await gaveta.click().catch(() => {})
  }
}

/**
 * Types `sinal` into an empty box and measures, in the page, from the key to the
 * list on screen. The clock starts on `keydown` and stops on the first frame
 * after the list is in the DOM.
 */
async function abrirLista(page, sinal) {
  await caixa(page).click()
  await caixa(page).fill("")
  await page.evaluate(() => {
    window.__lista = null
    const inicio = { t: 0 }
    document.addEventListener("keydown", () => (inicio.t = performance.now()), { capture: true, once: true })
    const vigia = new MutationObserver(() => {
      if (!document.querySelector(".mention-picker")) return
      vigia.disconnect()
      requestAnimationFrame(() => (window.__lista = performance.now() - inicio.t))
    })
    vigia.observe(document.body, { childList: true, subtree: true })
  })
  await page.keyboard.type(sinal)
  await page.locator(".mention-picker").first().waitFor({ timeout: 5_000 })
  await ate(() => page.evaluate(() => window.__lista !== null), 5_000, 50)
  return page.evaluate(() => window.__lista)
}

/** Picks a room from the list open on `sinal + procura`. */
async function escolherSala(page, sinal, procura, nome) {
  await caixa(page).pressSequentially(`${sinal}${procura}`, { delay: 40 })
  await page.locator(".mention-picker").first().waitFor({ timeout: 10_000 })
  await page.locator(".mention-picker .mention-option").filter({ hasText: nome }).first().click()
}

/** Creates a text room in the open channel, optionally in a category. */
async function criarSala(page, nome, categoria = "") {
  await linhaDoCanal(page).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Nova sala" }).first().click()
  const folha = page.getByRole("dialog")
  await folha.getByLabel("Nome", { exact: true }).fill(nome)
  if (categoria) await folha.getByLabel("Categoria").fill(categoria)
  await folha.locator(".sheet-actions button.primary").first().click()
  await linhaDaSala(page, nome).waitFor({ timeout: 30_000 })
}

try {
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(MOTOR === "webkit" ? webkit : chromium, "bruno")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const carla = COM_ANTIGO ? await abrir(chromium, "carla", true) : null
  if (carla) {
    await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
    await dentro(carla.page)
  } else console.log("   SALTA a Carla: sem ORWELL_DIST_ANTIGO.")
  const [enderecoAna, enderecoBruno, enderecoCarla] = contasDoServidor(srv.base)
  await pedirAmizade(bruno.page, enderecoAna)
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana.page)) >= 0)
  if (carla) {
    await pedirAmizade(carla.page, enderecoAna)
    check("a Ana aceita a amizade da Carla", (await aceitarAmizade(ana.page)) >= 0)
  }
  await criarCanal(ana.page, CANAL)
  check("o Bruno entra", (await convidar(ana.page, CANAL, enderecoBruno)) && (await aceitarConvite(bruno.page, CANAL, { espera: 60_000 })))
  if (carla) check("a Carla entra", (await convidar(ana.page, CANAL, enderecoCarla)) && (await aceitarConvite(carla.page, CANAL, { espera: 60_000 })))
  for (const p of [ana, bruno, carla].filter(Boolean)) await abrirCanal(p.page, CANAL)

  // A hidden room: category "Direccao", only admins see it.
  await linhaDoCanal(ana.page).click({ button: "right" })
  await ana.page.getByRole("menuitem", { name: "Nova categoria" }).first().click()
  await ana.page.getByRole("dialog").getByLabel("Nome", { exact: true }).fill(CATEGORIA)
  await ana.page.getByRole("dialog").locator(".sheet-actions button.primary, button.primary").first().click()
  await espera(2000)
  await criarSala(ana.page, ESCONDIDA, CATEGORIA)
  await ana.page.locator(".room-category, .category-name").filter({ hasText: CATEGORIA }).first().click({ button: "right" })
  await ana.page.getByRole("menuitem", { name: "Quem vê esta categoria" }).first().click()
  const folha = ana.page.getByRole("dialog")
  await folha.getByLabel("Só quem administra").check()
  await folha.getByRole("button", { name: "Guardar" }).click()
  await espera(2000)
  await criarSala(ana.page, APAGADA)
  const brunoSemActas = await ate(
    async () =>
      (await linhaDaSala(bruno.page, APAGADA).isVisible().catch(() => false)) &&
      !(await bruno.page.locator(`.room-name:text-is("${ESCONDIDA}")`).count()),
    60_000,
    1000,
  )
  check("o Bruno vê «rascunho» e não vê «actas» na barra", brunoSemActas >= 0)
  await retratar(ana.page, "0-ana-salas-1440")

  // 1. The lists. Bruno at 1440, then at 390.
  for (const largura of [1440, 390]) {
    await bruno.page.setViewportSize({ width: largura, height: largura === 390 ? 844 : 900 })
    await espera(500)
    const msCardinal = await abrirLista(bruno.page, "#")
    const deCardinal = await opcoes(bruno.page)
    check(`${largura}: o # do Bruno abre em ${msCardinal.toFixed(1)} ms (< 50)`, msCardinal < 50)
    check(`${largura}: o # do Bruno tem «anúncios» e não tem «actas»`, deCardinal.includes("anúncios") && !deCardinal.some((o) => o.includes(ESCONDIDA)), deCardinal.join(", "))
    check(`${largura}: o # tem o título «Canais»`, (await bruno.page.locator(".mention-picker .mention-seccao").innerText().catch(() => "")).toLowerCase() === "canais")
    await retratar(bruno.page, `1-bruno-cardinal-${largura}`)
    await bruno.page.keyboard.press("Escape")
    const msArroba = await abrirLista(bruno.page, "@")
    const linhas = await linhasDaLista(bruno.page)
    const seccao = linhas.findIndex((l) => l.toLowerCase() === "canais")
    check(`${largura}: o @ do Bruno abre em ${msArroba.toFixed(1)} ms (< 50)`, msArroba < 50)
    check(`${largura}: o @ mostra pessoas e depois a secção Canais`, seccao > 0 && linhas.slice(seccao + 1).length > 0, linhas.join(" | "))
    check(`${largura}: o @ não tem «actas»`, !linhas.some((l) => l.includes(ESCONDIDA)))
    await retratar(bruno.page, `1-bruno-arroba-${largura}`)
    await bruno.page.keyboard.press("Escape")
    await caixa(bruno.page).fill("")
  }
  await bruno.page.setViewportSize({ width: 1440, height: 900 })

  // Ana's # has the hidden room: she administers.
  await abrirLista(ana.page, "#")
  check("o # da Ana tem «actas» (administra)", (await opcoes(ana.page)).includes(ESCONDIDA))
  await ana.page.keyboard.press("Escape")
  await caixa(ana.page).fill("")

  // 2. Ana sends, with the lists: # for two rooms, @ for the third.
  const campo = caixa(ana.page)
  await campo.click()
  await campo.pressSequentially("vejam ", { delay: 10 })
  await escolherSala(ana.page, "#", "anú", "anúncios")
  await campo.pressSequentially("e ", { delay: 10 })
  await escolherSala(ana.page, "#", "act", ESCONDIDA)
  await campo.pressSequentially("e ", { delay: 10 })
  await escolherSala(ana.page, "@", "rasc", APAGADA)
  await campo.pressSequentially("hoje", { delay: 10 })
  await retratar(ana.page, "2-ana-caixa-1440")
  await ana.page.keyboard.press("Enter")
  const naAna = ana.page.locator(".message").filter({ hasText: "hoje" }).last()
  await naAna.waitFor({ timeout: 15_000 })
  const pilulasDaAna = async () => (await naAna.locator(".mention-sala").allInnerTexts().catch(() => [])).join(" ")
  const daAna = await ate(async () => (await pilulasDaAna()) === `#anúncios #${ESCONDIDA} #${APAGADA}`, 15_000)
  check("na Ana, as três pílulas têm o nome", daAna >= 0, `${await pilulasDaAna()} | ${await ana.page.locator(".message").count()} linhas | sala ${await salaActual(ana.page)}`)
  await retratar(ana.page, "2-ana-enviada-1440")

  // Delete "rascunho".
  await linhaDaSala(ana.page, APAGADA).click({ button: "right" })
  await ana.page.locator(".context-menu").getByRole("menuitem", { name: "Fechar sala" }).click()
  await espera(1500)
  // The button's name is `rooms.removeTitle(nome)`, "Eliminar <nome>".
  await ana.page.getByRole("button", { name: "Eliminar " + APAGADA }).click({ timeout: 15_000 })
  await ana.page.getByRole("button", { name: "Eliminar sala" }).click()
  const saiu = await ate(async () => !(await bruno.page.locator(`.room-name:text-is("${APAGADA}")`).count()), 60_000, 1000)
  check("«rascunho» eliminada sai da barra do Bruno", saiu >= 0)

  // 3. Bruno reads.
  const linhaBruno = bruno.page.locator(".message").filter({ hasText: "hoje" }).last()
  check("a mensagem chega ao Bruno", (await ate(() => linhaBruno.isVisible(), 60_000)) >= 0)
  await espera(1500)
  for (const largura of [1440, 390]) {
    await bruno.page.setViewportSize({ width: largura, height: largura === 390 ? 844 : 900 })
    await espera(600)
    const pilulas = await linhaBruno.locator(".mention-sala").allInnerTexts()
    check(`${largura}: o Bruno lê #anúncios, e #sala-sem-acesso para «actas» e «rascunho»`, pilulas.join(" ") === "#anúncios #sala-sem-acesso #sala-sem-acesso", pilulas.join(" "))
    const html = await linhaBruno.innerHTML()
    check(`${largura}: nenhum nome escondido ou apagado na linha do Bruno`, !html.includes(ESCONDIDA) && !html.includes(APAGADA))
    check(`${largura}: as neutras não são botões`, (await linhaBruno.locator("button.mention-sala-privada").count()) === 0)
    check(`${largura}: a linha não acende como menção`, !((await linhaBruno.getAttribute("class")) ?? "").includes("menciona-me"))
    await linhaBruno.scrollIntoViewIfNeeded()
    await retratar(bruno.page, `3-bruno-pilulas-${largura}`)
  }
  check("e na página inteira do Bruno também não", !(await bruno.page.content()).includes(ESCONDIDA))

  // Click: from the default room to "anúncios", at 390 and then at 1440.
  for (const largura of [390, 1440]) {
    await bruno.page.setViewportSize({ width: largura, height: largura === 390 ? 844 : 900 })
    await espera(500)
    // The chip's name is `etiquetas.irParaSala(nome)`, "Abrir a sala <nome>".
    await linhaBruno.getByRole("button", { name: "Abrir a sala " + "anúncios" }).click()
    const foi = await ate(async () => (await naGaveta(bruno.page, () => salaActual(bruno.page))) === "anúncios", 10_000, 300)
    check(`${largura}: clicar em #anúncios abre a sala`, foi >= 0)
    await retratar(bruno.page, `4-bruno-depois-de-clicar-${largura}`)
    // Back to the room with the link.
    const voltar = await naGaveta(bruno.page, async () => {
      const atual = bruno.page.locator(".room-tree .room-row").first()
      await atual.locator("button.room").click()
      return salaActual(bruno.page)
    })
    await espera(800)
    if (!(await linhaBruno.isVisible().catch(() => false))) console.log("   (a sala da ligação não é a primeira da árvore:", voltar, ")")
  }

  // 4. The old client.
  if (carla) {
    const linhaCarla = carla.page.locator(".message").filter({ hasText: "hoje" }).last()
    check("a mensagem chega à Carla (antiga)", (await ate(() => linhaCarla.isVisible(), 60_000)) >= 0)
    const texto = await linhaCarla.innerText()
    console.log(`   a Carla (antiga) lê: ${JSON.stringify(texto.split("\n").find((l) => l.includes("hoje")) ?? texto)}`)
    check("a Carla lê os <#id> em texto, legível", /vejam <#[A-Za-z0-9._-]*> e <#[A-Za-z0-9._-]*> e <#[A-Za-z0-9._-]*> hoje/.test(texto))
    check("e nenhum nome de sala aparece na página dela", !(await carla.page.content()).includes(ESCONDIDA))
    await retratar(carla.page, "5-carla-antiga-1440")
    await carla.page.setViewportSize({ width: 390, height: 844 })
    await espera(800)
    await linhaCarla.scrollIntoViewIfNeeded().catch(() => {})
    await retratar(carla.page, "5-carla-antiga-390")
  }
  check("ninguém tem erros na página", registo.length === 0, registo.join(" | "))
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of abertos) await a.page.screenshot({ path: join(CAPTURAS, `falha-${a.nome}.png`) }).catch(() => {})
}
for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
console.log(`\nCapturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
