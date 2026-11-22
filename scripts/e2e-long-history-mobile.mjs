/**
 * A long history to a new phone: ~1 500 items from a sibling, and the sync ends.
 *
 *   npm run build && node scripts/e2e-long-history-mobile.mjs
 *   node scripts/e2e-long-history-mobile.mjs --only=iphone14|pixel7      (one phone)
 *
 * Why it exists (1.3.27). On 1.3.26 phones with a long account history saw
 * the history bar stand still for good (a page that never arrived, a media item
 * above the 16 MiB cap of kept responses), or a black screen during the sync.
 *
 * The sibling is Ana's device here in Node, the account's only device. Bruno is
 * a core account here in Node too. Before any phone:
 *  1. Ana and Bruno are friends. In their conversation Ana writes 200 lines
 *     (in batches) and Bruno 100; Ana edits 100 of hers; Bruno reacts to 100
 *     and Ana to 50; Bruno sends 20 photos (~100 KiB each). Ana has ten
 *     channels of her own ("arquivo-0" to "arquivo-9") with 95 lines each.
 *     Spread over channels on purpose: a device keeps the last 400 lines of
 *     each channel (`HISTORY_MAX_PER_CHANNEL`), so one channel cannot hold
 *     1 500.
 *  2. One photo above 16 MiB, which the wire cannot carry in one message (the
 *     server frame is 12 MiB): it is put straight into Ana's vault, as a photo a
 *     device kept from an attachment it fetched. The sync must deliver it or say
 *     it did not come; it must never hold the sync.
 * Then per phone (iPhone 14 in WebKit, Pixel 7 in Chromium), a NEW device:
 *  3. "Entrar com outro aparelho" › "Mostrar um código neste aparelho"; Ana
 *     types the code; the same words; "Sim, juntar o aparelho"; "Estás dentro"
 *     with the account password.
 *  4. The sync ends: no history plan left in the phone's vault, within 40 min
 *     (`E2E_SYNC_MS`). A line a minute says how many items came, and every
 *     five minutes what the plan still waits for.
 *
 * The pace. The phone runs this build as shipped. The sibling here in Node
 * sends history signals at 100 a minute (`E2E_SIBLING_SIGNALS_PER_MINUTE`)
 * instead of the shipped 40: the server allows 120 per connection, and at 40
 * a minute of 8 KiB parts the photo above 16 MiB alone takes over an hour. What
 * is proved is that the sync ENDS, not how long it takes; with
 * `E2E_SIBLING_SIGNALS_PER_MINUTE=40` the run is the production pace.
 *
 * What the phone cannot get: an entry of Ana's that never left her device (no
 * server `seq`) is not history, so it is left out of the totals and counted
 * apart.
 *     It counts what came, against what Ana has, and reads what the phone says
 *     did not come ("não vieram") from its vault.
 *  5. The conversation with Bruno opens on the phone and shows his last line.
 * At every step the centre of the screen is inside the app (`centreInsideApp`),
 * and the screen guard watches the page between steps (`screen-guard.mjs`).
 *
 * ALL LOCAL AND DISPOSABLE: `servidor-descartavel.mjs`, ports 8764 and 8765
 * (`E2E_PORTA_DA_FRENTE`, `E2E_PORTA_DO_SERVIDOR`), 127.0.0.1 only.
 */
import { centreInsideApp } from "./screen-guard.mjs"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { ArmazemEmMemoria, Session, TECTOS_DO_FIO_DO_HISTORICO, Vault, dobrarConversa } from "@enclave/client-core"
import { moradaDeSala } from "@enclave/protocol"
import { chromium, devices, webkit } from "playwright"
import { ate, dentro, escutar, irParaEmparelhar, verificador } from "./fase7-comum.mjs"
import { confirmarEAbrir } from "./juntar-aparelho.mjs"
import { irParaDirectas } from "./separadores.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const PASSWORD = "frase-de-verificacao-2026"
const CAPTURES = join(RAIZ, ".verify-data/long-history-mobile")
mkdirSync(CAPTURES, { recursive: true })
const SYNC_MS = Number(process.env.E2E_SYNC_MS ?? 40 * 60_000)
const SIBLING_SIGNALS = Number(process.env.E2E_SIBLING_SIGNALS_PER_MINUTE ?? 100)
const ARCHIVES = 10
const ARCHIVE_LINES = 95
const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1]
const PHONES = [
  ["iphone14", webkit, devices["iPhone 14"]],
  ["pixel7", chromium, devices["Pixel 7"]],
].filter(([name]) => !only || only === name)

const { check, resumo } = verificador()
const srv = await levantarServidor({
  frente: Number(process.env.E2E_PORTA_DA_FRENTE ?? 8764),
  servidor: Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8765),
  etiqueta: "long-history-mobile",
})
const NEW_DEVICE_APP = `http://${srv.NOME}/app/?lingua=pt&servidor=${encodeURIComponent(srv.NOME)}`
const log = []
const browsers = []
const nodeAccounts = []

async function cleanUp(code) {
  for (const account of nodeAccounts) {
    account.session.cancelarEmparelhamento?.()
    account.session.disconnect()
  }
  for (const browser of browsers) await browser.close().catch(() => {})
  srv.fechar()
  process.exit(code)
}

// Stopped from outside: close the browsers and the server, never leave them behind.
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void cleanUp(130))

/** What Ana has and the phone does not, per channel and per payload type. Filled in once Ana exists. */
let missing = () => ""

/** What the phone's history plan still waits for, in one line, for the log. */
function planSummary(plan) {
  if (!plan) return "no plan"
  const open = Object.entries(plan.canais ?? {}).filter(([, c]) => !c.fim)
  const channels = open.map(([id, c]) => `${id.slice(0, 10)}:${c.feitas ?? 0}/${c.total ?? "?"}${c.failures ? ` f${c.failures}${c.failureReason ? `(${c.failureReason})` : ""}` : ""}`).join(" ")
  const media = plan.media ? `media ${plan.media.feitas}/${plan.media.total} left ${plan.media.porTrazer?.length ?? 0} lost ${plan.media.perdidas ?? 0} tries ${JSON.stringify(plan.media.tentativas ?? {})}` : "no media phase"
  return `${open.length} channels open [${channels.slice(0, 300)}], ${media}${plan.parado ? `, stopped ${plan.parado.razao}` : ""}`
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
  // The account password is the one the phone types at "Estás dentro".
  await vault.create(PASSWORD)
  const session = new Session(vault, { armazem: new ArmazemEmMemoria() })
  const identity = await session.createIdentity(srv.NOME)
  await session.connect()
  await session.updateProfile({ displayName: name, donations: [] })
  const account = { name, session, vault, address: identity.address }
  nodeAccounts.push(account)
  return account
}

const randomB64 = (bytes) => {
  const out = []
  for (let i = 0; i < bytes; i += 65_536) out.push(crypto.getRandomValues(new Uint8Array(Math.min(65_536, bytes - i))))
  return Buffer.concat(out).toString("base64")
}
const photo = (name, bytes) => {
  const inline = `data:image/png;base64,${randomB64(bytes)}`
  return { url: "", key: "", nonce: "", digest: "", kind: "image", name, mediaType: "image/png", byteLength: inline.length, inline }
}
const line = (body, attachment) => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: attachment ? [attachment] : [], links: [], mentions: [] })

/** A vault, read from IndexedDB and opened with the password, here in Node. */
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

const entries = (vault, channel) => [...(vault.history?.[channel] ?? []), ...(vault.estadoDoCanal?.[channel] ?? [])].filter((e) => !e.herdado)
/** Entries the server numbered: what a sibling can send as history. */
const sent = (vault, channel) => entries(vault, channel).filter((e) => e.seq >= 0)
const itemCount = (vault, channels) => channels.reduce((sum, channel) => sum + entries(vault, channel).length, 0)
const bodies = (vault, channel) =>
  dobrarConversa([...entries(vault, channel)].sort((a, b) => a.seq - b.seq))
    .filter((e) => e.payload.t === "message")
    .map((e) => e.payload.body)

async function centreCheck(page, name, step) {
  const { ok, detail } = await centreInsideApp(page)
  check(`${name}: ${step}: the centre of the screen is inside the app`, ok, detail)
}

/** Until a `pair` event of that phase on a Node session. */
function pairPhase(session, target, ms = 60_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`pairing never reached ${target}`))
    }, ms)
    const off = session.on("pair", (event) => {
      if (event.fase === target) {
        clearTimeout(timer)
        off()
        resolve(event)
      } else if (event.fase === "falhou") {
        clearTimeout(timer)
        off()
        reject(new Error(`pairing failed: ${event.razao}`))
      }
    })
  })
}

try {
  TECTOS_DO_FIO_DO_HISTORICO.sinaisPorMinuto = SIBLING_SIGNALS
  // 1. The history, on Ana's only device.
  const ana = await nodeAccount("Ana")
  const bruno = await nodeAccount("Bruno")
  const dm = await ana.session.openDirect(bruno.address)
  await ate(async () => bruno.session.channels.includes(dm), 30_000)
  await ana.session.sendFriendRequest(dm)
  await ate(async () => bruno.session.friendTies().get(ana.address)?.link === "pedido-recebido", 30_000)
  await bruno.session.acceptFriend(dm, ana.address)
  check("Ana and Bruno are friends", (await ate(async () => ana.session.friendTies().get(bruno.address)?.link === "amigos", 60_000)) >= 0)

  const anaLines = []
  for (let i = 0; i < 200; i += 100) {
    const batch = Array.from({ length: 100 }, (_, j) => line(`ana ${String(i + j).padStart(4, "0")}`))
    anaLines.push(...batch)
    await ana.session.sendBatch(dm, batch)
  }
  const brunoLines = []
  for (let i = 0; i < 100; i += 50) {
    const batch = Array.from({ length: 50 }, (_, j) => line(`bruno ${String(i + j).padStart(3, "0")}`))
    brunoLines.push(...batch)
    await bruno.session.sendBatch(dm, batch)
  }
  for (let i = 0; i < 100; i++) await ana.session.editMessage(dm, anaLines[i * 2].id, `ana ${String(i * 2).padStart(4, "0")} editada`)
  for (let i = 0; i < 100; i++) await bruno.session.reactToMessage(dm, anaLines[i * 2 + 1].id, "👍")
  for (let i = 0; i < 50; i++) await ana.session.reactToMessage(dm, brunoLines[i * 2].id, "❤️")
  for (let i = 0; i < 20; i++) await bruno.session.send(dm, line(`foto ${i}`, photo(`foto-${i}.png`, 100 * 1024)))
  const last = line("a ultima linha do Bruno")
  await bruno.session.send(dm, last)
  const archives = []
  for (let a = 0; a < ARCHIVES; a++) {
    const archive = moradaDeSala(srv.NOME)
    await ana.session.createSpaceChannel(archive, `arquivo-${a}`)
    await ate(async () => ana.session.founderOf(archive) === ana.address, 30_000)
    await ana.session.sendBatch(archive, Array.from({ length: ARCHIVE_LINES }, (_, i) => line(`arquivo ${a} linha ${i}`)))
    archives.push(archive)
  }

  const channels = [dm, ...archives]
  missing = (vault) => {
    const out = []
    for (const channel of channels) {
      const have = new Set(entries(vault, channel).map((e) => e.payload?.id ?? `seq${e.seq}`))
      const lack = sent(ana.vault.contents, channel).filter((e) => !have.has(e.payload?.id ?? `seq${e.seq}`))
      if (!lack.length) continue
      const types = {}
      for (const e of lack) types[e.payload?.t ?? "?"] = (types[e.payload?.t ?? "?"] ?? 0) + 1
      out.push(`${channel === dm ? "dm" : channel.slice(0, 10)}: ${JSON.stringify(types)}`)
    }
    return out.join("; ") || "nothing"
  }
  const expected = 200 + 100 + 100 + 100 + 50 + 20 + 1 + ARCHIVES * ARCHIVE_LINES
  check(
    "Ana's device holds the whole history",
    (await ate(async () => itemCount(ana.vault.contents, channels) >= expected && bodies(ana.vault.contents, dm).includes("a ultima linha do Bruno"), 180_000, 1_000)) >= 0,
    `${itemCount(ana.vault.contents, channels)} items, ${expected} sent`,
  )

  // 2. The photo above 16 MiB, in Ana's vault.
  const BIG = 17 * 1024 * 1024
  const big = line("a fotografia grande", photo("grande.png", Math.ceil((BIG * 3) / 4)))
  await ana.vault.update((contents) => {
    const list = (contents.history[dm] ??= [])
    const seq = Math.max(0, ...list.map((e) => e.seq)) + 1
    list.push({ seq, sender: ana.address, at: Date.now(), payload: big })
  })
  const total = channels.reduce((sum, channel) => sum + sent(ana.vault.contents, channel).length, 0)
  const unsent = itemCount(ana.vault.contents, channels) - total
  if (unsent) console.log(`       ${unsent} of Ana's entries never left her device (no server seq): left out of the totals`)
  check("the photo above 16 MiB is in Ana's vault", entries(ana.vault.contents, dm).some((e) => e.payload.id === big.id), `${total} items in all`)

  for (const [name, engine, options] of PHONES) {
    console.log(`\n=== ${name} ===`)
    const browser = await engine.launch({ headless: true })
    browsers.push(browser)
    const context = await browser.newContext({ ...options, locale: "pt-PT" })
    escutar(context, log, name)
    /*
      `E2E_DIAG=1`: the page says in its console what the timeline needs to explain a
      stall: lifecycle events, Web Lock requests and grants, and each change of the
      element at the top of the app root.
    */
    if (process.env.E2E_DIAG === "1") {
      await context.addInitScript(() => {
        const say = (what) => console.log(`[diag] ${what}`)
        for (const type of ["pagehide", "pageshow", "freeze", "resume", "visibilitychange", "blur", "focus", "online", "offline"]) {
          window.addEventListener(type, (event) => say(`${type} ${document.visibilityState}${event.persisted !== undefined ? ` persisted=${event.persisted}` : ""}`), true)
          document.addEventListener(type, () => say(`doc ${type} ${document.visibilityState}`), true)
        }
        const request = navigator.locks?.request?.bind(navigator.locks)
        if (request) {
          navigator.locks.request = (name, ...rest) => {
            const options = rest.length > 1 ? rest[0] : {}
            const callback = rest.at(-1)
            say(`lock request ${name} ${JSON.stringify({ mode: options?.mode, ifAvailable: options?.ifAvailable, steal: options?.steal, signal: Boolean(options?.signal) })}`)
            const wrapped = async (lock) => {
              say(`lock granted ${name} ${lock ? "yes" : "null"}`)
              try {
                return await callback(lock)
              } finally {
                say(`lock released ${name}`)
              }
            }
            const result = rest.length > 1 ? request(name, options, wrapped) : request(name, wrapped)
            result.catch((error) => say(`lock rejected ${name} ${error?.name}`))
            return result
          }
        }
        let last = ""
        const look = () => {
          const top = document.getElementById("root")?.firstElementChild
          const now = top ? `${top.tagName.toLowerCase()}.${String(top.className).split(" ").slice(0, 2).join(".")}` : "empty"
          const gate = document.querySelector(".gate-card h1, .gate-card h2")?.textContent ?? ""
          const label = `${now} ${gate}`.trim()
          if (label !== last) say(`root ${label}`)
          last = label
        }
        new MutationObserver(look).observe(document, { childList: true, subtree: true })
      })
    }
    const page = await context.newPage()
    // A timeline of this phone, for the diagnosis: navigations, crashes, errors, every console line.
    const timeline = []
    const tStart = Date.now()
    const mark = (what) => timeline.push(`${String(Math.round((Date.now() - tStart) / 1000)).padStart(5)} s ${what}`)
    page.on("framenavigated", (frame) => frame === page.mainFrame() && mark(`NAVIGATED ${frame.url()}`))
    page.on("crash", () => mark("CRASH"))
    page.on("pageerror", (error) => mark(`PAGEERROR ${error.message}`))
    page.on("console", (message) => mark(`CONSOLE ${message.type()} ${message.text().slice(0, 300)}`))
    const saveTimeline = () => writeFileSync(join(CAPTURES, `${name}-timeline.txt`), timeline.join("\n"))

    // 3. The new device shows a code, and Ana types it.
    await page.goto(NEW_DEVICE_APP, { waitUntil: "domcontentloaded" })
    await irParaEmparelhar(page)
    await page.getByRole("button", { name: "Mostrar um código neste aparelho" }).click()
    const codeText = page.locator(".short-code-text")
    await codeText.waitFor({ timeout: 30_000 })
    const code = await codeText.getAttribute("data-code")
    await centreCheck(page, name, "code on screen")
    const sas = pairPhase(ana.session, "sas")
    await ana.session.pairAsHostByCode(code)
    await sas
    await page.locator(".sas-palavras").waitFor({ timeout: 30_000 })
    const done = pairPhase(ana.session, "concluido", 120_000)
    await ana.session.confirmarSas()
    await confirmarEAbrir(page, null, PASSWORD)
    await done.catch(() => {})
    await dentro(page)
    check(`${name}: the phone is in the account`, true)
    await centreCheck(page, name, "app open")

    // 4. The sync ends.
    const t0 = Date.now()
    let vault = {}
    let samples = 0
    let lastPlan = null
    const ended = await ate(async () => {
      vault = await vaultOf(page)
      if (vault.historico?.plano) lastPlan = vault.historico.plano
      // Every minute, a look at the centre while the history comes in, and how much came.
      if (++samples % 12 === 0) {
        const locked = await page.getByRole("button", { name: "Entrar", exact: true }).count().catch(() => -1)
        mark(`MINUTE ${itemCount(vault, channels)} items, lock screen: ${locked > 0}`)
        saveTimeline()
        console.log(`       ${name}: ${Math.round((Date.now() - t0) / 60_000)} min, ${itemCount(vault, channels)} of ${total} items${locked > 0 ? ", LOCK SCREEN" : ""}`)
        if (samples % 60 === 0 || samples === 12) {
          console.log(`       ${name}: plan: ${planSummary(vault.historico?.plano)}`)
          console.log(`       ${name}: missing: ${missing(vault)}`)
          console.log(`       ${name}: sibling signals: ${JSON.stringify(ana.session.estatisticasDoHistorico)}`)
          const bar = await page.locator(".barra-historico").first().innerText().catch(() => "")
          if (bar) console.log(`       ${name}: bar: ${bar.replace(/\s+/g, " ")}`)
        }
        await centreCheck(page, name, `sync at ${Math.round((Date.now() - t0) / 60_000)} min`)
      }
      return vault.historico?.plano === undefined && vault.historico?.inicial === undefined
    }, SYNC_MS, 5_000)
    saveTimeline()
    const came = itemCount(vault, channels)
    if (ended < 0) console.log(`       ${name}: plan at the deadline: ${planSummary(vault.historico?.plano)}`)
    // What the phone gave up on, from the last plan it had: entries per channel, and media.
    const lostEntries = Object.values(lastPlan?.canais ?? {}).reduce((sum, c) => sum + (c.notReceived ?? 0), 0)
    const lostMedia = lastPlan?.media?.perdidas ?? 0
    check(`${name}: the sync ends`, ended >= 0, `${Math.round((Date.now() - t0) / 1000)} s, ${came} of ${total} items, not received: ${lostEntries} entries and ${lostMedia} media`)
    const bar = await page.locator(".barra-historico").first().innerText().catch(() => "")
    if (bar) console.log(`       ${name}: the history bar says "${bar.replace(/\s+/g, " ")}"`)
    check(`${name}: the history bar is not left standing`, (await ate(async () => (await page.locator(".barra-historico").count()) === 0 || /não vieram|nao vieram/i.test(await page.locator(".barra-historico").first().innerText()), 60_000)) >= 0, bar.replace(/\s+/g, " "))
    const lines = bodies(vault, dm)
    check(`${name}: all of Ana's and Bruno's lines`, lines.filter((b) => /^(ana|bruno) /.test(b)).length === 300, `${lines.filter((b) => /^(ana|bruno) /.test(b)).length}`)
    const archiveLines = archives.reduce((sum, c) => sum + bodies(vault, c).length, 0)
    check(`${name}: all the lines of the ten channels`, archiveLines === ARCHIVES * ARCHIVE_LINES, `${archiveLines}`)
    check(`${name}: the edits`, lines.filter((b) => b.endsWith(" editada")).length === 100)
    const bigEntry = entries(vault, dm).find((e) => e.payload.id === big.id)
    console.log(`       ${name}: the photo above 16 MiB ${bigEntry ? "came" : "did not come"} (${came} of ${total} items)`)
    await centreCheck(page, name, "sync over")

    // 5. The conversation with Bruno opens and shows his last line.
    await irParaDirectas(page).catch(async (error) => {
      // What the finger hits on the Messages tab, for the log.
      const hit = await page.evaluate(() => {
        const tab = [...document.querySelectorAll(".separadores button")].find((b) => /Mensagens/.test(b.textContent ?? ""))
        if (!tab) return "no Messages tab"
        const r = tab.getBoundingClientRect()
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return el ? `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}` : "nothing"
      })
      const shot = join(CAPTURES, `${name}-no-messages-tab.png`)
      await page.screenshot({ path: shot }).catch(() => {})
      const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200)
      throw new Error(`${String(error?.message ?? error).split("\n")[0]} (the Messages tab hits ${hit}; screen: "${text}"; capture ${shot})`)
    })
    await page.locator(".direct-open").first().waitFor({ state: "attached", timeout: 30_000 })
    await page.evaluate(() => document.querySelector(".direct-open")?.click())
    const shows = await ate(async () => (await page.evaluate(() => document.body.textContent ?? "")).includes("a ultima linha do Bruno"), 60_000)
    check(`${name}: the conversation with Bruno shows his last line`, shows >= 0)
    await centreCheck(page, name, "conversation open")
    await context.close()
  }
  const errors = log.filter((l) => l.includes("PAGEERROR"))
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "))
} catch (error) {
  check("the script reached the end", false, String(error?.message ?? error).split("\n")[0])
}

await cleanUp(resumo() ? 0 : 1)
