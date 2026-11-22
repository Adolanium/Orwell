/**
 * The update from the previous web (1.3.26) to this one, in the browser, with
 * the service worker registered.
 *
 *   npm run build
 *   E2E_PREVIOUS_WEB_DIST=<apps/web/dist built from 00adbb5a> node scripts/e2e-upgrade-from-previous.mjs
 *   ... --only=desktop|pixel7|iphone14                      (one device)
 *
 * The previous dist comes by environment and is the only thing that comes: a
 * folder on disk, never a network target. To build it: `git worktree add
 * --detach <dir> 00adbb5a`, then `npm ci && npm run build` there; the folder is
 * `<dir>/apps/web/dist`.
 *
 * Per device (Chromium desktop, Pixel 7 in Chromium, iPhone 14 in WebKit), one
 * browser context, as a person who keeps the app open across a release:
 *  1. The front serves the previous web (the `orwell-dist=antiga` cookie of
 *     `servidor-descartavel.mjs`). Ana creates her account there, and the
 *     service worker is registered.
 *  2. Channels: Ana creates two in the interface; Bruno, a core account here in
 *     Node, becomes her friend and seats her in a third. She reads Bruno there.
 *  3. The release: the front now serves this web (the cookie goes). The tab
 *     looks again (a `focus`, as when the person comes back) and shows the
 *     update pill. While it shows, Bruno writes three more lines.
 *  4. "Recarregar" on the pill: the page loads this build (its bundle name is
 *     the one in this `dist`), and the app opens on the same account.
 *  5. Every channel is there and opens; the lines Bruno wrote during the update
 *     arrive; the sync is over (no history plan in the vault, no history bar),
 *     and the service worker is still registered.
 * At every step the centre of the screen is inside the app (`centreInsideApp`),
 * and the screen guard watches every page between steps (`screen-guard.mjs`).
 *
 * The server is this build's from the start: the server goes first in a
 * release, and the clients follow.
 *
 * ALL LOCAL AND DISPOSABLE: `servidor-descartavel.mjs`, ports 8760 and 8761
 * (`E2E_PORTA_DA_FRENTE`, `E2E_PORTA_DO_SERVIDOR`), 127.0.0.1 only.
 */
import { centreInsideApp } from "./screen-guard.mjs"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala } from "@enclave/protocol"
import { chromium, devices, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { abrirCanal, ate, contasDoServidor, criarCanal, dentro, escutar, ouviu, separador, temCanal, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const PREVIOUS = process.env.E2E_PREVIOUS_WEB_DIST ? resolve(process.env.E2E_PREVIOUS_WEB_DIST) : ""
if (!PREVIOUS || !existsSync(join(PREVIOUS, "index.html"))) {
  console.error("E2E_PREVIOUS_WEB_DIST must name the apps/web/dist of 1.3.26 (00adbb5a). See the header of this script.")
  process.exit(2)
}
const PASSWORD = "frase-de-verificacao-2026"
const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1]
const DEVICES = [
  ["desktop", chromium, { viewport: { width: 1280, height: 860 } }],
  ["pixel7", chromium, devices["Pixel 7"]],
  ["iphone14", webkit, devices["iPhone 14"]],
].filter(([name]) => !only || only === name)

const bundleOf = (dist) => readFileSync(join(dist, "index.html"), "utf8").match(/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null
const NEW_BUNDLE = bundleOf(join(RAIZ, "apps/web/dist"))
const OLD_BUNDLE = bundleOf(PREVIOUS)

const { check, resumo } = verificador()
const srv = await levantarServidor({
  frente: Number(process.env.E2E_PORTA_DA_FRENTE ?? 8760),
  servidor: Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8761),
  distAntiga: PREVIOUS,
  etiqueta: "upgrade-from-previous",
})
const log = []
const browsers = []
const nodeAccounts = []
/** The page in use, for a capture when the script stops. */
let current = null

async function cleanUp(code) {
  for (const account of nodeAccounts) account.session.disconnect()
  for (const browser of browsers) await browser.close().catch(() => {})
  srv.fechar()
  process.exit(code)
}

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
  const identity = await session.createIdentity(srv.NOME)
  await session.connect()
  await session.updateProfile({ displayName: name, donations: [] })
  const account = { name, session, vault, address: identity.address }
  nodeAccounts.push(account)
  return account
}

const line = (body) => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: [], links: [], mentions: [] })

/** The vault, read from IndexedDB and opened with the password, here in Node. */
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
  const key = argon2id(new TextEncoder().encode(PASSWORD), b64(file.salt), { t: 3, m: 65_536, p: 4, dkLen: 32 })
  return JSON.parse(new TextDecoder().decode(xchacha20poly1305(key, b64(file.nonce)).decrypt(b64(file.ciphertext))))
}

const loadedBundle = (page) => page.evaluate(() => [...document.scripts].map((s) => s.src).find((src) => /index-[A-Za-z0-9_-]+\.js/.test(src))?.match(/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null)
const serviceWorker = (page) => page.evaluate(async () => Boolean((await navigator.serviceWorker?.getRegistration?.())?.active)).catch(() => false)

async function centreCheck(page, name, step) {
  const { ok, detail } = await centreInsideApp(page)
  check(`${name}: ${step}: the centre of the screen is inside the app`, ok, detail)
}

check("the two builds differ", Boolean(NEW_BUNDLE && OLD_BUNDLE && NEW_BUNDLE !== OLD_BUNDLE), `${OLD_BUNDLE} -> ${NEW_BUNDLE}`)

try {
  const bruno = await nodeAccount("Bruno")
  for (const [name, engine, options] of DEVICES) {
    console.log(`\n=== ${name} ===`)
    const browser = await engine.launch({ headless: true })
    browsers.push(browser)
    const context = await browser.newContext({ ...options, locale: "pt-PT" })
    escutar(context, log, name)
    const host = new URL(srv.APP).hostname
    await context.addCookies([{ name: "orwell-dist", value: "antiga", domain: host, path: "/" }])
    const page = await context.newPage()
    current = { page, name }

    // 1. The previous web, an account, the service worker.
    await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
    const before = contasDoServidor(srv.base).length
    // The last wait of `criarConta` reads a screen of this build; on 1.3.26 in WebKit it can miss it. The app being open is the check.
    await criarConta(page, { nome: `Ana ${name}`.slice(0, 14), frase: PASSWORD, servidor: srv.NOME }).catch(() => {})
    await dentro(page)
    check(`${name}: the previous web is loaded`, (await loadedBundle(page)) === OLD_BUNDLE, String(await loadedBundle(page)))
    check(`${name}: the service worker is registered`, (await ate(() => serviceWorker(page), 30_000)) >= 0)
    await centreCheck(page, name, "account created on 1.3.26")
    const ana = contasDoServidor(srv.base)[before]

    // 2. Two channels of her own, and Bruno's, where he seats her.
    const own = [`praca-${name}`, `oficina-${name}`]
    for (const channel of own) await criarCanal(page, channel)
    const dm = await bruno.session.openDirect(ana)
    await ate(async () => bruno.session.channels.includes(dm), 30_000)
    await bruno.session.sendFriendRequest(dm)
    await separador(page, /^Recebidos/)
    await ate(async () => page.locator(".people-requests").getByRole("button", { name: "Aceitar" }).first().isVisible(), 90_000, 1_500)
    await page.locator(".people-requests").getByRole("button", { name: "Aceitar" }).first().click()
    check(`${name}: Ana and Bruno are friends`, (await ate(async () => bruno.session.friendTies().get(ana)?.link === "amigos", 60_000)) >= 0)
    const adro = `adro-${name}`
    const channel = moradaDeSala(srv.NOME)
    await bruno.session.createSpaceChannel(channel, adro)
    await ate(async () => bruno.session.founderOf(channel) === bruno.address, 30_000)
    await bruno.session.seat(channel, ana)
    const all = [...own, adro]
    // By the name in the page (a rail face's `aria-label` counts): the 1.3.26 sidebar has no `title` on its lines, which `temCanal` reads.
    const named = async (channelName) => (await page.evaluate(() => document.body.innerHTML)).includes(channelName)
    // A note, not a check: this is 1.3.26 itself. What the update must keep is checked after the reload.
    await ate(async () => (await named(adro)) && (await named(own[0])) && (await named(own[1])), 30_000, 1_000)
    const missingBefore = []
    for (const channelName of all) if (!(await named(channelName))) missingBefore.push(channelName)
    console.log(`       ${name}: on 1.3.26, ${missingBefore.length ? `not in the page yet: ${missingBefore.join(", ")}` : "all three channels in the page"}`)
    await bruno.session.send(channel, line(`antes da actualizacao ${name}`))
    await abrirCanal(page, adro)
    check(`${name}: Ana reads Bruno on 1.3.26`, (await ouviu(page, `antes da actualizacao ${name}`, 60_000)) >= 0)
    await centreCheck(page, name, "channels on 1.3.26")

    // 3. The release: the front serves this web; the tab looks again and shows the pill.
    await context.clearCookies()
    const pill = page.locator('[data-faixa="versao"]')
    const sawPill = await ate(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      return pill.isVisible()
    }, 60_000, 2_000)
    check(`${name}: the update pill shows`, sawPill >= 0, sawPill >= 0 ? (await pill.innerText()).replace(/\s+/g, " ") : "")
    await centreCheck(page, name, "update pill on screen")
    for (let n = 1; n <= 3; n++) await bruno.session.send(channel, line(`durante a actualizacao ${n} ${name}`))

    // 4. Reload from the pill.
    await Promise.all([page.waitForEvent("load", { timeout: 60_000 }), pill.getByRole("button").first().click()])
    await centreCheck(page, name, "right after the reload")
    await dentro(page)
    check(`${name}: this build is loaded`, (await loadedBundle(page)) === NEW_BUNDLE, String(await loadedBundle(page)))
    await centreCheck(page, name, "app open on 1.3.27")

    // 5. Every channel there and opening, the lines of the update, the sync over.
    for (const name2 of all) {
      const there = (await temCanal(page, name2, 60_000)) !== false
      let opens = false
      if (there) {
        await abrirCanal(page, name2)
        opens = (await page.locator("h1, .topbar-comunidade").filter({ hasText: name2 }).first().waitFor({ timeout: 30_000 }).then(() => true, () => false))
      }
      check(`${name}: channel ${name2} is there and opens`, there && opens)
      await centreCheck(page, name, `channel ${name2} open`)
    }
    await abrirCanal(page, adro)
    let caughtUp = true
    for (let n = 1; n <= 3; n++) caughtUp = (await ouviu(page, `durante a actualizacao ${n} ${name}`, 60_000)) >= 0 && caughtUp
    check(`${name}: the lines written during the update arrive`, caughtUp)
    const synced = await ate(async () => {
      const vault = await vaultOf(page)
      return vault.historico?.plano === undefined && (await page.locator(".barra-historico").count()) === 0
    }, 120_000, 2_000)
    check(`${name}: the sync is over`, synced >= 0)
    check(`${name}: the service worker is still registered`, await serviceWorker(page))
    await centreCheck(page, name, "end")
    await context.close()
  }
  const errors = log.filter((l) => l.includes("PAGEERROR"))
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "))
} catch (error) {
  let shot = ""
  if (current) {
    mkdirSync(join(RAIZ, ".verify-data/upgrade-from-previous"), { recursive: true })
    shot = join(RAIZ, ".verify-data/upgrade-from-previous", `${current.name}-stopped.png`)
    await current.page.screenshot({ path: shot }).catch(() => {})
  }
  check("the script reached the end", false, `${String(error?.message ?? error).split("\n")[0]}${shot ? ` (capture ${shot})` : ""}`)
}

await cleanUp(resumo() ? 0 : 1)
