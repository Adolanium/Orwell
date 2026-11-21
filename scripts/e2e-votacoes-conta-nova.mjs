/**
 * Polls seen by members who joined AFTER the polls room had polls, on the web.
 *
 *   node scripts/e2e-votacoes-conta-nova.mjs [chromium|webkit]
 *
 * ALL LOCAL AND DISPOSABLE (`levantarServidor`): a server in a temp folder, ports
 * 8584 and 8585. It never points at production.
 *
 * Ana (old account, founder) makes a channel, a polls room and poll P1. Then two
 * members join: Bruno, an old account (born 30 days ago, like every test account),
 * and Carla, an account born TODAY (the trigger that ages accounts is dropped
 * before she registers). After both are in, Ana makes poll P2. Each newcomer opens
 * "Polls" from the channel menu and the script reports which polls each one sees.
 *
 * Telling the hypotheses apart:
 *   - P1 missing, P2 present for both: the history from before the join (not a bug of
 *     the polls page; D2's job).
 *   - P2 missing for Carla only: account age.
 *   - P2 missing for both: polls after joining are broken.
 *
 * Measured 21/11/2026: on 1.3.25 (hotfix-votacoes) P1 is missing for both and P2 shows;
 * with D2 both polls show, with Ana's vote on P1. With D2, wait for the past:
 *   ESPERA_DO_PASSADO_MS=60000 node scripts/e2e-votacoes-conta-nova.mjs
 * `ORWELL_RAIZ=<worktree>` runs another worktree's web and server builds.
 */
import { DatabaseSync } from "node:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar, etiquetaDe } from "./convite.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const MOTOR = process.argv[2] ?? "chromium"
const CAPTURAS = join(RAIZ, "capturas")
const FRASE = "frase-de-verificacao-2026"
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []
function check(nome, ok, detalhe = "") {
  results.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

const srv = await levantarServidor({
  frente: 8584,
  servidor: 8585,
  etiqueta: "votacoes-conta-nova",
  ...(process.env.ORWELL_RAIZ
    ? { dist: join(process.env.ORWELL_RAIZ, "apps/web/dist"), servidorJs: join(process.env.ORWELL_RAIZ, "apps/server/dist/main.js") }
    : {}),
})
const { APP, NOME } = srv
let browser
async function arrumar(codigo) {
  await browser?.close().catch(() => {})
  await srv.fechar()
  process.exit(codigo)
}
mkdirSync(CAPTURAS, { recursive: true })

try {
  browser = await (MOTOR === "webkit" ? webkit : chromium).launch({ headless: true })
  const erros = []
  async function conta(nome) {
    const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    page.on("pageerror", (e) => erros.push(`${nome}: ${e.message}`))
    await page.goto(APP, { waitUntil: "domcontentloaded" })
    await criarConta(page, { nome, frase: FRASE, servidor: NOME })
    await page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
    await wait(2000)
    const texto = await page.evaluate(() => document.body.innerText)
    const addr = texto.match(/@[a-z-]+:[^\s]+/)?.[0] ?? null
    return { ctx, page, nome, addr }
  }

  const ana = await conta("Ana")
  const CANAL = `votacoes-${Date.now().toString(36)}`
  await ana.page.getByRole("button", { name: "Criar canal" }).first().click()
  await ana.page.locator("form.prompt input").first().fill(CANAL)
  await ana.page.locator("form.prompt button.primary").first().click()
  await ana.page.locator("h1, .topbar-comunidade").filter({ hasText: new RegExp(`^${CANAL}$`) }).first().waitFor({ timeout: 30_000 })
  const etiqueta = etiquetaDe(CANAL)
  const linhaDoCanal = (page) => page.locator(".channel-row", { has: page.locator(".channel-name", { hasText: etiqueta }) }).first()
  const abrirVotacoesDoCanal = async (page) => {
    await linhaDoCanal(page).click({ button: "right" })
    await page.locator(".context-menu").getByRole("menuitem", { name: "Votações" }).click()
  }

  await abrirVotacoesDoCanal(ana.page)
  await ana.page.getByRole("button", { name: "Criar sala de votações" }).click()
  await ana.page.locator(".sheet input").first().fill("votacoes")
  await ana.page.locator(".kind-choice").getByRole("button", { name: "Votações", exact: true }).click()
  await ana.page.locator(".sheet-actions button.primary").first().click()
  await ana.page.locator('.room-tree .room-name:text-is("votacoes")').first().waitFor({ timeout: 30_000 })
  const poll = async (pergunta) => {
    await ana.page.locator('.room-tree .room-name:text-is("votacoes")').first().click()
    await wait(800)
    await ana.page.getByRole("button", { name: "Nova votação" }).click()
    await ana.page.locator('.sheet input[placeholder="O que queres perguntar?"]').fill(pergunta)
    const campos = ana.page.locator('.sheet input[placeholder="Resposta"]')
    await campos.nth(0).fill("Sim")
    await campos.nth(1).fill("Não")
    await ana.page.locator(".sheet-actions button.primary").first().click()
    await wait(3000)
  }
  await poll("P1 antes de entrarem?")
  check("Ana vê P1", (await ana.page.getByText("P1 antes de entrarem?").count()) > 0)
  // Ana votes "Sim" on P1 before anyone else joins: the newcomers must count it.
  await ana.page.locator(".votacoes-pagina-cartao", { hasText: "P1 antes de entrarem?" }).locator("button.votacao-opcao").first().click()
  await wait(2500)

  const bruno = await conta("Bruno")
  // Carla registers TODAY: the trigger that ages test accounts goes away first.
  const db = new DatabaseSync(srv.base)
  db.exec("DROP TRIGGER IF EXISTS contas_de_teste_antigas")
  db.close()
  const carla = await conta("Carla")
  {
    const db2 = new DatabaseSync(srv.base)
    const idades = db2.prepare("SELECT address, created_minute FROM accounts").all()
    db2.close()
    const agora = Math.floor(Date.now() / 60_000)
    console.log("  ..  idades (min):", idades.map((l) => `${l.address.split(":")[0]}=${agora - Number(l.created_minute)}`).join(" "))
  }
  for (const quem of [bruno, carla]) {
    check(`${quem.nome} entrou no canal`, (await convidar(ana.page, etiqueta, quem.addr)) && (await aceitarConvite(quem.page, etiqueta)))
  }
  await wait(5000)
  await poll("P2 depois de entrarem?")
  // D2 starts its first round 20 s after connecting; give the past time to come.
  await wait(Number(process.env.ESPERA_DO_PASSADO_MS ?? 5000))

  for (const quem of [bruno, carla]) {
    const p = quem.page
    await linhaDoCanal(p).click()
    await wait(2000)
    await abrirVotacoesDoCanal(p)
    await wait(6000)
    const texto = await p.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText)
    const salas = await p.locator(".room-tree .room-name").allInnerTexts()
    console.log(`  ..  ${quem.nome}: salas = ${salas.join(", ")}`)
    console.log(`  ..  ${quem.nome}: ecrã = ${texto.replace(/\s+/g, " ").slice(0, 400)}`)
    await p.screenshot({ path: join(CAPTURAS, `votacoes-conta-nova-${MOTOR}-${quem.nome}.png`) })
    check(`${quem.nome} vê P1 (criada antes de entrar)`, texto.includes("P1 antes de entrarem?"))
    check(`${quem.nome} vê P2 (criada depois de entrar)`, texto.includes("P2 depois de entrarem?"))
    const contaDeP1 = await p
      .locator(".votacoes-pagina-cartao", { hasText: "P1 antes de entrarem?" })
      .locator(".votacao-conta")
      .first()
      .innerText()
      .catch(() => null)
    check(`${quem.nome} conta o voto da Ana em P1`, contaDeP1 === "1", `Sim = ${contaDeP1}`)
  }
  check("sem erros de página", erros.length === 0, erros.slice(0, 3).join(" | "))
} catch (erro) {
  console.error(erro)
  results.push(false)
}
console.log(`\n${results.filter(Boolean).length}/${results.length} ok`)
await arrumar(results.every(Boolean) ? 0 : 1)
