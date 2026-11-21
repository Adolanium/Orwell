// The opening's exit veil ends on its own, with the page timers frozen.
//
// Bug of 21/11/2026 ("the background stays in front"): the exit copy of the
// splash (`abertura-viva.ts`) and the hold that hides the app under it were
// ended only by two `setTimeout`s. A tab that froze in between kept them up
// over a live app. The fix gives the hold a CSS deadline (`veil-deadline` in
// `pele.css`, `VEIL_DEADLINE_MS`) and cleans up when the page comes back.
//
// This script measures it in real engines, which the unit tests cannot (jsdom
// runs no CSS animations):
//
//   1. serves a `dist` with `vite preview` on 127.0.0.1 and opens the app with
//      no account (it stays on the gate, no homeserver);
//   2. freezes every `setTimeout` scheduled while `html.abertura-a-segurar`
//      is on, which is what a frozen tab does to the exit's timers;
//   3. samples every frame, from the moment the copy goes up: the copy's
//      opacity, `#root`'s opacity and the classes on <html>;
//   4. checks, in both motion modes: the hold lasts until the deadline, then
//      the copy fades to 0 and the app to 1, and the fade moves (frames with
//      opacity strictly between 0 and 1), slower with reduced motion;
//   5. then fires `focus`, as a page coming back, and checks the copy is gone
//      from the DOM and the classes are clear.
//
// Usage:
//   node scripts/opening-veil-deadline-proof.mjs [--dist apps/web/dist] [--port 5397]
//        [--engines chromium,firefox,webkit] [--themes escuro,claro,aurora] [--expect-stuck]
//
// `--expect-stuck`: for a `dist` from before the fix, the control: passes when
// the copy is still fully up 5 s later.
import { spawn } from "node:child_process"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, firefox, webkit } from "playwright"

const REPO = fileURLToPath(new URL("..", import.meta.url))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const DIST = resolve(arg("--dist", join(REPO, "apps/web/dist")))
const PORT = Number(arg("--port", "5397"))
const ENGINES = arg("--engines", "chromium,firefox,webkit").split(",")
// Aurora has its own copy of the universal reduced-motion rule, with a higher
// specificity: the one the deadline's duration must outrank.
const THEMES = arg("--themes", "escuro,claro,aurora").split(",")
const EXPECT_STUCK = process.argv.includes("--expect-stuck")
const DEADLINE_MS = 3000
const SAMPLE_MS = 5000

const preview = spawn(
  "npx",
  ["vite", "preview", "--outDir", DIST, "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
  { cwd: join(REPO, "apps/web"), stdio: ["ignore", "pipe", "pipe"] },
)
await new Promise((ready, fail) => {
  const t = setTimeout(() => fail(new Error("vite preview did not start")), 20_000)
  preview.stdout.on("data", (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t)
      ready()
    }
  })
  preview.on("exit", (code) => fail(new Error(`vite preview exited with ${code}`)))
})
const APP = `http://127.0.0.1:${PORT}/app/?lingua=en`

/** In the page, before anything: freeze the exit's timers and sample each frame. */
function instrument(sampleMs) {
  const realSetTimeout = window.setTimeout.bind(window)
  window.__frozen = 0
  window.setTimeout = function (fn, ms, ...rest) {
    if (document.documentElement.classList.contains("abertura-a-segurar")) {
      window.__frozen += 1
      return 2 ** 30 + window.__frozen
    }
    return realSetTimeout(fn, ms, ...rest)
  }
  window.__samples = []
  let upAt = null
  const frame = () => {
    const veil = document.querySelector(".abertura-veu")
    if (veil && upAt === null) upAt = performance.now()
    if (upAt !== null) {
      const root = document.getElementById("root")
      window.__samples.push({
        t: Math.round(performance.now() - upAt),
        veil: veil ? Number(getComputedStyle(veil).opacity) : null,
        veilBg: veil ? getComputedStyle(veil).backgroundColor : null,
        root: root ? Number(getComputedStyle(root).opacity) : null,
        cls: document.documentElement.className,
      })
      if (performance.now() - upAt > sampleMs) return
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

let failures = 0
const check = (ok, label) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`)
  if (!ok) failures += 1
}

try {
  for (const name of ENGINES) {
    const engine = { chromium, firefox, webkit }[name]
    const browser = await engine.launch({ headless: true })
    try {
      for (const theme of THEMES) for (const reducedMotion of ["no-preference", "reduce"]) {
        const tag = `${name} ${theme} ${reducedMotion}`
        const context = await browser.newContext({ reducedMotion, viewport: { width: 1280, height: 800 } })
        await context.addInitScript((tema) => localStorage.setItem("enclave.prefs", JSON.stringify({ tema })), theme)
        await context.addInitScript(instrument, SAMPLE_MS)
        const page = await context.newPage()
        await page.goto(APP)
        // Polled from here, not with `waitForFunction`: its polling runs on the
        // page's `setTimeout`, which is frozen.
        const until = Date.now() + 30_000
        while (!(await page.evaluate((ms) => window.__samples.at(-1)?.t >= ms, SAMPLE_MS))) {
          if (Date.now() > until) throw new Error(`${tag}: the veil never went up`)
          await new Promise((r) => setTimeout(r, 200))
        }
        const samples = await page.evaluate(() => window.__samples)
        const frozen = await page.evaluate(() => window.__frozen)
        const before = samples.filter((s) => s.t < DEADLINE_MS - 100)
        const after = samples.filter((s) => s.t > DEADLINE_MS + 500)
        const moving = samples.filter((s) => s.veil !== null && s.veil > 0.02 && s.veil < 0.98)
        const fadeStart = samples.find((s) => s.veil !== null && s.veil < 0.98)?.t ?? null
        const fadeEnd = samples.find((s) => s.veil !== null && s.veil <= 0.001)?.t ?? null
        console.log(
          `${tag}: ${samples.length} frames, ${frozen} timers frozen, veil background ${samples[0]?.veilBg}, ` +
            `fade ${fadeStart} -> ${fadeEnd} ms, ${moving.length} frames mid-fade`,
        )
        check(frozen > 0, `${tag}: the exit's timers were frozen`)
        check(before.length > 0 && before.every((s) => s.veil === 1 && s.root === 0), `${tag}: the hold holds before the deadline`)
        if (EXPECT_STUCK) {
          check(after.length > 0 && after.every((s) => s.veil === 1 && s.root === 0), `${tag}: control, the veil stays up`)
        } else {
          check(fadeStart !== null && fadeStart >= DEADLINE_MS - 50, `${tag}: the fade starts at the deadline (${fadeStart} ms)`)
          check(after.length > 0 && after.every((s) => s.veil === 0 && s.root === 1), `${tag}: after the deadline the copy is at 0 and the app at 1`)
          check(moving.length > 0, `${tag}: the fade moves (${moving.length} frames between 0 and 1)`)
          if (reducedMotion === "reduce") check(fadeEnd - fadeStart >= 250, `${tag}: slower with reduced motion (${fadeEnd - fadeStart} ms)`)
          check(samples[0]?.veilBg === "rgba(0, 0, 0, 0)" || samples[0]?.veilBg === "transparent", `${tag}: the copy has no background`)
          await page.evaluate(() => window.dispatchEvent(new Event("focus")))
          const state = await page.evaluate(() => ({
            veils: document.querySelectorAll(".abertura-veu").length,
            cls: document.documentElement.className,
          }))
          check(state.veils === 0 && !/abertura-/.test(state.cls), `${tag}: a page coming back cleans up the DOM`)
        }
        check((await page.evaluate(() => document.documentElement.dataset.theme)) === theme, `${tag}: the theme applied`)
        await context.close()
      }
    } finally {
      await browser.close()
    }
  }
} finally {
  preview.kill()
}
console.log(failures === 0 ? "ALL OK" : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
