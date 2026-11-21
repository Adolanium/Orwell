/**
 * The call card's "⋯" and its voice wave, measured in a real layout engine.
 *
 *   node scripts/measure-call-card.mjs
 *   node scripts/measure-call-card.mjs --label before --shots <dir>
 *
 * jsdom applies no stylesheets, so whether two absolutely positioned pieces of
 * the card land on each other is a question only a browser answers. This page
 * mounts the real `CallPanel` (fake call engine, no server, no permission
 * dialogs: Chromium runs with its fake media device and fake media UI) and
 * measures, on every card, the bounding boxes of:
 *
 *   - `.call-chip-mais`, the person's "⋯" menu button;
 *   - `.call-chip-onda`, the wave that draws the person's voice level.
 *
 * The matrix: the voice room and the strip above a conversation, 1280 and 390 px wide (390 as a touch phone, where the "⋯" is
 * always visible), the Dark, Light and Aurora themes, short and long names,
 * silent and speaking (`--voz` written by hand, so captures are deterministic),
 * and normal and reduced motion. Fails when, on any card:
 *
 *   1. the two boxes intersect (by more than a hair: 0.5 px);
 *   2. the "⋯" target is smaller than 44 × 44 px;
 *   3. the "⋯" or the wave leaves the card;
 *   3a. the "⋯" target reaches the volume slider or the name label;
 *   4. with reduced motion, the wave stops moving with the voice, or moves at
 *      full speed (it must still move, only slower).
 *
 * `--shots <dir>` writes one PNG per case, named
 * `<label>-<width>-<mode>-<theme>-<names>-<speech>.png`.
 */
import { build } from "esbuild"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..")
const OUT = join(HERE, ".saida-call-card")
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const LABEL = option("--label", "after")
const SHOTS = option("--shots", null)
const TOLERANCE = 0.5
const MIN_TARGET = 44

mkdirSync(OUT, { recursive: true })
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const ENTRY = join(OUT, "entry.tsx")
writeFileSync(
  ENTRY,
  `
import { createRoot } from "react-dom/client"
import { CallPanel } from ${JSON.stringify(join(ROOT, "packages/ui/src/screens/call/CallPanel.js"))}
import ${JSON.stringify(join(ROOT, "packages/ui/src/styles.css"))}

const query = new URLSearchParams(location.search)
const SHORT = ["Ana", "Rui", "Eva"]
const LONG = [
  "Maximiliana Albuquerque de Vasconcelos Sobral",
  "Bartolomeu Constantino Figueiredo Magalhães",
  "Wilhelmina Theodora von Hohenzollern-Sigmaringen",
]
const NAMES = query.get("names") === "long" ? LONG : SHORT

const engine = {
  setMuted() {},
  setCameraOff() {},
  active: false,
  tectoDePartilha: 6,
  podePartilharEcra: true,
  medirLimiteDeVideo: () => Promise.resolve(null),
  startScreenShare: () => Promise.resolve(false),
  stopScreenShare: () => Promise.resolve(),
}

const participants = NAMES.map((name, i) => ({
  address: "@p" + i + ":s",
  connected: true,
  stream: null,
  video: false,
  encrypted: true,
  micMuted: false,
  screen: null,
}))

function Demo() {
  return (
    <main className="main" style={{ height: "100vh" }}>
        <CallPanel
          call={engine}
          channel="!room:s"
          participants={participants}
          localStream={null}
          selfLabel={query.get("names") === "long" ? "Eleutério Montenegro Cavaleiro" : "Eu"}
          selfProfile={{ displayName: "Eu", donations: [] }}
          nameFor={(who) => NAMES[participants.findIndex((p) => p.address === who)] ?? who}
          directory={new Map()}
          onToggleMic={() => {}}
          onToggleSound={() => {}}
          onLeave={() => {}}
          menuDaPessoa={() => null}
          modo={query.get("mode") === "strip" ? "faixa" : "sala"}
        />
    </main>
  )
}

document.documentElement.dataset.theme = query.get("theme") ?? "escuro"
createRoot(document.getElementById("root")).render(<Demo />)

window.__voice = (value) => {
  for (const card of document.querySelectorAll(".call-chip")) card.style.setProperty("--voz", String(value))
}

/** Every card, with the boxes of its "⋯" and its wave. */
window.__measure = () =>
  [...document.querySelectorAll(".call-chip")].map((card) => {
    const box = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }
    }
    return {
      name: card.querySelector(".call-chip-name")?.textContent ?? "",
      card: box(card),
      more: box(card.querySelector(".call-chip-mais")),
      wave: box(card.querySelector(".call-chip-onda")),
      volume: box(card.querySelector(":scope > .chip-volume")),
      labels: box(card.querySelector(".call-chip-labels")),
    }
  })
`,
  "utf8",
)

await build({
  entryPoints: { page: ENTRY, aurora: join(ROOT, "packages/ui/src/styles-aurora.css") },
  bundle: true,
  outdir: OUT,
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".json": "json", ".woff2": "file" },
  external: ["@sapphi-red/*"],
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(OUT, "index.html"),
  // The viewport meta of the real app: without it a mobile context lays the page out at 980 px and zooms out.
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="page.css">` +
    `<link id="folha-aurora" rel="stylesheet" href="aurora.css" media="not all">` +
    `<body><div id="root"></div><script>
      if (new URLSearchParams(location.search).get("theme") === "aurora") document.getElementById("folha-aurora").media = "all"
    </script><script src="page.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
})

const results = []
const check = (label, ok, detail = "") => {
  results.push(ok)
  if (!ok || process.env.VERBOSE) console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}

const intersection = (a, b) => {
  const w = Math.min(a.right, b.right) - Math.max(a.x, b.x)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? { w: +w.toFixed(2), h: +h.toFixed(2) } : null
}
const inside = (inner, outer) =>
  inner.x >= outer.x - TOLERANCE &&
  inner.y >= outer.y - TOLERANCE &&
  inner.right <= outer.right + TOLERANCE &&
  inner.bottom <= outer.bottom + TOLERANCE

const VIEWPORTS = [
  { width: 1280, height: 900, touch: false },
  { width: 390, height: 844, touch: true },
]
const THEMES = ["escuro", "claro", "aurora"]
const NAME_SETS = ["short", "long"]
// "room" is the open voice room (the card grid); "strip" is the call above a conversation.
const MODES = ["room", "strip"]

async function open({ width, height, touch }, theme, names, mode = "room", reducedMotion = "no-preference") {
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: touch ? 2 : 1,
    reducedMotion,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))
  await page.goto(`file://${join(OUT, "index.html")}?theme=${theme}&names=${names}&mode=${mode}`)
  await page.waitForSelector(".call-chip", { timeout: 15_000 })
  await page.evaluate(() => document.fonts.ready)
  return { ctx, page, errors }
}

let cases = 0
for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    for (const names of NAME_SETS) {
     for (const mode of MODES) {
      const { ctx, page, errors } = await open(viewport, theme, names, mode)
      const where = `${viewport.width}px ${mode} ${theme} ${names}`
      check(`${where}: the page draws without errors`, errors.length === 0, errors[0] ?? "")

      for (const speech of ["silent", "speaking"]) {
        await page.evaluate((v) => window.__voice(v), speech === "speaking" ? 0.9 : 0)
        // On a desktop the "⋯" only shows on hover: hover the first card so the
        // capture shows what a person sees when reaching for the menu.
        // The first card is our own, which has no menu: hover the second.
        if (!viewport.touch) await page.hover(".call-chip >> nth=1", { position: { x: 12, y: 12 } })
        await page.waitForTimeout(250)
        const cards = await page.evaluate(() => window.__measure())
        cases++

        // Our own card has no "⋯"; every other card has both.
        check(
          `${where} ${speech}: every other person's card has a "⋯" and a wave`,
          cards.length === 4 && cards.slice(1).every((c) => c.more && c.wave),
          `${cards.length} cards`,
        )
        for (const c of cards) {
          if (!c.more || !c.wave) continue
          const at = `${where} ${speech} [${c.name.slice(0, 24)}]`
          const overlap = intersection(c.more, c.wave)
          check(
            `${at}: the "⋯" and the wave do not overlap`,
            !overlap || overlap.w <= TOLERANCE || overlap.h <= TOLERANCE,
            overlap ? `overlap ${overlap.w}×${overlap.h} px; ⋯ at ${c.more.x.toFixed(1)},${c.more.y.toFixed(1)} ${c.more.w}×${c.more.h}, wave at ${c.wave.x.toFixed(1)},${c.wave.y.toFixed(1)} ${c.wave.w}×${c.wave.h}` : "",
          )
          // The 44 px target must not reach the volume slider nor the name label.
          for (const [piece, other] of [["volume slider", c.volume], ["name label", c.labels]]) {
            if (!other) continue
            const hit = intersection(c.more, other)
            check(
              `${at}: the "⋯" and the ${piece} do not overlap`,
              !hit || hit.w <= TOLERANCE || hit.h <= TOLERANCE,
              hit ? `overlap ${hit.w}×${hit.h} px; ⋯ at ${c.more.x.toFixed(1)},${c.more.y.toFixed(1)} ${c.more.w}×${c.more.h}, ${piece} at ${other.x.toFixed(1)},${other.y.toFixed(1)} ${other.w}×${other.h}` : "",
            )
          }
          check(`${at}: the "⋯" target is at least ${MIN_TARGET} px`, c.more.w >= MIN_TARGET && c.more.h >= MIN_TARGET, `${c.more.w}×${c.more.h}`)
          check(`${at}: the "⋯" and the wave stay inside the card`, inside(c.more, c.card) && inside(c.wave, c.card))
        }

        if (SHOTS) await page.screenshot({ path: join(SHOTS, `${LABEL}-${viewport.width}-${mode}-${theme}-${names}-${speech}.png`) })
      }
      await ctx.close()
     }
    }
  }
}

/*
  Reduced motion: the wave keeps moving with the voice, only slower. Read the
  first card's tallest bar right after the level jumps, and again once it has
  settled: with full-speed motion the two readings are equal (the bar follows
  the level in the same frame); with reduced motion the first reading lags
  behind and the second reaches the top.
*/
async function waveResponse(reducedMotion) {
  const { ctx, page } = await open(VIEWPORTS[0], "escuro", "short", "room", reducedMotion)
  const reading = await page.evaluate(async () => {
    const bar = () => document.querySelectorAll(".call-chip-onda .onda-barra")[1]
    const height = () => bar().getBoundingClientRect().height
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
    window.__voice(0)
    await new Promise((r) => setTimeout(r, 900))
    const rest = height()
    window.__voice(1)
    await frame()
    await frame()
    const soon = height()
    await new Promise((r) => setTimeout(r, 1200))
    return { rest, soon, settled: height(), box: bar().parentElement.getBoundingClientRect().height }
  })
  await ctx.close()
  return reading
}
const normal = await waveResponse("no-preference")
const reduced = await waveResponse("reduce")
check(
  "normal motion: the wave follows the voice at once",
  normal.soon >= normal.settled - TOLERANCE && normal.settled > normal.rest * 2,
  JSON.stringify(normal),
)
check(
  "reduced motion: the wave still rises with the voice",
  reduced.settled > reduced.rest * 2,
  JSON.stringify(reduced),
)
check(
  "reduced motion: and it rises slower than with normal motion",
  reduced.soon < reduced.settled - 1,
  JSON.stringify(reduced),
)

await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed over ${cases} layouts (label "${LABEL}")`)
process.exit(failed ? 1 : 0)
