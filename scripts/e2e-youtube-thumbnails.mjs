/**
 * YouTube thumbnails when the link is pasted and sent at once, live.
 *
 *   node scripts/e2e-youtube-thumbnails.mjs      (requires `npm run build` first)
 *   BROWSERS=chromium,firefox,webkit node scripts/e2e-youtube-thumbnails.mjs
 *
 * The bug (21/11/2026): "many YouTube thumbnails are still blank".
 *
 * Root cause: the composer sent the link card in whatever state it was at the
 * moment of Enter. The preview (title and thumbnail) only arrives about one
 * second after the address appears (a 700 ms typing delay, then the host
 * round trip and the shrink), and nothing fills the card after the message
 * leaves. Paste and Enter, which is how people share a video, sent either a
 * card with no thumbnail, forever, or no card at all when Enter landed before
 * the card was born (it is set from an effect, a render after the text).
 * Measured before the fix: 0 of 7 pasted videos with a thumbnail, 6 of them
 * plain text. The earlier scripts never caught it: they waited for the
 * thumbnail in the compose box before pressing Enter.
 *
 * Each browser in `BROWSERS` gets one account. The first creates a community
 * and invites the others. Each account posts every URL form below, pressing
 * Enter right after the paste, and every other account must see the
 * thumbnail in bytes. Then each page reloads and the thumbnails must persist.
 *
 * Disposable homeserver on ports 8506 and 8507, never production. The title
 * and thumbnail come from the homeserver, which needs Internet for oEmbed and
 * i.ytimg.com.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, ate, contasDoServidor, criarCanal, dentro, espera, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const PHRASE = "frase-de-verificacao-2026"
const COMPOSER = 'textarea[placeholder="Escreve uma mensagem"]'
const SHOTS = process.env.SHOTS ?? join(RAIZ, "capturas", "youtube-thumbnails")
mkdirSync(SHOTS, { recursive: true })
mkdirSync(join(RAIZ, ".verify-data"), { recursive: true })

const ENGINES = { chromium, firefox, webkit }
const BROWSERS = (process.env.BROWSERS ?? "chromium,chromium").split(",").map((b) => b.trim()).filter(Boolean)

/** Real, public videos in the URL forms people paste. */
const URLS = [
  ["watch", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ["youtu.be-si", "https://youtu.be/jNQXAC9IVRw?si=Xk3vJqPzLm8aB2cD"],
  ["shorts", "https://www.youtube.com/shorts/aqz-KE-bpKQ"],
  ["mobile-t", "https://m.youtube.com/watch?v=kJQP7kiw5Fk&t=42s"],
  ["music", "https://music.youtube.com/watch?v=9bZkp7q19f0&si=abc123"],
  ["live", "https://www.youtube.com/live/aqz-KE-bpKQ?si=abc123"],
]
/** `ONLY=watch,shorts` keeps those forms only: for a quick look while debugging. */
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean)
if (ONLY.length > 0) URLS.splice(0, URLS.length, ...URLS.filter(([form]) => ONLY.includes(form)))
/** Only the first poster sends every form; the others send one each, enough to prove the path per browser. */
const URLS_PER_OTHER = 1

const { check, resumo } = verificador()

/** Paste and press Enter at once: what a person does. Never waits for the preview. */
async function pasteAndSend(page, tag, url) {
  const box = page.locator(COMPOSER)
  await box.click()
  await box.fill(`${tag} ${url}`)
  await box.press("Enter")
  // The box empties when the message leaves; if it did not, Enter was swallowed.
  await ate(async () => (await box.inputValue()) === "", 20_000)
}

async function thumbOf(page, tag, ms = 60_000) {
  const message = page.locator(".message", { hasText: tag }).last()
  const facade = message.locator(".video-facade").first()
  const arrived = await message.waitFor({ timeout: ms }).then(() => true, () => false)
  if (!arrived) return { arrived, src: null }
  await ate(async () => (await facade.locator(".facade-thumb").count()) > 0, 20_000)
  const src = await facade.locator(".facade-thumb").getAttribute("src", { timeout: 2000 }).catch(() => null)
  return { arrived, src }
}

const isBytes = (src) => /^(data:image\/|blob:)/.test(String(src))

const srv = await levantarServidor({ frente: 8506, servidor: 8507, etiqueta: "youtube-thumbnails" })
console.log(`server ${srv.NOME}; browsers ${BROWSERS.join(", ")}`)
const opened = []
async function cleanup(code) {
  for (const b of opened) await b.close().catch(() => {})
  srv.fechar()
  process.exit(code)
}

try {
  const people = []
  const names = ["Ana", "Bruno", "Carla", "Duarte"]
  for (const [i, engine] of BROWSERS.entries()) {
    const browser = await ENGINES[engine].launch({ headless: true })
    opened.push(browser)
    const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
    // The click on a thumbnail opens youtube.com; keep it off the network.
    await ctx.route(/^https:\/\/(www\.)?youtube\.com\//, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>YouTube (script)</title>" }),
    )
    const page = await ctx.newPage()
    const errors = []
    page.on("pageerror", (e) => errors.push(String(e)))
    if (process.env.DEBUG) {
      page.on("console", (m) => console.log(`  [${engine} console] ${m.text().slice(0, 200)}`))
      page.on("websocket", (ws) => {
        const show = (way) => (f) => {
          const text = typeof f.payload === "string" ? f.payload : ""
          if (text.includes("link.preview")) console.log(`  [${engine} ws ${way}] ${text.slice(0, 160)}`)
        }
        ws.on("framesent", show("out"))
        ws.on("framereceived", show("in"))
      })
    }
    const name = names[i] ?? `P${i}`
    await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await criarConta(page, { nome: name, frase: PHRASE, servidor: srv.NOME })
    await dentro(page)
    people.push({ name, engine, page, errors })
  }
  const addresses = contasDoServidor(srv.base)

  const [host, ...guests] = people
  await criarCanal(host.page, "videos")
  for (const [i, guest] of guests.entries()) {
    check(`${host.name} invites ${guest.name} (${guest.engine})`, await convidar(host.page, "videos", addresses[i + 1]))
    check(`${guest.name} accepts`, await aceitarConvite(guest.page, "videos", { espera: 60_000 }))
  }
  for (const p of people) await abrirCanal(p.page, "videos")
  await espera(1500)

  const sent = []
  for (const [pi, poster] of people.entries()) {
    const list = pi === 0 ? URLS : URLS.slice(pi % URLS.length, (pi % URLS.length) + URLS_PER_OTHER)
    for (const [form, url] of list) {
      const tag = `yt-${poster.name.toLowerCase()}-${form}`
      await pasteAndSend(poster.page, tag, url)
      sent.push({ tag, form, poster })
    }
  }

  for (const { tag, form, poster } of sent) {
    for (const reader of people) {
      const { arrived, src } = await thumbOf(reader.page, tag)
      const who = reader === poster ? `${reader.name} (own)` : reader.name
      check(`${form} from ${poster.name} (${poster.engine}): ${who} on ${reader.engine} sees the thumbnail`, arrived && isBytes(src), String(src).slice(0, 30))
    }
  }

  for (const p of people) {
    await p.page.screenshot({ path: join(SHOTS, `live-${p.engine}-${p.name.toLowerCase()}.png`) })
  }

  // A thumbnail that only lived in the interface would vanish here.
  for (const p of people) {
    await p.page.reload({ waitUntil: "domcontentloaded" })
    await dentro(p.page)
    await abrirCanal(p.page, "videos")
    await espera(1500)
  }
  for (const { tag, form, poster } of sent) {
    for (const reader of people) {
      const { arrived, src } = await thumbOf(reader.page, tag, 30_000)
      check(`after reload, ${reader.name} on ${reader.engine} still sees ${form} from ${poster.name}`, arrived && isBytes(src), String(src).slice(0, 30))
    }
  }
  for (const p of people) {
    await p.page.locator(".message", { hasText: sent[0].tag }).last().scrollIntoViewIfNeeded().catch(() => {})
    await p.page.screenshot({ path: join(SHOTS, `reload-${p.engine}-${p.name.toLowerCase()}.png`) })
  }

  for (const p of people) check(`no page errors for ${p.name} (${p.engine})`, p.errors.length === 0, p.errors.slice(0, 2).join(" | "))
  await cleanup(resumo() ? 0 : 1)
} catch (error) {
  console.error(error)
  await cleanup(2)
}
