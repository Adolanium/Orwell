/**
 * Seed the demo server (`demo-servidor.mjs`) with two accounts and a community to look at.
 *
 *   node scripts/demo-semear.mjs [frente=8492]
 *
 * Ana and Bruno (password below, test accounts that only exist on this local server) share the community
 * "demo-votacoes" with the general room (a picture in a message) and a polls room "votações" (no chat) holding an
 * open poll with a deadline (1 day) and a poll that Ana closed by hand. Each account is exported
 * to `.dev-data/demo-votacoes/contas/<nome>.json`, sealed by the password: import it at the
 * gate of your own browser ("Entrar com o ficheiro da conta"). Importing moves the account to that browser.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { deflateSync } from "node:zlib"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const PORTA = process.argv[2] ?? "8492"
const NOME = `localhost:${PORTA}`
const APP = `http://${NOME}/app/?lingua=pt`
const FRASE = "demo-orwell-2026"
const PASTA = join(RAIZ, ".dev-data/demo-votacoes/contas")
mkdirSync(PASTA, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function png(l, a) {
  const tabela = Array.from({ length: 256 }, (_, n) => { let v = n; for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; return v >>> 0 })
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = tabela[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const bloco = (t, d) => { const n = Buffer.alloc(4); n.writeUInt32BE(d.length); const tt = Buffer.from(t); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([tt, d]))); return Buffer.concat([n, tt, d, c]) }
  const h = Buffer.alloc(13); h.writeUInt32BE(l, 0); h.writeUInt32BE(a, 4); h[8] = 8; h[9] = 2
  const linhas = []
  for (let y = 0; y < a; y++) { const r = Buffer.alloc(1 + l * 3); for (let x = 0; x < l; x++) { r[1 + x * 3] = Math.round((x / l) * 255); r[2 + x * 3] = Math.round((y / a) * 255); r[3 + x * 3] = 140 } linhas.push(r) }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", h), bloco("IDAT", deflateSync(Buffer.concat(linhas))), bloco("IEND", Buffer.alloc(0))])
}

const browser = await chromium.launch({ headless: true })
async function conta(nome) {
  const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage()
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome, frase: FRASE, servidor: NOME })
  await page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
  await wait(2000)
  const addr = (await page.evaluate(() => document.body.innerText)).match(/@[a-z-]+:[^\s]+/)?.[0]
  return { page, nome, addr }
}
try {
  const ana = await conta("Ana")
  const bruno = await conta("Bruno")
  const CANAL = "demo-votacoes"
  await ana.page.getByRole("button", { name: "Criar canal" }).first().click()
  await ana.page.locator("form.prompt input").first().fill(CANAL)
  await ana.page.locator("form.prompt button.primary").first().click()
  await ana.page.getByRole("heading", { name: CANAL }).waitFor({ timeout: 30_000 })
  const linha = (p) => p.locator(".channel-row", { has: p.locator(".channel-name", { hasText: CANAL }) }).first()
  await linha(ana.page).click({ button: "right" })
  await ana.page.getByRole("menuitem", { name: "Nova sala" }).click()
  await ana.page.locator(".sheet input").first().fill("votações")
  await ana.page.locator(".kind-choice").getByRole("button", { name: "Votações", exact: true }).click()
  await ana.page.locator(".sheet-actions button.primary").first().click()
  await ana.page.locator('.room-tree .room-name:text-is("votações")').first().waitFor({ timeout: 30_000 })
  if (!(await convidar(ana.page, CANAL, bruno.addr)) || !(await aceitarConvite(bruno.page, CANAL))) throw new Error("Bruno não entrou no canal")

  const caixa = ana.page.locator('textarea[placeholder="Escreve uma mensagem"]')
  const poll = async (pergunta, opcoes) => {
    await ana.page.getByRole("button", { name: "Nova votação" }).click()
    await ana.page.locator('.sheet input[placeholder="O que queres perguntar?"]').fill(pergunta)
    const campos = ana.page.locator('.sheet input[placeholder="Resposta"]')
    for (let i = 0; i < opcoes.length; i++) await campos.nth(i).fill(opcoes[i])
    await ana.page.locator(".sheet-actions button.primary").first().click()
    await wait(3000)
  }
  // The picture goes in the general room (the first of the tree).
  await ana.page.locator(".room-tree .room-name").first().click()
  await caixa.waitFor({ timeout: 30_000 })
  const ficheiro = join(PASTA, "imagem-demo.png")
  writeFileSync(ficheiro, png(320, 200))
  await ana.page.locator('input[type="file"][accept^="image"]').setInputFiles(ficheiro)
  await wait(1500)
  await caixa.fill("olha a imagem: clica nela, ou abre o menu da mensagem")
  await ana.page.keyboard.press("Enter")
  await wait(4000)
  // The polls room: one open poll (deadline of 1 day) and one that Ana closed by hand.
  await ana.page.locator('.room-tree .room-name:text-is("votações")').first().click()
  await wait(1000)
  await poll("Jantar na sexta?", ["Sim", "Não"])
  await poll("Que cor tinha o muro?", ["Branco", "Cinza"])
  await ana.page.locator(".votacoes-pagina-cartao", { hasText: "Que cor tinha o muro?" }).getByRole("button", { name: "Fechar votação" }).click()
  await wait(3000)
  // Bruno votes in the open one, so there is a result to read.
  await bruno.page.locator(".room-row", { has: bruno.page.locator(".room-name", { hasText: "votações" }) }).first().locator("button.room").click()
  await bruno.page.locator(".votacoes-pagina-cartao", { hasText: "Jantar na sexta?" }).getByRole("button", { name: /Votar em Sim/ }).click({ timeout: 60_000 })
  await wait(3000)

  for (const c of [ana, bruno]) {
    await c.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
    await c.page.getByRole("button", { name: "Conta e segurança", exact: true }).click()
    await c.page.getByRole("button", { name: "Guardar o ficheiro da conta" }).click()
    const d = c.page.waitForEvent("download", { timeout: 60_000 })
    await c.page.locator(".sheet").getByRole("button", { name: "Guardar o ficheiro", exact: true }).first().click()
    const destino = join(PASTA, `${c.nome.toLowerCase()}.json`)
    await (await d).saveAs(destino)
    console.log(`${c.nome}: ${c.addr}  ->  ${destino}`)
  }
} finally {
  await browser.close()
}
