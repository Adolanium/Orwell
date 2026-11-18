/**
 * Only accounts created 5 days ago or more vote (17/11/2026), live.
 *
 *   npm run build && ORWELL_DIST_ANTIGO=<apps/web/dist of 1.3.16> \
 *     node --dns-result-order=ipv4first scripts/prova-idade-para-votar.mjs
 *
 * The disposable server makes every account 30 days old (`contasDeTesteAntigas`);
 * this proof then sets two accounts back to "created now" in the test database,
 * which is what the server signs. Through the interface:
 *  - Ana (30 days, Chromium) creates a polls room and a poll, and votes: it counts.
 *  - Bruno (new, WebKit, new client) sees the options off and the sentence.
 *  - Carla (new, the OLD 1.3.16 web) votes: her old client lets her and counts
 *    it; Ana and Bruno do not count it, and her name is not in their list.
 *
 * `ORWELL_LATENCIA_MS=150` puts that round trip on every socket (half each way,
 * in order, through `routeWebSocket`): `hello.ok` then arrives after the app has
 * asked for its own age, the race of review C1 that localhost always won.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8958 and 8959. Captures in
 * `.verify-data/prova-idade-para-votar/`.
 */
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, espera, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "lagar"
const PERGUNTA = "Jantar na sexta?"
const CAPTURAS = join(RAIZ, ".verify-data/prova-idade-para-votar", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })
const DIST_ANTIGO = process.env.ORWELL_DIST_ANTIGO ?? ""
const COM_ANTIGO = DIST_ANTIGO !== "" && existsSync(join(DIST_ANTIGO, "index.html"))
const LATENCIA_MS = Number(process.env.ORWELL_LATENCIA_MS ?? 0)

/** Every gateway socket of this context, `LATENCIA_MS` round trip: half each way, order kept. */
async function comLatencia(ctx) {
  if (LATENCIA_MS <= 0) return
  const meia = LATENCIA_MS / 2
  await ctx.routeWebSocket(/\/_enclave\/gateway/, (ws) => {
    const servidor = ws.connectToServer()
    ws.onMessage((mensagem) => setTimeout(() => servidor.send(mensagem), meia))
    servidor.onMessage((mensagem) => setTimeout(() => ws.send(mensagem), meia))
  })
}

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8958, servidor: 8959, sfu: 0, etiqueta: "idade-para-votar", ...(COM_ANTIGO ? { distAntiga: DIST_ANTIGO } : {}) })
const browsers = []
const abertos = []
const registo = []

async function abrir(motor, nome, antiga = false) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  await comLatencia(ctx)
  if (antiga) await ctx.addCookies([{ name: "orwell-dist", value: "antiga", url: `http://${srv.NOME}` }])
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser: b, ctx, page }
  abertos.push(aparelho)
  return aparelho
}

/** In the test database: this account was created now (and its devices too). */
function criadaAgora(endereco) {
  const db = new DatabaseSync(srv.base)
  try {
    const minuto = Math.floor(Date.now() / 60_000)
    db.prepare("UPDATE accounts SET created_minute = ? WHERE address = ?").run(minuto, endereco)
  } finally {
    db.close()
  }
}

const retratar = (page, nome) => page.screenshot({ path: join(CAPTURAS, `${nome}.png`) }).catch(() => {})
const linhaDaSala = (page, nome) => page.locator(".room-row", { has: page.locator(`.room-name:text-is("${nome}")`) }).first()
const cartao = (page) => page.locator(".votacao", { hasText: PERGUNTA }).first()
const quemVotou = (page) => cartao(page).locator(".votacao-quem").allInnerTexts().then((t) => t.join(" | "))
const totalDe = (page) => cartao(page).locator(".votacao-rodape").innerText().catch(() => "")

try {
  if (!COM_ANTIGO) console.log("   SALTA a Carla: sem ORWELL_DIST_ANTIGO.")
  if (LATENCIA_MS > 0) console.log(`   latência de ${LATENCIA_MS} ms em cada socket`)
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(webkit, "bruno")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const carla = COM_ANTIGO ? await abrir(chromium, "carla", true) : null
  if (carla) {
    await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
    await dentro(carla.page)
  }
  const [enderecoAna, enderecoBruno, enderecoCarla] = contasDoServidor(srv.base)
  criadaAgora(enderecoBruno)
  if (carla) criadaAgora(enderecoCarla)
  // The client keeps an age for the session (it does not change in real life); the
  // date was just rewritten under it, so Bruno starts a new session.
  await bruno.page.reload({ waitUntil: "domcontentloaded" })
  await dentro(bruno.page)
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

  // The polls room and the poll.
  await ana.page.locator(".channel-row", { has: ana.page.locator(".channel-name", { hasText: CANAL }) }).first().click({ button: "right" })
  await ana.page.locator(".context-menu").getByRole("menuitem", { name: "Votações" }).click()
  await ana.page.getByRole("button", { name: "Criar sala de votações" }).click({ timeout: 15_000 })
  await ana.page.locator(".sheet input").first().fill("polls")
  await ana.page.locator(".kind-choice").getByRole("button", { name: "Votações", exact: true }).click()
  await ana.page.locator(".sheet-actions button.primary").first().click()
  await linhaDaSala(ana.page, "polls").waitFor({ timeout: 30_000 })
  await linhaDaSala(ana.page, "polls").locator("button.room").click()
  await ana.page.getByRole("button", { name: "Nova votação" }).click()
  await ana.page.locator('.sheet input[placeholder="O que queres perguntar?"]').fill(PERGUNTA)
  const campos = ana.page.locator('.sheet input[placeholder="Resposta"]')
  await campos.nth(0).fill("Sim")
  await campos.nth(1).fill("Não")
  await ana.page.locator(".sheet-actions button.primary").first().click()
  await cartao(ana.page).waitFor({ timeout: 30_000 })

  // Ana (30 days) votes Sim: it counts.
  await cartao(ana.page).getByRole("button", { name: /^Votar em Sim$/ }).click()
  check("o voto da Ana (conta com 30 dias) conta", (await ate(async () => /1 voto/.test(await totalDe(ana.page)), 30_000)) >= 0, await totalDe(ana.page))

  // Bruno (new, new client): the options off, and the sentence.
  await ate(() => linhaDaSala(bruno.page, "polls").isVisible(), 60_000)
  await linhaDaSala(bruno.page, "polls").locator("button.room").click()
  await cartao(bruno.page).waitFor({ timeout: 60_000 })
  const frase = await ate(() => bruno.page.getByText("Só podes votar 5 dias depois de criares a conta.").first().isVisible(), 30_000)
  check("o Bruno (conta nova) lê «Só podes votar 5 dias depois de criares a conta.»", frase >= 0)
  check("e as opções dele estão desligadas", await cartao(bruno.page).getByRole("button", { name: /^Votar em Não$/ }).isDisabled())
  await retratar(bruno.page, "bruno-conta-nova-desligado")

  // Carla (new, OLD client) votes Não. Her client counts it; the new ones do not.
  if (carla) {
    const temSala = await ate(() => linhaDaSala(carla.page, "polls").isVisible(), 60_000)
    if (temSala >= 0) await linhaDaSala(carla.page, "polls").locator("button.room").click()
    await cartao(carla.page).waitFor({ timeout: 60_000 })
    await cartao(carla.page).getByRole("button", { name: /^Votar em Não$/ }).click()
    const naCarla = await ate(async () => /2 votos/.test(await totalDe(carla.page)), 30_000)
    console.log(`   a Carla (1.3.16) conta o voto dela: ${naCarla >= 0} (${(await totalDe(carla.page)).replace(/\s+/g, " ")})`)
    await retratar(carla.page, "carla-1-3-16-conta-tudo")
    await espera(5000)
    check("na Ana, o voto da Carla (conta nova) não conta: 1 voto", /1 voto/.test(await totalDe(ana.page)) && !/2 votos/.test(await totalDe(ana.page)), await totalDe(ana.page))
    check("e o nome da Carla não está na lista de quem votou", !(await quemVotou(ana.page)).includes("Carla"), await quemVotou(ana.page))
    check("no Bruno, também 1 voto", /1 voto/.test(await totalDe(bruno.page)), await totalDe(bruno.page))
    await retratar(ana.page, "ana-so-conta-o-dela")
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
