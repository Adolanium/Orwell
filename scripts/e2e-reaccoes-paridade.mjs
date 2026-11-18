/**
 * Reactions like Discord, live: quick reactions, the virtual picker with skin
 * tones, who reacted, the phone's long press, Settings.
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/e2e-reaccoes-paridade.mjs
 *
 * Four accounts in one channel, two engines, two widths:
 *  - Ana: Chromium, desktop 1440 (mouse). Measures the picker with the CPU 4x slower.
 *  - Bruno: WebKit, desktop 1440 (mouse).
 *  - Carla: WebKit, phone 390 (touch).
 *  - Dora: Chromium, phone 390 (touch).
 *  - Eva: the 1.3.17 web (one reaction per emoji), Chromium 1440, on the same
 *    server, to prove the one-reaction rule lives with older clients
 *    (`ORWELL_DIST_ANTIGA`, by default the `build-1.3.17` worktree next to this one).
 * The accounts and the channel are made at desktop width; the phones then go to 390.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8796 and 8797 (or E2E_PORTA_DA_FRENTE and E2E_PORTA_DO_SERVIDOR). Captures in
 * `.verify-data/prova-reaccoes-paridade/`.
 */
import { existsSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, dizer, espera, ouviu, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const CANAL = "eira"
const CAPTURAS = join(RAIZ, ".verify-data/prova-reaccoes-paridade", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const DIST_ANTIGA = resolve(process.env.ORWELL_DIST_ANTIGA ?? join(RAIZ, "../build-1.3.17/apps/web/dist"))
if (!existsSync(join(DIST_ANTIGA, "index.html"))) throw new Error(`Falta a web 1.3.17 em ${DIST_ANTIGA} (ORWELL_DIST_ANTIGA).`)
const srv = await levantarServidor({ distAntiga: DIST_ANTIGA, frente: Number(process.env.E2E_PORTA_DA_FRENTE ?? 8796), servidor: Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8797), sfu: 0, etiqueta: "reaccoes-paridade" })
const browsers = []
const abertos = []
const registo = []

async function abrir(motor, nome, { telemovel = false, antiga = false } = {}) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1440, height: 900 }, ...(telemovel ? { deviceScaleFactor: 2, hasTouch: true } : {}) })
  if (antiga) await ctx.addCookies([{ name: "orwell-dist", value: "antiga", url: `http://${srv.NOME}` }])
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  page.on("console", (m) => {
    if (m.type() === "error") registo.push(`${nome} CONSOLA ${m.text().slice(0, 300)}`)
  })
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, page, telemovel }
  abertos.push(aparelho)
  return aparelho
}

const linha = (page, texto) => page.locator(".message").filter({ hasText: texto }).first()
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
/** The chips that are mine on a line. */
const minhas = async (page, texto) => (await fichas(page, texto)).filter((f) => f.minha).map((f) => f.emoji)

/** From now on, every chip count this page draws on the line, at each change of the DOM. */
async function vigiarFichas(page, texto) {
  await page.evaluate((texto) => {
    window.__contagens = []
    const contar = () => {
      const linha = [...document.querySelectorAll(".message")].find((m) => m.textContent?.includes(texto))
      if (!linha) return
      const minhas = linha.querySelectorAll('.reaccao[aria-pressed="true"]').length
      const pessoas = [...linha.querySelectorAll(".reaccao:not(.reaccao-mais) .reaccao-n")].reduce((s, n) => s + Number(n.textContent), 0)
      window.__contagens.push({ minhas, pessoas })
    }
    window.__vigia?.disconnect()
    window.__vigia = new MutationObserver(contar)
    window.__vigia.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
  }, texto)
}
const contagens = (page) => page.evaluate(() => window.__contagens ?? [])

/** Pick in the old (1.3.17) picker: the first result of the search. */
async function escolherNoAntigo(page, procura) {
  await page.locator(".emoji-grid").first().waitFor({ timeout: 10_000 })
  await page.getByLabel("Procurar emoji pelo nome").fill(procura)
  await espera(300)
  await page.locator(".emoji-grid button").first().click()
}

/** A real long press: pointer events of type touch, as `useToqueLongo` listens. */
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

/** From the click on "React" to the frame after the first emoji cell is in the DOM, measured in the page. */
async function medirAbertura(page, texto) {
  await linha(page, texto).hover()
  const botao = linha(page, texto).getByRole("button", { name: "Reagir", exact: true })
  await botao.waitFor()
  return botao.evaluate(
    (el) =>
      new Promise((resolve) => {
        const t0 = performance.now()
        const pronto = () => requestAnimationFrame(() => resolve({ ms: performance.now() - t0, casas: document.querySelectorAll(".emoji-grid .emoji-cell").length }))
        const ob = new MutationObserver(() => {
          if (document.querySelector(".emoji-grid .emoji-cell")) {
            ob.disconnect()
            pronto()
          }
        })
        ob.observe(document.body, { childList: true, subtree: true })
        el.click()
      }),
  )
}

try {
  // 0. Four accounts, friendships with Ana, the channel.
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(webkit, "bruno")
  await criarConta(bruno.page, { nome: "Bruno", servidor: srv.NOME })
  await dentro(bruno.page)
  const carla = await abrir(webkit, "carla", { telemovel: true })
  await criarConta(carla.page, { nome: "Carla", servidor: srv.NOME })
  await dentro(carla.page)
  const dora = await abrir(chromium, "dora", { telemovel: true })
  await criarConta(dora.page, { nome: "Dora", servidor: srv.NOME })
  await dentro(dora.page)
  const eva = await abrir(chromium, "eva-1.3.17", { antiga: true })
  await criarConta(eva.page, { nome: "Eva", servidor: srv.NOME })
  await dentro(eva.page)
  const versaoDaEva = await eva.page.evaluate(() => document.body.innerText.match(/1\.3\.\d+/)?.[0] ?? "")
  console.log(`   a Eva corre a web antiga (${DIST_ANTIGA})${versaoDaEva ? `, ${versaoDaEva}` : ""}`)
  const [enderecoAna, ...outros] = contasDoServidor(srv.base)
  await criarCanal(ana.page, CANAL)
  for (const [i, p] of [bruno, carla, dora, eva].entries()) {
    await pedirAmizade(p.page, enderecoAna)
    check(`a Ana aceita a amizade de ${p.nome}`, (await aceitarAmizade(ana.page)) >= 0)
    // Accepting leaves Ana on the friends list; the invite starts from the channel list.
    await ana.page.getByRole("button", { name: "Comunidades", exact: true }).first().click()
    check(`a Ana convida ${p.nome}`, await convidar(ana.page, CANAL, outros[i]))
    check(`${p.nome} entra no canal`, await aceitarConvite(p.page, CANAL, { espera: 60_000 }))
  }
  for (const p of [ana, bruno, carla, dora, eva]) await abrirCanal(p.page, CANAL)
  for (const p of [carla, dora]) await p.page.setViewportSize({ width: 390, height: 844 })

  const FRASE = "Quem traz o pao para a eira"
  await dizer(bruno.page, FRASE)
  for (const p of [ana, carla, dora, eva]) check(`a frase chega a ${p.nome}`, (await ouviu(p.page, FRASE)) >= 0)

  // 1. Hover bar: three quick reactions before "React".
  await linha(ana.page, FRASE).hover()
  const rapidas = await linha(ana.page, FRASE).locator(".msg-actions .msg-rapida").evaluateAll((bs) => bs.map((b) => b.textContent))
  check("a barra tem três reacções rápidas (de fábrica 👍 ❤️ 😂)", JSON.stringify(rapidas) === JSON.stringify(["👍", "❤️", "😂"]), JSON.stringify(rapidas))
  await ana.page.screenshot({ path: join(CAPTURAS, "1-ana-barra-rapida-chromium-1440.png") })
  await linha(ana.page, FRASE).locator(".msg-actions .msg-rapida", { hasText: "👍" }).click()
  check("a reacção rápida chega ao Bruno (WebKit)", (await ate(async () => (await fichaDe(bruno.page, FRASE, "👍"))?.n === 1, 60_000)) >= 0)
  check("e aos dois telemóveis", (await ate(async () => (await fichaDe(carla.page, FRASE, "👍"))?.n === 1 && (await fichaDe(dora.page, FRASE, "👍"))?.n === 1, 60_000)) >= 0)

  // 2. The picker, measured with the CPU 4x slower: first open (loads the catalog) and the second.
  const cdp = await ana.page.context().newCDPSession(ana.page)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  const primeira = await medirAbertura(ana.page, FRASE)
  await ana.page.keyboard.press("Escape")
  const segunda = await medirAbertura(ana.page, FRASE)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
  console.log(`   selector, CPU 4x: 1.ª ${primeira.ms.toFixed(0)} ms, 2.ª ${segunda.ms.toFixed(0)} ms; casas no DOM: ${segunda.casas}`)
  check("o selector abre em menos de 100 ms (2.ª vez, CPU 4x)", segunda.ms < 100, `${segunda.ms.toFixed(0)} ms`)
  check("a lista é virtual: menos de 200 casas no DOM de 1870", segunda.casas > 40 && segunda.casas < 200, `${segunda.casas}`)
  // Skin tone, then search: the toned emoji goes out.
  await ana.page.locator(".emoji-tom").click()
  await ana.page.getByRole("radio", { name: "Médio", exact: true }).click()
  await ana.page.getByLabel("Procurar emoji pelo nome").fill("polegar para cima")
  await espera(200)
  await ana.page.screenshot({ path: join(CAPTURAS, "2-ana-selector-tom-chromium-1440.png") })
  // One reaction per person: 👍🏽 replaces Ana's 👍, with no frame showing two or none.
  for (const p of [ana, bruno]) await vigiarFichas(p.page, FRASE)
  await ana.page.locator(".emoji-grid .emoji-cell").first().click()
  check("o emoji com tom chega ao Bruno", (await ate(async () => (await fichaDe(bruno.page, FRASE, "👍🏽"))?.n === 1, 60_000)) >= 0)
  check(
    "e troca a reacção da Ana: a 👍 sai, em todo o lado",
    (await ate(async () => !(await fichaDe(bruno.page, FRASE, "👍")) && !(await fichaDe(eva.page, FRASE, "👍")) && (await fichaDe(eva.page, FRASE, "👍🏽"))?.n === 1, 60_000)) >= 0,
    `Eva (1.3.17): ${JSON.stringify(await fichas(eva.page, FRASE))}`,
  )
  for (const p of [ana, bruno]) {
    const vistas = await contagens(p.page)
    const pessoas = new Set(vistas.map((c) => c.pessoas))
    check(`a troca não pisca em ${p.nome}: sempre uma pessoa, nunca zero nem duas`, vistas.length > 0 && pessoas.size === 1 && pessoas.has(1), JSON.stringify(vistas.slice(0, 12)))
  }

  // 3. Keyboard only: the arrows across the list, Enter on the search picks the first result.
  await linha(ana.page, FRASE).hover()
  await linha(ana.page, FRASE).getByRole("button", { name: "Reagir", exact: true }).click()
  await ana.page.locator(".emoji-grid .emoji-cell").first().waitFor()
  await ana.page.keyboard.press("ArrowDown")
  for (let i = 0; i < 30; i++) await ana.page.keyboard.press("ArrowDown")
  const focada = await ana.page.evaluate(() => document.activeElement?.getAttribute("data-i"))
  check("as setas descem pela lista virtual e o foco vai junto", Number(focada) >= 200, `casa ${focada}`)
  await ana.page.keyboard.press("Enter")
  const pelaTecla = await ate(async () => {
    const m = await minhas(ana.page, FRASE)
    return m.length === 1 && m[0] !== "👍🏽" && (await fichas(ana.page, FRASE)).length === 1
  }, 30_000)
  check("Enter na casa focada reage, e troca outra vez: uma ficha só", pelaTecla >= 0, JSON.stringify(await fichas(ana.page, FRASE)))

  // The bar marks the reaction that is mine; another quick one switches; the same one takes it back.
  // The bar holds this person's most used three by now, so the emoji are read from it.
  const barra = async () => {
    await linha(ana.page, FRASE).hover()
    return linha(ana.page, FRASE).locator(".msg-actions .msg-rapida").evaluateAll((bs) => bs.map((b) => b.textContent ?? ""))
  }
  // Exact text: "👍" is also inside "👍🏽".
  const exacto = (emoji) => new RegExp(`^${emoji.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "u")
  const rapida = (emoji) => linha(ana.page, FRASE).locator(".msg-actions .msg-rapida", { hasText: exacto(emoji) }).first()
  const actual = (await minhas(ana.page, FRASE))[0]
  const outra = (await barra()).find((e) => e !== actual && e !== "👍") ?? ""
  await rapida(outra).click()
  check(`a rápida ${outra} troca a minha`, (await ate(async () => JSON.stringify(await minhas(ana.page, FRASE)) === JSON.stringify([outra]) && (await fichas(ana.page, FRASE)).length === 1, 30_000)) >= 0)
  await barra()
  const marcada = await rapida(outra).getAttribute("aria-pressed")
  check("e a barra marca qual é", marcada === "true", marcada ?? "")
  await ana.page.screenshot({ path: join(CAPTURAS, "3-ana-barra-marca-a-minha-chromium-1440.png") })
  await rapida(outra).click()
  check("a mesma outra vez retira-a", (await ate(async () => (await fichas(bruno.page, FRASE)).length === 0, 60_000)) >= 0)
  check("o 👍 está na barra (usado antes)", (await barra()).includes("👍"))
  await rapida("👍").click()
  await ate(async () => (await fichaDe(bruno.page, FRASE, "👍"))?.n === 1, 60_000)

  // 4. Bruno joins by the chip, sees the names on hover, and the list by right click.
  await linha(bruno.page, FRASE).locator(".reaccao", { hasText: "👍" }).first().click()
  check("o Bruno junta-se à 👍: dois em todo o lado", (await ate(async () => (await fichaDe(dora.page, FRASE, "👍"))?.n === 2, 60_000)) >= 0)
  await linha(bruno.page, FRASE).locator(".reaccao", { hasText: "👍" }).first().click({ button: "right" })
  const folha = bruno.page.locator(".quem-reagiu")
  check("o botão direito na ficha abre quem reagiu", await folha.waitFor({ timeout: 10_000 }).then(() => true, () => false))
  const nomes = await folha.locator(".quem-reagiu-nome").allTextContents()
  check("e lista a Ana e o Bruno na 👍", nomes.some((n) => /Ana/.test(n)) && nomes.some((n) => /Bruno/.test(n)), JSON.stringify(nomes))
  await bruno.page.screenshot({ path: join(CAPTURAS, "4-bruno-quem-reagiu-webkit-1440.png") })
  await bruno.page.keyboard.press("Escape")

  // 5. Carla's phone (WebKit 390): long press opens the menu with the quick reactions.
  await toqueLongo(linha(carla.page, FRASE).locator("p").first())
  const filaRapida = carla.page.locator(".context-menu .menu-reacoes, .context-menu .menu-reaccoes")
  check("no telemóvel, o toque longo abre o menu com as reacções rápidas", await filaRapida.waitFor({ timeout: 10_000 }).then(() => true, () => false))
  await carla.page.screenshot({ path: join(CAPTURAS, "5-carla-menu-webkit-390.png") })
  await carla.page.locator(".context-menu .menu-reaccao", { hasText: "❤️" }).tap()
  check("a ❤️ do telemóvel chega à Ana", (await ate(async () => (await fichaDe(ana.page, FRASE, "❤️"))?.n === 1, 60_000)) >= 0)
  await carla.page.screenshot({ path: join(CAPTURAS, "5-carla-fichas-webkit-390.png") })

  // 6. Dora's phone (Chromium 390): long press on a chip opens who reacted; the menu has "See reactions".
  await toqueLongo(linha(dora.page, FRASE).locator(".reaccao", { hasText: "❤️" }).first())
  const folhaDora = dora.page.locator(".quem-reagiu")
  check("no telemóvel, o toque longo numa ficha abre quem reagiu", await folhaDora.waitFor({ timeout: 10_000 }).then(() => true, () => false))
  check("com a Carla na ❤️", /Carla/.test((await folhaDora.locator(".quem-reagiu-nome").allTextContents()).join(" ")))
  await dora.page.screenshot({ path: join(CAPTURAS, "6-dora-quem-reagiu-chromium-390.png") })
  await dora.page.getByRole("button", { name: "Fechar", exact: true }).last().tap()
  await toqueLongo(linha(dora.page, FRASE).locator("p").first())
  check('o menu tem "Ver reacções"', await dora.page.locator(".context-menu").getByRole("menuitem", { name: "Ver reacções" }).waitFor({ timeout: 10_000 }).then(() => true, () => false))
  await dora.page.screenshot({ path: join(CAPTURAS, "6-dora-menu-chromium-390.png") })
  await dora.page.keyboard.press("Escape").catch(() => {})
  for (const p of [carla, dora]) {
    const rola = await p.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    check(`a 390 px, ${p.nome} não tem rolagem horizontal`, !rola)
  }

  // 7. Reduced motion: a chip that arrives still animates, slower.
  await ana.page.emulateMedia({ reducedMotion: "reduce" })
  const OUTRA = "E a agua tambem"
  await dizer(bruno.page, OUTRA)
  await ouviu(ana.page, OUTRA)
  await ana.page.evaluate(() => {
    window.__animacoes = []
    document.addEventListener("animationstart", (e) => {
      window.__animacoes.push({ nome: e.animationName, ms: parseFloat(getComputedStyle(e.target).animationDuration) * 1000 })
    })
  })
  await linha(bruno.page, OUTRA).hover()
  await linha(bruno.page, OUTRA).locator(".msg-actions .msg-rapida", { hasText: "😂" }).click()
  await ate(async () => (await fichaDe(ana.page, OUTRA, "😂"))?.n === 1, 60_000)
  const animacoes = await ana.page.evaluate(() => window.__animacoes)
  const calma = animacoes.find((a) => a.nome === "reaccao-entra-calma")
  check("com movimento reduzido, a ficha nova entra na mesma, mais devagar", calma && calma.ms >= 600, JSON.stringify(animacoes))
  await ana.page.emulateMedia({ reducedMotion: "no-preference" })

  // 8. Living with 1.3.17. Eva reacts twice in the old web, which keeps both;
  // the new clients count only her later one.
  await linha(eva.page, FRASE).hover()
  await linha(eva.page, FRASE).getByRole("button", { name: "Reagir", exact: true }).click()
  await escolherNoAntigo(eva.page, "olhos")
  await ate(async () => (await minhas(eva.page, FRASE)).length === 1, 30_000)
  const E_ANTIGA_1 = (await minhas(eva.page, FRASE))[0] ?? ""
  // Both new clients have her first one before she adds the second.
  for (const p of [ana, bruno]) await ate(async () => (await fichaDe(p.page, FRASE, E_ANTIGA_1))?.n === 1, 60_000)
  await linha(eva.page, FRASE).hover()
  await linha(eva.page, FRASE).getByRole("button", { name: "Reagir", exact: true }).click()
  await escolherNoAntigo(eva.page, "festa")
  check(
    "a web 1.3.17 deixa a Eva com duas reacções",
    (await ate(async () => (await minhas(eva.page, FRASE)).length === 2, 30_000)) >= 0,
    JSON.stringify(await fichas(eva.page, FRASE)),
  )
  const doisDaEva = await minhas(eva.page, FRASE)
  const E_ANTIGA_2 = doisDaEva.find((e) => e !== E_ANTIGA_1) ?? ""
  await eva.page.screenshot({ path: join(CAPTURAS, "8-eva-1317-duas-reaccoes-chromium-1440.png") })
  for (const p of [ana, bruno]) {
    const so = await ate(async () => (await fichaDe(p.page, FRASE, E_ANTIGA_2))?.n === 1, 60_000)
    check(`${p.nome} conta só a mais recente da Eva (${E_ANTIGA_2}), não a ${E_ANTIGA_1}`, so >= 0 && !(await fichaDe(p.page, FRASE, E_ANTIGA_1)), JSON.stringify(await fichas(p.page, FRASE)))
  }
  await ana.page.screenshot({ path: join(CAPTURAS, "8-ana-uma-da-eva-chromium-1440.png") })
  // And the other way: Ana switches her 👍 to another in the new web; the old web ends with one for her.
  const paraOutra = (await barra()).find((e) => e !== "👍" && e !== E_ANTIGA_2) ?? ""
  await rapida(paraOutra).click()
  check(
    `a troca da Ana (👍 para ${paraOutra}) chega à web 1.3.17 como uma só`,
    (await ate(async () => (await fichaDe(eva.page, FRASE, paraOutra))?.n === 1 && (await fichaDe(eva.page, FRASE, "👍"))?.n === 1, 60_000)) >= 0,
    JSON.stringify(await fichas(eva.page, FRASE)),
  )
  await eva.page.screenshot({ path: join(CAPTURAS, "8-eva-1317-troca-da-ana-chromium-1440.png") })

  // 9. Settings: Ana pins 🌻 in the first slot; the hover bar follows.
  await ana.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await ana.page.getByRole("button", { name: "Conta", exact: true }).first().click().catch(() => {})
  await ana.page.getByRole("button", { name: /^Casa 1:/ }).click()
  await ana.page.getByLabel("Procurar emoji pelo nome").fill("girassol")
  await ana.page.keyboard.press("Enter")
  await espera(300)
  await ana.page.screenshot({ path: join(CAPTURAS, "8-ana-definicoes-chromium-1440.png") })
  await abrirCanal(ana.page, CANAL)
  await linha(ana.page, FRASE).hover()
  const depois = await linha(ana.page, FRASE).locator(".msg-actions .msg-rapida").first().textContent()
  check("a reacção escolhida nas Definições é a primeira da barra", depois === "🌻", depois ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of abertos) await a.page.screenshot({ path: join(CAPTURAS, `falha-${a.nome}.png`) }).catch(() => {})
}
for (const l of registo.slice(-30)) console.log(l)
for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
console.log(`\nCapturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
