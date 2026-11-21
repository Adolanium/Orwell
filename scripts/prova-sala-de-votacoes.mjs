/**
 * The polls room is a room (17/11/2026): drag, rename, delete, and deleting it
 * deletes its polls. Live, with an old client beside.
 *
 *   npm run build && ORWELL_DIST_ANTIGO=<apps/web/dist of 1.3.15 or 1.3.16> \
 *     node --dns-result-order=ipv4first scripts/prova-sala-de-votacoes.mjs [etiqueta]
 *
 * Ana (founder, Chromium, mouse) organises. Bruno (WebKit, 390 px, touch) reads.
 * Carla runs the OLD web on the same origin, so the proof also says what an
 * old client sees after each gesture. Through the interface:
 *  1. no fixed "Polls" row in the tree; "Polls" in the channel menu creates a
 *     polls room, which sits in the tree like any other room;
 *  2. a poll in it reaches Bruno and Carla;
 *  3. Ana drags the room above "anúncios" with the mouse: the order reaches Bruno;
 *  4. Bruno's long press opens the room menu, like on any room;
 *  5. Ana renames it: the name reaches Bruno and Carla;
 *  6. Ana closes and deletes it: it leaves Bruno, and the poll is shown nowhere,
 *     not even in the default room, also after a reload. What Carla shows is
 *     recorded, not judged: an old client cannot learn the new rule.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8956 and 8957. Captures in
 * `.verify-data/prova-sala-de-votacoes/<etiqueta>-<data>/`.
 */
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, espera, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"
import { mostrarLista, noTelemovel, profundidade, voltarAConversa } from "./separadores.mjs"

const ETIQUETA = process.argv[2] ?? "prova"
const FRASE = "frase-de-verificacao-2026"
const CANAL = "lagar"
const PERGUNTA = "Jantar na sexta?"
const CAPTURAS = join(RAIZ, ".verify-data/prova-sala-de-votacoes", `${ETIQUETA}-${new Date().toISOString().replace(/[:.]/g, "-")}`)
mkdirSync(CAPTURAS, { recursive: true })
const DIST_ANTIGO = process.env.ORWELL_DIST_ANTIGO ?? ""
const COM_ANTIGO = DIST_ANTIGO !== "" && existsSync(join(DIST_ANTIGO, "index.html"))

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8956, servidor: 8957, sfu: 0, etiqueta: "sala-de-votacoes", ...(COM_ANTIGO ? { distAntiga: DIST_ANTIGO } : {}) })
const browsers = []
const abertos = []
const registo = []

async function abrir(motor, nome, contexto = {}, antiga = false) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 }, ...contexto })
  if (antiga) await ctx.addCookies([{ name: "orwell-dist", value: "antiga", url: `http://${srv.NOME}` }])
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser: b, ctx, page }
  abertos.push(aparelho)
  return aparelho
}

const retratar = (page, nome) => page.screenshot({ path: join(CAPTURAS, `${nome}.png`) }).catch(() => {})
const linhaDaSala = (page, nome) => page.locator(".room-row", { has: page.locator(`.room-name:text-is("${nome}")`) }).first()
const nomesDasSalas = (page) => page.locator(".room-tree .room-row .room-name").allInnerTexts()
const linhaDoCanal = (page) => page.locator(".channel-row", { has: page.locator(".channel-name", { hasText: CANAL }) }).first()

/**
 * On a phone, shows the Communities list (the room tree), runs `fazer`, and
 * pushes the conversation back if one was on screen. Since option B
 * (20/11/2026) the list is a tab, not a drawer. On a computer, just `fazer`.
 */
async function naGaveta(page, fazer) {
  const telemovel = await noTelemovel(page)
  const naConversa = telemovel && (await profundidade(page)) > 0
  if (telemovel) await mostrarLista(page)
  await espera(400)
  try {
    return await fazer()
  } finally {
    if (naConversa) await voltarAConversa(page)
  }
}

async function toqueLongo(alvo, ms = 800) {
  const caixa = await alvo.boundingBox()
  if (!caixa) throw new Error("o alvo do toque longo não está no ecrã")
  const x = Math.round(caixa.x + caixa.width / 2)
  const y = Math.round(caixa.y + caixa.height / 2)
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

/** Is the poll card or question anywhere on the screen? */
const veAPergunta = (page) => page.getByText(PERGUNTA).first().isVisible().catch(() => false)

try {
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  // A touch screen; the phone width comes after joining (the invite helpers drive the wide layout).
  const bruno = await abrir(webkit, "bruno", { hasTouch: true })
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const carla = COM_ANTIGO ? await abrir(chromium, "carla", {}, true) : null
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
  await bruno.page.setViewportSize({ width: 390, height: 844 })
  await espera(500)

  // 1. No fixed row; the channel menu creates a real polls room.
  check("a Ana não tem a linha fixa «Votações»", (await ana.page.locator(".room-votacoes").count()) === 0)
  await linhaDoCanal(ana.page).click({ button: "right" })
  await ana.page.locator(".context-menu").getByRole("menuitem", { name: "Votações" }).click()
  await ana.page.getByRole("button", { name: "Criar sala de votações" }).click({ timeout: 15_000 })
  await ana.page.locator(".sheet input").first().fill("polls")
  await ana.page.locator(".kind-choice").getByRole("button", { name: "Votações", exact: true }).click()
  await ana.page.locator(".sheet-actions button.primary").first().click()
  await linhaDaSala(ana.page, "polls").waitFor({ timeout: 30_000 })
  check("a sala «polls» está na árvore e arrasta-se, como as outras", (await linhaDaSala(ana.page, "polls").getAttribute("draggable")) === "true")
  await retratar(ana.page, "1-ana-sala-criada")

  // 2. A poll in it.
  await linhaDaSala(ana.page, "polls").locator("button.room").click()
  await ana.page.getByRole("button", { name: "Nova votação" }).click()
  await ana.page.locator('.sheet input[placeholder="O que queres perguntar?"]').fill(PERGUNTA)
  const campos = ana.page.locator('.sheet input[placeholder="Resposta"]')
  await campos.nth(0).fill("Sim")
  await campos.nth(1).fill("Não")
  await ana.page.locator(".sheet-actions button.primary").first().click()
  await espera(2000)
  const brunoTemSala = await ate(() => naGaveta(bruno.page, () => linhaDaSala(bruno.page, "polls").isVisible()), 60_000, 1000)
  check("a sala chega ao Bruno (telemóvel)", brunoTemSala >= 0)
  await naGaveta(bruno.page, () => linhaDaSala(bruno.page, "polls").locator("button.room").click())
  check("o Bruno vê a votação na sala", (await ate(() => veAPergunta(bruno.page), 60_000)) >= 0)
  await retratar(bruno.page, "2-bruno-votacao-390")
  if (carla) {
    await espera(2000)
    await retratar(carla.page, "2-carla-antiga")
    console.log("   a Carla (antiga) tem a sala:", await linhaDaSala(carla.page, "polls").isVisible().catch(() => false))
  }

  // 3. Drag with the mouse, above "anúncios".
  await linhaDaSala(ana.page, "polls").dragTo(linhaDaSala(ana.page, "anúncios"))
  const subiu = async (page) => {
    const nomes = await nomesDasSalas(page)
    return nomes.indexOf("polls") >= 0 && nomes.indexOf("polls") < nomes.indexOf("anúncios")
  }
  check("arrastada, fica acima de «anúncios» na Ana", (await ate(() => subiu(ana.page), 15_000)) >= 0, (await nomesDasSalas(ana.page)).join(", "))
  check("e a ordem chega ao Bruno", (await ate(() => naGaveta(bruno.page, () => subiu(bruno.page)), 60_000, 1000)) >= 0)
  await retratar(ana.page, "3-ana-depois-de-arrastar")
  if (carla) console.log("   ordem na Carla (antiga):", (await nomesDasSalas(carla.page)).join(", "))

  // 4. Bruno's long press opens the room menu.
  await naGaveta(bruno.page, async () => {
    await toqueLongo(linhaDaSala(bruno.page, "polls"))
    const menu = await bruno.page.locator(".context-menu").first().isVisible({ timeout: 3000 }).catch(() => false)
    check("o toque longo do Bruno abre o menu da sala, como nas outras", menu)
    await retratar(bruno.page, "4-bruno-toque-longo-390")
    await bruno.page.keyboard.press("Escape").catch(() => {})
  })

  // 5. Rename.
  await linhaDaSala(ana.page, "polls").click({ button: "right" })
  await ana.page.locator(".context-menu").getByRole("menuitem", { name: "Mudar o nome" }).click()
  await ana.page.locator("form.prompt input").first().fill("votos do mês")
  await ana.page.locator("form.prompt button.primary").first().click()
  check("renomeada na Ana", (await ate(() => linhaDaSala(ana.page, "votos do mês").isVisible(), 15_000)) >= 0)
  check("o nome novo chega ao Bruno", (await ate(() => naGaveta(bruno.page, () => linhaDaSala(bruno.page, "votos do mês").isVisible()), 60_000, 1000)) >= 0)
  if (carla) {
    const carlaNome = await ate(() => linhaDaSala(carla.page, "votos do mês").isVisible(), 60_000, 1000)
    check("o nome novo chega à Carla (antiga)", carlaNome >= 0)
  }
  await retratar(ana.page, "5-ana-renomeada")

  // 6. Close, then delete. The poll goes with it.
  await linhaDaSala(ana.page, "votos do mês").click({ button: "right" })
  await ana.page.locator(".context-menu").getByRole("menuitem", { name: "Fechar sala" }).click()
  await espera(1500)
  // The button's name is `rooms.removeTitle(nome)`, "Eliminar <nome>".
  const NOME_NOVO = "votos do mês"
  await ana.page.getByRole("button", { name: "Eliminar " + NOME_NOVO }).click({ timeout: 15_000 })
  const corpoDoAviso = await ana.page.locator(".confirmar-corpo").first().innerText().catch(() => "")
  check("o aviso diz que as votações são eliminadas", /votações dela são eliminadas/.test(corpoDoAviso), corpoDoAviso)
  await retratar(ana.page, "6-ana-aviso-de-eliminar")
  await ana.page.getByRole("button", { name: "Eliminar sala" }).click()
  await espera(2000)
  check("eliminada: sai da Ana", (await ana.page.locator('.room-name:text-is("votos do mês")').count()) === 0)
  check("na sala por omissão da Ana a votação não aparece", !(await veAPergunta(ana.page)))
  const saiuDoBruno = await ate(() => naGaveta(bruno.page, async () => (await bruno.page.locator('.room-name:text-is("votos do mês")').count()) === 0), 60_000, 1000)
  check("eliminada: sai do Bruno", saiuDoBruno >= 0)
  await espera(1500)
  check("no Bruno, na sala por omissão, a votação não aparece", !(await veAPergunta(bruno.page)))
  await retratar(bruno.page, "6-bruno-depois-de-eliminar-390")
  await bruno.page.setViewportSize({ width: 1280, height: 860 })
  await bruno.page.reload({ waitUntil: "domcontentloaded" })
  await dentro(bruno.page)
  await abrirCanal(bruno.page, CANAL)
  await bruno.page.setViewportSize({ width: 390, height: 844 })
  await espera(3000)
  check("depois de recarregar (cofre e recuperação), a votação continua sem aparecer no Bruno", !(await veAPergunta(bruno.page)))
  check("e a sala não volta", (await naGaveta(bruno.page, () => bruno.page.locator('.room-name:text-is("votos do mês")').count())) === 0)
  if (carla) {
    await espera(3000)
    const carlaSala = await linhaDaSala(carla.page, "votos do mês").isVisible().catch(() => false)
    const carlaPergunta = await veAPergunta(carla.page)
    console.log(`   a Carla (antiga) depois de eliminar: sala visível=${carlaSala}, votação visível na sala por omissão=${carlaPergunta}`)
    await retratar(carla.page, "6-carla-antiga-depois-de-eliminar")
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
