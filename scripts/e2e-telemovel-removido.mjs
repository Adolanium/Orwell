/**
 * Removing a device, end to end in real browsers (1.3.16, the requirement:
 * "When a user removes a device in the settings, the account
 * becomes unreachable on that device. As it conventionally happens."
 *
 *   node scripts/e2e-telemovel-removido.mjs [--telemovel chromium|webkit|firefox]
 *   (needs `npm run build` first)
 *
 * Ana creates the account on the computer (Chromium) and writes in a channel.
 * The phone (the browser chosen, 390x844) pairs by the link and receives the
 * account key (Erro 609 is gone). The phone closes. On the computer, Settings ›
 * Devices › Revoke. The phone opens again: the app signs out, the vault and the
 * media in it are erased from IndexedDB, and the sign-up gate shows the phrase
 * with code 748. The computer stays in the account and keeps writing.
 *
 * ALL LOCAL AND ALL DISPOSABLE, like `e2e-emparelhar.mjs`: its own homeserver in
 * a temp folder, a front end acting as Caddy, its own ports, no way to point it
 * at production.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { abrirComunidade, appAberta } from "./separadores.mjs"
import { juntarComPalavras } from "./juntar-aparelho.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA_DA_FRENTE = 8482
const PORTA_DO_SERVIDOR = 8483
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const FRASE = "frase-de-verificacao-2026"
const MOTORES = { chromium, webkit, firefox }
const qual = process.argv.includes("--telemovel") ? process.argv[process.argv.indexOf("--telemovel") + 1] : "chromium"
const motorDoTelemovel = MOTORES[qual]
if (!motorDoTelemovel) {
  console.error(`--telemovel ${qual}: só chromium, webkit ou firefox`)
  process.exit(2)
}

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

const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-removido-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let registoDoServidor = ""
servidor.stdout.on("data", (bocado) => (registoDoServidor += bocado))
servidor.stderr.on("data", (bocado) => (registoDoServidor += bocado))

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json", ".wasm": "application/wasm" }
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
  const adiante = http.request({ host: "127.0.0.1", port: PORTA_DO_SERVIDOR, path: pedido.url, method: pedido.method, headers: pedido.headers }, (vinda) => {
    resposta.writeHead(vinda.statusCode ?? 502, vinda.headers)
    vinda.pipe(resposta)
  })
  adiante.on("error", () => {
    resposta.writeHead(502)
    resposta.end()
  })
  pedido.pipe(adiante)
})
frente.on("upgrade", (pedido, socket, cabeca) => {
  const destino = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => {
    const linhas = [`${pedido.method} ${pedido.url} HTTP/${pedido.httpVersion}`]
    for (let i = 0; i < pedido.rawHeaders.length; i += 2) linhas.push(`${pedido.rawHeaders[i]}: ${pedido.rawHeaders[i + 1]}`)
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

let browserPc
let browserTel
async function arrumar(codigoDeSaida) {
  await browserPc?.close().catch(() => {})
  await browserTel?.close().catch(() => {})
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigoDeSaida)
}
if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await arrumar(2)
}

const erros = []
function escutar(context, nome) {
  context.on("page", (page) => page.on("pageerror", (erro) => erros.push(`${nome}: ${erro.message}`)))
}
const CONTEXTO = { locale: "pt-PT" }
// The app is open: the rail on a computer, the bar of tabs on a phone.
const dentro = (page, timeout = 90_000) => appAberta(page, timeout)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Open a channel's conversation at any width: on the phone through the rail of communities (`separadores.mjs`). */
const abrirCanal = (page, nome) => abrirComunidade(page, nome)
async function dizer(page, frase) {
  const caixa = page.locator('textarea[placeholder="Escreve uma mensagem"]')
  await caixa.click()
  await caixa.fill(frase)
  await page.keyboard.press("Enter")
  // With a finger (a touch context), Enter starts a new line and the send
  // button sends (1.3.25). The text is still in the box: send it.
  if ((await caixa.inputValue().catch(() => "")) !== "") await page.locator("form.chat-composer .composer-enviar").first().click()
}
const ouviu = (page, frase, timeout = 30_000) =>
  page.getByText(frase, { exact: false }).first().waitFor({ timeout }).then(() => true, () => false)

/** What IndexedDB holds for the main account: the vault bytes (or null) and whether a remembered session is there. */
async function armazem(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const pedido = indexedDB.open("enclave", 1)
        pedido.onerror = () => reject(pedido.error)
        pedido.onsuccess = () => {
          const db = pedido.result
          if (!db.objectStoreNames.contains("vault")) return resolve({ cofre: null, sessao: false, chaves: [] })
          const store = db.transaction("vault", "readonly").objectStore("vault")
          const cofre = store.get("current")
          const sessao = store.get("sessao")
          const chaves = store.getAllKeys()
          chaves.onsuccess = () =>
            resolve({
              cofre: cofre.result ? new TextDecoder().decode(cofre.result) : null,
              sessao: sessao.result !== undefined,
              chaves: chaves.result.map(String),
            })
          chaves.onerror = () => reject(chaves.error)
        }
      }),
  )
}

function abrirCofre(bruto, frase) {
  const ficheiro = JSON.parse(bruto.startsWith("orwv2\n") ? bruto.slice(6) : bruto)
  const b64 = (texto) => Buffer.from(texto.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  const chave = argon2id(new TextEncoder().encode(frase), b64(ficheiro.salt), { t: 3, m: 65_536, p: 4, dkLen: 32 })
  return JSON.parse(new TextDecoder().decode(xchacha20poly1305(chave, b64(ficheiro.nonce)).decrypt(b64(ficheiro.ciphertext))))
}

try {
  console.log(`  ..  computador em Chromium, telemóvel em ${qual}`)
  browserPc = await chromium.launch({ headless: true })
  const ctxPc = await browserPc.newContext(CONTEXTO)
  escutar(ctxPc, "pc")
  const pc = await ctxPc.newPage()
  await pc.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(pc, { nome: "Ana", frase: FRASE, servidor: NOME, canalOficial: false })
  await dentro(pc)
  await pc.getByRole("button", { name: "Criar canal" }).first().click()
  await pc.locator("form.prompt input").first().fill("adega")
  await pc.locator("form.prompt button.primary").first().click()
  // Since 1.3.20 the heading is the room, and the channel's name sits beside it.
  await pc.locator("h1, .topbar-comunidade").filter({ hasText: /^adega$/ }).first().waitFor({ timeout: 30_000 })
  const antes = `antes do telemóvel, ${Date.now().toString(36)}`
  await dizer(pc, antes)
  check("a Ana cria a conta e o canal adega no computador, e escreve", await ouviu(pc, antes))

  // ---- pairing, by the link
  await pc.getByRole("button", { name: "Configurações" }).first().click()
  await pc.getByRole("button", { name: "Conta e segurança", exact: true }).click()
  await pc.getByRole("button", { name: "Juntar um aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator("code[data-link]").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")

  browserTel = await motorDoTelemovel.launch({ headless: true })
  const ctxTel = await browserTel.newContext({
    ...CONTEXTO,
    viewport: { width: 390, height: 844 },
    ...(qual === "firefox" ? {} : { deviceScaleFactor: 2, isMobile: true }),
    hasTouch: true,
  })
  escutar(ctxTel, "telemóvel")
  let tel = await ctxTel.newPage()
  await tel.goto(APP, { waitUntil: "domcontentloaded" })
  await tel.getByRole("button", { name: "Entrar com outro aparelho" }).click({ timeout: 60_000 })
  await juntarComPalavras(tel, folha, link, FRASE)
  await folha.getByText("O aparelho novo já está na conta.").waitFor({ timeout: 30_000 }).catch(() => {})
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await dentro(tel)
  check("o telemóvel emparelha pelo link e entra na conta", true)

  await wait(2500)
  const guardado = await armazem(tel)
  const cofreTel = guardado.cofre ? abrirCofre(guardado.cofre, FRASE) : null
  const cofrePc = abrirCofre((await armazem(pc)).cofre, FRASE)
  check("o cofre do telemóvel tem a chave da conta, a mesma do computador", cofreTel?.signingPrivateKey?.length === 43 && cofreTel.signingPrivateKey === cofrePc.signingPrivateKey)
  await abrirCanal(tel, "adega").catch(() => {})
  check("o telemóvel tem o histórico do canal (o cofre e o armazém de media ficam no IndexedDB)", await ouviu(tel, antes, 60_000))

  // ---- the phone closes; the computer removes it
  await tel.close()
  await pc.keyboard.press("Escape").catch(() => {})
  await pc.getByRole("button", { name: "Configurações" }).first().click()
  await pc.getByRole("button", { name: "Conta e segurança", exact: true }).click()
  await pc.getByRole("button", { name: /^Aparelhos/ }).click()
  await pc.locator(".aparelhos-lista li").nth(1).waitFor({ timeout: 15_000 })
  check("o computador vê dois aparelhos", (await pc.locator(".aparelhos-lista li").count()) === 2)
  await pc.getByRole("button", { name: /^Revogar / }).first().click()
  await pc.getByRole("alertdialog").getByRole("button", { name: "Revogar" }).click()
  await pc.getByText("O aparelho foi revogado.").first().waitFor({ timeout: 30_000 }).then(
    () => check("o computador revoga o telemóvel em Definições › Aparelhos", true),
    () => check("o computador revoga o telemóvel em Definições › Aparelhos", false),
  )

  // ---- the phone comes back
  tel = await ctxTel.newPage()
  await tel.goto(APP, { waitUntil: "domcontentloaded" })
  // With the remembered session it opens by itself; without it, the password.
  const porta = tel.locator('input[type="password"]').first()
  const pediu = await porta.waitFor({ timeout: 8_000 }).then(() => true, () => false)
  if (pediu) {
    await porta.fill(FRASE)
    await tel.keyboard.press("Enter")
  }
  // 21/11/2026: its own screen, "Este aparelho saiu da conta.", with the two ways back in.
  const viuAFrase = await tel
    .getByRole("heading", { name: "Este aparelho saiu da conta." })
    .waitFor({ timeout: 60_000 })
    .then(() => true, () => false)
  check("o telemóvel volta, sai da conta e diz porquê", viuAFrase)
  if (!viuAFrase) console.log(`  ..  o ecrã do telemóvel: ${JSON.stringify(((await tel.locator("body").innerText().catch(() => "")) ?? "").slice(0, 300))}`)
  const caminhos =
    (await tel.getByRole("button", { name: "Entrar com o ficheiro da conta" }).count()) === 1 &&
    (await tel.getByRole("button", { name: "Entrar com outro aparelho" }).count()) === 1
  check("e oferece o ficheiro da conta e outro aparelho, nunca apagar", caminhos)
  await wait(1000)
  const depois = await armazem(tel)
  check("o cofre do telemóvel foi apagado do IndexedDB (mensagens e media)", depois.cofre === null, JSON.stringify(depois.chaves))
  check("e a sessão memorizada também", depois.sessao === false)

  // A reload stays out: nothing left opens the account.
  await tel.reload({ waitUntil: "domcontentloaded" })
  const voltouADentro = await dentro(tel, 10_000).then(() => true, () => false)
  check("recarregar não volta a abrir a conta", !voltouADentro)

  // ---- the computer stays in, and keeps writing
  await pc.keyboard.press("Escape").catch(() => {})
  await pc.getByRole("button", { name: "Comunidades" }).first().click().catch(() => {})
  await abrirCanal(pc, "adega")
  const doPc = `depois de revogar, ${Date.now().toString(36)}`
  await dizer(pc, doPc)
  check("o computador continua na conta e escreve", await ouviu(pc, doPc))
  check("nenhum erro de página", erros.length === 0, erros[0]?.slice(0, 100) ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
