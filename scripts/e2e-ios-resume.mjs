/**
 * The iOS back-forward cache: a phone that locks its screen mid-history does not
 * reload, and the history between devices finishes.
 *
 *   node scripts/e2e-ios-resume.mjs                 (the phone in WebKit; needs `npm run build`)
 *   node scripts/e2e-ios-resume.mjs webkit chromium firefox
 *   node scripts/e2e-ios-resume.mjs --no-locks      (no Web Locks: election by BroadcastChannel)
 *
 * Why it exists (21/11/2026). iOS fires `pagehide` with `persisted` on every
 * screen lock and app switch, on a page that stays in memory. The web app used
 * to release ownership for good and reload on return: the installed app on the
 * iPhone "restarted by itself", and the history from the other devices of the
 * account started over every time and never finished. Now the page suspends
 * (saves, stops writing, releases the lock) and resumes on return, reloading only
 * if another tab owned the vault in the meantime.
 *
 * What it proves, for each engine named (the phone runs in it; the computer is Chromium):
 *  1. Ana on the computer; Bruno, a core account here in Node, writes her thirty
 *     messages and a heavy photo, then goes offline for good.
 *  2. Ana pairs the phone by link. The history starts coming in.
 *  3. Mid-history, the iOS pair WITHOUT `pageshow` (`pagehide` persisted, the
 *     page hidden, then visible): the socket closes while suspended, and on
 *     return the SAME document reconnects. No navigation, the page marker survives.
 *  4. Again, with `pageshow` persisted this time (the back button, or iOS when it
 *     does fire it). Same result.
 *  5. The history finishes on the phone, with no reload at any point: the whole
 *     conversation, without duplicates, and the photo.
 *  6. One owner per browser still holds: the phone suspends, a second tab of the
 *     same browser opens, takes over and writes. The first tab comes back: it must
 *     NOT resume (its memory is stale); it reloads and waits, with no socket, while
 *     the second keeps the only one.
 *
 * The events are synthetic: Playwright cannot lock a phone. They are the same
 * events, with the same `persisted` flag and the same `visibilityState`, that the
 * page code reads; what a real iOS adds is freezing the JS in between, which the
 * code does not depend on (it stops writing before the freeze, in the handler).
 *
 * ALL LOCAL AND ALL DISPOSABLE, like `e2e-historico-entre-aparelhos.mjs`, which
 * this is adapted from: its own homeserver in a temp folder, a front end acting
 * as Caddy, free ports chosen by the system, and no way to point it at production.
 */
// Every page is watched: the centre of the screen stays inside the app (1.3.27).
import "./screen-guard.mjs"
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { DatabaseSync } from "node:sqlite"
import { Session, Vault, chaveDoEvento, dobrarConversa } from "@enclave/client-core"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { irParaEmparelhar } from "./fase7-comum.mjs"
import { abrirJuntarUmAparelho, colarCodigo, confirmarEAbrir } from "./juntar-aparelho.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(ROOT, "apps/web/dist")
const SERVER_JS = join(ROOT, "apps/server/dist/main.js")
const PASSPHRASE = "frase-de-verificacao-2026"
const ENGINES = { chromium, firefox, webkit }
const NO_LOCKS = process.argv.includes("--no-locks")
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const chosen = requested.length ? requested : ["webkit"]
for (const name of chosen) {
  if (!ENGINES[name]) {
    console.error(`Unknown engine: ${name}. Use chromium, firefox or webkit.`)
    process.exit(2)
  }
}
for (const [what, path] of [["the built web", join(DIST, "index.html")], ["the built server", SERVER_JS]]) {
  if (!existsSync(path)) {
    console.error(`Missing ${what}: ${path}. Run \`npm run build\` first.`)
    process.exit(2)
  }
}

/** A port the system says is free right now. */
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

const FRONT_PORT = await freePort()
const SERVER_PORT = await freePort()
const HOST = `localhost:${FRONT_PORT}`
const APP = `http://${HOST}/app/?lingua=pt`

// --- the homeserver, disposable ---------------------------------------------------
const data = mkdtempSync(join(tmpdir(), "orwell-e2e-ios-resume-"))
const server = spawn(process.execPath, [SERVER_JS], {
  env: {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    ENCLAVE_DATA_DIR: data,
    ENCLAVE_SERVER_NAME: HOST,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(SERVER_PORT),
    ENCLAVE_COMMUNITY_MODE: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let serverLog = ""
server.stdout.on("data", (chunk) => (serverLog += chunk))
server.stderr.on("data", (chunk) => (serverLog += chunk))

// --- the front end, acting as Caddy -------------------------------------------------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json", ".wasm": "application/wasm" }
const front = http.createServer((request, response) => {
  const path = (request.url ?? "/").split("?")[0]
  if (path.startsWith("/app")) {
    const relative = normalize(decodeURIComponent(path.slice("/app".length))).replace(/^(\.\.[/\\])+/, "")
    let file = join(DIST, relative)
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html")
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" })
    response.end(readFileSync(file))
    return
  }
  const onward = http.request({ host: "127.0.0.1", port: SERVER_PORT, path: request.url, method: request.method, headers: request.headers }, (back) => {
    response.writeHead(back.statusCode ?? 502, back.headers)
    back.pipe(response)
  })
  onward.on("error", () => {
    response.writeHead(502)
    response.end()
  })
  request.pipe(onward)
})
front.on("upgrade", (request, socket, head) => {
  const target = net.connect(SERVER_PORT, "127.0.0.1", () => {
    const lines = [`${request.method} ${request.url} HTTP/${request.httpVersion}`]
    for (let i = 0; i < request.rawHeaders.length; i += 2) lines.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}`)
    target.write(`${lines.join("\r\n")}\r\n\r\n`)
    if (head.length) target.write(head)
    socket.pipe(target).pipe(socket)
  })
  target.on("error", () => socket.destroy())
  socket.on("error", () => target.destroy())
})
await new Promise((resolve) => front.listen(FRONT_PORT, "127.0.0.1", resolve))

async function serverUp() {
  for (let round = 0; round < 60; round++) {
    const ok = await new Promise((resolve) => {
      const probe = net.connect(SERVER_PORT, "127.0.0.1", () => {
        probe.destroy()
        resolve(true)
      })
      probe.on("error", () => resolve(false))
    })
    if (ok) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

const browsers = []
const nodeAccounts = []
async function cleanUp(exitCode) {
  for (const account of nodeAccounts) account.session.disconnect()
  for (const browser of browsers) await browser.close().catch(() => {})
  front.close()
  server.kill()
  rmSync(data, { recursive: true, force: true })
  process.exit(exitCode)
}
if (!(await serverUp())) {
  console.error("The homeserver did not start:\n" + serverLog.slice(-2000))
  await cleanUp(2)
}

// --- helpers ------------------------------------------------------------------------
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// Inside the app: "Configurações" on a wide screen, or the phone's "Tu" tab (the phone layout since 1.3.26).
const inside = (page, timeout = 90_000) =>
  page.getByRole("button", { name: "Configurações", exact: true }).or(page.getByRole("button", { name: "Tu", exact: true })).first().waitFor({ timeout })
const WAITING = "Já tens o Orwell aberto noutro separador."

async function until(condition, ms = 60_000, step = 1_000) {
  const limit = Date.now() + ms
  while (Date.now() < limit) {
    if (await condition().catch(() => false)) return true
    await wait(step)
  }
  return false
}

/** Open sockets and main-frame navigations of a page. A navigation after the first load is a reload. */
function watch(page) {
  const open = new Set()
  let navigations = 0
  page.on("websocket", (ws) => {
    open.add(ws)
    ws.on("close", () => open.delete(ws))
  })
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return
    navigations += 1
    open.clear()
  })
  return { open: () => open.size, navigations: () => navigations }
}

/** The vault, read from IndexedDB and opened with the passphrase, here in Node. */
async function vaultOf(page) {
  const raw = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("enclave", 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const read = request.result.transaction("vault", "readonly").objectStore("vault").get("current")
          read.onsuccess = () => resolve(read.result ? new TextDecoder().decode(read.result) : null)
          read.onerror = () => reject(read.error)
        }
      }),
  )
  if (!raw) throw new Error("no vault")
  const file = JSON.parse(raw.startsWith("orwv2\n") ? raw.slice(6) : raw)
  const b64 = (text) => Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  const key = argon2id(new TextEncoder().encode(PASSPHRASE), b64(file.salt), { t: 3, m: 65_536, p: 4, dkLen: 32 })
  return JSON.parse(new TextDecoder().decode(xchacha20poly1305(key, b64(file.nonce)).decrypt(b64(file.ciphertext))))
}

/**
 * The iOS pair, as the page sees it: `pagehide` with `persisted` and the page
 * hidden, then visible again, with or without `pageshow`.
 */
async function suspendPage(page) {
  await page.evaluate(() => {
    const own = window
    if (!own.__visibilityPatched) {
      own.__visibilityPatched = true
      own.__visibility = "visible"
      Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => own.__visibility })
      Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => own.__visibility === "hidden" })
    }
    own.__visibility = "hidden"
    document.dispatchEvent(new Event("visibilitychange"))
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))
  })
}
async function resumePage(page, { pageshow }) {
  await page.evaluate((withPageshow) => {
    window.__visibility = "visible"
    document.dispatchEvent(new Event("visibilitychange"))
    if (withPageshow) window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))
  }, pageshow)
}
const marker = (page) => page.evaluate(() => window.__sameDocument ?? null).catch(() => null)

class MemoryVaultBackend {
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

async function nodeAccount(name) {
  const vault = new Vault(new MemoryVaultBackend())
  await vault.create("frase-de-teste-do-no")
  const session = new Session(vault)
  const identity = await session.createIdentity(HOST)
  await session.connect()
  await session.updateProfile({ displayName: name, donations: [] })
  const account = { name, session, vault, address: identity.address }
  nodeAccounts.push(account)
  return account
}

/** Ana's address, read from the server database (read-only): the first account born. */
function firstAccountAddress() {
  const db = new DatabaseSync(join(data, "enclave.sqlite"), { readOnly: true })
  try {
    return db.prepare("SELECT address FROM accounts ORDER BY rowid ASC").get()?.address
  } finally {
    db.close()
  }
}

function message(body, attachment) {
  return {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body,
    attachments: attachment
      ? [{ url: "", key: "", nonce: "", digest: "", kind: "image", name: attachment.name, mediaType: "image/png", byteLength: attachment.bytes, inline: attachment.inline }]
      : [],
    links: [],
    mentions: [],
  }
}

const entries = (vault, channel) => [...(vault.history?.[channel] ?? []), ...(vault.estadoDoCanal?.[channel] ?? [])].filter((e) => !e.herdado)
const bodies = (vault, channel) =>
  dobrarConversa([...entries(vault, channel)].sort((a, b) => a.seq - b.seq))
    .filter((e) => e.payload.t === "message")
    .map((e) => e.payload.body)

// A heavy photo with a random tail (a repeated tail compresses to nothing): it keeps the history busy for minutes.
const PHOTO = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg${Array.from({ length: 15 }, () => Buffer.from(crypto.getRandomValues(new Uint8Array(60_000))).toString("base64")).join("")}`

const resultsByEngine = {}
const pc = { browser: null, page: null, dm: null }

// --- once: Ana on the computer, and Bruno's conversation -----------------------------
const setupResults = []
const setupCheck = (name, ok, detail = "") => {
  setupResults.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FAIL "} [setup] ${name}${detail ? `  (${detail})` : ""}`)
}
try {
  pc.browser = await chromium.launch({ headless: true })
  browsers.push(pc.browser)
  const ctxPc = await pc.browser.newContext({ locale: "pt-PT" })
  pc.page = await ctxPc.newPage()
  await pc.page.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(pc.page, { nome: "Ana", frase: PASSPHRASE, servidor: HOST })
  await inside(pc.page)
  const ana = firstAccountAddress()
  const bruno = await nodeAccount("Bruno")
  pc.dm = await bruno.session.openDirect(ana)
  await until(async () => bruno.session.channels.includes(pc.dm), 30_000, 500)
  await bruno.session.sendFriendRequest(pc.dm)
  await pc.page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await pc.page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await pc.page.locator(".people-tabs").getByRole("button", { name: "Recebidos" }).click()
  await until(async () => pc.page.getByRole("button", { name: "Aceitar" }).first().isVisible(), 60_000)
  await pc.page.getByRole("button", { name: "Aceitar" }).first().click()
  await until(async () => bruno.session.friendTies().get(ana)?.link === "amigos", 60_000)
  for (let n = 1; n <= 30; n++) await bruno.session.send(pc.dm, message(`mensagem ${n} do Bruno`))
  await bruno.session.send(pc.dm, message("a fotografia do rio", { name: "rio.png", bytes: PHOTO.length, inline: PHOTO }))
  setupCheck(
    "the computer has the whole conversation",
    await until(async () => bodies(await vaultOf(pc.page), pc.dm).filter((b) => b.startsWith("mensagem ")).length === 30, 120_000, 2_000),
  )
  // Bruno leaves for good: the history can only come from the computer.
  bruno.session.disconnect()
} catch (error) {
  setupCheck("the setup reached the end", false, String(error?.message ?? error).split("\n")[0])
}
if (setupResults.some((ok) => !ok)) await cleanUp(1)

// --- per engine: pair a phone, suspend it mid-history, twice, then the second tab -----
for (const engineName of chosen) {
  const results = []
  const check = (name, ok, detail = "") => {
    results.push(Boolean(ok))
    console.log(`${ok ? "  ok  " : " FAIL "} [${engineName}] ${name}${detail ? `  (${detail})` : ""}`)
  }
  try {
    // A fresh pairing link for each phone.
    const { folha: sheet, link } = await abrirJuntarUmAparelho(pc.page)

    const browser = await ENGINES[engineName].launch({ headless: true })
    browsers.push(browser)
    const phoneContext = { locale: "pt-PT", viewport: { width: 390, height: 844 }, hasTouch: true }
    // Firefox in Playwright does not take `isMobile`.
    if (engineName !== "firefox") Object.assign(phoneContext, { isMobile: true, deviceScaleFactor: 3 })
    const ctx = await browser.newContext(phoneContext)
    if (NO_LOCKS) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "locks", { get: () => undefined, configurable: true }))
    const pageErrors = []
    ctx.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.message)))
    // `DEBUG_IOS=1`: the phone's console, for a failure that needs it.
    if (process.env.DEBUG_IOS) ctx.on("page", (page) => page.on("console", (line) => console.log(`    [${engineName} console] ${line.text().slice(0, 300)}`)))
    const phone = await ctx.newPage()
    const phoneWatch = watch(phone)
    await phone.goto(APP, { waitUntil: "domcontentloaded" })
    await irParaEmparelhar(phone)
    // The words, then "Estás dentro" with the account password (1.3.26). The
    // key stays per tab, so the second tab in step 6 asks for the password.
    await colarCodigo(phone, sheet, link)
    await confirmarEAbrir(phone, sheet, PASSPHRASE)
    await sheet.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
    await inside(phone)
    const navigationsAfterEntering = phoneWatch.navigations()
    await phone.evaluate(() => {
      window.__sameDocument = "phone-document"
    })
    check("the phone enters the account", true)

    // 3. Mid-history, the iOS pair without `pageshow`.
    // Mid-history: the device still owes its first pull (`inicial`), or a plan is under way.
    const pending = (vault) => vault.historico?.inicial !== undefined || vault.historico?.plano !== undefined
    const midway = await until(async () => pending(await vaultOf(phone)), 60_000, 250)
    check("the history is on its way (still pending in the vault)", midway)
    await suspendPage(phone)
    const closed = await until(async () => phoneWatch.open() === 0, 10_000, 200)
    check("suspended: the phone closes its socket", closed, `${phoneWatch.open()} open`)
    await wait(2_000)
    await resumePage(phone, { pageshow: false })
    const reconnected = await until(async () => phoneWatch.open() === 1, 30_000, 200)
    check("back without pageshow: the same document reconnects", reconnected && (await marker(phone)) === "phone-document" && phoneWatch.navigations() === navigationsAfterEntering, `${phoneWatch.navigations() - navigationsAfterEntering} reloads`)

    // 4. Again, with `pageshow` persisted.
    await wait(3_000)
    const stillMidway = pending(await vaultOf(phone))
    await suspendPage(phone)
    await until(async () => phoneWatch.open() === 0, 10_000, 200)
    await wait(2_000)
    await resumePage(phone, { pageshow: true })
    const reconnectedAgain = await until(async () => phoneWatch.open() === 1, 30_000, 200)
    check(
      "back with pageshow: the same document reconnects",
      reconnectedAgain && (await marker(phone)) === "phone-document" && phoneWatch.navigations() === navigationsAfterEntering,
      `${phoneWatch.navigations() - navigationsAfterEntering} reloads${stillMidway ? ", still mid-history" : ", history already done"}`,
    )

    // 5. The history finishes, without any reload.
    let phoneVault = {}
    const finished = await until(async () => {
      phoneVault = await vaultOf(phone)
      return phoneVault.historico?.plano === undefined && phoneVault.historico?.inicial === undefined
      // The photo crosses at the signal budget (40 a minute, shared by every device the computer serves).
    }, 600_000, 3_000)
    check("the history finishes on the phone", finished, finished ? "" : JSON.stringify({ inicial: phoneVault.historico?.inicial, plano: phoneVault.historico?.plano ? Object.keys(phoneVault.historico.plano) : null, parado: phoneVault.historico?.plano?.parado ?? null, media: phoneVault.historico?.plano?.media ? { total: phoneVault.historico.plano.media.total, feitas: phoneVault.historico.plano.media.feitas } : null }))
    const ids = entries(phoneVault, pc.dm).map((e) => chaveDoEvento(e) ?? `seq:${e.seq}`)
    check(
      "the whole conversation, without duplicates",
      bodies(phoneVault, pc.dm).filter((b) => b.startsWith("mensagem ")).length === 30 && new Set(ids).size === ids.length,
      `${ids.length} entries`,
    )
    check("and the photo", entries(phoneVault, pc.dm).some((e) => e.payload.body === "a fotografia do rio"))
    check("no reload at any point", (await marker(phone)) === "phone-document" && phoneWatch.navigations() === navigationsAfterEntering)

    // 6. One owner per browser: the phone suspends, a second tab takes over, the first must not resume.
    await suspendPage(phone)
    await until(async () => phoneWatch.open() === 0, 10_000, 200)
    const second = await ctx.newPage()
    const secondWatch = watch(second)
    await second.goto(APP, { waitUntil: "domcontentloaded" })
    const passphrase = second.locator('.gate-card input[type="password"]')
    const tookOver = await passphrase.waitFor({ timeout: 20_000 }).then(
      () => true,
      () => false,
    )
    check("with the first tab suspended, a second tab takes over", tookOver)
    await passphrase.fill(PASSPHRASE)
    await passphrase.press("Enter")
    await inside(second)
    check("and the second tab has the only socket", await until(async () => secondWatch.open() === 1, 30_000, 200))
    await resumePage(phone, { pageshow: true })
    const reloaded = await until(async () => phoneWatch.navigations() > navigationsAfterEntering, 20_000, 200)
    check("the first tab comes back: it reloads (its memory is stale), never resumes", reloaded && (await marker(phone)) === null)
    const waits = await phone.getByText(WAITING, { exact: false }).first().waitFor({ timeout: 20_000 }).then(
      () => true,
      () => false,
    )
    check("and it waits for the owner", waits)
    await wait(2_000)
    check("with no socket, while the second keeps the only one", phoneWatch.open() === 0 && secondWatch.open() === 1, `${phoneWatch.open()} / ${secondWatch.open()}`)
    check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "))
    await browser.close().catch(() => {})
  } catch (error) {
    const frames = String(error?.stack ?? "").split("\n").filter((l) => l.includes("e2e-ios-resume")).map((l) => l.trim().replace(/^.*e2e-ios-resume\.mjs:/, "line ")).join(", ")
    check("the script reached the end", false, `${String(error?.message ?? error).split("\n")[0]} @ ${frames}`)
    for (const page of browsers.at(-1)?.contexts().flatMap((c) => c.pages()) ?? []) {
      console.log(`    page shows: ${(await page.evaluate(() => document.body.innerText).catch(() => "")).replace(/\s+/g, " ").slice(0, 300)}`)
    }
  }
  resultsByEngine[engineName] = { passed: results.filter(Boolean).length, total: results.length }
}

console.log("")
let allGood = true
for (const [engine, { passed, total }] of Object.entries(resultsByEngine)) {
  console.log(`${engine}${NO_LOCKS ? " (no Web Locks)" : ""}: ${passed}/${total} checks passed`)
  if (passed !== total) allGood = false
}
await cleanUp(allGood ? 0 : 1)
