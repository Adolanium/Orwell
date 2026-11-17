/**
 * Pinned messages outlive retention (12/11/2026): 2 tabs, 3 browsers, on a disposable server.
 *
 *   npm run build && node scripts/e2e-fixadas-permanentes.mjs
 *
 * The server runs with `ENCLAVE_RETENTION_DAYS=0`: the sweep, once a minute, deletes
 * every event. That is the strictest case of what production does after 30 days.
 *
 *  - Ana founds the channel: Chromium, with a second tab that takes ownership;
 *  - Bruno, member without a role: Firefox. He sends a photo with a line of text;
 *  - Ana pins it. The sweep deletes everything on the server;
 *  - Carla joins AFTER: WebKit. She never has the message, and she sees the pin with
 *    the text, the thumbnail, the author and who pinned it;
 *  - Ana pins and unpins a second message: it leaves every screen;
 *  - Bruno deletes his photo: the pin leaves every screen, Carla's included.
 *
 * Screenshots in `.verify-data/prova-fixadas/<hora>/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { deflateSync } from "node:zlib"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, consultar, contasDoServidor, criarCanal, dentro, dizer, ouviu, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "lagar"
const CAPTURAS = join(RAIZ, ".verify-data/prova-fixadas", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

process.env.ENCLAVE_RETENTION_DAYS = "0"
const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8530, servidor: 8531, etiqueta: "fixadas" })
const browsers = []
const paginas = []

/** A 48x48 PNG in one colour: a real image the browser decodes and redraws. */
function pngDeUmaCor(r, g, b, lado = 48) {
  const crc = (bytes) => {
    let c = ~0
    for (const byte of bytes) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const pedaco = (tipo, dados) => {
    const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados])
    const tamanho = Buffer.alloc(4)
    tamanho.writeUInt32BE(dados.length)
    const soma = Buffer.alloc(4)
    soma.writeUInt32BE(crc(corpo))
    return Buffer.concat([tamanho, corpo, soma])
  }
  const cabeca = Buffer.alloc(13)
  cabeca.writeUInt32BE(lado, 0)
  cabeca.writeUInt32BE(lado, 4)
  cabeca[8] = 8
  cabeca[9] = 2
  const linhas = Buffer.alloc((lado * 3 + 1) * lado)
  for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) linhas.set([r, g, b], y * (lado * 3 + 1) + 1 + x * 3)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco("IHDR", cabeca),
    pedaco("IDAT", deflateSync(linhas)),
    pedaco("IEND", Buffer.alloc(0)),
  ])
}

async function abrir(motor, nome) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  paginas.push({ nome, page })
  return { nome, browser: b, ctx, page, erros }
}

const foto = async (page, nome) => {
  await page.bringToFront().catch(() => {})
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`) }).catch(() => {})
}

const botaoFixadas = (page) => page.getByRole("button", { name: "Ver o que está fixado nesta sala" })

/** The pinned sheet, as the person sees it: text, and whether a thumbnail is drawn. */
async function folhaDasFixadas(page) {
  await botaoFixadas(page).first().click()
  const folha = page.locator(".pinned-panel")
  await folha.waitFor({ timeout: 10_000 })
  const texto = (await folha.innerText()).replace(/\s+/g, " ")
  const miniatura = await folha
    .locator("img.pinned-miniatura")
    .first()
    .evaluate((img) => img.complete && img.naturalWidth > 0)
    .catch(() => false)
  return { texto, miniatura, fechar: () => page.keyboard.press("Escape") }
}

/** Whether the header counts any pin, waiting up to `ms`. */
const contaFixadas = (page, quer, ms = 30_000) =>
  ate(async () => ((await botaoFixadas(page).count()) > 0) === quer, ms, 400).then((t) => t >= 0)

async function menuDaMensagem(page, texto, entrada) {
  await page.locator(".message", { hasText: texto }).first().click({ button: "right" })
  await page.locator(".context-menu").first().waitFor({ timeout: 10_000 })
  await page.locator(".context-menu").getByText(entrada, { exact: true }).first().click()
}

try {
  const ana = await abrir(chromium, "ana-chromium")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(firefox, "bruno-firefox")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const [enderecoAna, enderecoBruno] = contasDoServidor(srv.base)
  await pedirAmizade(bruno.page, enderecoAna)
  check("a Ana aceita o Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))

  // 1. Bruno sends a photo with a line of text.
  await abrirCanal(bruno.page, CANAL)
  await abrirCanal(ana.page, CANAL)
  const marca = Date.now().toString(36)
  const legenda = `cartaz da feira ${marca}`
  await bruno.page
    .locator('input[type="file"][accept^="image/png"]')
    .first()
    .setInputFiles({ name: "cartaz.png", mimeType: "image/png", buffer: pngDeUmaCor(200, 40, 40) })
  await bruno.page.waitForTimeout(1500)
  await dizer(bruno.page, legenda)
  check("a Ana recebe a foto do Bruno", (await ouviu(ana.page, legenda)) >= 0)

  // 2. Ana pins it.
  await menuDaMensagem(ana.page, legenda, "Fixar na sala")
  check("a Ana vê a fixada no cabeçalho", await contaFixadas(ana.page, true))
  check("o Bruno vê a fixada no cabeçalho", await contaFixadas(bruno.page, true))
  const vistaDoBruno = await folhaDasFixadas(bruno.page)
  check("o Bruno lê o texto e quem fixou", vistaDoBruno.texto.includes(legenda) && vistaDoBruno.texto.includes("fixada por Ana"), vistaDoBruno.texto.slice(0, 160))
  check("o Bruno vê a miniatura da foto", vistaDoBruno.miniatura)
  await foto(bruno.page, "01-bruno-folha")
  await vistaDoBruno.fechar()

  // 3. The second tab of Ana takes ownership and shows the same pin.
  const ana2 = await ana.ctx.newPage()
  ana2.on("pageerror", (e) => ana.erros.push(String(e)))
  await ana2.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const espera = await ate(async () => (await ana2.locator("body").innerText()).includes("Já tens o Orwell aberto noutro separador."), 30_000, 500)
  check("o segundo separador da Ana espera pelo primeiro", espera >= 0)
  await ana2.getByRole("button", { name: "Usar este separador" }).click()
  const campo = ana2.locator('.gate-card input[type="password"]').first()
  await campo.or(ana2.getByRole("button", { name: "Configurações", exact: true }).first()).first().waitFor({ timeout: 60_000 })
  if (await campo.isVisible().catch(() => false)) {
    await campo.fill(FRASE)
    await ana2.getByRole("button", { name: "Entrar", exact: true }).click()
  }
  await dentro(ana2)
  await abrirCanal(ana2, CANAL)
  check("o segundo separador vê a fixada", await contaFixadas(ana2, true))
  const vistaDaAna2 = await folhaDasFixadas(ana2)
  check("e lê-a com a miniatura", vistaDaAna2.texto.includes(legenda) && vistaDaAna2.miniatura)
  await foto(ana2, "02-ana-segundo-separador")
  await vistaDaAna2.fechar()

  // 4. Retention: the sweep deletes every event on the server.
  const contar = () => Number(consultar(srv.base, "SELECT COUNT(*) AS n FROM events WHERE kind = 'application'")[0]?.n ?? -1)
  const varrido = await ate(async () => contar() === 0, 130_000, 2_000)
  check("a retenção apaga todos os eventos do servidor", varrido >= 0, `restam ${contar()}`)

  // 5. Carla joins AFTER, in WebKit.
  const carla = await abrir(webkit, "carla-webkit")
  await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
  await dentro(carla.page)
  const enderecoCarla = contasDoServidor(srv.base).find((e) => e !== enderecoAna && e !== enderecoBruno)
  await pedirAmizade(carla.page, enderecoAna)
  check("a Ana (segundo separador) aceita a Carla", (await aceitarAmizade(ana2)) >= 0)
  // Accepting left the tab on "Amigos": the channel list is under "Comunidades".
  await ana2.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  check("a Ana convida a Carla", await convidar(ana2, CANAL, enderecoCarla))
  check("a Carla entra no canal", await aceitarConvite(carla.page, CANAL, { espera: 60_000 }))
  await abrirCanal(carla.page, CANAL)
  check("a Carla vê a fixada no cabeçalho", await contaFixadas(carla.page, true, 60_000))
  const conversaDaCarla = await carla.page.evaluate(() => document.querySelector(".timeline")?.textContent ?? "")
  check("a conversa da Carla não tem a mensagem original", !conversaDaCarla.includes(legenda))
  const vistaDaCarla = await folhaDasFixadas(carla.page)
  check("a Carla lê o texto, quem fixou e vê a miniatura", vistaDaCarla.texto.includes(legenda) && vistaDaCarla.texto.includes("fixada por Ana") && vistaDaCarla.miniatura, vistaDaCarla.texto.slice(0, 160))
  await foto(carla.page, "03-carla-folha")
  await vistaDaCarla.fechar()

  // 6. Pin and unpin a second message: it leaves every screen.
  const segunda = `reuniao quinta ${marca}`
  await dizer(ana2, segunda)
  check("a Carla recebe a segunda mensagem", (await ouviu(carla.page, segunda)) >= 0)
  await menuDaMensagem(ana2, segunda, "Fixar na sala")
  const duas = await ate(async () => (await botaoFixadas(carla.page).innerText().catch(() => "")).includes("2"), 30_000, 400)
  check("a Carla conta duas fixadas", duas >= 0)
  await menuDaMensagem(ana2, segunda, "Desafixar")
  const uma = await ate(async () => (await botaoFixadas(carla.page).innerText().catch(() => "")).includes("1"), 30_000, 400)
  check("desafixar: a Carla volta a contar uma", uma >= 0)
  const umaNoBruno = await ate(async () => (await botaoFixadas(bruno.page).innerText().catch(() => "")).includes("1"), 30_000, 400)
  check("e o Bruno também", umaNoBruno >= 0)

  // 7. Bruno deletes his photo: the pin leaves every screen.
  await menuDaMensagem(bruno.page, legenda, "Apagar")
  await bruno.page.getByRole("button", { name: "Apagar", exact: true }).last().click()
  check("apagar: sai do cabeçalho do Bruno", await contaFixadas(bruno.page, false))
  check("sai do segundo separador da Ana", await contaFixadas(ana2, false))
  check("e sai do da Carla, que nunca teve a mensagem", await contaFixadas(carla.page, false))
  await foto(carla.page, "04-carla-depois-de-apagar")

  // 8. Console.
  for (const quem of [ana, bruno, carla]) {
    // Two known notices that are not errors of this feature: Firefox reports the CSP
    // blocking an `eval` feature probe in a dependency, and WebKit does not know the
    // `interactive-widget` viewport key. Neither comes from code this feature touches.
    const graves = quem.erros.filter(
      (e) => !/favicon|ERR_|WebSocket|Failed to load resource|blocked a JavaScript eval|interactive-widget/.test(e),
    )
    check(`sem erros de consola em ${quem.nome}`, graves.length === 0, graves.slice(0, 2).join(" | "))
  }
} catch (erro) {
  check("o guião correu até ao fim", false, String(erro?.stack ?? erro).slice(0, 400))
  for (const { nome, page } of paginas) await foto(page, `falha-${nome}`)
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  srv.fechar()
}
console.log(`capturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
