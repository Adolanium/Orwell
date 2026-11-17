/**
 * The emoji picker, captured and measured in the real web app.
 *
 *   node --dns-result-order=ipv4first scripts/capturar-selector-emoji.mjs [--dist <apps/web/dist of any build>] [--etiqueta antes]
 *
 * Chromium and WebKit, desktop 1440 and phone 390 (touch), each with and
 * without reduced motion. For each: the picker as it opens, after the
 * "Gestures" tab, after the "Flags" tab, and scrolled to the end. What is
 * measured, so a broken grid is a number and not an impression:
 *  - the card inside the screen;
 *  - every drawn cell: at least 28 px each side, and no two cells overlapping;
 *  - every cell's glyph fits its cell (no glyph cut by the cell edge);
 *  - the cells drawn (a virtual list keeps it near a hundred).
 *  - Chromium only, every category: which font drew each emoji, read from the
 *    browser itself (CDP `CSS.getPlatformFontsForNode`). An emoji drawn by the
 *    system's emoji font is one that Windows 10 would draw as a square, or, for a
 *    flag, as two letters; the house font draws them the same everywhere.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8794 and 8795. Captures in
 * `.verify-data/selector-emoji/<etiqueta>-<time>/`.
 */
import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { criarCanal, dentro, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const arg = (nome, omissao) => {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : omissao
}
const ETIQUETA = arg("--etiqueta", "depois")
const DIST = resolve(arg("--dist", join(RAIZ, "apps/web/dist")))
const CAPTURAS = join(RAIZ, ".verify-data/selector-emoji", `${ETIQUETA}-${new Date().toISOString().replace(/[:.]/g, "-")}`)
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8794, servidor: 8795, sfu: 0, dist: DIST, etiqueta: "selector-emoji" })
const browsers = []

const CASOS = [
  { motor: chromium, nome: "chromium", largura: 1440, altura: 900 },
  { motor: chromium, nome: "chromium", largura: 390, altura: 844, telemovel: true },
  { motor: webkit, nome: "webkit", largura: 1440, altura: 900 },
  { motor: webkit, nome: "webkit", largura: 390, altura: 844, telemovel: true },
  // Short windows: Windows at 125-150 % scaling on a 1080p screen, after the frame and the taskbar.
  { motor: chromium, nome: "chromium", largura: 1280, altura: 600 },
  { motor: chromium, nome: "chromium", largura: 1280, altura: 480 },
  { motor: webkit, nome: "webkit", largura: 1280, altura: 480 },
]
const SO = process.argv.includes("--so-baixas") ? CASOS.filter((c) => c.altura <= 600) : CASOS

/** Geometry of the open picker, measured in the page. */
const medir = (page) =>
  page.evaluate(() => {
    const painel = document.querySelector(".emoji-panel")
    const grelha = document.querySelector(".emoji-grid")
    if (!painel || !grelha) return null
    const p = painel.getBoundingClientRect()
    const g = grelha.getBoundingClientRect()
    const celulas = [...grelha.querySelectorAll(".emoji-cell")]
    const caixas = celulas
      .map((c) => ({ c, r: c.getBoundingClientRect() }))
      .filter(({ r }) => r.bottom > g.top && r.top < g.bottom)
    let sobrepostas = 0
    let pequenas = 0
    let cortadas = 0
    for (let i = 0; i < caixas.length; i++) {
      const a = caixas[i].r
      if (a.width < 28 || a.height < 28) pequenas++
      // The glyph: a range over the text node, which is what is painted.
      const no = caixas[i].c.firstChild
      if (no) {
        const intervalo = document.createRange()
        intervalo.selectNodeContents(caixas[i].c)
        const t = intervalo.getBoundingClientRect()
        if (t.width > a.width + 1 || t.height > a.height + 6) cortadas++
      }
      for (let j = i + 1; j < Math.min(caixas.length, i + 12); j++) {
        const b = caixas[j].r
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (x > 1 && y > 1) sobrepostas++
      }
    }
    return {
      painel: { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) },
      grelha: { h: Math.round(g.height), rolagem: grelha.scrollHeight },
      dentroDoEcra: p.left >= 0 && p.top >= 0 && p.right <= innerWidth + 0.5 && p.bottom <= innerHeight + 0.5,
      desenhadas: celulas.length,
      visiveis: caixas.length,
      sobrepostas,
      pequenas,
      cortadas,
      exemplo: caixas.slice(0, 3).map(({ r }) => `${Math.round(r.width)}x${Math.round(r.height)}`),
      rolagemHorizontal: document.documentElement.scrollWidth > innerWidth + 1,
    }
  })

const ABAS = ["Rostos", "Gestos e pessoas", "Natureza", "Comida e bebida", "Actividades", "Viagens e lugares", "Objectos", "Símbolos", "Bandeiras"]

/** Chromium: the platform font of every cell of every category. Returns counts and the emoji not drawn by ours. */
async function fontesDasCasas(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("DOM.enable")
  await cdp.send("CSS.enable")
  await page.evaluate(() => document.fonts.ready)
  const porFonte = {}
  const foraDaNossa = []
  for (const aba of ABAS) {
    await page.locator(".emoji-tabs").getByRole("button", { name: aba, exact: true }).click()
    await page.waitForTimeout(150)
    // The font arrives with `swap`: wait until it is loaded before asking who drew what.
    await page.evaluate(() => document.fonts.load('20px "Orwell Emoji"', "😀").catch(() => []))
    const { root } = await cdp.send("DOM.getDocument", { depth: -1 })
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: ".emoji-grid .emoji-cell" })
    for (const nodeId of nodeIds) {
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
      const nome = fonts.map((f) => f.familyName).sort().join("+") || "(nenhuma)"
      porFonte[nome] = (porFonte[nome] ?? 0) + 1
      if (!fonts.some((f) => /Noto Color Emoji/i.test(f.familyName))) {
        const { node } = await cdp.send("DOM.describeNode", { nodeId, depth: 1 })
        foraDaNossa.push(`${aba}:${node.children?.[0]?.nodeValue ?? "?"}(${nome})`)
      }
    }
  }
  await cdp.detach()
  return { porFonte, foraDaNossa }
}

try {
  for (const caso of SO) {
    const id = `${caso.nome}-${caso.largura}${caso.altura <= 600 ? `x${caso.altura}` : ""}`
    const b = await caso.motor.launch({ headless: true })
    browsers.push(b)
    const ctx = await b.newContext({
      locale: "pt-PT",
      // The account and the channel are made at desktop width (the phone drawer is
      // proved elsewhere); the picker is then opened at the case's width.
      viewport: { width: 1440, height: 900 },
      ...(caso.telemovel ? { deviceScaleFactor: 2, hasTouch: true } : {}),
    })
    const page = await ctx.newPage()
    await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await criarConta(page, { nome: `Eva ${id}`, servidor: srv.NOME })
    await dentro(page)
    await criarCanal(page, `lagar-${id}`)
    await page.setViewportSize({ width: caso.largura, height: caso.altura })
    await page.locator('input[placeholder="Escreve uma mensagem"]').waitFor({ timeout: 30_000 })
    for (const reduzido of [false, true]) {
      const etiqueta = `${id}${reduzido ? "-reduzido" : ""}`
      await page.emulateMedia({ reducedMotion: reduzido ? "reduce" : "no-preference" })
      const abrir = page.getByRole("button", { name: "Emojis", exact: true }).first()
      const t0 = Date.now()
      if (caso.telemovel) await abrir.tap()
      else await abrir.click()
      await page.locator(".emoji-grid .emoji-cell").first().waitFor({ timeout: 15_000 })
      const abriuEm = Date.now() - t0
      await page.waitForTimeout(400)
      const passos = [["1-abre", null], ["2-gestos", "Gestos e pessoas"], ["3-bandeiras", "Bandeiras"], ["4-fim", "fim"]]
      for (const [passo, aba] of passos) {
        if (aba === "fim") {
          await page.locator(".emoji-grid").evaluate((el) => (el.scrollTop = el.scrollHeight))
          await page.locator(".emoji-grid").dispatchEvent("scroll")
        } else if (aba) {
          const aba_ = page.locator(".emoji-tabs").getByRole("button", { name: aba, exact: true })
          if (caso.telemovel) await aba_.tap()
          else await aba_.click()
        }
        await page.waitForTimeout(300)
        const m = await medir(page)
        await page.screenshot({ path: join(CAPTURAS, `${etiqueta}-${passo}.png`) })
        console.log(`   ${etiqueta} ${passo}:`, JSON.stringify(m))
        check(`${etiqueta} ${passo}: o cartão cabe no ecrã`, m?.dentroDoEcra === true, JSON.stringify(m?.painel))
        check(`${etiqueta} ${passo}: nenhuma casa sobreposta nem pequena`, m?.sobrepostas === 0 && m?.pequenas === 0, `sobrepostas ${m?.sobrepostas}, pequenas ${m?.pequenas}, ${m?.exemplo}`)
        check(`${etiqueta} ${passo}: nenhum glifo cortado`, m?.cortadas === 0, `cortadas ${m?.cortadas}`)
        check(`${etiqueta} ${passo}: sem rolagem horizontal`, m?.rolagemHorizontal === false)
      }
      console.log(`   ${etiqueta}: abriu em ${abriuEm} ms (do clique à primeira casa, pelo Playwright)`)
      if (process.argv.includes("--fontes") && caso.nome === "chromium" && caso.largura === 1440 && !reduzido) {
        const { porFonte, foraDaNossa } = await fontesDasCasas(page)
        console.log(`   ${etiqueta}: casas por fonte que as desenhou:`, JSON.stringify(porFonte))
        console.log(`   ${etiqueta}: fora da fonte da casa (${foraDaNossa.length}):`, foraDaNossa.join(" "))
        const bandeirasDoSistema = foraDaNossa.filter((e) => e.startsWith("Bandeiras:")).length
        check(`${etiqueta}: todas as bandeiras desenhadas pela fonte da casa`, bandeirasDoSistema === 0, `${bandeirasDoSistema} pelo sistema`)
        check(`${etiqueta}: nenhum emoji fica para o sistema`, foraDaNossa.length === 0, `${foraDaNossa.length}`)
        await page.locator(".emoji-tabs").getByRole("button", { name: "Bandeiras", exact: true }).click()
        await page.waitForTimeout(200)
        await page.screenshot({ path: join(CAPTURAS, `${etiqueta}-5-bandeiras-fonte.png`) })
      }
      await page.keyboard.press("Escape")
      await page.locator(".emoji-panel").waitFor({ state: "detached", timeout: 5_000 }).catch(() => {})
    }
    await b.close()
  }
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}
for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
console.log(`\nCapturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
