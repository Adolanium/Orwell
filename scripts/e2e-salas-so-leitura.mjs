/**
 * Read-only rooms live (12/11/2026), with three accounts, three engines, a
 * paired device, two tabs and a phone width.
 *
 *   npm run build && node scripts/e2e-salas-so-leitura.mjs
 *
 * Ana founds the channel (Chromium). Bruno has the role "Anúncios" (WebKit).
 * Carla has no role (Firefox), plus a paired device (Chromium). Via the interface:
 *  1. Carla writes in "Avisos" while it is open to everyone;
 *  2. Ana turns "Avisos" read-only for "Anúncios" in the room menu ("Quem
 *     escreve"); on both of Carla's devices the writing bar gives way to the
 *     sentence, without reload; Carla's old message stays for everyone;
 *  3. Bruno writes and everyone reads it; Ana writes too;
 *  4. at 390 px, Carla's room has the sentence and no horizontal scroll;
 *  5. a second tab of Carla takes over and shows the same sentence;
 *  6. Ana gives "Anúncios" to Carla mid-way: the bar comes back without reload,
 *     and what Carla writes reaches the others;
 *  7. Ana creates "Regras" already read-only (no roles): Bruno reads the sentence.
 *
 * Everything local and disposable, ports 8697 and 8698. Screenshots in
 * `.verify-data/prova-salas-so-leitura/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, espera, irParaEmparelhar, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const SEGUINTE = /^(Continuar|Seguinte)$/
const CANAL = "redaccao"
const AVISOS = "Avisos"
const REGRAS = "Regras"
const CARGO = "Anúncios"
const SEM_ESCRITA = "Só alguns cargos podem escrever nesta sala."
const CAPTURAS = join(RAIZ, ".verify-data/prova-salas-so-leitura", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8697, servidor: 8698, sfu: 0, etiqueta: "salas-so-leitura" })
const browsers = []
const abertos = []
const registo = []

async function abrir(motor, nome, browser = null) {
  const b = browser ?? (await motor.launch({ headless: true }))
  if (!browser) browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  vigiar(page, nome)
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser: b, ctx, page }
  abertos.push(aparelho)
  return aparelho
}

function vigiar(page, nome) {
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  page.on("console", (m) => {
    if (m.type() === "error") registo.push(`${nome} CONSOLA ${m.text().slice(0, 300)}`)
  })
}

const linhaDa = (page, nome) => page.locator(".room-row").filter({ has: page.locator(".room-name", { hasText: new RegExp(`^${nome}$`) }) }).first()
const caixa = (page) => page.locator('textarea[placeholder="Escreve uma mensagem"]').first()
const frase = (page) => page.locator(".chat-escrita-trancada").filter({ hasText: SEM_ESCRITA }).first()
const viu = (page, texto) => page.locator(".message").filter({ hasText: texto }).first().isVisible().catch(() => false)
const temFrase = (page) => frase(page).isVisible().catch(() => false)
const temCaixa = (page) => caixa(page).isVisible().catch(() => false)

async function abrirSala(page, nome) {
  await linhaDa(page, nome).waitFor({ timeout: 60_000 })
  await linhaDa(page, nome).locator("button.room").first().click()
  await page.getByRole("heading", { name: nome }).first().waitFor({ timeout: 15_000 }).catch(() => {})
}

async function escrever(page, texto) {
  const campo = caixa(page)
  await campo.click()
  await campo.fill(texto)
  await page.keyboard.press("Enter")
}

async function semRolagem(page, rotulo) {
  const rola = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check(`${rotulo}: sem rolagem horizontal`, !rola)
}

async function abaCargos(page) {
  await page.locator(".channel-list .channel-row").filter({ has: page.locator(".channel-name", { hasText: CANAL }) }).first().click({ button: "right" })
  await page.getByRole("menuitem", { name: /propriedades/i }).first().click()
  const folha = page.getByRole("dialog").first()
  await folha.getByRole("tab", { name: "Cargos", exact: true }).click()
  const painel = folha.getByRole("tabpanel", { name: "Cargos" })
  await painel.waitFor({ timeout: 15_000 })
  return { folha, painel }
}

/** Ana gives or takes the role through the person's profile, as in the roles script. */
async function alternarCargo(page, nome) {
  await page.locator(".member-row").filter({ hasText: nome }).first().click()
  const interruptor = page.getByRole("switch", { name: CARGO }).first()
  await interruptor.waitFor({ timeout: 15_000 })
  const antes = await interruptor.getAttribute("aria-checked")
  await interruptor.click()
  await ate(async () => (await interruptor.getAttribute("aria-checked")) !== antes, 15_000)
  const depois = await interruptor.getAttribute("aria-checked")
  await page.getByRole("button", { name: "Voltar" }).first().click().catch(() => {})
  await page.keyboard.press("Escape").catch(() => {})
  return depois === "true"
}

async function emparelhar(dono, motor, nome) {
  await dono.page.keyboard.press("Escape").catch(() => {})
  await dono.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await dono.page.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await dono.page.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = dono.page.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  const novo = await abrir(motor, nome)
  await irParaEmparelhar(novo.page)
  await novo.page.getByLabel("Ou cola o link").fill(link)
  await novo.page.getByRole("button", { name: SEGUINTE }).first().click()
  await novo.page.getByRole("heading", { name: "Palavra-passe deste aparelho" }).waitFor({ timeout: 15_000 })
  const campos = novo.page.locator('.gate-card input[type="password"]')
  for (let i = 0; i < (await campos.count()); i++) await campos.nth(i).fill(FRASE)
  await novo.page.getByRole("button", { name: SEGUINTE }).first().click()
  await novo.page.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await novo.page.getByRole("button", { name: "São as mesmas" }).click()
  await folha.getByRole("button", { name: "São as mesmas" }).click()
  const feito = await novo.page.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 }).then(() => true, () => false)
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await novo.page.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(novo.page)
  await dono.page.keyboard.press("Escape").catch(() => {})
  check(`${nome} emparelha com a conta da Carla`, feito)
  return novo
}

try {
  // 0. Three accounts, friendships, the channel and invites.
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(webkit, "bruno")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const carla = await abrir(firefox, "carla")
  await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
  await dentro(carla.page)
  const [enderecoAna, enderecoBruno, enderecoCarla] = contasDoServidor(srv.base)
  await pedirAmizade(bruno.page, enderecoAna)
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await pedirAmizade(carla.page, enderecoAna)
  check("a Ana aceita a amizade da Carla", (await aceitarAmizade(ana.page)) >= 0)
  // Carla's second device, paired before the channel so it joins with her.
  const carla2 = await emparelhar(carla, chromium, "carla-2")
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("a Ana convida a Carla", await convidar(ana.page, CANAL, enderecoCarla))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  check("a Carla entra no canal", await aceitarConvite(carla.page, CANAL, { espera: 60_000 }))

  // The role, and Bruno has it.
  await abrirCanal(ana.page, CANAL)
  {
    const { folha, painel } = await abaCargos(ana.page)
    await painel.getByRole("button", { name: "Novo cargo" }).click()
    await folha.getByLabel("Nome do cargo", { exact: true }).fill(CARGO)
    await folha.getByRole("button", { name: "Criar cargo" }).click()
    await painel.getByText(CARGO).first().waitFor({ timeout: 15_000 })
    await ana.page.getByRole("button", { name: "Cancelar" }).first().click().catch(() => ana.page.keyboard.press("Escape"))
    await ana.page.keyboard.press("Escape").catch(() => {})
  }
  check("a Ana dá o cargo ao Bruno", await alternarCargo(ana.page, "Bruno"))

  // 1. The room, open to everyone, and Carla writes.
  await abrirCanal(ana.page, CANAL)
  await ana.page.locator(".room-row button.room-new").first().click()
  await ana.page.getByPlaceholder("Anúncios").fill(AVISOS)
  await ana.page.getByRole("button", { name: "Criar", exact: true }).click()
  await linhaDa(ana.page, AVISOS).waitFor({ timeout: 30_000 })
  const carlas = [carla, carla2]
  for (const p of [bruno, ...carlas]) {
    const entrou = await ate(async () => {
      await abrirCanal(p.page, CANAL).catch(() => {})
      return linhaDa(p.page, AVISOS).isVisible().catch(() => false)
    }, 90_000, 2000)
    check(`${p.nome} vê a sala ${AVISOS}`, entrou >= 0)
    await abrirSala(p.page, AVISOS)
  }
  await abrirSala(ana.page, AVISOS)
  await escrever(carla.page, "a Carla escreveu antes da regra")
  for (const p of [ana, bruno]) check(`a mensagem antiga da Carla chega a ${p.nome}`, (await ate(() => viu(p.page, "a Carla escreveu antes da regra"), 60_000)) >= 0)

  // 2. Read-only, from the room menu.
  await linhaDa(ana.page, AVISOS).click({ button: "right" })
  await ana.page.getByRole("menuitem", { name: "Quem escreve" }).click()
  const folha = ana.page.getByRole("dialog").first()
  await folha.getByRole("heading", { name: "Quem escreve nesta sala" }).waitFor({ timeout: 10_000 })
  await folha.getByRole("switch", { name: "Só leitura" }).click()
  check("a folha diz que a regra é das apps", (await folha.innerText()).includes("Esta regra é das apps, não da cifra."))
  await folha.getByRole("checkbox", { name: CARGO }).check()
  await ana.page.setViewportSize({ width: 390, height: 844 })
  await espera(300)
  await ana.page.screenshot({ path: join(CAPTURAS, "ana-folha-390.png") })
  await semRolagem(ana.page, "a folha Quem escreve a 390 px")
  await ana.page.setViewportSize({ width: 1280, height: 860 })
  await ana.page.screenshot({ path: join(CAPTURAS, "ana-folha-1280.png") })
  await folha.getByRole("button", { name: "Guardar" }).click()
  await folha.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {})

  const inicio = Date.now()
  for (const p of carlas) {
    const t = await ate(async () => (await temFrase(p.page)) && !(await temCaixa(p.page)), 60_000)
    check(`${p.nome}: a frase toma o lugar da barra, sem recarregar`, t >= 0, `${Date.now() - inicio} ms`)
    await p.page.screenshot({ path: join(CAPTURAS, `${p.nome}-so-leitura-1280.png`) })
  }
  check("o Bruno mantém a barra de escrita", (await ate(() => temCaixa(bruno.page), 10_000)) >= 0 && !(await temFrase(bruno.page)))
  check("a Ana mantém a barra de escrita", await temCaixa(ana.page))
  for (const p of [ana, bruno, carla]) check(`${p.nome} ainda vê a mensagem antiga da Carla`, await viu(p.page, "a Carla escreveu antes da regra"))

  // 3. Bruno and Ana write; everyone reads.
  await escrever(bruno.page, "aviso do Bruno")
  await escrever(ana.page, "aviso da Ana")
  for (const p of [ana, bruno, ...carlas]) {
    check(`${p.nome} lê o aviso do Bruno`, (await ate(() => viu(p.page, "aviso do Bruno"), 60_000)) >= 0)
    check(`${p.nome} lê o aviso da Ana`, (await ate(() => viu(p.page, "aviso da Ana"), 60_000)) >= 0)
  }

  // 4. Phone width.
  await carla.page.setViewportSize({ width: 390, height: 844 })
  await espera(500)
  check("a 390 px, a Carla vê a frase", await temFrase(carla.page))
  await carla.page.screenshot({ path: join(CAPTURAS, "carla-so-leitura-390.png") })
  await semRolagem(carla.page, "a sala só de leitura a 390 px")
  await carla.page.setViewportSize({ width: 1280, height: 860 })

  // 5. A second tab of Carla's second device takes over.
  {
    const p2 = await carla2.ctx.newPage()
    vigiar(p2, "carla-2-separador")
    await p2.goto(srv.APP, { waitUntil: "domcontentloaded" })
    const usar = p2.getByRole("button", { name: "Usar este separador" })
    await usar.waitFor({ timeout: 30_000 })
    await usar.click()
    await dentro(p2)
    await abrirCanal(p2, CANAL).catch(() => {})
    await abrirSala(p2, AVISOS)
    check("o segundo separador mostra a mesma frase", (await ate(() => temFrase(p2), 30_000)) >= 0)
    await p2.screenshot({ path: join(CAPTURAS, "carla-2-separador-1280.png") })
    // The first tab gave way: from here on, the second tab is Carla's second device.
    carla2.page = p2
  }

  // 6. The role, mid-way: the bar comes back without reload.
  await abrirCanal(ana.page, CANAL)
  check("a Ana dá o cargo à Carla", await alternarCargo(ana.page, "Carla"))
  const regresso = Date.now()
  for (const p of carlas) {
    const t = await ate(async () => (await temCaixa(p.page)) && !(await temFrase(p.page)), 60_000)
    check(`${p.nome}: a barra volta sem recarregar`, t >= 0, `${Date.now() - regresso} ms`)
  }
  await escrever(carla.page, "a Carla com cargo")
  for (const p of [ana, bruno]) check(`${p.nome} lê a Carla com cargo`, (await ate(() => viu(p.page, "a Carla com cargo"), 60_000)) >= 0)

  // 7. A room born read-only, with no roles: only who administers writes.
  await abrirSala(ana.page, AVISOS)
  await ana.page.locator(".room-row button.room-new").first().click()
  await ana.page.getByPlaceholder("Anúncios").fill(REGRAS)
  await ana.page.getByRole("switch", { name: "Só leitura" }).click()
  await ana.page.screenshot({ path: join(CAPTURAS, "ana-nova-sala-1280.png") })
  await ana.page.getByRole("button", { name: "Criar", exact: true }).click()
  await linhaDa(ana.page, REGRAS).waitFor({ timeout: 30_000 })
  await abrirSala(ana.page, REGRAS)
  check("a Ana escreve em Regras", await temCaixa(ana.page))
  await ate(() => linhaDa(bruno.page, REGRAS).isVisible().catch(() => false), 60_000)
  await abrirSala(bruno.page, REGRAS)
  check("o Bruno lê a frase em Regras", (await ate(() => temFrase(bruno.page), 30_000)) >= 0)
  await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-regras-1280.png") })
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of abertos) {
    const texto = await a.page.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
    console.log(`--- ${a.nome} mostra: "${texto.replace(/\s+/g, " ").slice(0, 600)}"`)
    await a.page.screenshot({ path: join(CAPTURAS, `falha-${a.nome}.png`) }).catch(() => {})
  }
}
for (const linha of registo.slice(-40)) console.log(linha)

for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
console.log(`\nCapturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
