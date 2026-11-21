/**
 * The rooms of a channel, on a phone from the first touch: are they visible?
 *
 *   node scripts/sondar-salas-telemovel.mjs [web-dist-folder]
 *
 * Diagnostic, not a test: prints what it measures and does not fail. Ana
 * creates the channel "nexo" on a wide screen and embeds a link. Bruno opens
 * the link in a phone context (390 × 844, `isMobile`, `hasTouch`) and joins.
 * Then we measure on both: does the drawer open? is the rooms list in the DOM,
 * visible, with height? what is on top of the center of each room
 * (`elementFromPoint`)?
 *
 * The dist by argument serves to compare old versions against the same
 * homeserver (from this tree).
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, webkit } from "playwright"
import { FRASE } from "./ambiente.mjs"
import { criarConta } from "./conta.mjs"
import { appAberta, irPara, mostrarLista, separadorActual } from "./separadores.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = resolve(process.argv[2] ?? join(RAIZ, "apps/web/dist"))
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA_DA_FRENTE = 8488
const PORTA_DO_SERVIDOR = 8489
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const CAPTURAS = process.env.SONDA_CAPTURAS ?? ""

for (const porta of [PORTA_DA_FRENTE, PORTA_DO_SERVIDOR]) {
  const livre = await new Promise((r) => {
    const sonda = net.createServer()
    sonda.once("error", () => r(false))
    sonda.once("listening", () => sonda.close(() => r(true)))
    sonda.listen(porta, "127.0.0.1")
  })
  if (!livre) {
    console.error(`A porta ${porta} já tem dono (um homeserver de uma corrida anterior?). Liberta-a primeiro.`)
    process.exit(2)
  }
}

const dados = mkdtempSync(join(tmpdir(), "orwell-sonda-salas-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "true",
    // Like production: the common room, where every new account joins.
    ...(process.env.SONDA_COMUM ? { ENCLAVE_COMMON_ROOM: `!orwell:${NOME}` } : {}),
  },
  stdio: ["ignore", "pipe", "pipe"],
})
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json" }
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
  adiante.on("error", () => { resposta.writeHead(502); resposta.end() })
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
await new Promise((r) => frente.listen(PORTA_DA_FRENTE, "127.0.0.1", r))
for (let volta = 0; volta < 60; volta++) {
  const ok = await new Promise((r) => { const s = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => { s.destroy(); r(true) }); s.on("error", () => r(false)) })
  if (ok) break
  await new Promise((r) => setTimeout(r, 250))
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// The app is open: the rail on a computer, the tabs on a phone (no rail there).
const dentro = (page) => appAberta(page)

/** The portrait of the sidebar: what exists, where, and what is on top of it. */
const medir = (page) =>
  page.evaluate(() => {
    const caixa = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      const c = getComputedStyle(el)
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: c.display, visibility: c.visibility, overflow: c.overflowY }
    }
    const sidebar = document.querySelector(".sidebar")
    const arvore = document.querySelector(".room-tree")
    const salas = [...document.querySelectorAll(".room-tree .room-name")].map((n) => {
      const r = n.getBoundingClientRect()
      const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { nome: n.textContent, h: Math.round(r.height), y: Math.round(r.y), porCima: topo === n || n.contains(topo) || topo?.closest(".room-row") ? "ela" : `${topo?.tagName}.${[...(topo?.classList ?? [])].join(".")}` }
    })
    return {
      sidebarClasses: sidebar?.className,
      sidebar: caixa(sidebar),
      canais: [...document.querySelectorAll(".channel-name")].map((n) => n.getAttribute("title") ?? n.textContent),
      // On a phone (option B) the other communities are faces on the rail, and what sits over the list.
      carril: [...document.querySelectorAll(".carril-comunidade:not(.carril-nova)")].map((n) => n.getAttribute("aria-label")),
      separador: document.querySelector(".app.telemovel")?.getAttribute("data-separador") ?? null,
      profundidade: document.querySelector(".app.telemovel")?.getAttribute("data-profundidade") ?? null,
      arvore: caixa(arvore),
      arvorePai: arvore ? caixa(arvore.parentElement) : null,
      salas,
      htmlDaBarra: sidebar ? sidebar.innerHTML.length : 0,
      seccoes: [...(sidebar?.querySelectorAll("[aria-expanded]") ?? [])].map((b) => `${b.textContent?.trim().slice(0, 30)}=${b.getAttribute("aria-expanded")}`),
    }
  })

let browser
try {
  const motor = process.env.SONDA_MOTOR === "webkit" ? webkit : chromium
  browser = await motor.launch({ headless: true, args: process.env.SONDA_MOTOR === "webkit" ? [] : ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] })
  // --- Ana, wide screen: the channel and the link --------------------------
  const ctxA = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 800 } })
  const a = await ctxA.newPage()
  const redeA = []
  a.on("websocket", (ws) => {
    ws.on("framesent", (f) => redeA.push(`${Date.now()} > ${String(f.payload).slice(0, 260)}`))
    ws.on("framereceived", (f) => redeA.push(`${Date.now()} < ${String(f.payload).slice(0, 260)}`))
  })
  a.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") redeA.push(`${Date.now()} CONSOLA ${m.type()}: ${m.text().slice(0, 300)}`) })
  process.on("exit", () => {
    if (process.env.SONDA_REDE) writeFileSync(process.env.SONDA_REDE, redeA.join("\n"))
  })
  await a.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(a, { nome: "Ana", frase: FRASE, servidor: NOME })
  await dentro(a)
  if (process.env.SONDA_COMUM) {
    // Ana adds rooms to the public room (the "Orwell" channel), from the channel menu.
    await a.locator(".channel-row").first().waitFor({ timeout: 90_000 }).catch(() => console.log("a Ana não vê a sala comum"))
    console.log("ANA, CANAIS:", JSON.stringify(await medir(a)))
    const comum = a.locator(".channel-row").first()
    await comum.click()
    for (const sala of ["prensa", "barricas"]) {
      await comum.click({ button: "right" })
      const item = a.getByRole("menuitem", { name: "Nova sala" })
      if (!(await item.count())) { console.log('sem "Nova sala" no menu do canal comum'); await a.keyboard.press("Escape"); break }
      await item.click()
      await a.locator(".sheet input").first().fill(sala)
      await a.locator(".sheet-actions button.primary").first().click()
      await a.locator(`.room-tree .room-name:text-is("${sala}")`).first().waitFor({ timeout: 30_000 }).catch(() => console.log("a sala não apareceu:", sala))
    }
    console.log("ANA, SALA COMUM COM SALAS:", JSON.stringify(await medir(a)))
    const ctxC = await browser.newContext({ permissions: ["microphone"], locale: "pt-PT", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const c = await ctxC.newPage()
    await c.goto(APP, { waitUntil: "domcontentloaded" })
    await criarConta(c, { nome: "Carla", frase: FRASE, servidor: NOME })
    await dentro(c)
    const t0 = Date.now()
    await c.locator(".channel-row").first().waitFor({ state: "attached", timeout: 90_000 }).catch(() => console.log("a Carla não recebe a sala comum"))
    console.log("Carla: sala comum chegou em", Date.now() - t0, "ms")
    await wait(3000)
    console.log("CARLA ENTROU:", JSON.stringify(await medir(c)))
    // No drawer since option B: the Communities list is the screen.
    await mostrarLista(c)
    await wait(800)
    console.log("CARLA LISTA:", JSON.stringify(await medir(c)))
    if (CAPTURAS) await c.screenshot({ path: join(CAPTURAS, "c-1-lista.png") })
    const linhaComum = c.locator(".channel-row").first()
    if (await linhaComum.count()) { await linhaComum.locator("button.channel").tap(); await wait(1500) }
    console.log("CARLA TOCOU NO COMUM:", JSON.stringify(await medir(c)))
    if (CAPTURAS) await c.screenshot({ path: join(CAPTURAS, "c-2-comum.png") })
  }
  await a.getByRole("button", { name: "Criar canal" }).first().click()
  await a.locator("form.prompt input").first().fill("nexo")
  await a.locator("form.prompt button.primary").first().click()
  await a.getByRole("heading", { name: "nexo" }).waitFor({ timeout: 30_000 })
  for (const extra of (process.env.SONDA_CANAIS ?? "").split(",").filter(Boolean)) {
    await a.getByRole("button", { name: "Criar canal" }).first().click()
    await a.locator("form.prompt input").first().fill(extra)
    await a.locator("form.prompt button.primary").first().click()
    await a.getByRole("heading", { name: extra }).waitFor({ timeout: 30_000 })
  }
  // A room created BEFORE the invite, from the channel menu.
  const novaSala = async (nome) => {
    const linha = a.locator(".channel-row", { has: a.locator('.channel-name[title="nexo"]') }).first()
    await linha.click({ button: "right" })
    await a.getByRole("menuitem", { name: "Nova sala" }).click()
    await a.locator(".sheet input").first().fill(nome)
    await a.locator(".sheet-actions button.primary").first().click()
    await a.locator(`.room-tree .room-name:text-is("${nome}")`).first().waitFor({ timeout: 30_000 })
  }
  await a.locator(".channel-row", { has: a.locator('.channel-name[title="nexo"]') }).first().click()
  await novaSala("antes")
  for (const extra of (process.env.SONDA_SALAS ?? "").split(",").filter(Boolean)) await novaSala(extra)
  await wait(1500)
  console.log("ANA LARGA:", JSON.stringify(await medir(a)))
  await a.locator('.room-tree button.room', { hasText: "geral" }).first().click()
  await wait(500)
  if (CAPTURAS) await a.screenshot({ path: join(CAPTURAS, "a-antes-do-convite.png") })
  await a.getByRole("button", { name: "Convidar…" }).first().click()
  await a.locator(".sheet").first().getByRole("button", { name: "Por link" }).click()
  const folha = a.locator(".sheet").first()
  await folha.getByRole("button", { name: "Criar link" }).click()
  const campo = folha.getByLabel("O teu link")
  await campo.waitFor({ timeout: 60_000 }).catch(async (e) => {
    if (CAPTURAS) await a.screenshot({ path: join(CAPTURAS, "a-folha-do-convite.png") })
    console.log("FOLHA:", (await folha.innerText().catch(() => "")).replace(/\s+/g, " "))
    throw e
  })
  const link = await campo.inputValue()
  await folha.getByRole("button", { name: "Fechar" }).click()

  // --- Bruno, phone from the start ----------------------------------------
  const ctxB = await browser.newContext({ permissions: ["microphone"], locale: "pt-PT", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const b = await ctxB.newPage()
  b.on("pageerror", (e) => console.log("B pageerror:", e.message))
  // The frontend here is not Caddy: the `redir /c -> /app/c` is done by hand.
  await b.goto(link.replace(/\?.*$/, "").replace(`${NOME}/c#`, `${NOME}/app/c#`), { waitUntil: "domcontentloaded" })
  console.log("LINK:", link, "->", b.url())
  await criarConta(b, { nome: "Bruno", frase: FRASE, servidor: NOME }).catch(async (e) => {
    console.log("B TEXTO:", (await b.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600))
    if (CAPTURAS) await b.screenshot({ path: join(CAPTURAS, "b-0-falhou.png") })
    throw e
  })
  await b.getByRole("heading", { name: "Convite para um canal" }).waitFor({ timeout: 90_000 })
  await b.getByRole("button", { name: "Entrar", exact: true }).click()
  await wait(4000)
  // And a room created AFTER Bruno joins.
  await novaSala("depois")
  await wait(6000)
  console.log("BRUNO DEPOIS DE ENTRAR:", JSON.stringify(await medir(b)))
  if (CAPTURAS) { mkdirSync(CAPTURAS, { recursive: true }); await b.screenshot({ path: join(CAPTURAS, "b-1-entrou.png") }) }
  console.log("separadores no ecrã:", (await b.locator(".separadores").count()) === 1)
  await mostrarLista(b)
  await wait(800)
  console.log("BRUNO LISTA:", JSON.stringify(await medir(b)))
  console.log("BRUNO ROLANTES:", JSON.stringify(await b.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll(".sidebar, .sidebar *")) {
      const c = getComputedStyle(el)
      if (el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0) out.push(`${el.tagName}.${el.className}: ${el.scrollHeight}/${el.clientHeight} overflowY=${c.overflowY}`)
    }
    return out
  })))
  if (CAPTURAS) await b.screenshot({ path: join(CAPTURAS, "b-2-lista.png") })
  const linha = b.locator(".channel-row").first()
  if (await linha.count()) { await linha.tap(); await wait(1200) }
  console.log("BRUNO TOCOU NO CANAL:", JSON.stringify(await medir(b)))
  if (CAPTURAS) await b.screenshot({ path: join(CAPTURAS, "b-3-canal.png") })

  // --- Bruno goes to the other tabs and comes back --------------------------
  // The drawer and its veil are gone (option B): the list is the Communities tab.
  const abrirGaveta = async () => {
    await mostrarLista(b)
    await wait(800)
  }
  const destinos = await b.locator(".separadores button").evaluateAll((bs) => bs.map((x) => x.getAttribute("aria-label") ?? x.textContent))
  console.log("SEPARADORES:", JSON.stringify(destinos))
  for (const separador of ["tu", "mensagens", "amigos"]) {
    await irPara(b, separador)
    await wait(1200)
    await irPara(b, "comunidades")
    await wait(1200)
    console.log(`BRUNO DEPOIS DE ${separador}:`, JSON.stringify(await medir(b)))
    if (CAPTURAS) await b.screenshot({ path: join(CAPTURAS, `b-4-depois-${separador}.png`) })
  }

  // --- Ana's page, opened by Bruno from one of her messages ----------------
  await a.locator('.room-tree button.room', { hasText: "geral" }).first().click()
  await a.locator('textarea[placeholder="Escreve uma mensagem"]').fill("olá do largo")
  await a.locator('textarea[placeholder="Escreve uma mensagem"]').press("Enter")
  await abrirGaveta()
  await b.locator('.room-tree button.room', { hasText: "geral" }).first().tap()
  await wait(1500)
  const caraDaAna = b.locator(".message-avatar-botao").first()
  const chegou = await caraDaAna.waitFor({ timeout: 30_000 }).then(() => true, () => false)
  console.log("mensagem da Ana chegou ao Bruno:", chegou)
  if (chegou) {
    await caraDaAna.tap()
    await wait(1200)
    console.log("PÁGINA: vista-guardada display =", await b.locator(".vista-guardada").evaluate((el) => getComputedStyle(el).display), "| separador:", await separadorActual(b))
    if (CAPTURAS) await b.screenshot({ path: join(CAPTURAS, "b-p1-pagina.png") })
    await abrirGaveta()
    console.log("BRUNO PÁGINA LISTA:", JSON.stringify(await medir(b)))
    if (CAPTURAS) await b.screenshot({ path: join(CAPTURAS, "b-p2-pagina-lista.png") })
    const outra = b.locator('.room-tree button.room', { hasText: "conversa" }).first()
    if (await outra.isVisible().catch(() => false)) {
      await outra.tap()
      await wait(1200)
      console.log("PÁGINA → conversa: vista-guardada =", await b.locator(".vista-guardada").evaluate((el) => getComputedStyle(el).display), "| caixa:", await b.locator('textarea[placeholder="Escreve uma mensagem"]').isVisible())
      if (CAPTURAS) await b.screenshot({ path: join(CAPTURAS, "b-p3-depois.png") })
    }
  }

  // --- Bruno joins the voice room, then searches for rooms -------------------
  await abrirGaveta()
  const voz = b.locator('.room-tree button.room', { hasText: "voz" }).first()
  if (await voz.count()) {
    await voz.tap()
    await wait(4000)
    console.log("BRUNO NA CHAMADA, CONVERSA EMPURRADA:", JSON.stringify(await medir(b)))
    if (CAPTURAS) await b.screenshot({ path: join(CAPTURAS, "b-7-chamada.png") })
    await abrirGaveta()
    console.log("BRUNO NA CHAMADA, LISTA:", JSON.stringify(await medir(b)))
    if (CAPTURAS) await b.screenshot({ path: join(CAPTURAS, "b-8-chamada-lista.png") })
    const conversa = b.locator('.room-tree button.room', { hasText: "conversa" }).first()
    if (await conversa.isVisible().catch(() => false)) {
      await conversa.tap()
      await wait(1500)
      console.log("BRUNO NA CHAMADA, FOI À CONVERSA:", JSON.stringify(await medir(b)))
      if (CAPTURAS) await b.screenshot({ path: join(CAPTURAS, "b-9-chamada-conversa.png") })
    }
  }

  // --- Bruno reopens the app (new tab, at 390) --------------------------------
  await b.close()
  const b2 = await ctxB.newPage()
  await b2.goto(APP, { waitUntil: "domcontentloaded" })
  await b2.locator('input[name="password"]').waitFor({ timeout: 60_000 })
  await b2.locator('input[name="password"]').fill(FRASE)
  await b2.locator('input[name="password"]').press("Enter")
  await dentro(b2)
  await wait(3000)
  console.log("BRUNO REABERTO:", JSON.stringify(await medir(b2)))
  if (CAPTURAS) await b2.screenshot({ path: join(CAPTURAS, "b-5-reaberto.png") })
  await mostrarLista(b2)
  await wait(800)
  console.log("BRUNO REABERTO LISTA:", JSON.stringify(await medir(b2)))
  if (CAPTURAS) await b2.screenshot({ path: join(CAPTURAS, "b-6-reaberto-lista.png") })

  // --- Ana, at 390 in a new mobile context: not the same account; it shrinks ----
  await a.setViewportSize({ width: 390, height: 844 })
  await wait(800)
  await mostrarLista(a)
  await wait(800)
  console.log("ANA 390 LISTA:", JSON.stringify(await medir(a)))
  if (CAPTURAS) await a.screenshot({ path: join(CAPTURAS, "a-390-lista.png") })
  // The last community: its face on the rail (the sidebar lists only the chosen one), and whether its rooms fit on screen.
  const ultimo = a.locator(".carril-comunidade:not(.carril-nova)").last()
  await ultimo.scrollIntoViewIfNeeded().catch(() => {})
  await ultimo.click().catch((e) => console.log("toque no último falhou:", e.message.split("\n")[0]))
  await wait(1200)
  const rolagem = await a.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll(".sidebar, .sidebar *")) {
      const c = getComputedStyle(el)
      if (/(auto|scroll)/.test(c.overflowY) && el.scrollHeight > el.clientHeight) out.push(`${el.className}: ${el.scrollHeight}/${el.clientHeight}`)
    }
    return out
  })
  console.log("ROLANTES NA LISTA:", JSON.stringify(rolagem))
  console.log("ANA 390 ÚLTIMO CANAL:", JSON.stringify(await medir(a)))
  if (CAPTURAS) await a.screenshot({ path: join(CAPTURAS, "a-390-ultimo.png") })
} catch (erro) {
  console.error(erro)
} finally {
  await browser?.close().catch(() => {})
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
}
