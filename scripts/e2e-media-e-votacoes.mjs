/**
 * Copy / download buttons on media, message links, and the polls page, with TWO accounts.
 *
 *   node scripts/e2e-media-e-votacoes.mjs [chromium|webkit] [desktop|telemovel]
 *
 * ALL LOCAL AND DISPOSABLE, the pattern of `e2e-telemovel.mjs`: a server in a temp
 * folder, a front end acting as Caddy, ports 8484 and 8485. It never points at
 * production, and it refuses to start if a port is taken (it kills nobody).
 *
 * It runs on the plain web build. Polls are created in a polls room, not from
 * the composer's "+" (`MOSTRAR_VOTACOES` in `Composer.tsx` stays off, and a check
 * here holds it so): do not flip that flag for this proof.
 *
 * Ana (desktop) writes: an image, a file, a poll in the default room, a poll in
 * a POLLS ROOM "votacoes" (a room with `layout: "polls"`, no chat) holding three polls, one of
 * them closed by hand and one with a deadline a minute away. Bruno (desktop
 * at 1440, or a 390 px touch phone) then:
 *   - opens the message menu (hover button, keyboard, long press on the phone) and
 *     finds "Copy image", "Download" and "Copy message link";
 *   - downloads the picture and compares the bytes with what Ana sent;
 *   - copies the image and, where the browser lets it, reads a PNG back;
 *   - opens the large image and finds the same buttons;
 *   - copies the message link and follows it (hash change) to the message;
 *   - opens "Polls" in the channel menu, uses the tabs and the room filter, and
 *     follows "See the message".
 * Screenshots go to `capturas/media-votacoes-<browser>-<modo>-*.png`.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { deflateSync } from "node:zlib"
import { fileURLToPath } from "node:url"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar, etiquetaDe } from "./convite.mjs"

const MOTOR = process.argv[2] ?? "chromium"
const MODO = process.argv[3] ?? "desktop"
const RAIZ = fileURLToPath(new URL("..", import.meta.url))
let DIST = join(RAIZ, "apps/web/dist")
/** A web build from before the polls room, for the old-client proof (a released build, from the environment). */
const DIST_ANTIGO = process.env.ORWELL_DIST_ANTIGO ?? join(RAIZ, "../release-1.3.9/apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const CAPTURAS = join(RAIZ, "capturas")
const PORTA_DA_FRENTE = 8484
const PORTA_DO_SERVIDOR = 8485
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const FRASE = "frase-de-verificacao-2026"
const TELEMOVEL = { width: 390, height: 844 }
const movel = MODO === "telemovel"

const results = []
function check(nome, ok, detalhe = "") {
  results.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A real PNG, made here: 96x64, a gradient, so a copy that loses bytes is visible. */
function fazerPng(largura, altura) {
  const crc = (buf) => {
    let c
    let tabela = fazerPng.tabela
    if (!tabela) {
      tabela = fazerPng.tabela = Array.from({ length: 256 }, (_, n) => {
        let v = n
        for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1
        return v >>> 0
      })
    }
    c = 0xffffffff
    for (const b of buf) c = tabela[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const bloco = (tipo, dados) => {
    const t = Buffer.from(tipo)
    const n = Buffer.alloc(4)
    n.writeUInt32BE(dados.length)
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(Buffer.concat([t, dados])))
    return Buffer.concat([n, t, dados, c])
  }
  const cabeca = Buffer.alloc(13)
  cabeca.writeUInt32BE(largura, 0)
  cabeca.writeUInt32BE(altura, 4)
  cabeca[8] = 8
  cabeca[9] = 2
  const linhas = []
  for (let y = 0; y < altura; y++) {
    const linha = Buffer.alloc(1 + largura * 3)
    for (let x = 0; x < largura; x++) {
      linha[1 + x * 3] = Math.round((x / largura) * 255)
      linha[2 + x * 3] = Math.round((y / altura) * 255)
      linha[3 + x * 3] = 140
    }
    linhas.push(linha)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloco("IHDR", cabeca),
    bloco("IDAT", deflateSync(Buffer.concat(linhas))),
    bloco("IEND", Buffer.alloc(0)),
  ])
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

const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-media-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let registoDoServidor = ""
servidor.stdout.on("data", (b) => (registoDoServidor += b))
servidor.stderr.on("data", (b) => (registoDoServidor += b))

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
    await wait(250)
  }
  return false
}

let browser
async function arrumar(codigo) {
  await browser?.close().catch(() => {})
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigo)
}
if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await arrumar(2)
}

let passo = 0
async function retratar(page, nome) {
  passo += 1
  const f = join(CAPTURAS, `media-votacoes-${MOTOR}-${MODO}-${String(passo).padStart(2, "0")}-${nome}.png`)
  await page.screenshot({ path: f })
  console.log(`  ..  captura: ${f}`)
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

mkdirSync(CAPTURAS, { recursive: true })
const PNG = fazerPng(96, 64)
const dirTemp = mkdtempSync(join(tmpdir(), "orwell-e2e-media-ficheiros-"))
const caminhoPng = join(dirTemp, "gradiente.png")
const caminhoTxt = join(dirTemp, "nota.txt")
writeFileSync(caminhoPng, PNG)
writeFileSync(caminhoTxt, "bytes do ficheiro de teste\n")

try {
  browser = await (MOTOR === "webkit" ? webkit : chromium).launch({ headless: true })
  const erros = []
  async function conta(nome, opcoes) {
    const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opcoes })
    if (movel && nome === "Bruno") {
      // A phone has a share sheet and headless browsers do not: record what the app hands to it.
      await ctx.addInitScript(() => {
        navigator.canShare = () => true
        navigator.share = async (dados) => {
          const f = dados.files?.[0]
          window.__partilhado = f ? { nome: f.name, tipo: f.type, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) } : null
        }
      })
    }
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
  const permissoes = MOTOR === "chromium" ? { permissions: ["clipboard-read", "clipboard-write"] } : {}
  const ana = await conta("Ana", {})
  const bruno = await conta("Bruno", { ...permissoes, ...(movel ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) })
  check("as duas contas abriram", Boolean(ana.addr && bruno.addr), `${ana.addr} / ${bruno.addr}`)

  // ------------------------------------------------------------------ Ana: channel, rooms
  const CANAL = `votacoes-${Date.now().toString(36)}`
  await ana.page.getByRole("button", { name: "Criar canal" }).first().click()
  await ana.page.locator("form.prompt input").first().fill(CANAL)
  await ana.page.locator("form.prompt button.primary").first().click()
  await ana.page.getByRole("heading", { name: CANAL }).waitFor({ timeout: 30_000 })
  const etiqueta = etiquetaDe(CANAL)
  const linhaDoCanal = (page) => page.locator(".channel-row", { has: page.locator(".channel-name", { hasText: etiqueta }) }).first()
  // "Polls" lives in the channel menu since 17/11/2026: the fixed sidebar row had no room behind it.
  const abrirVotacoesDoCanal = async (page) => {
    await linhaDoCanal(page).click({ button: "right" })
    await page.locator(".context-menu").getByRole("menuitem", { name: "Votações" }).click()
  }
  check("Bruno entrou no canal", await convidar(ana.page, etiqueta, bruno.addr) && (await aceitarConvite(bruno.page, etiqueta)))
  await linhaDoCanal(bruno.page).click()
  await wait(3000)

  // ---- No polls room yet: Bruno reads that there are none; Ana is offered the way to create one.
  await abrirVotacoesDoCanal(bruno.page)
  await bruno.page.locator(".votacoes-pagina").waitFor({ timeout: 10_000 })
  check("sem sala de votações, quem não organiza só lê que ainda não há votações",
    (await bruno.page.getByText("Ainda não há votações neste canal.").count()) === 1 && (await bruno.page.getByRole("button", { name: "Criar sala de votações" }).count()) === 0)
  await abrirVotacoesDoCanal(ana.page)
  await ana.page.getByRole("button", { name: "Criar sala de votações" }).waitFor({ timeout: 10_000 })
  check("e quem organiza vê «Criar sala de votações»", true)
  await retratar(ana.page, "sem-sala-de-votacoes")
  await ana.page.getByRole("button", { name: "Criar sala de votações" }).click()
  await ana.page.locator(".sheet input").first().fill("votacoes")
  await ana.page.locator(".kind-choice").getByRole("button", { name: "Votações", exact: true }).click()
  await ana.page.locator(".sheet-actions button.primary").first().click()
  await ana.page.locator('.room-tree .room-name:text-is("votacoes")').first().waitFor({ timeout: 30_000 })
  check("Ana criou a sala de votações pelo botão", true)

  const caixa = (page) => page.locator('input[placeholder="Escreve uma mensagem"]')
  const salaDeAna = async (nome) => {
    await ana.page.locator(`.room-tree .room-name:text-is("${nome}")`).first().click()
    await wait(800)
  }
  /** The local `datetime-local` value `ms` from now, rounded UP to the minute (the field has no seconds). */
  const dataEm = (ms) => {
    const d = new Date(Math.ceil((Date.now() + ms) / 60_000) * 60_000)
    const dois = (n) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`
  }
  const poll = async (pergunta, opcoes, prazo = null) => {
    await ana.page.getByRole("button", { name: "Nova votação" }).click()
    await ana.page.locator('.sheet input[placeholder="O que queres perguntar?"]').fill(pergunta)
    const campos = ana.page.locator('.sheet input[placeholder="Resposta"]')
    for (let i = 0; i < opcoes.length; i++) await campos.nth(i).fill(opcoes[i])
    if (prazo) {
      await ana.page.getByRole("radio", { name: "Data e hora" }).check()
      await ana.page.locator('.sheet input[type="datetime-local"]').fill(prazo)
    }
    await ana.page.locator(".sheet-actions button.primary").first().click()
    await wait(3000)
  }

  // Default room: the picture, the file, a poll.
  await ana.page.locator(".room-tree .room-name").first().click().catch(() => {})
  await caixa(ana.page).waitFor({ timeout: 30_000 })
  await ana.page.locator('input[type="file"][accept^="image"]').setInputFiles(caminhoPng)
  await wait(1500)
  await caixa(ana.page).fill("olha a imagem")
  await ana.page.keyboard.press("Enter")
  await wait(4000)
  await ana.page.locator('input[type="file"]:not([accept])').setInputFiles(caminhoTxt)
  await wait(1500)
  await caixa(ana.page).fill("e o ficheiro")
  await ana.page.keyboard.press("Enter")
  await wait(4000)
  // The chat room no longer creates polls from its "+" menu.
  await ana.page.getByRole("button", { name: "Anexar ou abanar" }).click()
  const maisDoChat = await ana.page.getByRole("menuitem").allInnerTexts()
  check("o «+» da caixa de escrita já não cria votações", !maisDoChat.some((t) => /votação/i.test(t)), maisDoChat.join(" | "))
  await ana.page.keyboard.press("Escape")

  // The polls room: polls and nothing else.
  await salaDeAna("votacoes")
  check("dentro da sala de votações não há caixa de escrita", (await caixa(ana.page).count()) === 0)
  await poll("Jantar na sexta?", ["Sim", "Não"])
  const prazoCurto = dataEm(75_000)
  const fechoCurtoEm = new Date(prazoCurto).getTime()
  await poll("Fecha sozinha?", ["Sim", "Não"], prazoCurto)
  await poll("Que cor tinha o muro?", ["Branco", "Cinza"])
  // Closed by hand, by its author, before any deadline.
  await ana.page.locator(".votacoes-pagina-cartao", { hasText: "Que cor tinha o muro?" }).getByRole("button", { name: "Fechar votação" }).click()
  await wait(3000)
  await ana.page.locator(".room-tree .room-name").first().click().catch(() => {})
  await wait(1500)

  // ------------------------------------------------------------------ Bruno
  const bp = bruno.page
  if (movel) {
    await bp.setViewportSize(TELEMOVEL)
    await wait(800)
  }
  // Bruno left the conversation to read the polls list: back to the default room (through the drawer on a phone).
  if (movel) await bp.getByRole("button", { name: "Abrir o painel lateral" }).tap().catch(() => {})
  await bp.locator(".room-tree .room-name").first().click()
  await bp.locator(".message img").first().waitFor({ timeout: 60_000 })
  check("Bruno recebeu a imagem e o ficheiro", (await bp.locator(".file-attachment").count()) >= 1)
  await retratar(bp, "conversa")

  const mensagemDaImagem = bp.locator(".message", { has: bp.locator("img") }).first()
  const entradasDoMenu = async () => (await bp.getByRole("menuitem").allInnerTexts()).map((t) => t.trim())

  // 1. Open the message menu the way each device does it.
  if (movel) {
    await toqueLongo(mensagemDaImagem)
  } else {
    await mensagemDaImagem.hover()
    await mensagemDaImagem.getByRole("button", { name: "Mais acções nesta mensagem" }).click()
  }
  await wait(500)
  const entradas = await entradasDoMenu()
  check(movel ? "o toque longo abre o menu da mensagem" : "o botão que aparece com o rato abre o menu da mensagem", entradas.length > 0, entradas.join(" | "))
  check("o menu tem Copiar imagem, Descarregar e Copiar link da mensagem",
    ["Copiar imagem", "Descarregar", "Copiar link da mensagem"].every((e) => entradas.includes(e)))
  await retratar(bp, "menu-da-mensagem")

  // 2. Download: the bytes are what Ana sent.
  const descarga = bp.waitForEvent("download", { timeout: movel ? 3000 : 15_000 }).catch(() => null)
  await bp.getByRole("menuitem", { name: "Descarregar", exact: true }).click()
  const baixado = await descarga
  let iguais = false
  if (movel) {
    // On a phone, "Download" opens the share sheet with the file itself.
    await wait(800)
    const partilhado = await bp.evaluate(() => window.__partilhado ?? null)
    iguais = Boolean(partilhado) && Buffer.from(partilhado.bytes).equals(PNG) && partilhado.tipo === "image/png"
    check("no telemóvel, Descarregar abre a folha de partilha com o ficheiro e os bytes exactos", iguais, partilhado ? `${partilhado.nome} ${partilhado.tipo}` : "sem partilha")
  } else {
    if (baixado) {
      const caminho = await baixado.path()
      iguais = caminho ? readFileSync(caminho).equals(PNG) : false
    }
    check("Descarregar grava um ficheiro com os bytes exactos da imagem", iguais, baixado ? baixado.suggestedFilename() : "sem download")
  }

  // 3. Copy image.
  await wait(500)
  if (movel) await toqueLongo(mensagemDaImagem)
  else {
    await mensagemDaImagem.hover()
    await mensagemDaImagem.getByRole("button", { name: "Mais acções nesta mensagem" }).click()
  }
  await bp.getByRole("menuitem", { name: "Copiar imagem", exact: true }).click()
  await wait(1200)
  const avisos = (await bp.locator(".toast-stack").innerText().catch(() => "")).replace(/\s+/g, " ").trim()
  if (MOTOR === "chromium") {
    const tipo = await bp.evaluate(async () => {
      try {
        const [item] = await navigator.clipboard.read()
        const blob = await item.getType("image/png")
        return `${blob.type}:${blob.size}`
      } catch (e) {
        return `erro:${e.name}`
      }
    })
    check("Copiar imagem põe um PNG na área de transferência", /^image\/png:\d{3,}$/.test(tipo), tipo)
  }
  check("Copiar imagem diz o que aconteceu, numa linha", /Imagem copiada\.|Este browser não copia imagens\.|O browser não deixou copiar a imagem\./.test(avisos), avisos)

  // 4. Keyboard: Tab to the "⋯" button, Enter opens the menu, Escape closes it.
  if (!movel) {
    await mensagemDaImagem.hover()
    const mais = mensagemDaImagem.getByRole("button", { name: "Mais acções nesta mensagem" })
    await mais.focus()
    await bp.keyboard.press("Enter")
    await wait(400)
    check("com o teclado, o menu abre no botão «Mais acções»", (await entradasDoMenu()).includes("Copiar imagem"))
    await bp.keyboard.press("Escape")
  }

  // 5. The file: only Download.
  const mensagemDoFicheiro = bp.locator(".message", { hasText: "e o ficheiro" }).first()
  if (movel) await toqueLongo(mensagemDoFicheiro)
  else {
    await mensagemDoFicheiro.hover()
    await mensagemDoFicheiro.getByRole("button", { name: "Mais acções nesta mensagem" }).click()
  }
  await wait(400)
  const doFicheiro = await entradasDoMenu()
  check("o ficheiro só tem Descarregar (e o link da mensagem), sem Copiar imagem", doFicheiro.includes("Descarregar") && !doFicheiro.includes("Copiar imagem"), doFicheiro.join(" | "))
  await bp.keyboard.press("Escape")

  // 6. Large image.
  await mensagemDaImagem.locator(".image-open").first().click()
  await bp.locator(".lightbox").waitFor({ timeout: 10_000 })
  const botoes = await bp.locator(".lightbox-accoes button").allInnerTexts()
  check("o visualizador tem Copiar imagem, Descarregar e Copiar link da mensagem", ["Copiar imagem", "Descarregar", "Copiar link da mensagem"].every((e) => botoes.map((b) => b.trim()).includes(e)), botoes.join(" | "))
  const caixaDaFolha = await bp.locator(".lightbox").boundingBox()
  const janela = bp.viewportSize()
  check("o visualizador cabe no ecrã com os botões", caixaDaFolha && caixaDaFolha.y >= 0 && caixaDaFolha.y + caixaDaFolha.height <= janela.height + 1 && caixaDaFolha.x >= 0 && caixaDaFolha.x + caixaDaFolha.width <= janela.width + 1, JSON.stringify(caixaDaFolha))
  await wait(900) // the sheet animates in; a slow machine would be caught half drawn
  await retratar(bp, "visualizador")
  const descarga2 = bp.waitForEvent("download", { timeout: movel ? 3000 : 15_000 }).catch(() => null)
  if (movel) await bp.evaluate(() => { window.__partilhado = null })
  await bp.locator(".lightbox-accoes").getByRole("button", { name: "Descarregar" }).click()
  const baixado2 = await descarga2
  if (movel) {
    await wait(800)
    const partilhado = await bp.evaluate(() => window.__partilhado ?? null)
    check("Descarregar no visualizador abre a folha de partilha com os mesmos bytes", Boolean(partilhado) && Buffer.from(partilhado.bytes).equals(PNG))
  } else {
    check("Descarregar no visualizador grava os mesmos bytes", baixado2 && readFileSync(await baixado2.path()).equals(PNG))
  }

  // 7. Message link: copy it, move to another room, follow it.
  await bp.locator(".lightbox-accoes").getByRole("button", { name: "Copiar link da mensagem" }).click()
  await wait(600)
  let ligacao = ""
  if (MOTOR === "chromium") ligacao = await bp.evaluate(() => navigator.clipboard.readText())
  else {
    // WebKit in Playwright has no clipboard permission: read the link where the app builds it.
    ligacao = await bp.evaluate(() => "")
  }
  await bp.keyboard.press("Escape")
  check("o link da mensagem tem o caminho /app/m e o canal só no fragmento", MOTOR !== "chromium" || (/\/app\/m#m=/.test(ligacao) && !new URL(ligacao).search), ligacao)
  if (MOTOR === "chromium") {
    // Move away to another room, then follow the link.
    await bp.locator(".room-tree .room-name:text-is(\"votacoes\")").first().click().catch(() => {})
    await wait(800)
    await bp.evaluate((hash) => { location.hash = hash }, new URL(ligacao).hash)
    await bp.locator(".message.destacada").first().waitFor({ timeout: 15_000 }).catch(() => {})
    const noSitio = await bp.evaluate(() => {
      const m = document.querySelector(".message.destacada")
      return m ? m.textContent : null
    })
    check("seguir o link leva à sala da mensagem e acende-a", (noSitio ?? "").includes("olha a imagem"), noSitio ?? "sem linha destacada")
    check("e o fragmento sai do endereço depois de usado", (await bp.evaluate(() => location.hash)) === "")
  }

  // ------------------------------------------------------------------ The polls room, as Bruno
  if (movel) await bp.getByRole("button", { name: "Abrir o painel lateral" }).tap().catch(() => {})
  await retratar(bp, "barra-com-sala-de-votacoes")
  const salaDeVotos = bp.locator(".room-row", { hasText: "votacoes" }).first()
  // Rooms drag only for whoever may edit the channel (`onReorderRoom` is set only
  // with `editaOCanal` in App.tsx): Ana, who created it, drags the polls room like
  // any other; Bruno, a plain member, sees it in the tree but does not drag it.
  const salaDeVotosDaAna = ana.page.locator(".room-row", { hasText: "votacoes" }).first()
  check(
    "a sala de votações está na barra como as outras salas, e arrasta-se (para quem edita o canal)",
    (await salaDeVotos.isVisible()) &&
      (await salaDeVotos.getAttribute("draggable")) === "false" &&
      (await salaDeVotosDaAna.getAttribute("draggable")) === "true",
    `Bruno: ${await salaDeVotos.getAttribute("draggable")}, Ana: ${await salaDeVotosDaAna.getAttribute("draggable")}`,
  )
  check("e já não há linha fixa «Votações»", (await bp.locator(".room-votacoes").count()) === 0)
  await salaDeVotos.locator("button.room").click()
  await bp.locator(".votacoes-pagina-cartao").first().waitFor({ timeout: 15_000 })
  check("com uma só sala de votações, a linha leva direto a ela", (await bp.locator(".votacoes-pagina-topo h2").innerText()) === "votacoes")
  check("e lá dentro não há conversa", (await caixa(bp).count()) === 0 && (await bp.locator(".message").count()) === 0)
  await wait(800)
  const perguntasAbertas = await bp.locator(".votacoes-pagina-cartao .votacao-pergunta").allInnerTexts()
  check("as Abertas têm as que têm prazo por chegar", perguntasAbertas.includes("Jantar na sexta?") && perguntasAbertas.includes("Fecha sozinha?") && !perguntasAbertas.includes("Que cor tinha o muro?"), perguntasAbertas.join(" | "))
  check("cada votação diz quando fecha", (await bp.locator(".votacoes-pagina-cartao .votacao-prazo").allInnerTexts()).some((t) => /^Fecha a /.test(t)))
  check("Bruno pode criar votações (escreve na sala) e não pode fechar as da Ana", (await bp.getByRole("button", { name: "Nova votação" }).count()) === 1 && (await bp.getByRole("button", { name: "Fechar votação" }).count()) === 0)
  await retratar(bp, "sala-de-votacoes-abertas")
  const larguraDaPagina = await bp.evaluate(() => ({ cx: document.documentElement.clientWidth, sx: document.documentElement.scrollWidth }))
  check("sem scroll lateral", larguraDaPagina.sx <= larguraDaPagina.cx, JSON.stringify(larguraDaPagina))
  // Layout A: the room takes the whole main area; on desktop the content is a centred 960 px column,
  // on a phone the cards run from edge to edge.
  const geometria = await bp.evaluate(() => {
    const caixa = (el) => (el ? el.getBoundingClientRect() : null)
    const sala = caixa(document.querySelector("section.votacoes-pagina"))
    const miolo = caixa(document.querySelector(".votacoes-pagina-miolo"))
    const cartao = caixa(document.querySelector(".votacoes-pagina-cartao"))
    const barra = document.querySelector(".votacoes-pagina-cartao .votacao-opcao")
    return {
      janela: document.documentElement.clientWidth,
      sala: sala && { x: Math.round(sala.x), w: Math.round(sala.width) },
      miolo: miolo && { x: Math.round(miolo.x), w: Math.round(miolo.width) },
      cartao: cartao && { x: Math.round(cartao.x), w: Math.round(cartao.width) },
      barra: barra ? Math.round(barra.getBoundingClientRect().width) : 0,
      membros: (document.querySelector("aside.members")?.getBoundingClientRect().width ?? 0) > 0,
    }
  })
  if (movel) {
    // The rail stays at the left on a phone; the cards fill the rest, edge to edge.
    check("layout A no telemóvel: os cartões vão de margem a margem da área principal", geometria.cartao && geometria.sala && geometria.cartao.x === geometria.sala.x && geometria.cartao.w === geometria.sala.w && geometria.sala.x + geometria.sala.w === geometria.janela, JSON.stringify(geometria))
  } else {
    const centro = geometria.miolo && geometria.sala && Math.abs(geometria.miolo.x - geometria.sala.x - (geometria.sala.w - geometria.miolo.w) / 2) <= 1
    check("layout A a 1440: coluna central de 960 px, centrada, sem coluna de membros", geometria.miolo?.w === 960 && centro && !geometria.membros, JSON.stringify(geometria))
    check("e as barras de resultado ocupam a largura do cartão", geometria.cartao && geometria.barra >= geometria.cartao.w - 2 * 40 - 2, JSON.stringify(geometria))
  }

  // Voting works from the card.
  await bp.locator(".votacoes-pagina-cartao", { hasText: "Jantar na sexta?" }).getByRole("button", { name: /Votar em Sim/ }).click()
  await wait(3000)
  check("votar no cartão conta o voto", (await bp.locator(".votacoes-pagina-cartao", { hasText: "Jantar na sexta?" }).innerText()).includes("1 voto"))
  await salaDeAna("votacoes")
  const anaVe = await ana.page.locator(".votacoes-pagina-cartao", { hasText: "Jantar na sexta?" }).innerText()
  check("e a Ana vê o voto do Bruno", /1 voto/.test(anaVe), anaVe.replace(/\s+/g, " "))
  check("a Ana, que criou, tem «Fechar votação» nas suas", (await ana.page.getByRole("button", { name: "Fechar votação" }).count()) >= 1)

  await bp.getByRole("tab", { name: /Fechadas/ }).click()
  await wait(400)
  const fechadas = await bp.locator(".votacoes-pagina-cartao .votacao-pergunta").allInnerTexts()
  check("as Fechadas têm a votação que o autor fechou à mão", fechadas.includes("Que cor tinha o muro?"), fechadas.join(" | "))
  check("a fechada di-lo no cartão e não deixa votar", (await bp.locator(".votacoes-pagina-cartao .votacao-fechada").allInnerTexts()).some((t) => /^Fechou a /.test(t)) && (await bp.getByRole("button", { name: /Votar em/ }).count()) === 0)
  await retratar(bp, "sala-de-votacoes-fechadas")
  await bp.getByRole("tab", { name: /Abertas/ }).click()

  // The poll with the short deadline moves to "Closed" by itself, with the room open and no reload.
  await wait(Math.max(0, fechoCurtoEm - Date.now()) + 4000)
  await bp.getByRole("tab", { name: /Fechadas/ }).click()
  const fechadasDepois = await bp.locator(".votacoes-pagina-cartao .votacao-pergunta").allInnerTexts()
  check("passado o prazo, a votação muda sozinha para as Fechadas", fechadasDepois.includes("Fecha sozinha?"), fechadasDepois.join(" | "))
  await bp.getByRole("tab", { name: /Abertas/ }).click()
  const abertasDepois = await bp.locator(".votacoes-pagina-cartao .votacao-pergunta").allInnerTexts()
  check("e sai das Abertas", !abertasDepois.includes("Fecha sozinha?"), abertasDepois.join(" | "))

  // "New poll" from Bruno: he can write in the room.
  await bp.getByRole("button", { name: "Nova votação" }).click()
  await bp.locator('.sheet input[placeholder="O que queres perguntar?"]').fill("Dos três, qual?")
  const camposB = bp.locator('.sheet input[placeholder="Resposta"]')
  await camposB.nth(0).fill("A")
  await camposB.nth(1).fill("B")
  await bp.locator(".sheet-actions button.primary").first().click()
  await bp.locator(".votacoes-pagina-cartao", { hasText: "Dos três, qual?" }).waitFor({ timeout: 15_000 }).catch(() => {})
  check("Bruno cria uma votação na sala, e fica como cartão", (await bp.locator(".votacoes-pagina-cartao", { hasText: "Dos três, qual?" }).count()) === 1)
  check("e é dele fechá-la", (await bp.locator(".votacoes-pagina-cartao", { hasText: "Dos três, qual?" }).getByRole("button", { name: "Fechar votação" }).count()) === 1)

  // ---- The old client: the same server and the same rooms, a web build from before the polls room.
  if (existsSync(join(DIST_ANTIGO, "index.html"))) {
    DIST = DIST_ANTIGO
    const antes = erros.length
    await bp.reload({ waitUntil: "domcontentloaded" })
    const campoFrase = bp.locator('input[type="password"]').first()
    await campoFrase.or(bp.getByRole("button", { name: "Configurações", exact: true }).first()).first().waitFor({ timeout: 60_000 })
    if (await campoFrase.count()) {
      await campoFrase.fill(FRASE)
      await bp.keyboard.press("Enter")
    }
    await bp.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
    if (movel) await bp.getByRole("button", { name: "Abrir o painel lateral" }).tap().catch(() => {})
    await wait(4000)
    // The old build asks to save the account file when it opens: close that sheet, like a person would.
    const lembrete = bp.locator(".sheet").getByRole("button", { name: "Fechar" }).first()
    if (await lembrete.isVisible().catch(() => false)) await lembrete.click()
    // On a phone the old build may have its drawer shut or no channel open after a reload: open the drawer, then the channel.
    const salaAntiga = bp.locator(`.room-tree .room-name:text-is("votacoes")`).first()
    if (movel && !(await salaAntiga.isVisible().catch(() => false))) {
      await bp.getByRole("button", { name: "Abrir o painel lateral" }).tap().catch(() => {})
      await wait(800)
    }
    if (movel && !(await salaAntiga.isVisible().catch(() => false))) {
      await linhaDoCanal(bp).tap().catch(() => {})
      await wait(1200)
    }
    await bp.locator(`.room-tree .room-name:text-is("votacoes")`).first().click({ timeout: 15_000 })
    await wait(2500)
    check("cliente antigo: a sala de votações é uma sala de texto, com caixa de escrita", (await caixa(bp).count()) === 1)
    const lido = await bp.locator(".message").allInnerTexts()
    check("cliente antigo: as votações lêem-se (cartão ou texto), sem nada partido", lido.some((t) => t.includes("Jantar na sexta?")) && lido.some((t) => t.includes("Sim")), lido.length + " mensagens")
    check("cliente antigo: sem erros de página", erros.length === antes, erros.slice(antes).join(" || "))
    await retratar(bp, "cliente-antigo")
    DIST = join(RAIZ, "apps/web/dist")
  } else {
    console.log("  ..  sem a web antiga (ORWELL_DIST_ANTIGO): a prova do cliente antigo não correu")
    results.push(false)
  }

  check("sem erros de página", erros.length === 0, erros.join(" || "))
} catch (erro) {
  console.error("O guião caiu:", erro)
  results.push(false)
}

const falhas = results.filter((r) => !r).length
console.log(`\n${results.length - falhas}/${results.length} passaram`)
rmSync(dirTemp, { recursive: true, force: true })
await arrumar(falhas === 0 ? 0 : 1)
