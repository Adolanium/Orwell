/**
 * Direct conversations without a notice, and the nudge that shakes on every system (12/11/2026).
 *
 *   node scripts/e2e-directa-sem-aviso.mjs [chromium|firefox|webkit|todos]   (needs `npm run build` first)
 *
 * Two requests, proven with two real accounts in a real browser, in each engine:
 *
 *  1. "When a user opens the conversation with another, without friendship, the other
 *     user is notified; I do not want that." Ana opens a direct with Bruno through
 *     "Message", without friendship. For 15 s Bruno gets no sound, no system notice,
 *     no bell line and no row in the Friends column. Then Ana asks for friendship,
 *     and that still reaches Bruno: bell line and sound (the control).
 *  2. "On Windows the window turns blue, it does not produce the effect we wanted."
 *     Bruno's browser runs with `reducedMotion: 'reduce'`, as a Windows machine with that setting does.
 *     Ana nudges him in the direct: Bruno's `.main` must MOVE (its transform changes
 *     over time, for longer than the normal shake) and its background must not change
 *     (no blue flash). Ana, with normal motion, gets the normal shake as the echo.
 *     In a group channel there is no nudge button and no menu entry.
 *
 * ALL LOCAL AND ALL DISPOSABLE, in the mold of `e2e-amizade-ui.mjs`: its own
 * homeserver without community mode, the database in a temporary folder deleted at
 * the end, and a front end that acts as Caddy. It takes no target: there is no way
 * to point it at production.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA_DA_FRENTE = 8496
const PORTA_DO_SERVIDOR = 8497
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const FRASE = "frase-de-verificacao-2026"
const MOTORES = { chromium, firefox, webkit }
const pedido = process.argv[2] ?? "todos"
const escolhidos = pedido === "todos" ? Object.keys(MOTORES) : [pedido]

const results = []
function check(nome, ok, detalhe = "") {
  results.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

for (const [o_que, caminho] of [["a web construída", join(DIST, "index.html")], ["o servidor construído", SERVIDOR_JS]]) {
  if (!existsSync(caminho)) {
    console.error(`Falta ${o_que}: ${caminho}. Corre \`npm run build\` primeiro.`)
    process.exit(2)
  }
}

async function portaLivre(porta) {
  return new Promise((resolve) => {
    const sonda = net.createServer()
    sonda.once("error", () => resolve(false))
    sonda.once("listening", () => sonda.close(() => resolve(true)))
    sonda.listen(porta, "127.0.0.1")
  })
}
for (const porta of [PORTA_DA_FRENTE, PORTA_DO_SERVIDOR]) {
  if (!(await portaLivre(porta))) {
    console.error(`A porta ${porta} já tem dono. Este guião não mata processos de ninguém: liberta-a e volta a correr.`)
    process.exit(2)
  }
}

// --- the homeserver, disposable, without community mode ----------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-directa-sem-aviso-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let registoDoServidor = ""
servidor.stdout.on("data", (bocado) => (registoDoServidor += bocado))
servidor.stderr.on("data", (bocado) => (registoDoServidor += bocado))

// --- the front end that acts as Caddy ----------------------------------------------
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json", ".wasm": "application/wasm" }
const frente = http.createServer((pedidoHttp, resposta) => {
  const caminho = (pedidoHttp.url ?? "/").split("?")[0]
  if (caminho.startsWith("/app")) {
    const relativo = normalize(decodeURIComponent(caminho.slice("/app".length))).replace(/^(\.\.[/\\])+/, "")
    let ficheiro = join(DIST, relativo)
    if (!ficheiro.startsWith(DIST) || !existsSync(ficheiro) || statSync(ficheiro).isDirectory()) ficheiro = join(DIST, "index.html")
    resposta.writeHead(200, { "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream", "cache-control": "no-cache" })
    resposta.end(readFileSync(ficheiro))
    return
  }
  const adiante = http.request({ host: "127.0.0.1", port: PORTA_DO_SERVIDOR, path: pedidoHttp.url, method: pedidoHttp.method, headers: pedidoHttp.headers }, (vinda) => {
    resposta.writeHead(vinda.statusCode ?? 502, vinda.headers)
    vinda.pipe(resposta)
  })
  adiante.on("error", () => {
    resposta.writeHead(502)
    resposta.end()
  })
  pedidoHttp.pipe(adiante)
})
frente.on("upgrade", (pedidoHttp, socket, cabeca) => {
  const destino = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => {
    const linhas = [`${pedidoHttp.method} ${pedidoHttp.url} HTTP/${pedidoHttp.httpVersion}`]
    for (let i = 0; i < pedidoHttp.rawHeaders.length; i += 2) linhas.push(`${pedidoHttp.rawHeaders[i]}: ${pedidoHttp.rawHeaders[i + 1]}`)
    destino.write(`${linhas.join("\r\n")}\r\n\r\n`)
    if (cabeca.length) destino.write(cabeca)
    socket.pipe(destino).pipe(socket)
  })
  destino.on("error", () => socket.destroy())
  socket.on("error", () => destino.destroy())
})
await new Promise((resolve) => frente.listen(PORTA_DA_FRENTE, "127.0.0.1", resolve))

async function servidorDePe() {
  for (let volta = 0; volta < 60; volta++) {
    const ok = await new Promise((resolve) => {
      const sonda = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => {
        sonda.destroy()
        resolve(true)
      })
      sonda.on("error", () => resolve(false))
    })
    if (ok) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

let browser
async function arrumar(codigoDeSaida) {
  await browser?.close().catch(() => {})
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigoDeSaida)
}

if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await arrumar(2)
}

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function ate(condicao, ms = 60_000, passo = 500) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await condicao().catch(() => false)) return true
    await espera(passo)
  }
  return false
}
const dentro = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })

/**
 * The instruments, installed before the app loads: each real-time sound `start`, and
 * each system notice. The notice API is replaced by a counter with permission
 * granted, so the app would use it if it wanted to.
 */
const ESPIAO = `
window.__sons = 0
window.__avisos = []
const comecar = AudioBufferSourceNode.prototype.start
AudioBufferSourceNode.prototype.start = function (...a) {
  if (typeof OfflineAudioContext === "undefined" || !(this.context instanceof OfflineAudioContext)) window.__sons += 1
  return comecar.apply(this, a)
}
class AvisoFalso {
  static permission = "granted"
  static requestPermission() { return Promise.resolve("granted") }
  constructor(titulo, opcoes) { window.__avisos.push(titulo + " | " + (opcoes && opcoes.body || "")) }
  close() {}
  addEventListener() {}
  set onclick(_) {}
}
window.Notification = AvisoFalso
`

async function separador(page, nome) {
  await page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await page.locator(".people-tabs").getByRole("button", { name: nome }).click()
}
async function meuLink(page) {
  await separador(page, "Encontrar")
  return page.getByLabel("O teu link de amizade", { exact: true }).inputValue()
}
async function abrirPerfilPeloLink(page, link) {
  await separador(page, "Encontrar")
  await page.getByLabel("Cola um link ou endereço").fill(link)
  await page.getByRole("button", { name: "Abrir perfil" }).click()
  const folha = page.locator(".person-profile")
  await folha.waitFor({ timeout: 15_000 })
  return folha
}
const linhasDoSino = async (page) => {
  await page.locator(".me-bell").first().click()
  await page.locator(".notif-janela").waitFor({ timeout: 10_000 })
  const n = await page.locator(".notif-list li").count()
  const texto = await page.locator(".notif-janela").innerText().catch(() => "")
  await page.keyboard.press("Escape")
  return { n, texto }
}
/** What Bruno has received, counted from outside the app. */
const contadores = (page) =>
  page.evaluate(() => ({ sons: window.__sons, avisos: [...window.__avisos], sino: document.querySelector(".me-bell")?.getAttribute("aria-label") ?? "" }))

/**
 * Sample `.main` on every frame for `ms`, from inside the page: the transform, the
 * background and whether the class is on. Started BEFORE the nudge, so it catches
 * the whole shake.
 */
const amostrar = (page, ms) =>
  page.evaluate(
    (duracao) =>
      new Promise((resolve) => {
        const fim = performance.now() + duracao
        const amostras = []
        const passo = () => {
          const main = document.querySelector(".main")
          if (main) {
            const estilo = getComputedStyle(main)
            amostras.push({ t: performance.now(), transform: estilo.transform, fundo: estilo.backgroundColor, sombra: estilo.boxShadow, aAbanar: main.classList.contains("buzzing") || (document.querySelector(".app")?.classList.contains("buzzing") ?? false) })
          }
          if (performance.now() < fim) requestAnimationFrame(passo)
          else resolve(amostras)
        }
        requestAnimationFrame(passo)
      }),
    ms,
  )
function resumo(amostras) {
  const comClasse = amostras.filter((a) => a.aAbanar)
  const transforms = new Set(comClasse.map((a) => a.transform).filter((t) => t && t !== "none" && t !== "matrix(1, 0, 0, 1, 0, 0)"))
  const fundos = new Set(amostras.map((a) => a.fundo))
  const sombras = new Set(amostras.map((a) => a.sombra))
  const duracao = comClasse.length ? comClasse.at(-1).t - comClasse[0].t : 0
  return { amostras: amostras.length, comClasse: comClasse.length, transforms: transforms.size, fundos: fundos.size, sombras: sombras.size, duracao: Math.round(duracao) }
}

async function correr(motor) {
  console.log(`\n=== ${motor}`)
  browser = await MOTORES[motor].launch({ headless: true })
  const CONTEXTO = { locale: "pt-PT", viewport: { width: 1200, height: 860 } }

  const ctxA = await browser.newContext(CONTEXTO)
  const a = await ctxA.newPage()
  await a.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(a, { nome: "Ana", frase: FRASE, servidor: NOME })
  await dentro(a)

  // Bruno: reduced motion, like a Windows machine with that setting; and the instruments.
  const ctxB = await browser.newContext({ ...CONTEXTO, reducedMotion: "reduce" })
  await ctxB.addInitScript(ESPIAO)
  const b = await ctxB.newPage()
  await b.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(b, { nome: "Bruno", frase: FRASE, servidor: NOME })
  await dentro(b)
  check(`[${motor}] o browser do Bruno está em movimento reduzido`, await b.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches))
  // A click: the gesture the sound engine waits for. Without it, silence would prove nothing.
  await b.locator(".people-destination, body").first().click({ position: { x: 5, y: 5 } }).catch(() => {})
  await separador(b, "Todos")

  const linkDoBruno = await meuLink(b)
  await separador(b, "Todos")
  const antes = await contadores(b)

  // ---------------------------------------------------------------- 1. open without a notice
  const folha = await abrirPerfilPeloLink(a, linkDoBruno)
  await folha.getByRole("button", { name: "Mensagem", exact: true }).click()
  // The direct is born on Ana's side and Bruno is seated in it.
  const abriu = await ate(async () => (await a.locator(".chat-composer, .main").count()) > 0, 30_000)
  check(`[${motor}] a Ana abre a conversa com o Bruno sem amizade`, abriu)
  await espera(15_000)

  const depois = await contadores(b)
  check(`[${motor}] abrir a conversa não toca nada ao Bruno`, depois.sons === antes.sons, `${antes.sons} -> ${depois.sons}`)
  check(`[${motor}] nem lhe levanta aviso do sistema`, depois.avisos.length === antes.avisos.length, depois.avisos.join(" / ") || "nenhum")
  check(`[${motor}] o sino do Bruno não conta nada`, depois.sino === "Notificações", depois.sino)
  const sino = await linhasDoSino(b)
  check(`[${motor}] e não tem linha nenhuma`, sino.n === 0, sino.texto.replace(/\s+/g, " ").slice(0, 80))
  await separador(b, "Todos")
  const coluna = b.getByRole("complementary", { name: "Amigos e conversas" })
  const linhasNaColuna = await coluna.locator(".direct-list li").count()
  check(`[${motor}] a coluna do Bruno não ganha conversa nenhuma`, linhasNaColuna === 0, `${linhasNaColuna} linhas`)
  check(`[${motor}] nem a Ana aparece como amiga`, (await b.locator(".people-scroll .person-row", { hasText: "Ana" }).count()) === 0)

  // -------------------------------------------------- the control: the friend request still arrives
  // "Message" took Ana to the conversation: the profile opens again from the link.
  const folhaDeNovo = await abrirPerfilPeloLink(a, linkDoBruno)
  // The bell, with reduced motion, must swing (slower), never light up in colour.
  // Sampled on every frame until 1.5 s after the class appears.
  const sinoAmostrado = b.evaluate(
    () =>
      new Promise((resolve) => {
        const limite = performance.now() + 60_000
        const amostras = []
        let visto = null
        const passo = () => {
          const sino = document.querySelector(".me-bell")
          if (sino) {
            const estilo = getComputedStyle(sino)
            const avisa = sino.classList.contains("avisa")
            if (avisa && visto === null) visto = performance.now()
            amostras.push({ t: performance.now(), transform: estilo.transform, fundo: estilo.backgroundColor, cor: estilo.color, avisa })
          }
          const agora = performance.now()
          if (agora > limite || (visto !== null && agora > visto + 1_500)) resolve(amostras)
          else requestAnimationFrame(passo)
        }
        requestAnimationFrame(passo)
      }),
  )
  await folhaDeNovo.getByRole("button", { name: "Pedir amizade" }).click()
  await folhaDeNovo.getByRole("status").filter({ hasText: "Pedido enviado" }).waitFor({ timeout: 30_000 })
  await a.keyboard.press("Escape")
  const chegou = await ate(async () => (await b.getByLabel("1 pedido à espera de resposta").count()) > 0, 60_000)
  check(`[${motor}] o pedido de amizade que vem depois chega ao Bruno`, chegou)
  const amostrasDoSino = await sinoAmostrado
  const comClasse = amostrasDoSino.filter((x) => x.avisa)
  const angulos = new Set(comClasse.map((x) => x.transform).filter((t) => t && t !== "none" && t !== "matrix(1, 0, 0, 1, 0, 0)"))
  const duracaoDoSino = comClasse.length ? Math.round(comClasse.at(-1).t - comClasse[0].t) : 0
  check(`[${motor}] com movimento reduzido, o sino balança: o transform muda`, angulos.size >= 5, `${angulos.size} ângulos, ${comClasse.length} amostras`)
  check(`[${motor}] e mais devagar do que o normal (mais de 700 ms)`, duracaoDoSino > 700, `${duracaoDoSino} ms`)
  check(
    `[${motor}] sem realce: a cor e o fundo do sino não mudam`,
    new Set(amostrasDoSino.map((x) => x.fundo)).size === 1 && new Set(amostrasDoSino.map((x) => x.cor)).size === 1,
  )
  const comPedido = await contadores(b)
  check(`[${motor}] e toca, uma vez`, comPedido.sons === depois.sons + 1, `${depois.sons} -> ${comPedido.sons}`)
  const sinoComPedido = await linhasDoSino(b)
  check(`[${motor}] e fica no sino, uma linha só`, sinoComPedido.n === 1, sinoComPedido.texto.replace(/\s+/g, " ").slice(0, 80))
  const comConversa = await ate(async () => (await b.getByRole("complementary", { name: "Amigos e conversas" }).locator(".direct-list li").count()) === 1, 15_000)
  check(`[${motor}] e a conversa aparece na coluna, com o pedido`, comConversa)

  // Bruno accepts: the nudge needs a conversation where both can write.
  await separador(b, "Recebidos")
  await b.getByRole("button", { name: "Aceitar" }).click()
  check(
    `[${motor}] o Bruno aceita, e a Ana vê "Amigos (1)"`,
    await ate(async () => {
      await separador(a, "Todos")
      return (await a.locator(".people-bar-title").innerText()) === "Amigos (1)"
    }, 90_000, 2_000),
  )

  // ---------------------------------------------------------------- 2. the nudge
  // Both open the direct, from the conversation column.
  const abrirDirecta = async (page) => {
    await separador(page, "Todos")
    await page.getByRole("complementary", { name: "Amigos e conversas" }).locator(".direct-list li").first().click()
    await page.locator(".main .chat-composer").waitFor({ timeout: 15_000 })
  }
  await abrirDirecta(b)
  await abrirDirecta(a)
  const botaoDaAna = a.locator(".composer-line .composer-buzz")
  check(`[${motor}] a directa tem o botão da cotovelada, com o ícone desenhado`, await ate(async () => (await botaoDaAna.count()) === 1 && (await botaoDaAna.locator("svg").count()) === 1, 60_000))
  await espera(2_000)

  const [amostrasDoBruno, amostrasDaAna] = await Promise.all([amostrar(b, 3_000), amostrar(a, 3_000), espera(300).then(() => botaoDaAna.click())])
  const doBruno = resumo(amostrasDoBruno)
  const daAna = resumo(amostrasDaAna)
  check(`[${motor}] com movimento reduzido, o ecrã do Bruno abana: o transform muda ao longo do tempo`, doBruno.transforms >= 5, JSON.stringify(doBruno))
  check(`[${motor}] e abana mais devagar do que o normal (mais de 1,2 s)`, doBruno.duracao > 1_200, `${doBruno.duracao} ms`)
  check(`[${motor}] sem clarão: o fundo e a sombra do Bruno não mudam`, doBruno.fundos === 1 && doBruno.sombras === 1, `fundos ${doBruno.fundos}, sombras ${doBruno.sombras}`)
  check(`[${motor}] a Ana, com movimento normal, sente o eco a abanar`, daAna.transforms >= 5, JSON.stringify(daAna))
  check(`[${motor}] e o eco dela é o abanão normal, mais curto`, daAna.duracao > 400 && daAna.duracao < 1_200, `${daAna.duracao} ms`)
  await b.screenshot({ path: join(dados, `bruno-${motor}.png`) }).catch(() => {})

  /*
    On a phone width the button stays in the line, and the line still fits.
    Until 1.3.25 it left the line at 480 px and less; since the phone layout
    (1.3.26, option B, `telemovel.css`) it stays there, because the "+" menu
    has no nudge and a phone had no other way to send one.
  */
  await a.setViewportSize({ width: 390, height: 844 })
  await espera(800)
  const naLinhaEstreita = await a.evaluate(() => {
    const botao = document.querySelector(".composer-line .composer-buzz")
    const linha = document.querySelector(".composer-line")
    return { visivel: botao ? getComputedStyle(botao).display !== "none" : false, transborda: linha ? linha.scrollWidth > linha.clientWidth + 1 : null }
  })
  check(`[${motor}] a 390 px o botão fica na linha e a linha não transborda`, naLinhaEstreita.visivel && naLinhaEstreita.transborda === false, JSON.stringify(naLinhaEstreita))
  await a.setViewportSize(CONTEXTO.viewport)
  await espera(800)

  // ------------------------------------------------------ 3. no nudge in a group channel
  const SALA = `verif-${Date.now().toString(36)}`
  await a.getByRole("button", { name: "Comunidades", exact: true }).first().click()
  await a.getByRole("button", { name: "Criar canal", exact: true }).first().click()
  await a.locator('input[placeholder="geral"]').fill(SALA)
  await a.getByRole("button", { name: "Confirmar" }).click()
  await ate(async () => (await a.locator(".chat-composer").count()) > 0, 30_000)
  await espera(2_000)
  check(`[${motor}] num canal de grupo não há botão de cotovelada`, (await a.locator(".composer-buzz").count()) === 0)
  await a.getByTitle("Anexar ou abanar").first().click().catch(() => {})
  const entradas = await a.getByRole("menuitem").allTextContents().catch(() => [])
  check(`[${motor}] nem entrada no menu "+"`, entradas.length > 0 && !entradas.some((e) => e.includes("Cotovelada")), entradas.join(" | "))
  await a.keyboard.press("Escape")

  await browser.close()
  browser = null
}

try {
  for (const motor of escolhidos) await correr(motor)
} catch (erro) {
  console.error(erro)
  check("o guião correu até ao fim", false, String(erro).slice(0, 200))
}

const falhas = results.filter((ok) => !ok).length
console.log(`\n${results.length - falhas}/${results.length} verificações passaram`)
await arrumar(falhas === 0 ? 0 : 1)
