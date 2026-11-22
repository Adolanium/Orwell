/**
 * The mobile notice covers nothing: real layout in Chromium and WebKit, at
 * 320, 390 and 720x360, on every tab. Closed, it stays closed; a narrow
 * window with a mouse never sees it.
 *
 *   npm run build && node scripts/e2e-mobile-notice.mjs
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, webkit } from "playwright"
import { criarContaEEntrar } from "./conta.mjs"
import { levantarServidor } from "./frente-lenta.mjs"
import { appAberta, voltarUm } from "./separadores.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const home = await levantarServidor({ dist: join(ROOT, "apps/web/dist"), portaDaFrente: 8676, portaDoServidor: 8677, rede: { atrasoMs: 0, bytesPorSegundo: 1e9 }, prefixo: "orwell-mobile-notice-" })
let failed = 0
let passed = 0
const check = (ok, what, detail = "") => {
  if (ok) passed++
  else {
    failed++
    console.log("FAIL", what, detail)
  }
}

const measure = (page) =>
  page.evaluate(() => {
    const notice = document.querySelector(".mobile-notice")
    if (!notice) return { none: true }
    const n = notice.getBoundingClientRect()
    const over = []
    for (const el of document.querySelectorAll("#root *")) {
      if (el.contains(notice) || notice.contains(el)) continue
      if (!el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) continue
      const r = el.getBoundingClientRect()
      let { top, bottom } = r
      // Only the part that is painted: what a scroll box clips is not over anything.
      for (let up = el.parentElement; up; up = up.parentElement) {
        if (up.contains(notice)) break
        if (getComputedStyle(up).overflowY !== "visible") {
          const c = up.getBoundingClientRect()
          top = Math.max(top, c.top)
          bottom = Math.min(bottom, c.bottom)
        }
      }
      if (r.width < 1 || bottom - top < 1) continue
      if (r.left < n.right - 1 && r.right > n.left + 1 && top < n.bottom - 1 && bottom > n.top + 1) over.push(String(el.className?.baseVal ?? el.className).slice(0, 60) || el.tagName)
    }
    const b = notice.querySelector("button").getBoundingClientRect()
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
    const p = notice.querySelector("p")
    const tabs = document.querySelector(".separadores").getBoundingClientRect()
    return { over, top: n.top, button: [b.width, b.height], onTop: notice.contains(hit), clipped: p.scrollWidth > p.clientWidth + 1 || notice.scrollHeight > notice.clientHeight + 1, wide: document.documentElement.scrollWidth > innerWidth, tabsInside: tabs.bottom <= innerHeight + 1 && tabs.height >= 56 }
  })

try {
  for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await engine.launch()
    const phone = await browser.newContext({ viewport: { width: 1200, height: 900 }, isMobile: true, hasTouch: true, acceptDownloads: true, locale: "pt-PT" })
    const page = await phone.newPage()
    await page.goto(home.app)
    await criarContaEEntrar(page, { nome: engineName === "chromium" ? "Ana" : "Bia", servidor: home.nome })
    // The account is made at tablet width (saving its file needs the rail), then the screen becomes a phone.
    await page.setViewportSize({ width: 390, height: 844 })
    // Saving the file can leave Settings pushed: the notice lives over the lists.
    for (let i = 0; i < 3 && !(await page.locator(".separadores").count()); i++) {
      await voltarUm(page)
      await page.waitForTimeout(700)
    }
    check((await page.locator(".separadores").count()) === 1, `${engineName}: back on a list`)
    await page.locator(".mobile-notice").waitFor({ timeout: 15_000 }).catch(async (error) => {
      console.log("STATE", engineName, await page.evaluate(() => JSON.stringify({ width: innerWidth, client: document.documentElement.clientWidth, phone: matchMedia("(max-width: 840px)").matches, coarse: matchMedia("(pointer: coarse)").matches, both: matchMedia("(max-width: 840px) and (pointer: coarse)").matches, app: document.querySelector(".app")?.className, depth: document.querySelector(".app")?.getAttribute("data-profundidade"), tabs: !!document.querySelector(".separadores") })))
      throw error
    })
    const tabs = await page.locator(".separadores .separador").count()
    for (const [width, height] of [[320, 568], [390, 844], [720, 360]]) {
      await page.setViewportSize({ width, height })
      for (let i = 0; i < tabs; i++) {
        await page.locator(".separadores .separador").nth(i).click()
        await page.waitForTimeout(700)
        const at = `${engineName} ${width}x${height} tab ${i}`
        const m = await measure(page)
        check(!m.none, `${at}: the notice is there`)
        if (m.none) continue
        check(m.over.length === 0, `${at}: covers nothing`, [...new Set(m.over)].slice(0, 5).join(" | "))
        check(m.onTop, `${at}: nothing covers it`)
        check(m.button[0] >= 44 && m.button[1] >= 44, `${at}: 44 px to close`, m.button)
        check(!m.clipped && !m.wide, `${at}: all the text, no sideways scroll`)
        check(m.tabsInside, `${at}: the tabs stay on screen`)
        if (width !== 720 && i === 0 && process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, `notice-${engineName}-${width}.png`) })
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator(".mobile-notice button").click()
    check((await page.locator(".mobile-notice").count()) === 0, `${engineName}: closes`)
    check(await page.evaluate(() => localStorage.getItem("enclave.mobileNoticeClosed") === "1"), `${engineName}: remembers`)
    await phone.close()

    const narrow = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true, locale: "pt-PT" })
    const desk = await narrow.newPage()
    await desk.goto(home.app)
    await criarContaEEntrar(desk, { nome: engineName === "chromium" ? "Rui" : "Gil", servidor: home.nome })
    await desk.setViewportSize({ width: 700, height: 900 })
    await appAberta(desk)
    await desk.waitForTimeout(1500)
    check((await desk.locator(".mobile-notice").count()) === 0, `${engineName}: never on a narrow window with a mouse`)
    await browser.close()
  }
} catch (error) {
  failed++
  console.log("FAIL", String(error.stack).split("\n").filter((l) => !l.includes("node_modules")).slice(0, 6).join(" | "))
} finally {
  await home.fechar()
}
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
