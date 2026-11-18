/**
 * A day away from a busy room, in Chromium and in WebKit (17/11/2026).
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/e2e-conversa-longa.mjs
 *
 * What is proved, through the interface on the browser's side:
 *  1. Wanda creates an account in the browser. Xavier, an account of the core
 *     here in Node, creates the room "dia" and seats her and ten helpers.
 *  2. Wanda closes the app (offline). Xavier writes 1 000 messages; the helpers
 *     send 10 000 typing signals between them.
 *  3. Wanda opens the app again and opens "dia". She presses "Carregar mais
 *     antigas" at the top until the line "Não há mensagens mais antigas neste
 *     aparelho" takes its place. Every one of the 1 000 messages passed through
 *     the screen, the first and the last included, and no error appeared.
 *  4. Screenshots of the newest and of the start.
 *
 * Before the fix the vault kept the last 400 and the rest was gone: the button
 * stopped after those, with nothing to say why.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8751 and 8752. Captures in
 * `.verify-data/prova-conversa-longa/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { moradaDeSala } from "@enclave/protocol"
import { Session, Vault } from "@enclave/client-core"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { abrirCanal, ate, contasDoServidor, dentro, espera, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const MENSAGENS = Number(process.env.MENSAGENS ?? 1_000)
const AJUDANTES = 10
const SINAIS_POR_AJUDANTE = (MENSAGENS * 10) / AJUDANTES
const CAPTURAS = join(RAIZ, ".verify-data/prova-conversa-longa", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8751, servidor: 8752, sfu: 0, etiqueta: "conversa-longa" })
const browsers = []
const nos = []

async function arrumar(codigo) {
  for (const conta of nos) conta.session.disconnect()
  for (const browser of browsers) await browser.close().catch(() => {})
  srv.fechar()
  process.exit(codigo)
}

class CofreEmMemoria {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(bytes) {
    this.bytes = bytes
  }
  async clear() {
    this.bytes = null
  }
}

async function contaNoNode(nome) {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-de-teste-do-no")
  const session = new Session(vault)
  const identidade = await session.createIdentity(srv.NOME)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  const conta = { nome, session, vault, address: identidade.address }
  nos.push(conta)
  return conta
}

/** Send everything, in batches; the server's per-minute cap answers `rate-limited` and the core waits its turn. */
async function enviarTudo(conta, canal, payloads) {
  for (let i = 0; i < payloads.length; i += 100) await conta.session.sendBatch(canal, payloads.slice(i, i + 100))
}

async function desbloquear(page) {
  const campo = page.locator('input[type="password"]').first()
  await campo.or(page.getByRole("button", { name: "Configurações", exact: true }).first()).first().waitFor({ timeout: 60_000 })
  if (await campo.count()) {
    await campo.fill(FRASE)
    await page.keyboard.press("Enter")
  }
  await dentro(page)
}

const dias = async (page) =>
  page.evaluate(() => [...new Set((document.querySelector(".timeline")?.textContent ?? "").match(/dia-\d{4}/g) ?? [])])

for (const [motor, rotulo] of [
  [chromium, "chromium"],
  [webkit, "webkit"],
]) {
  try {
    const browser = await motor.launch({ headless: true })
    browsers.push(browser)
    const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
    let page = await ctx.newPage()
    const erros = []
    page.on("pageerror", (erro) => erros.push(erro.message))
    await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await criarConta(page, { nome: `Wanda ${rotulo}`, frase: FRASE, servidor: srv.NOME })
    await dentro(page)
    const wanda = contasDoServidor(srv.base).at(-1)

    // 1. The room, with Wanda and the helpers.
    const xavier = await contaNoNode(`Xavier ${rotulo}`)
    const ajudantes = []
    for (let i = 0; i < AJUDANTES; i++) ajudantes.push(await contaNoNode(`Ajudante ${i}`))
    const sala = moradaDeSala(srv.NOME)
    await xavier.session.createSpaceChannel(sala, "dia")
    await ate(async () => xavier.session.founderOf(sala) === xavier.address, 15_000, 100)
    for (const quem of [wanda, ...ajudantes.map((a) => a.address)]) await xavier.session.seat(sala, quem)
    await ate(async () => ajudantes.every((a) => a.session.channels.includes(sala)), 60_000, 300)
    await abrirCanal(page, "dia")
    check(`${rotulo}: a Wanda está na sala "dia"`, true)

    // 2. Wanda goes away; the day happens.
    await page.close()
    const inicio = Date.now()
    const mensagens = Array.from({ length: MENSAGENS }, (_, i) => ({
      t: "message",
      body: `dia-${String(i).padStart(4, "0")}`,
      sentAt: Date.now() + i,
      id: `dia-${rotulo}-${String(i).padStart(6, "0")}`,
    }))
    await Promise.all([
      enviarTudo(xavier, sala, mensagens),
      ...ajudantes.map((ajudante) =>
        enviarTudo(ajudante, sala, Array.from({ length: SINAIS_POR_AJUDANTE }, () => ({ t: "typing", until: Date.now() + 5_000 }))),
      ),
    ])
    console.log(`  (${rotulo}: ${MENSAGENS} mensagens e ${SINAIS_POR_AJUDANTE * AJUDANTES} sinais em ${Math.round((Date.now() - inicio) / 1000)} s)`)

    // 3. Back, and up.
    page = await ctx.newPage()
    page.on("pageerror", (erro) => erros.push(erro.message))
    await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await desbloquear(page)
    await abrirCanal(page, "dia")
    const ultima = `dia-${String(MENSAGENS - 1).padStart(4, "0")}`
    check(`${rotulo}: a última mensagem do dia chega`, (await ate(async () => (await dias(page)).includes(ultima), 300_000, 2_000)) >= 0)
    await espera(3_000)
    await page.screenshot({ path: join(CAPTURAS, `${rotulo}-1-recente.png`) })

    const vistas = new Set(await dias(page))
    const fim = page.locator(".timeline-inicio-do-aparelho")
    const botao = page.locator(".timeline-load-older")
    let carregamentos = 0
    // Up, as a person does: to the top, and again while the window slides, then the button.
    const aoTopo = async () => {
      // With the wheel, as a person does: the list draws the lines above on each scroll event.
      const caixa = await page.locator(".timeline").boundingBox()
      if (caixa) await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
      for (let volta = 0; volta < 60; volta++) {
        await page.mouse.wheel(0, -4_000)
        await espera(200)
        for (const dia of await dias(page)) vistas.add(dia)
        if ((await botao.isVisible().catch(() => false)) || (await fim.isVisible().catch(() => false))) return
      }
    }
    for (; carregamentos < 60; carregamentos++) {
      await aoTopo()
      if (await fim.isVisible().catch(() => false)) break
      if (process.env.DEPURAR) {
        const estado = await page.evaluate(() => {
          const el = document.querySelector(".timeline")
          const d = (el?.textContent ?? "").match(/dia-\d{4}/g) ?? []
          return { topo: el?.scrollTop, alto: el?.clientHeight, total: el?.scrollHeight, primeira: d[0], n: new Set(d).size, botao: !!document.querySelector(".timeline-load-older") }
        })
        console.log("  depurar", carregamentos, JSON.stringify(estado))
      }
      if (!(await botao.isVisible().catch(() => false))) break
      await botao.click()
      await espera(700)
    }
    await page.screenshot({ path: join(CAPTURAS, `${rotulo}-2-inicio.png`) })
    // And down again through everything loaded, since the list draws only a window of it.
    const altura = await page.evaluate(() => document.querySelector(".timeline")?.scrollHeight ?? 0)
    for (let topo = 0; topo <= altura + 2_000; topo += 300) {
      await page.evaluate((y) => document.querySelector(".timeline")?.scrollTo({ top: y }), topo)
      await espera(60)
      for (const dia of await dias(page)) vistas.add(dia)
    }
    check(`${rotulo}: ao subir, as ${MENSAGENS} mensagens passam no ecrã`, vistas.size === MENSAGENS, `${vistas.size} de ${MENSAGENS}, ${carregamentos} carregamentos`)
    check(`${rotulo}: a primeira mensagem do dia está lá`, vistas.has("dia-0000"))
    check(
      `${rotulo}: no topo, a linha "Não há mensagens mais antigas neste aparelho"`,
      await (async () => {
        await aoTopo()
        return (await fim.isVisible().catch(() => false)) && (await fim.innerText()).startsWith("Não há mensagens mais antigas neste aparelho")
      })(),
    )
    const toasts = await page.locator(".toast, [role='alert']").allInnerTexts().catch(() => [])
    check(`${rotulo}: sem erros na página nem avisos de erro`, erros.length === 0 && !toasts.some((t) => /Erro \d+/.test(t)), [...erros, ...toasts].join(" | ").slice(0, 200))
  } catch (erro) {
    check(`${rotulo}: o guião chegou ao fim`, false, String(erro?.message ?? erro).split("\n")[0])
  }
}

console.log(`\ncapturas: ${CAPTURAS}`)
await arrumar(resumo() ? 0 : 1)
