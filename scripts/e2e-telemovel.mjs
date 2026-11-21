/**
 * Phone in hand: the tabs, the rooms, the long press, the people panel
 * and the keyboard.
 *
 *   node scripts/e2e-telemovel.mjs           (needs `npm run build` first)
 *
 * **Why this script had to exist.** Duarte used Orwell on a 390px screen for
 * the first time and reported: "can't see the different channels or the rooms".
 * No script proved that path. `e2e-mobile-scroll.mjs` measures four scrollers
 * (and runs against PRODUCTION); `medir-destinos.mjs` opens the drawer with
 * `click({ force: true })`, which passes through any panel on top, in other
 * words, it would hide exactly the bug that was there. This one taps like a
 * finger taps: `tap()`, no `force`, in a 390x844 context with touch.
 *
 * The path, which is the complaint read backwards. Since the phone layout
 * with tabs (option B, 20/11/2026) there is no drawer at 840 px or less:
 * the Communities tab is the list (a rail of communities and the channels of
 * the chosen one), and a conversation is pushed full screen over it.
 *   1. the Communities tab shows the list, with the rail of communities;
 *   2. tap a community WITH rooms on the rail: its rooms appear and the list STAYS;
 *   3. tap a room: its conversation is pushed full screen; the back arrow and
 *      the browser back button bring the list back;
 *   4. long press a channel: opens the menu that right-click opens, as a sheet;
 *   5. the people panel is pushed full screen and its arrow closes it;
 *   6. focus on the input bar does not hide it below the keyboard.
 *
 * ALL LOCAL AND ALL DISPOSABLE, following the pattern of `e2e-emparelhar.mjs`:
 * your own homeserver in a temp folder, a front end acting as Caddy on 8472, and
 * no way to point it at production.
 *
 * **What this script CANNOT prove, noted so you do not trust it too much.** Headless
 * Chromium emulates touch, not the SYSTEM: Safari's native text selection menu
 * (the "Copy / Search" bubble that a finger on text opens on iOS, and which
 * `-webkit-touch-callout: none` in `screens.css` exists to silence) does not
 * appear here, nor do the compatibility mouse events at real WebKit timings. The
 * virtual keyboard also does not exist: we measure the mechanics that receive it,
 * pushing `--teclado` by hand. These three only show up on device.
 *
 * The account and channels are set up with the window WIDE, where the sidebar is
 * a column: what we want to measure is the phone layout working, not a setup
 * that depends on it. Only then the window shrinks to 390x844.
 *
 * Screenshots in `capturas/telemovel-*.png`, one per step, to look at.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { appAberta, profundidade, voltarUm } from "./separadores.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const CAPTURAS = join(RAIZ, "capturas")
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8472)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8473)
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const FRASE = "frase-de-verificacao-2026"
/** Duarte's phone screen, where the complaint was born. */
const TELEMOVEL = { width: 390, height: 844 }

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

// --- the homeserver, disposable -----------------------------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-telemovel-"))
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
servidor.stdout.on("data", (bocado) => (registoDoServidor += bocado))
servidor.stderr.on("data", (bocado) => (registoDoServidor += bocado))

// --- The frontend that acts as Caddy. ----------------------------------------
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const dentro = (page) => appAberta(page, 90_000)

let passo = 0
async function retratar(page, nome) {
  passo += 1
  const ficheiro = join(CAPTURAS, `telemovel-${String(passo).padStart(2, "0")}-${nome}.png`)
  await page.screenshot({ path: ficheiro })
  console.log(`  ..  captura: ${ficheiro}`)
  return ficheiro
}

/** The list of the open tab is on screen: no conversation pushed over it, and the tabs drawn. */
const naLista = async (page) => (await profundidade(page)) === 0 && (await page.locator(".separadores").isVisible().catch(() => false))

/** A conversation is pushed full screen over the list. */
const conversaEmpurrada = (page) =>
  page.evaluate(() => {
    const ecra = document.querySelector(".ecra-empurrado")?.getBoundingClientRect()
    return ecra !== undefined && Math.round(ecra.width) === innerWidth && Math.round(ecra.height) >= innerHeight - 1
  })

/**
 * Back to the Communities list: the back arrow while something is pushed,
 * then the tab. Each tab keeps its stack: coming back to Communities shows
 * the conversation it had open, and its arrow brings the list.
 */
async function paraALista(page) {
  for (let i = 0; i < 3 && (await profundidade(page)) > 0; i++) await voltarUm(page)
  await page.locator(".separadores").getByRole("button", { name: "Comunidades", exact: true }).tap()
  await wait(500)
  for (let i = 0; i < 3 && (await profundidade(page)) > 0; i++) await voltarUm(page)
}

/** The rooms drawn in the tree, by name. Empty when there is no tree. */
const salasNoEcra = (page) => page.evaluate(() => [...document.querySelectorAll(".room-tree .room-name")].map((n) => n.textContent))

/** The face of a community on the rail of the Communities tab. */
const caraDaComunidade = (page, nome) => page.locator(`.carril-comunidade[aria-label="${nome}"]`).first()

/** The line of a channel, by the name that reads in it. */
const linhaDoCanal = (page, nome) => page.locator(".channel-row", { has: page.locator(`.channel-name[title="${nome}"]`) }).first()

/**
 * A real long press: the finger lands, stays half a second, and lifts.
 *
 * With pointer events not `tap()`: it is `pointerdown` … wait … `pointerup`
 * that the app listens for (see `useToqueLongo`), and that is what we exercise.
 * `pointerType: "touch"` because the hook refuses the mouse on purpose.
 */
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

try {
  browser = await chromium.launch({
    headless: true,
    // Fake microphone: section 6b enters a voice room.
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  })
  /*
    A context with TOUCH from the start (it is a context property not a window
    one), but wide for setup. `isMobile` turns on Chromium's mobile emulation,
    * which is what makes `pointer: coarse` and `hover: none` work, and those are
    the media queries the whole slice uses.
  */
  const ctx = await browser.newContext({
    locale: "pt-PT",
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    permissions: ["microphone"],
  })
  const erros = []
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => erros.push(`${erro.message}\n${erro.stack ?? ""}`))
  const consola = []
  page.on("console", (m) => consola.push(`${m.type()}: ${m.text()}`.slice(0, 200)))

  // ---------------------------------------------------------------------------
  // 0. Setup, with the window wide: account, two channels, and rooms in one.
  // ---------------------------------------------------------------------------
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome: "Duarte", frase: FRASE, servidor: NOME })
  await dentro(page)
  check("a conta abre", true)

  for (const canal of ["adega", "lagar"]) {
    await page.getByRole("button", { name: "Criar canal" }).first().click()
    await page.locator("form.prompt input").first().fill(canal)
    await page.locator("form.prompt button.primary").first().click()
    // Since 1.3.20 the heading is the room, and the channel's name sits beside it.
    await page.locator("h1, .topbar-comunidade").filter({ hasText: new RegExp(`^${canal}$`) }).first().waitFor({ timeout: 30_000 })
  }
  check("dois canais criados: adega e lagar", true)

  // Rooms go to storage via the channel menu. The main view stays with the
  // conversation alone, which is the other side of the rule we are measuring.
  await linhaDoCanal(page, "adega").click()
  for (const sala of ["prensa", "barricas"]) {
    await linhaDoCanal(page, "adega").click({ button: "right" })
    await page.getByRole("menuitem", { name: "Nova sala" }).click()
    await page.locator(".sheet input").first().fill(sala)
    await page.locator(".sheet-actions button.primary").first().click()
    await page.locator(`.room-tree .room-name:text-is("${sala}")`).first().waitFor({ timeout: 30_000 })
  }
  const salasDaAdega = await salasNoEcra(page)
  check("a adega ganha duas salas", salasDaAdega.includes("prensa") && salasDaAdega.includes("barricas"), salasDaAdega.join(", "))

  // ---------------------------------------------------------------------------
  // THE WINDOW SHRINKS. From here on is Duarte's phone.
  // ---------------------------------------------------------------------------
  await page.setViewportSize(TELEMOVEL)
  await wait(800)
  check("a barra lateral deixa de ser uma coluna: a app passa ao desenho do telemóvel", (await page.locator(".app.telemovel").count()) === 1)
  check("e o hambúrguer antigo não é desenhado", !(await page.locator(".rail-menu").isVisible().catch(() => false)))
  await retratar(page, "telemovel-ao-encolher")

  // ---------------------------------------------------------------------------
  // 1. The Communities tab shows the list. Real tap, no `force`.
  // ---------------------------------------------------------------------------
  const separadorComunidades = page.locator(".separadores").getByRole("button", { name: "Comunidades", exact: true })
  // Creating the channels pushed a conversation: the arrow brings the list back.
  for (let i = 0; i < 3 && (await profundidade(page)) > 0; i++) await voltarUm(page)
  check("o separador Comunidades está à vista e é alcançável (sem force)", await separadorComunidades.isVisible())
  await separadorComunidades.tap()
  await wait(400)
  check("tocar em Comunidades mostra a lista", await naLista(page))
  const alvoDoSeparador = await separadorComunidades.boundingBox()
  check(
    "e o separador tem 44px de alvo, que é o mínimo a que um dedo acerta",
    (alvoDoSeparador?.width ?? 0) >= 44 && (alvoDoSeparador?.height ?? 0) >= 44,
    `${Math.round(alvoDoSeparador?.width ?? 0)}x${Math.round(alvoDoSeparador?.height ?? 0)}`,
  )
  const carril = await page.evaluate(() =>
    [...document.querySelectorAll(".carril-comunidade:not(.carril-nova)")].map((b) => {
      const r = b.getBoundingClientRect()
      return { nome: b.getAttribute("aria-label"), ok: r.width >= 44 && r.height >= 44 && r.x >= 0 && r.right <= innerWidth }
    }),
  )
  check(
    "o carril das comunidades mostra a adega e o lagar, cada cara com 44px",
    ["adega", "lagar"].every((nome) => carril.some((c) => c.nome === nome && c.ok)),
    carril.map((c) => `${c.nome}${c.ok ? "" : "✗"}`).join(", "),
  )
  /*
    The list is opaque, and nothing sits on top of the channel lines.

    The complaint from 0.8.0 ("in mobile version users do not see the rooms")
    had two visible causes: the skin's glass (66%) let messages pass under the
    room names, and a hint stuck by the `:hover` touch over the open channel
    line.
  */
  const listaOpaca = await page.evaluate(() => {
    const cor = getComputedStyle(document.querySelector(".sidebar")).backgroundColor
    const alfa = /rgba?\(([^)]+)\)/.exec(cor)?.[1].split(/[ ,/]+/).filter(Boolean)[3]
    return { cor, opaca: alfa === undefined || Number(alfa) >= 0.99 }
  })
  check("a lista é opaca: nada passa por baixo das salas", listaOpaca.opaca, listaOpaca.cor)
  const linhasAoDedo = await page.evaluate(() =>
    [...document.querySelectorAll(".sidebar .channel-row")].map((linha) => {
      const r = linha.getBoundingClientRect()
      const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      const dica = topo ? getComputedStyle(topo, "::after").content : ""
      return linha.contains(topo) && (dica === "none" || dica === "normal" || !dica.includes("painel"))
    }),
  )
  check("e nada se pousa em cima da linha do canal", linhasAoDedo.length > 0 && linhasAoDedo.every(Boolean), linhasAoDedo.join(","))
  await retratar(page, "lista-de-comunidades")

  // ---------------------------------------------------------------------------
  // 2. THE COMPLAINT. Tap a community on the rail: its rooms appear, and the
  //    list STAYS (nothing is pushed until a room or the line is tapped).
  // ---------------------------------------------------------------------------
  await caraDaComunidade(page, "lagar").tap()
  await wait(700)
  const salasDoLagar = await salasNoEcra(page)
  check("tocar no lagar mostra as salas dele", salasDoLagar.includes("conversa") && salasDoLagar.includes("voz"), salasDoLagar.join(", "))
  check("E A LISTA FICA: é a queixa, medida", await naLista(page))
  await retratar(page, "lagar-com-salas")

  await caraDaComunidade(page, "adega").tap()
  await wait(700)
  const salasVisiveis = await salasNoEcra(page)
  check("e tocar na adega troca para as salas DELA, sem abrir nada", salasVisiveis.includes("prensa") && salasVisiveis.includes("barricas"), salasVisiveis.join(", "))
  check("a lista continua no ecrã à segunda comunidade", await naLista(page))
  await retratar(page, "salas-da-adega")

  // ---------------------------------------------------------------------------
  // 3. Tap a room: its conversation is pushed full screen. Back brings the list.
  // ---------------------------------------------------------------------------
  const prensa = page.locator('.room-tree button.room', { hasText: "prensa" }).first()
  await prensa.tap()
  await wait(600)
  check("tocar numa sala empurra a conversa dela em ecrã inteiro", await conversaEmpurrada(page))
  check("sem separadores por cima da conversa", !(await page.locator(".separadores").isVisible().catch(() => false)))
  check("e a conversa está à frente, com a caixa de escrita à vista", await page.locator('textarea[placeholder="Escreve uma mensagem"]').isVisible())
  const tituloDaSala = await page.locator(".ecra-empurrado .topbar h1").first().innerText().catch(() => "")
  check("e é a sala em que se tocou que está aberta", tituloDaSala.trim() === "prensa", tituloDaSala.trim())
  await retratar(page, "sala-aberta")
  await page.locator(".ecra-empurrado .topbar-voltar").first().tap()
  await wait(600)
  check("a seta para trás devolve a lista", await naLista(page))
  const salaAcesa = await page.locator(".room-row.current .room-name").first().innerText().catch(() => "")
  check("e a sala aberta continua acesa na lista", salaAcesa.trim() === "prensa", salaAcesa.trim())
  await prensa.tap()
  await wait(600)
  await page.goBack()
  await wait(600)
  check("e o voltar do browser (o gesto do sistema) também", await naLista(page))

  // ---------------------------------------------------------------------------
  // 4. The long press opens the menu that right-click opens, as a sheet.
  // ---------------------------------------------------------------------------
  await toqueLongo(linhaDoCanal(page, "adega"))
  await wait(400)
  const menuAberto = await page.locator(".context-menu").first().isVisible().catch(() => false)
  check("manter o dedo pousado num canal abre o menu de contexto", menuAberto)
  check("e o menu é uma folha em baixo", (await page.locator(".context-menu.context-folha").count()) === 1)
  const itensDoMenu = menuAberto ? await page.locator(".context-menu [role=menuitem]").allInnerTexts() : []
  check("e o menu traz as acções do canal (mudar o nome, nova sala, …)", itensDoMenu.length >= 3, itensDoMenu.slice(0, 4).join(" | "))
  await retratar(page, "toque-longo-menu")
  /*
    And closes with a TAP outside, just like it does in real life: on the veil,
    at the top of the screen, above the sheet. The menu listens for
    `pointerdown` (see `ContextMenu.tsx`), the half a finger exercises.
  */
  await page.touchscreen.tap(195, 80)
  await wait(400)
  check("e um toque fora dispensa o menu", (await page.locator(".context-menu").count()) === 0)
  // On a computer the right click on the line also picks the channel; on the
  // phone that pushes its conversation. Measured, not required.
  console.log(`  ..  depois do toque longo na linha do canal: ${(await profundidade(page)) > 0 ? "a conversa ficou empurrada" : "a lista ficou"}`)
  if ((await profundidade(page)) > 0) await paraALista(page)

  // The other side of the same rule: a swipe does not open a menu. Without this,
  // the channel list could not be scrolled with a finger.
  const linhaParaDeslizar = linhaDoCanal(page, "adega")
  const caixa = await linhaParaDeslizar.boundingBox()
  await linhaParaDeslizar.evaluate(
    (el, { x, y }) =>
      new Promise((resolve) => {
        const fazer = (tipo, cx, cy) => {
          const evento = new MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: cx, clientY: cy })
          Object.defineProperty(evento, "pointerType", { value: "touch" })
          el.dispatchEvent(evento)
        }
        fazer("pointerdown", x, y)
        setTimeout(() => fazer("pointermove", x, y - 60), 120)
        setTimeout(() => {
          fazer("pointerup", x, y - 60)
          resolve()
        }, 900)
      }),
    { x: Math.round(caixa.x + caixa.width / 2), y: Math.round(caixa.y + caixa.height / 2) },
  )
  await wait(300)
  check("mas um DESLIZE não abre menu nenhum: a lista continua a percorrer-se", (await page.locator(".context-menu").count()) === 0)

  // ---------------------------------------------------------------------------
  // 5. The people panel is pushed full screen, and its arrow closes it.
  // ---------------------------------------------------------------------------
  await prensa.tap()
  await wait(600)
  const pegaDasPessoas = page.getByRole("button", { name: "Membros" })
  const alvoDasPessoas = await pegaDasPessoas.boundingBox()
  check(
    "o botão da lista de pessoas tem 44px de alvo",
    (alvoDasPessoas?.width ?? 0) >= 44 && (alvoDasPessoas?.height ?? 0) >= 44,
    `${Math.round(alvoDasPessoas?.width ?? 0)}x${Math.round(alvoDasPessoas?.height ?? 0)}`,
  )
  await pegaDasPessoas.tap()
  await wait(500)
  const larguraDasPessoas = await page.evaluate(() => Math.round(document.querySelector(".members.open")?.getBoundingClientRect().width ?? 0))
  check("tocar no botão abre a lista de pessoas em ecrã inteiro", larguraDasPessoas === TELEMOVEL.width, `${larguraDasPessoas} px`)
  check("por cima da conversa: dois ecrãs sobre a lista", (await profundidade(page)) === 2)
  await retratar(page, "pessoas-em-ecra-inteiro")
  await page.locator(".members.open .topbar-voltar").first().tap()
  await wait(500)
  check(
    "a seta das pessoas fecha-as e deixa a conversa",
    (await page.evaluate(() => document.querySelector(".members")?.classList.contains("open") !== true)) && (await profundidade(page)) === 1,
  )

  // ---------------------------------------------------------------------------
  // 6. The keyboard. Focus on the input bar does not send it off screen.
  // ---------------------------------------------------------------------------
  const caixaDeEscrita = page.locator('textarea[placeholder="Escreve uma mensagem"]')
  await caixaDeEscrita.tap()
  await wait(400)
  const posicao = await caixaDeEscrita.boundingBox()
  const altura = TELEMOVEL.height
  check(
    "com a barra de escrita focada, ela continua dentro do ecrã",
    posicao !== null && posicao.y >= 0 && posicao.y + posicao.height <= altura + 1,
    posicao ? `topo ${Math.round(posicao.y)}, fundo ${Math.round(posicao.y + posicao.height)} de ${altura}` : "sem caixa",
  )
  /*
    The real keyboard does not exist in a headless browser, what we measure here
    is the MECHANICS that receive it: the sheet has to add `--teclado` to the
    bottom margin, and the app has to shrink when that variable grows. Push the
    variable by hand and watch the input bar rise. Without the rule in `movel.css`,
    this does not move a pixel.
  */
  const antes = (await caixaDeEscrita.boundingBox())?.y ?? 0
  await page.evaluate(() => document.documentElement.style.setProperty("--teclado", "300px"))
  await wait(400)
  const depois = (await caixaDeEscrita.boundingBox())?.y ?? 0
  check("e sobe com o teclado, em vez de ficar por baixo dele", depois < antes - 250, `${Math.round(antes)} -> ${Math.round(depois)}`)
  await retratar(page, "teclado-a-levantar-a-barra")
  await page.evaluate(() => document.documentElement.style.removeProperty("--teclado"))

  // ---------------------------------------------------------------------------
  // 6b. Rooms are visible and open, with a person page open before and a call
  //     running.
  //
  // The 0.8.0 complaint ("in mobile version users do not see the rooms") did not
  // show up here, nor on WebKit, nor with the common room, nor with 23 rooms.
  // The two paths that 0.8.0 brought back are stuck: the person page (which hides
  // the prior view) and the compact call bar.
  // ---------------------------------------------------------------------------
  /** The rooms of the open channel: on screen, with height, and nothing on top of the center. */
  const salasAoDedo = (pg) =>
    pg.evaluate(() =>
      [...document.querySelectorAll(".room-tree .room-row .room-name")].map((n) => {
        const r = n.getBoundingClientRect()
        const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        const dentroDoEcra = r.height > 0 && r.y >= 0 && r.bottom <= innerHeight && r.x >= 0 && r.right <= innerWidth
        return { nome: n.textContent?.trim() ?? "", ok: dentroDoEcra && Boolean(topo && n.closest(".room-row")?.contains(topo)) }
      }),
    )
  const salasCertas = (lista) => ["prensa", "barricas"].every((nome) => lista.some((s) => s.nome === nome && s.ok))

  // With a person page open before. This script has only one account, and the face
  // of the writer is their own: opening the "Me" destination. It goes back via the
  // Communities tab, like it does in real life. (The page of ANOTHER person, over the
  // channel, is measured with two accounts in `scripts/sondar-salas-telemovel.mjs`.)
  await page.locator('textarea[placeholder="Escreve uma mensagem"]').fill("a prensa já trabalha")
  await page.locator('textarea[placeholder="Escreve uma mensagem"]').press("Enter")
  // With a finger (a touch context), Enter starts a new line and the send
  // button sends (1.3.25). The text is still in the box: send it.
  if ((await page.locator('textarea[placeholder="Escreve uma mensagem"]').inputValue().catch(() => "")) !== "") await page.locator("form.chat-composer .composer-enviar").first().click()
  const cara = page.locator(".message-avatar-botao").last()
  await cara.waitFor({ timeout: 30_000 })
  await cara.tap()
  await wait(800)
  // On the phone the page "Eu" is a screen of the "Tu" tab, pushed over its list.
  const destinoDepoisDaCara = await page.locator(".app.telemovel").getAttribute("data-separador")
  check('(salas) tocar na própria cara abre a página "Eu" (separador Tu)', destinoDepoisDaCara === "tu" && (await profundidade(page)) >= 1, `${destinoDepoisDaCara}`)
  await paraALista(page)
  const comPagina = await salasAoDedo(page)
  check("(salas) de volta às Comunidades, as salas da adega vêem-se na lista", salasCertas(comPagina), comPagina.map((s) => `${s.nome}${s.ok ? "" : "✗"}`).join(", "))
  await page.locator('.room-tree button.room', { hasText: "barricas" }).first().tap()
  await wait(800)
  check("(salas) e tocar numa sala abre a conversa dela", await page.locator('textarea[placeholder="Escreve uma mensagem"]').isVisible())

  // With a call: enter the voice room, and go back to a text room by the list.
  await paraALista(page)
  await page.locator('.room-tree button.room', { hasText: "voz" }).first().tap()
  await page.locator(".call").first().waitFor({ timeout: 30_000 })
  await wait(1500)
  check("(salas) tocar na sala de voz entra na chamada", await page.locator(".call").first().isVisible())
  await paraALista(page)
  const naChamada = await salasAoDedo(page)
  check("(salas) com a chamada a decorrer, as salas vêem-se na lista", salasCertas(naChamada), naChamada.map((s) => `${s.nome}${s.ok ? "" : "✗"}`).join(", "))
  await retratar(page, "salas-com-chamada")
  await page.locator('.room-tree button.room', { hasText: "prensa" }).first().tap()
  await wait(800)
  check("(salas) e tocar numa sala de texto abre a conversa, com a chamada viva", await page.locator('textarea[placeholder="Escreve uma mensagem"]').isVisible())
  await paraALista(page)
  const depoisDaChamada = await salasAoDedo(page)
  check("(salas) e as salas continuam na lista com a barra da chamada", salasCertas(depoisDaChamada), depoisDaChamada.map((s) => `${s.nome}${s.ok ? "" : "✗"}`).join(", "))

  // ---------------------------------------------------------------------------
  // 7. The gate, which is the Face ID screen.
  //
  // You reach it the way you reach it in real life: the app closes and opens again
  // later. The session key lives in `sessionStorage` and dies with the tab, so
  // clearing it and reloading is exactly the state Duarte finds Orwell in every
  // time he opens it, that is the complaint.
  //
  // And NOT by "Sign out": with a channel open, that button blanks the app instead
  // of showing the gate. Not from this slice, it happens the same way on 0.3.0
  // that is in production, and is noted in the report with steps to reproduce.
  // ---------------------------------------------------------------------------
  await page.evaluate(() => sessionStorage.removeItem("enclave-session-key"))
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.locator('input[type="password"]').waitFor({ timeout: 60_000 })
  const campo = page.locator('input[type="password"]').first()
  check("reabrir a aplicação leva ao portão, que pede a frase-passe", true)
  check(
    "e o campo pede ao gestor do sistema para preencher (é o que faz aparecer o Face ID)",
    (await campo.getAttribute("autocomplete")) === "current-password",
    String(await campo.getAttribute("autocomplete")),
  )
  check("dentro de um formulário a sério", await campo.evaluate((el) => el.closest("form") !== null))
  check("com um campo de identidade para o gestor nomear o registo", (await page.locator('input[autocomplete="username"]').count()) === 1)
  await retratar(page, "portao-com-face-id")
  await campo.fill(FRASE)
  const antesDeAbrir = Date.now()
  await page.getByRole("button", { name: "Entrar", exact: true }).tap()
  await dentro(page)
  check("e a frase-passe abre o cofre: a chave derivada no Worker é a mesma de sempre", true, `${Date.now() - antesDeAbrir} ms`)
  await retratar(page, "reaberto-depois-do-portao")

  check("nenhum erro de página durante o percurso todo", erros.length === 0, erros[0]?.slice(0, 100) ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
console.log(`capturas em ${CAPTURAS}/telemovel-*.png`)
await arrumar(passaram === results.length ? 0 : 1)
