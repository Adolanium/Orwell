/**
 * The first frame on Aurora, with the Aurora sheet out of the main one.
 *
 *   node scripts/provar-primeiro-quadro-aurora.mjs --dist <apps/web/dist> [--referencia <dist with Aurora bundled>] [--atraso 1500]
 *
 * Since 1.3.20 the Aurora skin is its own file (`folha-da-aurora.ts`), written
 * by the head script only for whoever chose Aurora. This proves that the
 * first frame does not flash: a static server gives the dist at /app/ (no
 * homeserver: only the opening is drawn), the stored theme is Aurora, and an
 * init script records, from the first `requestAnimationFrame` (which runs
 * before the first paint), what each frame computes: the page and body
 * background, the body font, the opening's colours, and whether the Aurora
 * sheet is applied. `--atraso` holds the Aurora file that many ms, to prove it
 * blocks the first paint rather than arriving after it. With `--referencia`
 * the same is recorded on a dist where Aurora sits in the main sheet (the
 * 1.3.20 integration), and the first frames must be equal.
 *
 * Chromium, Firefox and WebKit. Local only: it serves files, nothing else.
 */
import { createServer } from "node:http"
import { readFileSync, existsSync, statSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { chromium, firefox, webkit } from "playwright"

const arg = (nome, omissao) => {
  const i = process.argv.indexOf(`--${nome}`)
  return i > 0 ? process.argv[i + 1] : omissao
}
const casa = (p) => resolve(String(p).replace(/^~/, process.env.HOME ?? "~"))
const DIST = casa(arg("dist", "apps/web/dist"))
const REFERENCIA = arg("referencia") ? casa(arg("referencia")) : null
const ATRASO = Number(arg("atraso", 1500))
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" }

function servir(dist) {
  return new Promise((ok) => {
    const s = createServer((pedido, resposta) => {
      const caminho = decodeURIComponent(new URL(pedido.url, "http://x").pathname).replace(/^\/app\/?/, "/")
      let f = join(dist, caminho)
      if (!existsSync(f) || statSync(f).isDirectory()) f = join(dist, "index.html")
      const enviar = () => {
        resposta.setHeader("Content-Type", TIPOS[extname(f)] ?? "application/octet-stream")
        resposta.end(readFileSync(f))
      }
      // The Aurora file, held: if the first paint waits for it, no frame comes before it.
      if (ATRASO > 0 && /styles-aurora-[^/]+\.css$/.test(f)) setTimeout(enviar, ATRASO)
      else enviar()
    })
    s.listen(0, "127.0.0.1", () => ok(s))
  })
}

/** In the page, before everything: Aurora stored, and one record per frame from the first. */
const SONDA = () => {
  try {
    if (!localStorage.getItem("enclave.prefs")) localStorage.setItem("enclave.prefs", JSON.stringify({ tema: "aurora" }))
  } catch {}
  const quadros = []
  globalThis.__quadros = quadros
  const t0 = performance.now()
  const registar = () => {
    const html = document.documentElement
    const body = document.body
    const ab = document.querySelector(".abertura, .splash, #root > *")
    const cs = (el) => (el ? getComputedStyle(el) : null)
    const link = document.getElementById("folha-aurora")
    quadros.push({
      ms: Math.round(performance.now() - t0),
      tema: html.dataset.theme ?? null,
      folhaAurora: link ? { media: link.media, carregada: !!link.sheet } : null,
      htmlFundo: cs(html)?.backgroundColor,
      bodyFundo: body ? cs(body).backgroundColor : null,
      bodyImagem: body ? cs(body).backgroundImage.slice(0, 80) : null,
      bodyLetra: body ? cs(body).fontFamily.slice(0, 60) : null,
      aberturaCor: ab ? cs(ab).color : null,
      aberturaFundo: ab ? cs(ab).backgroundImage.slice(0, 80) : null,
    })
    if (quadros.length < 120) requestAnimationFrame(registar)
  }
  requestAnimationFrame(registar)
}

async function gravar(motor, dist) {
  const servidor = await servir(dist)
  const url = `http://127.0.0.1:${servidor.address().port}/app/`
  const nav = await motor.launch()
  try {
    const pagina = await nav.newPage({ viewport: { width: 1440, height: 900 } })
    await pagina.addInitScript(SONDA)
    await pagina.goto(url, { waitUntil: "commit" })
    await pagina.waitForFunction(() => (globalThis.__quadros?.length ?? 0) >= 60, null, { timeout: 30_000 })
    return await pagina.evaluate(() => globalThis.__quadros)
  } finally {
    await nav.close()
    servidor.close()
  }
}

const iguais = (a, b) => ["tema", "htmlFundo", "bodyFundo", "bodyImagem", "bodyLetra", "aberturaCor", "aberturaFundo"].every((k) => a[k] === b[k])
let falhou = false
for (const [nome, motor] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  const quadros = await gravar(motor, DIST)
  const primeiro = quadros[0]
  const ultimo = quadros.at(-1)
  // Every frame from the first draws what the last one draws: no frame without the Aurora sheet.
  const diferentes = quadros.filter((q) => !iguais(q, ultimo))
  const semFolha = quadros.filter((q) => !q.folhaAurora?.carregada)
  let contraReferencia = null
  if (REFERENCIA) {
    const ref = await gravar(motor, REFERENCIA)
    contraReferencia = iguais(primeiro, ref[0]) ? "igual" : { nosso: primeiro, referencia: ref[0] }
  }
  const ok = diferentes.length === 0 && semFolha.length === 0 && (contraReferencia === null || contraReferencia === "igual")
  if (!ok) falhou = true
  console.log(JSON.stringify({ motor: nome, ok, atrasoDaFolhaMs: ATRASO, primeiroQuadroMs: primeiro.ms, quadros: quadros.length, quadrosDiferentesDoUltimo: diferentes.length, quadrosSemAFolha: semFolha.length, contraReferencia, primeiro }))
}
process.exit(falhou ? 1 : 0)
