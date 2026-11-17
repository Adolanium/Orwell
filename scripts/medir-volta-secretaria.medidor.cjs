/**
 * The driver of `medir-volta-secretaria.mjs`, required in the desktop app's
 * main process by `lancarSemPlaywright` (see `secretaria.mjs`). One JSON command
 * per stdin line, one `MEDIDOR {json}` answer per stdout line.
 *
 * It does from the main process what Playwright would do from outside, because
 * Playwright attached keeps the page visible (focus emulation) and a minimized
 * window then measures nothing. CPU throttling goes through `webContents.debugger`,
 * which does not keep the page awake (measured on a bare window: minimized, hidden).
 */
const { app, BrowserWindow, ipcMain } = require("electron")
const { writeFileSync } = require("node:fs")
const { monitorEventLoopDelay } = require("node:perf_hooks")
const inspector = require("node:inspector")

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const janela = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().endsWith("renderer/index.html")) ?? null
const naPagina = (codigo) => janela().webContents.executeJavaScript(codigo, true)
const responder = (r) => process.stdout.write(`MEDIDOR ${JSON.stringify(r ?? {})}\n`)

async function ate(condicao, ms, passo = 250) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await Promise.resolve().then(condicao).catch(() => false)) return true
    await wait(passo)
  }
  return false
}

// Every synchronous read the window makes: the `ipcMain.on` listeners, wrapped once.
let leituras = { n: 0, somaMs: 0, maxMs: 0, porCanal: {} }
function embrulharLeituras() {
  for (const canal of ipcMain.eventNames()) {
    for (const ouvinte of ipcMain.listeners(canal)) {
      ipcMain.removeListener(canal, ouvinte)
      ipcMain.on(canal, (evento, ...resto) => {
        const t = performance.now()
        const r = ouvinte(evento, ...resto)
        const d = performance.now() - t
        leituras.n++
        leituras.somaMs += d
        leituras.maxMs = Math.max(leituras.maxMs, d)
        leituras.porCanal[String(canal)] = (leituras.porCanal[String(canal)] ?? 0) + 1
        return r
      })
    }
  }
}

const OBSERVADORES = `(() => {
  if (globalThis.__v) return true
  const s = { longas: [], eventos: [], visivel: null, primeiroQuadroMs: null, cliques: 0, cliqueEsperaMs: null, cliqueAteQuadroMs: null }
  globalThis.__v = s
  // The Event Timing API leaves out events under 16 ms: this tells "fast" from "never arrived".
  /*
    And what the person sees: from "visible again" to the handler of their click
    (the wait), and to the first frame after it (the answer). Event Timing does
    not see the wait of an input sent by the main process: its clock starts when
    the renderer takes the event.
  */
  document.addEventListener("pointerdown", () => {
    s.cliques++
    const desde = s.visivel ?? s.antesDeVoltar
    if (desde == null || s.cliqueEsperaMs !== null) return
    s.cliqueEsperaMs = Math.round(performance.now() - desde)
    requestAnimationFrame(() => setTimeout(() => { s.cliqueAteQuadroMs = Math.round(performance.now() - desde) }, 0))
  }, true)
  new PerformanceObserver((l) => { for (const e of l.getEntries()) s.longas.push({ t: e.startTime, d: e.duration }) }).observe({ type: "longtask" })
  new PerformanceObserver((l) => { for (const e of l.getEntries()) s.eventos.push({ t: e.startTime, d: e.duration, n: e.name, atraso: e.processingStart - e.startTime }) }).observe({ type: "event", durationThreshold: 16 })
  // From "visible again" to the first frame after it.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return
    const visivel = performance.now()
    s.visivel = visivel
    s.primeiroQuadroMs = null
    s.cliqueEsperaMs = null
    s.cliqueAteQuadroMs = null
    requestAnimationFrame(() => setTimeout(() => { s.primeiroQuadroMs = Math.round(performance.now() - visivel) }, 0))
  })
  return true
})()`

const COLHER = `(() => {
  const s = globalThis.__v
  // "Visible again" when the page saw it; otherwise the mark the driver set just before showing the window.
  const t = s.visivel ?? s.antesDeVoltar ?? 0
  const cliques = s.cliques
  s.cliques = 0
  const longas = s.longas.filter((l) => l.t >= t)
  const clique = s.eventos.filter((e) => e.t >= t && (e.n === "click" || e.n === "pointerdown" || e.n === "pointerup" || e.n === "mousedown"))
  return {
    inpPrimeiroCliqueMs: clique.length ? Math.round(Math.max(...clique.map((e) => e.d))) : cliques > 0 ? "<16" : null,
    atrasoDoCliqueMs: clique.length ? Math.round(clique[0].atraso) : null,
    longas: longas.length,
    longaMaxMs: Math.round(Math.max(0, ...longas.map((l) => l.d))),
    longasSomaMs: Math.round(longas.reduce((a, l) => a + l.d, 0)),
    primeiroQuadroMs: s.primeiroQuadroMs,
    viuVisivel: s.visivel !== null,
    cliquesRecebidos: cliques,
    cliqueEsperaMs: s.cliqueEsperaMs,
    cliqueAteQuadroMs: s.cliqueAteQuadroMs,
  }
})()`

let caixa = null
let embrulhadas = false

const comandos = {
  async pronto({ cpu }) {
    if (!(await ate(() => janela() !== null, 120_000))) throw new Error("no window")
    if (!(await ate(async () => (await naPagina(`document.querySelectorAll(".channel-name").length`)) >= 1, 180_000))) throw new Error("no channel list")
    await naPagina(`document.querySelector(".channel-name").click()`)
    const w = janela()
    if (cpu > 1) {
      w.webContents.debugger.attach("1.3")
      await w.webContents.debugger.sendCommand("Emulation.setCPUThrottlingRate", { rate: cpu })
    }
    await naPagina(OBSERVADORES)
    return { ok: true }
  },
  async esconder({ modo, indice }) {
    caixa = await naPagina(`(() => {
      const salas = [...document.querySelectorAll("button")].filter((b) => /^#?\\s*sala \\d+$/i.test((b.textContent ?? "").trim()))
      const b = salas[${Number(indice)} % Math.max(1, salas.length)]
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    const w = janela()
    // What shows the window again behind our back (the tray, the dock's `activate`), for the diagnostics.
    const vistos = { show: 0, activate: 0, focus: 0, visivelLogoDepois: null }
    const aoMostrar = () => vistos.show++
    const aoActivar = () => vistos.activate++
    const aoFocar = () => vistos.focus++
    w.on("show", aoMostrar)
    w.on("focus", aoFocar)
    app.on("activate", aoActivar)
    // Sometimes the first hide does not reach the page: ask again, up to three times.
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      if (modo === "minimizar") w.minimize()
      else w.hide()
      if (tentativa === 0) {
        await wait(1_000)
        vistos.visivelLogoDepois = w.isVisible()
        vistos.paginaLogoDepois = await naPagina("document.visibilityState")
      }
      if (await ate(async () => (await naPagina("document.visibilityState")) === "hidden", 10_000)) break
      w.show()
      await wait(2_000)
    }
    w.removeListener("show", aoMostrar)
    w.removeListener("focus", aoFocar)
    app.removeListener("activate", aoActivar)
    const visibilidade = await naPagina("document.visibilityState")
    const diagnostico =
      visibilidade === "hidden"
        ? undefined
        : {
            janela: { visivel: w.isVisible(), minimizada: w.isMinimized(), focada: w.isFocused() },
            vistos,
            janelas: BrowserWindow.getAllWindows().map((x) => ({ url: x.webContents.getURL().slice(-40), visivel: x.isVisible() })),
            pagina: await naPagina(`({ foco: document.hasFocus(), visivel: document.visibilityState })`),
          }
    return { visibilidade, caixa, diagnostico }
  },
  async voltar({ modo, perfil, rastreio, saida, rotulo }) {
    const w = janela()
    if (!embrulhadas) {
      embrulharLeituras()
      embrulhadas = true
    }
    leituras = { n: 0, somaMs: 0, maxMs: 0, porCanal: {} }
    let sessao = null
    const post = (m, p) => new Promise((ok, falha) => sessao.post(m, p, (e, r) => (e ? falha(e) : ok(r))))
    if (perfil) {
      sessao = new inspector.Session()
      sessao.connect()
      await post("Profiler.enable")
      await post("Profiler.setSamplingInterval", { interval: 200 })
      await post("Profiler.start")
      if (!w.webContents.debugger.isAttached()) w.webContents.debugger.attach("1.3")
      await w.webContents.debugger.sendCommand("Profiler.enable")
      await w.webContents.debugger.sendCommand("Profiler.setSamplingInterval", { interval: 200 })
      await w.webContents.debugger.sendCommand("Profiler.start")
    }
    // `rastreio`: a Chromium trace of the window over the first 2 s (style, layout, paint, by name).
    const eventosDoRastreio = []
    let rastreioFeito = null
    if (rastreio) {
      if (!w.webContents.debugger.isAttached()) w.webContents.debugger.attach("1.3")
      rastreioFeito = new Promise((ok) => {
        const ouvir = (_e, metodo, params) => {
          if (metodo === "Tracing.dataCollected") eventosDoRastreio.push(...params.value)
          if (metodo === "Tracing.tracingComplete") {
            w.webContents.debugger.removeListener("message", ouvir)
            ok()
          }
        }
        w.webContents.debugger.on("message", ouvir)
      })
      await w.webContents.debugger.sendCommand("Tracing.start", {
        traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink", "cc", "v8.execute"] },
        transferMode: "ReportEvents",
      })
    }
    const laco = monitorEventLoopDelay({ resolution: 10 })
    laco.enable()
    // The start of the return, in the page's clock, in case its `visibilitychange` comes late or not at all.
    await naPagina(`(() => { const s = globalThis.__v; s.antesDeVoltar = performance.now(); s.visivel = null; s.cliqueEsperaMs = null; s.cliqueAteQuadroMs = null; s.primeiroQuadroMs = null })()`)
    if (modo === "minimizar") w.restore()
    else w.show()
    w.focus()
    // The click right away, the way a person clicks the room they came back for.
    if (caixa) {
      const e = { x: Math.round(caixa.x), y: Math.round(caixa.y), button: "left", clickCount: 1 }
      w.webContents.sendInputEvent({ type: "mouseDown", ...e })
      w.webContents.sendInputEvent({ type: "mouseUp", ...e })
    }
    if (rastreio) {
      await wait(2_000)
      await w.webContents.debugger.sendCommand("Tracing.end")
      await rastreioFeito
      writeFileSync(`${saida}/secretaria-${rotulo}-rastreio.json`, JSON.stringify({ traceEvents: eventosDoRastreio }))
      await wait(13_000)
    } else await wait(15_000)
    laco.disable()
    const r = await naPagina(COLHER)
    r.principalMaxMs = Math.round(laco.max / 1e6)
    r.leiturasSincronas = { n: leituras.n, somaMs: Math.round(leituras.somaMs), maxMs: Math.round(leituras.maxMs), porCanal: leituras.porCanal }
    if (perfil) {
      const { profile } = await w.webContents.debugger.sendCommand("Profiler.stop")
      writeFileSync(`${saida}/secretaria-${rotulo}-janela.cpuprofile`, JSON.stringify(profile))
      const principal = await post("Profiler.stop")
      writeFileSync(`${saida}/secretaria-${rotulo}-principal.cpuprofile`, JSON.stringify(principal.profile))
      sessao.disconnect()
    }
    return r
  },
}

let resto = ""
process.stdin.on("data", (b) => {
  resto += String(b)
  let i
  while ((i = resto.indexOf("\n")) >= 0) {
    const linha = resto.slice(0, i)
    resto = resto.slice(i + 1)
    const pedido = JSON.parse(linha)
    app
      .whenReady()
      .then(() => comandos[pedido.comando](pedido))
      .then(responder, (erro) => responder({ erro: String(erro?.stack ?? erro) }))
  }
})
