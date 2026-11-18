/**
 * The light theme, seen in the real app: chat, settings and a call, in every
 * theme, at 390 and 1440 px, with and without reduced motion.
 *
 * Runs against the local demo server (`demo-servidor.mjs`), never production:
 *
 *   node scripts/demo-servidor.mjs 8580 8581      (in another terminal)
 *   node scripts/retratar-tema-claro.mjs semear   (once: Ana and Bruno, a community, messages)
 *   node scripts/retratar-tema-claro.mjs retratar [temas=escuro,claro,aurora] [pasta]
 *
 * The two accounts live in persistent browser profiles in
 * `.dev-data/tema-claro/` (git ignores it), with "Remember session" on, so
 * `retratar` opens straight into the app. Captures go to
 * `capturas/tema-claro/`.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { deflateSync } from "node:zlib"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const FRENTE = process.env.FRENTE ?? "8580"
const NOME = `localhost:${FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const DADOS = join(RAIZ, ".dev-data/tema-claro")
const PERFIL = (quem) => join(DADOS, `perfil-${quem}`)
const CANAL = "lagar"
const modo = process.argv[2] ?? "retratar"
const TEMAS = (process.argv[3] ?? "escuro,claro,aurora").split(",")
const SAIDA = resolve(RAIZ, process.argv[4] ?? "capturas/tema-claro")
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(DADOS, { recursive: true })

/** A 320x200 gradient PNG, for a picture in a message. */
function png(l, a) {
  const tabela = Array.from({ length: 256 }, (_, n) => {
    let v = n
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1
    return v >>> 0
  })
  const crc = (b) => {
    let c = 0xffffffff
    for (const x of b) c = tabela[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const bloco = (t, d) => {
    const n = Buffer.alloc(4)
    n.writeUInt32BE(d.length)
    const tt = Buffer.from(t)
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(Buffer.concat([tt, d])))
    return Buffer.concat([n, tt, d, c])
  }
  const h = Buffer.alloc(13)
  h.writeUInt32BE(l, 0)
  h.writeUInt32BE(a, 4)
  h[8] = 8
  h[9] = 2
  const linhas = []
  for (let y = 0; y < a; y++) {
    const r = Buffer.alloc(1 + l * 3)
    for (let x = 0; x < l; x++) {
      r[1 + x * 3] = Math.round((x / l) * 255)
      r[2 + x * 3] = Math.round((y / a) * 255)
      r[3 + x * 3] = 140
    }
    linhas.push(r)
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", h), bloco("IDAT", deflateSync(Buffer.concat(linhas))), bloco("IEND", Buffer.alloc(0))])
}

const opcoesDoBrowser = {
  headless: true,
  locale: "pt-PT",
  acceptDownloads: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  permissions: ["microphone", "camera"],
}

async function abrir(quem, extra = {}) {
  const ctx = await chromium.launchPersistentContext(PERFIL(quem), { ...opcoesDoBrowser, viewport: { width: 1440, height: 900 }, ...extra })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  return { ctx, page }
}

async function semear() {
  const pessoas = {}
  for (const nome of ["Ana", "Bruno"]) {
    const { ctx, page } = await abrir(nome.toLowerCase())
    await page.goto(APP, { waitUntil: "domcontentloaded" })
    await criarConta(page, { nome, servidor: NOME, memorizar: true, canalOficial: false })
    await page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
    await wait(1500)
    const addr = (await page.evaluate(() => document.body.innerText)).match(/@[a-z-]+:[^\s]+/)?.[0]
    pessoas[nome] = { ctx, page, addr }
  }
  const { Ana: ana, Bruno: bruno } = pessoas
  await ana.page.getByRole("button", { name: "Criar canal" }).first().click()
  await ana.page.locator("form.prompt input").first().fill(CANAL)
  await ana.page.locator("form.prompt button.primary").first().click()
  // In a community the heading is the open room since the restyle; the channel is in the list.
  await ana.page.locator(".channel-name", { hasText: CANAL }).first().waitFor({ timeout: 30_000 })
  if (!(await convidar(ana.page, CANAL, bruno.addr)) || !(await aceitarConvite(bruno.page, CANAL))) throw new Error("Bruno did not join")

  const caixa = (p) => p.locator('input[placeholder="Escreve uma mensagem"], textarea[placeholder="Escreve uma mensagem"]').first()
  await ana.page.locator(".room-tree .room-name").first().click()
  await caixa(ana.page).waitFor({ timeout: 30_000 })
  const dizer = async (p, texto) => {
    await caixa(p).fill(texto)
    await p.keyboard.press("Enter")
    await wait(1500)
  }
  await dizer(ana.page, "Bom dia! Já viram o tema claro?")
  const ficheiro = join(DADOS, "imagem.png")
  writeFileSync(ficheiro, png(320, 200))
  await ana.page.locator('input[type="file"][accept^="image"]').setInputFiles(ficheiro)
  await wait(1500)
  await dizer(ana.page, "Uma imagem, para ver a caixa reservada.")
  await bruno.page.locator(".room-tree .room-name").first().click()
  await caixa(bruno.page).waitFor({ timeout: 30_000 })
  await dizer(bruno.page, "Vi. Lê-se bem de dia, e o escuro continua igual.")
  await dizer(bruno.page, `Uma palavra comprida para ver se a linha transborda: ${"palavraenorme".repeat(6)}`)
  await wait(3000)
  for (const p of Object.values(pessoas)) await p.ctx.close()
  console.log(`semeado: Ana ${ana.addr}, Bruno ${bruno.addr}`)
}

/**
 * The theme, the way the app keeps it: the prefs in `localStorage`, then a
 * reload. With `abertura`, the opening is captured while it shows.
 */
async function porTema(page, tema, abertura) {
  await page.evaluate((t) => {
    const prefs = JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}")
    localStorage.setItem("enclave.prefs", JSON.stringify({ ...prefs, tema: t }))
  }, tema)
  await page.reload({ waitUntil: "commit" })
  if (abertura) {
    await page.locator(".abertura").first().waitFor({ timeout: 10_000 }).catch(() => {})
    await wait(250)
    await page.screenshot({ path: abertura })
  }
  await page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
  await page.evaluate(() => document.fonts.ready)
  await wait(1500)
}

/** Into the voice room, if this server gives a call; false when it does not. */
async function entrarNaChamada(page) {
  const voz = page.locator(".room-tree .room-name", { hasText: /^voz$/ }).first()
  if (!(await voz.isVisible().catch(() => false))) await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  if (await voz.isVisible().catch(() => false)) await voz.click()
  else {
    // On a phone the room list is in a drawer: the banner over the chat
    // ("Bruno está em chamada · Entrar") joins, and the dock opens the call.
    const entrar = page.getByRole("button", { name: "Entrar", exact: true }).first()
    if (!(await entrar.count())) return false
    await entrar.click({ force: true })
    await page.locator(".call-dock-back").first().click({ timeout: 15_000, force: true }).catch(() => {})
  }
  return page
    .locator(".call-chip")
    .first()
    .waitFor({ timeout: 25_000 })
    .then(() => true)
    .catch(() => false)
}

async function retratar() {
  mkdirSync(SAIDA, { recursive: true })
  // Bruno waits in the voice room the whole time, so the call has two people.
  const bruno = await abrir("bruno")
  await bruno.page.goto(APP, { waitUntil: "domcontentloaded" })
  await bruno.page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
  if (!(await entrarNaChamada(bruno.page))) console.log("Bruno não entrou na chamada")
  for (const movimento of ["no-preference", "reduce"]) {
    for (const [largura, altura] of [
      [1440, 900],
      [390, 844],
    ]) {
      const largo = largura > 600
      const { ctx, page } = await abrir("ana", { viewport: { width: largura, height: altura }, deviceScaleFactor: largo ? 1 : 2, reducedMotion: movimento, isMobile: !largo, hasTouch: !largo })
      try {
        await page.goto(APP, { waitUntil: "domcontentloaded" })
        for (const tema of TEMAS) {
          const sufixo = `${tema}-${largura}${movimento === "reduce" ? "-movimento-reduzido" : ""}`
          await porTema(page, tema, largo ? join(SAIDA, `abertura-${sufixo}.png`) : null)
          await page.screenshot({ path: join(SAIDA, `chat-${sufixo}.png`) })
          if (largo) await page.locator(".me-faixa").first().screenshot({ path: join(SAIDA, `cartao-${sufixo}.png`) }).catch(() => {})
          if (await entrarNaChamada(page)) {
            await wait(1500)
            await page.screenshot({ path: join(SAIDA, `chamada-${sufixo}.png`) })
            if (largo) await page.locator(".me-faixa").first().screenshot({ path: join(SAIDA, `cartao-em-chamada-${sufixo}.png`) }).catch(() => {})
            await page.getByRole("button", { name: "Sair da chamada" }).first().click().catch(() => {})
            await wait(1000)
            await page.keyboard.press("Escape")
          } else console.log(`sem chamada (${sufixo})`)
          if (movimento === "reduce") continue
          // Settings, Account section (where the theme is chosen).
          await page.getByRole("button", { name: "Configurações", exact: true }).first().click({ force: true })
          await page.getByRole("button", { name: "Conta", exact: true }).first().click().catch(() => {})
          await wait(800)
          await page.screenshot({ path: join(SAIDA, `definicoes-${sufixo}.png`) })
          if (!largo) continue
          // Help: the "Sincronizar conta" button.
          await page.getByRole("button", { name: "Ajuda e diagnóstico", exact: true }).first().click().catch(() => {})
          await wait(800)
          await page.screenshot({ path: join(SAIDA, `definicoes-ajuda-${sufixo}.png`) })
        }
      } finally {
        await ctx.close()
      }
    }
  }
  await bruno.ctx.close()
}

if (modo === "semear") await semear()
else await retratar()
