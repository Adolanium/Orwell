/**
 * The screen guard for every e2e: the app is never covered.
 *
 *   import "./screen-guard.mjs"      (first import of the script, before playwright launches)
 *
 * Why it exists (1.3.27). In 1.3.26 a throw in the Shell left an empty `#root`
 * over the dark background: a black screen, with the sync still running below.
 * A script that only waits for its text never sees it: the vault fills, the
 * checks pass, and the person sees nothing. This guard looks at what a finger
 * would hit.
 *
 * How it works. Importing this file wraps `launch` (and `launchPersistentContext`)
 * of the three playwright engines, so every context and every page the script
 * opens is watched with no other change to the script. Every `SAMPLE_MS` it asks
 * each page for `document.elementFromPoint` at the centre of the viewport. A
 * sample is BAD when the element is:
 *   - nothing, `html`, `body` or `#root` itself: the background shows;
 *   - outside `#root` (and not the version pill, `[data-faixa]`);
 *   - a veil or scrim itself (`.overlay`, `*-scrim`, `.context-veu`): a sheet
 *     that should be on top of it is not;
 *   - anywhere while the crash card is on screen ("Algo correu mal." /
 *     "Something went wrong.").
 * A page that is navigating (the evaluate throws), or not on `/app`, is not
 * sampled. A bad state that lasts `GRACE_MS` or more is a finding: a reload
 * paints a dark frame for a moment, a black screen stays.
 *
 * Every finding names the page and the last step the script printed (`ok` or
 * `FALHA` line), so "em cada passo" holds without touching each check. At exit,
 * findings print as FALHA lines and the exit code becomes 1.
 *
 * Local only: it reads the page, never clicks, never changes it.
 */
import { chromium, firefox, webkit } from "playwright"

const SAMPLE_MS = Number(process.env.E2E_SCREEN_SAMPLE_MS ?? 400)
const GRACE_MS = Number(process.env.E2E_SCREEN_GRACE_MS ?? 4_000)
const VEILS = [".overlay", ".people-scrim", ".members-scrim", ".drawer-scrim", ".context-veu", "[class*='-scrim']", "[class*='veu']"]
const CRASH_TITLES = ["Algo correu mal.", "Something went wrong."]

const findings = []
const watched = new WeakSet()
let lastStep = "(before the first check)"
let samples = 0

// The last step the script printed: every script logs its checks as "  ok  …" or " FALHA …".
const originalLog = console.log
console.log = (...args) => {
  const line = typeof args[0] === "string" ? args[0] : ""
  if (/^\s*(ok|FALHA)\s/.test(line)) lastStep = line.trim().replace(/\s+/g, " ").slice(0, 160)
  originalLog(...args)
}

/** What the centre of the page hits, read in the page. `null` while it cannot be read. */
async function centre(page) {
  return page.evaluate(
    ({ veils, crashTitles }) => {
      if (!location.pathname.startsWith("/app")) return { skip: true }
      const x = Math.floor(innerWidth / 2)
      const y = Math.floor(innerHeight / 2)
      const el = document.elementFromPoint(x, y)
      const root = document.getElementById("root")
      const describe = (node) => (node ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${typeof node.className === "string" && node.className ? `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}` : ""}` : "nothing")
      const crash = [...document.querySelectorAll(".gate-card h1")].some((h) => crashTitles.includes((h.textContent ?? "").trim()))
      if (crash) return { bad: "crash card", what: describe(el) }
      if (!el || el === document.documentElement || el === document.body || el === root) return { bad: "background", what: describe(el) }
      if (!root?.contains(el) && !el.closest("[data-faixa]")) return { bad: "outside the app", what: describe(el) }
      if (veils.some((s) => el.matches(s))) return { bad: "veil", what: describe(el) }
      return { ok: true }
    },
    { veils: VEILS, crashTitles: CRASH_TITLES },
  )
}

/** Watch one page until it closes. */
export function guardPage(page, label = "page") {
  if (watched.has(page)) return
  watched.add(page)
  let badSince = 0
  let reported = false
  let busy = false
  const timer = setInterval(async () => {
    if (busy || page.isClosed()) return
    busy = true
    try {
      const seen = await centre(page).catch(() => null)
      if (!seen || seen.skip) return
      samples += 1
      if (seen.ok) {
        badSince = 0
        reported = false
        return
      }
      const now = Date.now()
      if (!badSince) badSince = now
      if (!reported && now - badSince >= GRACE_MS) {
        reported = true
        findings.push(`${label}: ${seen.bad} at the centre (${seen.what}) for ${Math.round((now - badSince) / 1000)} s, after: ${lastStep}`)
        originalLog(` FALHA [screen guard] ${findings.at(-1)}`)
      }
    } finally {
      busy = false
    }
  }, SAMPLE_MS)
  timer.unref()
  page.once("close", () => clearInterval(timer))
}

/** Watch every page of a context, the ones open now and the ones still to come. */
export function guardContext(context, label = "context") {
  let n = 0
  const add = (page) => guardPage(page, `${label}#${++n}`)
  context.on("page", add)
  for (const page of context.pages()) add(page)
}

function wrapBrowser(browser, engine) {
  let n = 0
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (...args) => {
    const context = await newContext(...args)
    guardContext(context, `${engine} context ${++n}`)
    return context
  }
  const newPage = browser.newPage.bind(browser)
  browser.newPage = async (...args) => {
    const page = await newPage(...args)
    guardPage(page, `${engine} page ${++n}`)
    return page
  }
  return browser
}

for (const [engine, type] of Object.entries({ chromium, firefox, webkit })) {
  const launch = type.launch.bind(type)
  type.launch = async (...args) => wrapBrowser(await launch(...args), engine)
  const persistent = type.launchPersistentContext.bind(type)
  type.launchPersistentContext = async (...args) => {
    const context = await persistent(...args)
    guardContext(context, `${engine} persistent`)
    return context
  }
}

/**
 * One explicit probe, for a script that checks the centre at a step of its own:
 * `{ ok, detail }`. It waits up to `ms` for the centre to be inside the app,
 * so a step taken mid-paint does not fail on a frame.
 */
export async function centreInsideApp(page, ms = GRACE_MS) {
  const end = Date.now() + ms
  let last = null
  do {
    last = await centre(page).catch(() => null)
    if (last?.ok) return { ok: true, detail: "" }
    await new Promise((resolve) => setTimeout(resolve, 200))
  } while (Date.now() < end)
  return { ok: false, detail: last ? (last.skip ? "not on /app" : `${last.bad}: ${last.what}`) : "the page did not answer" }
}

/** The findings so far, for a script that wants them in its own summary. */
export function screenFindings() {
  return [...findings]
}

process.on("exit", () => {
  if (findings.length) {
    originalLog(` FALHA [screen guard] the screen was covered ${findings.length} time(s); exit code 1`)
    process.exitCode = 1
  } else {
    originalLog(`  ok   [screen guard] the centre of the screen was inside the app in all ${samples} samples`)
  }
})
