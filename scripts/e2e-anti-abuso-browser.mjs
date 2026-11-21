/**
 * The abuse brake, part 2 (1.3.26), in a real browser against a real server.
 *
 *   1. A new account is created in Chromium: the button says "A preparar a
 *      conta…" while the proof of work runs in a Web Worker, and the account
 *      reaches the server.
 *   2. In the common room, the box of that account says it is new. The server
 *      lets 3 messages through at once (the slack, which the app's own profile
 *      also uses), then holds the next for the interval: the founder reads the
 *      first at once and the last about 30 seconds later.
 *   3. A second new account from the same network (the same /24) is refused:
 *      "Erro 234", and the invite-code field appears.
 *   4. A third new account from the same network opens a short invite link of
 *      a real community (a member older than 72 hours) and gets in.
 *   5. The first new account (under 72 hours) creates one channel with the
 *      "+". Then the "+" stays, grey and aria-disabled (the cap on channels: 1
 *      in the first 72 hours), and the reason shows in its tooltip on hover.
 *   6. In that channel it creates rooms with "Nova sala" up to the room cap
 *      of a new account (2 here, `ENCLAVE_NEW_ACCOUNT_CHANNELS`, below the 3 of
 *      `ENCLAVE_CHANNELS_PER_ACCOUNT`; the 3 rooms the channel was born with
 *      do not count). Then "Nova sala" stays, grey and aria-disabled, with the
 *      reason in its tooltip on hover.
 *
 *   node scripts/e2e-anti-abuso-browser.mjs   (needs `npm run build`)
 *
 * Local and throwaway, like `e2e-canal-comum-opcional-browser.mjs`: a homeserver
 * with the common room (NOT in community mode, which turns the new-account
 * limits off), a front end that acts as Caddy and puts the same public address
 * in X-Forwarded-For for every browser connection (and none for Node), and the
 * founder in Node (so loopback, which the limits leave alone). Ports 8473
 * (front) and 8472 (server), or E2E_PORTA_DA_FRENTE/E2E_PORTA_DO_SERVIDOR.
 */
import { spawn, execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { webcrypto } from "node:crypto"
import { chromium } from "playwright"
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala } from "@enclave/protocol"
import { criarConta } from "./conta.mjs"
if (!globalThis.crypto) globalThis.crypto = webcrypto

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8473)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8472)
const NOME = `localhost:${PORTA_DA_FRENTE}`
const SALA = `!orwell:${NOME}`
/** The address the front end says every browser connection comes from: a documentation network (RFC 5737). */
const IP_DO_BROWSER = "203.0.113.10"
const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(join(RAIZ, ".dev-data-scr"), { recursive: true })
const dados = mkdtempSync(join(RAIZ, ".dev-data-scr", "anti-abuso-"))
const BASE = join(dados, "enclave.sqlite")
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
    ENCLAVE_COMMON_ROOM: SALA,
    // About 3 to 5 seconds on this Mac: long enough to see the progress on the button.
    ENCLAVE_PROVA_TRABALHO: process.env.ENCLAVE_PROVA_TRABALHO ?? "8000000",
    ENCLAVE_PROVA_TRABALHO_NO_PICO: "8000000",
    ENCLAVE_CONTAS_POR_REDE_HORA: "1",
    ENCLAVE_CONTAS_POR_REDE_DIA: "10",
    ENCLAVE_CONTA_NOVA_INTERVALO_24H_S: "30",
    // Part 6: 2 rooms in the first 72 hours, 3 after, so the new-account cap is the one reached.
    ENCLAVE_NEW_ACCOUNT_CHANNELS: "2",
    ENCLAVE_CHANNELS_PER_ACCOUNT: "3",
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let registoDoServidor = ""
servidor.stdout.on("data", (b) => (registoDoServidor += b))
servidor.stderr.on("data", (b) => (registoDoServidor += b))

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".wasm": "application/wasm" }
const frente = http.createServer((pedido, resposta) => {
  const caminho = (pedido.url ?? "/").split("?")[0]
  if (caminho.startsWith("/app")) {
    const relativo = normalize(decodeURIComponent(caminho.slice("/app".length))).replace(/^(\.\.[/\\])+/, "")
    let ficheiro = join(DIST, relativo)
    if (!ficheiro.startsWith(DIST) || !existsSync(ficheiro) || statSync(ficheiro).isDirectory()) ficheiro = join(DIST, "index.html")
    resposta.writeHead(200, { "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream", "cache-control": "no-cache" })
    resposta.end(readFileSync(ficheiro))
    return
  }
  const adiante = http.request(
    { host: "127.0.0.1", port: PORTA_DO_SERVIDOR, path: pedido.url, method: pedido.method, headers: { ...pedido.headers, "x-forwarded-for": IP_DO_BROWSER } },
    (vinda) => {
      resposta.writeHead(vinda.statusCode ?? 502, vinda.headers)
      vinda.pipe(resposta)
    },
  )
  adiante.on("error", () => {
    resposta.writeHead(502)
    resposta.end()
  })
  pedido.pipe(adiante)
})
// The WebSocket goes through here, with the public address in X-Forwarded-For, as Caddy does.
frente.on("upgrade", (pedido, socket, cabeca) => {
  const destino = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => {
    const linhas = [`${pedido.method} ${pedido.url} HTTP/${pedido.httpVersion}`]
    for (let i = 0; i < pedido.rawHeaders.length; i += 2) {
      if (pedido.rawHeaders[i].toLowerCase() === "x-forwarded-for") continue
      linhas.push(`${pedido.rawHeaders[i]}: ${pedido.rawHeaders[i + 1]}`)
    }
    if (/Mozilla/.test(pedido.headers["user-agent"] ?? "")) linhas.push(`X-Forwarded-For: ${IP_DO_BROWSER}`)
    destino.write(`${linhas.join("\r\n")}\r\n\r\n`)
    if (cabeca.length) destino.write(cabeca)
    socket.pipe(destino).pipe(socket)
  })
  destino.on("error", () => socket.destroy())
  socket.on("error", () => destino.destroy())
})
await new Promise((r) => frente.listen(PORTA_DA_FRENTE, "127.0.0.1", r))
for (let i = 0; i < 60; i++) {
  if (registoDoServidor.includes("listening")) break
  await pausa(250)
}

let browser
const sessoes = []
async function arrumar(codigo) {
  await browser?.close().catch(() => {})
  for (const s of sessoes) s.disconnect?.()
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigo)
}

class MemoryBackend {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(b) {
    this.bytes = b
  }
  async clear() {
    this.bytes = null
  }
}

async function ate(condicao, ms) {
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    if (await condicao()) return true
    await pausa(250)
  }
  return false
}
const sql = (q) => execFileSync("sqlite3", ["-readonly", BASE, q], { encoding: "utf8" }).trim()

const falhas = []
const verificar = (ok, frase) => {
  console.log(`  ${ok ? "ok  " : "FALHA"} ${frase}`)
  if (!ok) falhas.push(frase)
}

// ------------------------------------------------------------------ the stage
// The founder, in Node: no X-Forwarded-For (the front adds it only for the browser), so loopback.
const vault = new Vault(new MemoryBackend())
await vault.create("frase-de-teste")
const dona = new Session(vault)
sessoes.push(dona)
await dona.createIdentity(NOME)
await dona.escolherSalaComum(true)
await dona.connect()
await dona.updateProfile({ displayName: "Fundadora", donations: [] })
verificar(await ate(() => dona.channels.includes(SALA), 30_000), "a fundadora cria a sala comum")

browser = await chromium.launch()
const URL_DA_APP = `http://${NOME}/app/?lingua=pt`

// ------------------------------------------------- 1. a new account, with the proof
console.log("\n1. Conta nova no browser: a prova de trabalho")
const contexto = await browser.newContext({ locale: "pt-PT" })
const pagina = await contexto.newPage()
await pagina.goto(URL_DA_APP)
let viuAPreparar = false
const vigia = setInterval(() => {
  void pagina
    .getByText(/A preparar a conta…/)
    .count()
    .then((n) => {
      if (n > 0) viuAPreparar = true
    })
    .catch(() => {})
}, 100)
try {
  await criarConta(pagina, { nome: "Nova", servidor: NOME, canalOficial: true, timeout: 120_000 })
  await pagina.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
} catch (erro) {
  await pagina.screenshot({ path: join(RAIZ, ".dev-data-scr", "anti-abuso-registo.png") })
  console.log(`  FALHA o registo não chegou à aplicação: ${erro.message.split("\n")[0]}`)
  clearInterval(vigia)
  await arrumar(1)
}
clearInterval(vigia)
verificar(viuAPreparar, 'o botão disse "A preparar a conta…" durante a prova')
const nova = sql("select address from accounts order by created_minute desc, rowid desc limit 1")
verificar(nova !== dona.identity.address, `o servidor tem a conta nova (${nova})`)

// ------------------------------------------------- 2. the common room, new account
console.log("\n2. A conta nova na sala comum")
verificar(await ate(() => dona.membersOf(SALA).map(String).includes(nova), 90_000), "a conta nova entra na sala comum")
await pagina.locator(".channel-row").filter({ has: pagina.locator(".channel-name", { hasText: /^Orwell$/ }) }).first().click()
verificar(
  await pagina.getByText(/A tua conta é nova\. Algumas funções abrem daqui a 24 h\./).first().waitFor({ timeout: 30_000 }).then(() => true, () => false),
  "a caixa da sala comum diz que a conta é nova",
)
const caixa = pagina.locator("textarea").first()
const visto = (texto) => dona.history(SALA).some((e) => e.payload?.body === texto)
const MENSAGENS = ["mensagem 1", "mensagem 2", "mensagem 3", "mensagem 4", "mensagem 5"]
for (const texto of MENSAGENS) {
  await caixa.fill(texto)
  await caixa.press("Enter")
}
const inicio = Date.now()
verificar(await ate(() => visto("mensagem 1"), 60_000), "a fundadora lê a primeira logo (a folga)")
const primeiraEm = Date.now() - inicio
verificar(!visto("mensagem 5"), "a quinta ainda não chegou")
verificar(await ate(() => visto("mensagem 5"), 150_000), "a quinta chega depois do intervalo")
verificar(primeiraEm < 15_000, `a primeira não esperou o intervalo (${Math.round(primeiraEm / 1000)} s)`)
verificar(Date.now() - inicio >= 20_000, `a quinta esperou o intervalo (${Math.round((Date.now() - inicio) / 1000)} s)`)

// ------------------------------------------------- 3. the same network, again
console.log("\n3. Outra conta nova da mesma rede")
const outro = await browser.newContext({ locale: "pt-PT" })
const outraPagina = await outro.newPage()
await outraPagina.goto(URL_DA_APP)
await criarConta(outraPagina, { nome: "Outra", servidor: NOME, canalOficial: false, ficheiro: false, timeout: 120_000 }).catch(() => {})
verificar(
  await outraPagina.getByText(/Erro 234/).first().waitFor({ timeout: 60_000 }).then(() => true, () => false),
  'a segunda conta da mesma rede vê "Erro 234"',
)
verificar((await outraPagina.getByRole("textbox", { name: "Código de convite" }).count()) > 0, "e o campo do código de convite")

// ------------------------------------------------- 4. the same network, with a community invite
console.log("\n4. Outra conta nova da mesma rede, com a ligação de convite de uma comunidade")
const comunidade = moradaDeSala(NOME)
await dona.createSpaceChannel(comunidade)
const { longa, curta } = await dona.criarConvite(comunidade)
// The founder is a real community member: older than 72 hours, as the server checks.
execFileSync("sqlite3", [BASE, `update accounts set created_minute = created_minute - 6000 where address = '${dona.identity.address}'`])
const terceiro = await browser.newContext({ locale: "pt-PT" })
const terceiraPagina = await terceiro.newPage()
// The short link is copied as `/c#…`; in production Caddy sends it to `/app/c#…`, and this front does not, so go there directly.
await terceiraPagina.goto(curta ? curta.replace("/c#", "/app/c#") : longa)
let entrou = false
try {
  await criarConta(terceiraPagina, { nome: "Terceira", servidor: NOME, canalOficial: false, timeout: 120_000 })
  await terceiraPagina.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
  entrou = true
} catch (erro) {
  await terceiraPagina.screenshot({ path: join(RAIZ, ".dev-data-scr", "anti-abuso-convite.png") })
  console.log(`  (${erro.message.split("\n")[0]})`)
}
verificar(entrou, "a conta nova entra pela ligação de convite, sem Erro 234")
verificar((await terceiraPagina.getByText(/Erro 234/).count()) === 0, "e não vê o Erro 234")
verificar(Number(sql("select count(*) from accounts")) === 3, "o servidor tem a fundadora, a Nova e a Terceira")

// ------------------------------------------------- 5. the cap on channels
console.log("\n5. A conta nova cria 1 canal; depois o + fica cinzento, com a razão no hover")
/** The tooltip of a button: the text of its `::after` and whether it shows now. */
const dica = (locator) =>
  locator.evaluate((el) => {
    const depois = getComputedStyle(el, "::after")
    return { texto: depois.content.replace(/^"|"$/g, ""), visivel: Number(depois.opacity) > 0.9 }
  })
const maisDaColuna = () => pagina.locator(".header-add[aria-label='Criar canal']")
verificar((await maisDaColuna().count()) === 1 && (await maisDaColuna().getAttribute("aria-disabled")) === null, 'antes, o "+" da coluna está lá, activo')
await maisDaColuna().click()
await pagina.getByPlaceholder("geral").first().fill("Primeiro")
await pagina.keyboard.press("Enter")
const contadas = () => Number(sql(`select count(*) from channel_claims where owner = '${nova}' and comunidade = 1`))
verificar(await ate(() => contadas() === 1, 30_000), "o servidor conta 1 canal da conta nova")
verificar(
  await ate(async () => (await maisDaColuna().getAttribute("aria-disabled").catch(() => null)) === "true", 30_000),
  'o "+" da coluna continua lá, com aria-disabled="true"',
)
const FRASE_DO_CANAL = "A tua conta é nova. Nos primeiros 3 dias podes criar 1 canal. Podes entrar noutros canais com um link."
await maisDaColuna().hover()
verificar(
  await ate(async () => {
    const d = await dica(maisDaColuna())
    return d.visivel && d.texto === FRASE_DO_CANAL
  }, 5_000),
  "o hover mostra a razão",
)
await maisDaColuna().click({ force: true })
verificar((await pagina.getByRole("heading", { name: "Criar canal" }).count()) === 0, "clicar não abre a folha de criar canal")
verificar((await pagina.getByRole("button", { name: "Entrar com um link" }).count()) > 0, '"Entrar com um link" continua')

// ------------------------------------------------- 6. the cap on rooms
console.log("\n6. Salas até ao tecto da conta nova (2 de 3); depois «Nova sala» fica cinzenta, com a razão no hover")
const salasContadas = () => Number(sql(`select count(*) from rooms_created where owner = '${nova}'`))
verificar(salasContadas() === 0, "as 3 salas com que o canal nasceu não contam")
const novaSala = () => pagina.getByRole("button", { name: "Nova sala" }).first()
for (const nome of ["sala-um", "sala-dois"]) {
  await novaSala().click()
  await pagina.getByPlaceholder("Anúncios").fill(nome)
  await pagina.getByRole("button", { name: "Criar", exact: true }).click()
  await ate(async () => (await pagina.getByText(nome).count()) > 0, 30_000)
}
verificar(await ate(() => salasContadas() === 2, 30_000), "o servidor conta 2 salas da conta nova (o tecto das primeiras 72 h)")
verificar(
  await ate(async () => (await novaSala().getAttribute("aria-disabled").catch(() => null)) === "true", 30_000),
  '«Nova sala» continua lá, com aria-disabled="true"',
)
await pagina.mouse.move(0, 0)
await novaSala().hover()
verificar(
  await ate(async () => {
    const d = await dica(novaSala())
    return d.visivel && d.texto === "A tua conta é nova. Nos primeiros 3 dias podes criar 2 salas."
  }, 5_000),
  "o hover mostra a razão das salas",
)
if (process.env.E2E_CAPTURAS) {
  // Screenshots of the two tips, for the review (E2E_CAPTURAS=<folder>).
  const pasta = process.env.E2E_CAPTURAS
  mkdirSync(pasta, { recursive: true })
  for (const [largura, altura] of [[1280, 800], [390, 844]]) {
    await pagina.setViewportSize({ width: largura, height: altura })
    await pagina.waitForTimeout(500)
    if (largura < 600) {
      // The phone layout: back to the list, then the rail "+", opened by a tap (the same click handler).
      await pagina.getByRole("button", { name: "Voltar" }).first().click({ timeout: 10_000 }).catch(() => {})
      await pagina.waitForTimeout(500)
      // `force`: Playwright waits for an aria-disabled button to become enabled.
      await pagina.locator(".carril-nova").click({ force: true, timeout: 30_000 }).catch(() => {})
      await pagina.waitForTimeout(700)
      await pagina.screenshot({ path: join(pasta, "390-carril-toque.png") })
      continue
    }
    await maisDaColuna().hover()
    await pagina.waitForTimeout(700)
    await pagina.screenshot({ path: join(pasta, `${largura}-canal-hover.png`) })
    await pagina.mouse.move(0, 0)
    await novaSala().hover()
    await pagina.waitForTimeout(700)
    await pagina.screenshot({ path: join(pasta, `${largura}-sala-hover.png`) })
  }
}

if (falhas.length > 0) {
  console.log(`\n${falhas.length} falha(s).`)
  console.log(registoDoServidor.slice(-2000))
  await arrumar(1)
}
console.log("\nTudo certo.")
await arrumar(0)
