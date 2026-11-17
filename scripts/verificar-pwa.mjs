// Live check of the PWA: what a browser receives from the `dist` served, not
// what is written in the sources (that is `apps/web/src/pwa.test.ts`).
//
// The risk this measures has a name: a Service Worker serving old code to an
// encrypted chat and silencing `version-watch.ts`. Ours does not intercept any
// request, and here we prove it with a real browser:
//
//   1. the `dist` has `sw.js`, the manifest and the four PNGs, and the built
//      `index.html` refers to them with `/app/` in front;
//   2. the server delivers them with the right type, and `sw.js` with
//      `no-cache` and its own policy (that is what `infra/Caddyfile` does in
//      production, and the server here mimics it: what we measure is the
//      browser, not Caddy);
//   3. the Service Worker registers with scope `/app/` and activates;
//   4. with it active, `index.html` keeps coming FROM THE NETWORK on every
//      load, no response comes from the Service Worker, and the Cache API is
//      empty;
//   5. `version-watch` still detects a swapped `index.html` on the server, which
//      is exactly what a Service Worker with cache would have broken;
//   6. a push delivered by CDP shows one notice with the fixed sentence of its
//      language, and after the pushes points 4 and 5 still hold.
//
// LOCAL by design. Serves the `dist` at 127.0.0.1, opens a fresh profile
// (without a vault, the app stays on the start screen and does not connect to
// any homeserver) and Chromium launches with DNS resolution blocked: nothing
// from here reaches `orwell.pt` or anywhere else. A request outside 127.0.0.1
// is a failure.
//
// Usage:
//   node scripts/verificar-pwa.mjs                  # builds and checks
//   node scripts/verificar-pwa.mjs --sem-construir
//   node scripts/verificar-pwa.mjs --captura        # and saves capturas/pwa-telemovel.png at 390 px
import { execFileSync } from "node:child_process"
import { createReadStream, existsSync, readFileSync, readdirSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { comLingua } from "./ambiente.mjs"

const REPO = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(REPO, "apps/web/dist")
const PORTO = 5392

const resultados = []
const check = (rotulo, ok, detalhe = "") => {
  resultados.push(Boolean(ok))
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` (${detalhe})` : ""}`)
}

if (!process.argv.includes("--sem-construir")) {
  console.log("a construir o dist da aplicação…")
  execFileSync("npm", ["run", "build", "-w", "@enclave/web"], { cwd: REPO, stdio: "inherit" })
  console.log("")
}

// --- 1. the dist ---------------------------------------------------------------

const noDist = existsSync(DIST) ? readdirSync(DIST) : []
const html = existsSync(join(DIST, "index.html")) ? readFileSync(join(DIST, "index.html"), "utf8") : ""
check("o dist tem o sw.js", noDist.includes("sw.js"))
check("o dist tem o manifesto", noDist.includes("manifest.webmanifest"))
const pngs = noDist.filter((nome) => nome.endsWith(".png")).sort()
check("o dist tem os quatro PNG", pngs.length === 4, pngs.join(", "))
check("o sw.js NÃO foi para /assets/, onde seria guardado um ano", !readdirSync(join(DIST, "assets")).some((n) => n.startsWith("sw")))
check("o index.html construído refere o manifesto com /app/", html.includes('href="/app/manifest.webmanifest"'))
const apple = /rel="apple-touch-icon" href="([^"]+)"/.exec(html)?.[1] ?? ""
check("e o ícone do iOS também", apple.startsWith("/app/apple-touch-icon.") && pngs.includes(apple.slice(5)), apple)
check("o registo do Service Worker está no bundle", readdirSync(join(DIST, "assets")).some(
  (nome) => nome.endsWith(".js") && readFileSync(join(DIST, "assets", nome), "utf8").includes("sw.js")))

// --- the server, mimicking the `handle /app/*` of the Caddyfile ---------------------

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".css": "text/css", ".js": "text/javascript",
  ".png": "image/png", ".webmanifest": "application/manifest+json", ".map": "application/json",
}
/** How many times `index.html` was requested FROM THE NETWORK. That is measure of point 4. */
let pedidosAoIndex = 0
/** When not `null`, this is what the server starts delivering as `index.html`. */
let indexTrocado = null

const servidor = createServer((pedido, resposta) => {
  const caminho = decodeURIComponent(new URL(pedido.url, "http://x").pathname)
  if (!caminho.startsWith("/app/")) {
    resposta.writeHead(404).end("fora de /app/")
    return
  }
  const relativo = normalize(caminho.slice(4)).replace(/^(\.\.[/\\])+/, "")
  let ficheiro = join(DIST, relativo)
  // `try_files {path} /app/index.html`
  if (relativo.endsWith("/") || !ficheiro.startsWith(DIST) || !existsSync(ficheiro)) ficheiro = join(DIST, "index.html")
  const eIndex = ficheiro === join(DIST, "index.html")
  if (eIndex) pedidosAoIndex += 1
  const cabecalhos = {
    "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream",
    "cache-control": caminho.startsWith("/app/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  }
  if (caminho === "/app/sw.js") cabecalhos["content-security-policy"] = "default-src 'none'"
  resposta.writeHead(200, cabecalhos)
  if (eIndex && indexTrocado !== null) resposta.end(indexTrocado)
  else createReadStream(ficheiro).pipe(resposta)
})
await new Promise((resolve) => servidor.listen(PORTO, "127.0.0.1", resolve))
const base = `http://127.0.0.1:${PORTO}`

// --- 2. what the server delivers ---------------------------------------------

{
  const r = await fetch(`${base}/app/sw.js`)
  const corpo = await r.text()
  check("/app/sw.js é JavaScript, e não o index.html a fingir", r.ok && r.headers.get("content-type")?.includes("javascript") && corpo.includes("notificationclick") && !corpo.includes("<html"))
  check("/app/sw.js é o que está em public/, byte a byte", corpo === readFileSync(join(REPO, "apps/web/public/sw.js"), "utf8"))
}
{
  const r = await fetch(`${base}/app/manifest.webmanifest`)
  const manifesto = await r.json().catch(() => null)
  check("/app/manifest.webmanifest é um manifesto", r.ok && manifesto?.scope === "/app/" && manifesto?.start_url === "/app/")
  for (const icone of manifesto?.icons ?? []) {
    const url = new URL(icone.src, `${base}/app/manifest.webmanifest`)
    const ri = await fetch(url)
    check(`o ícone ${icone.sizes} ${icone.purpose} é servido`, ri.ok && ri.headers.get("content-type") === "image/png", url.pathname)
  }
}

// --- 3 to 5. a real browser --------------------------------------------

const browser = await chromium.launch({
  // The full Chromium in new headless mode, not the headless shell: the shell
  // denies notification permission whatever the context grants, and point 6
  // needs the Service Worker to show a notice.
  channel: "chromium",
  // Nothing resolves outside the machine. The app without a vault does not connect
  // to anyone; this is the belt over the braces.
  args: ["--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"],
})
try {
  const contexto = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  })
  const pagina = await contexto.newPage()
  const paraFora = []
  const doServiceWorker = []
  const sockets = []
  pagina.on("request", (pedido) => {
    if (!pedido.url().startsWith(base) && !/^(data|blob):/.test(pedido.url())) paraFora.push(pedido.url())
  })
  pagina.on("response", (resposta) => {
    if (resposta.fromServiceWorker()) doServiceWorker.push(resposta.url())
  })
  pagina.on("websocket", (socket) => sockets.push(socket.url()))
  const erros = []
  pagina.on("console", (msg) => {
    if (msg.type() === "error") erros.push(msg.text())
  })

  // In Portuguese on purpose: the banner check looks for "Recarregar". Since 1.3.9
  // the app opens in English until someone chooses, and the browser language no
  // longer counts (it used to be `locale: "pt-PT"` here), so ask in the address.
  await pagina.goto(comLingua(`${base}/app/`), { waitUntil: "load" })
  const registo = await pagina.evaluate(async () => {
    const pronto = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 15_000)),
    ])
    if (!pronto) return null
    // `ready` resolves with an active worker; wait for it to take over this page.
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true })
        setTimeout(resolve, 5_000)
      })
    }
    return { scope: pronto.scope, estado: pronto.active?.state ?? null, controla: Boolean(navigator.serviceWorker.controller) }
  })
  check("o Service Worker regista-se e activa", registo !== null && ["activated", "activating"].includes(registo.estado), JSON.stringify(registo))
  check("com âmbito /app/, e não a origem inteira", registo?.scope === `${base}/app/`, registo?.scope ?? "")
  check("e toma conta da página aberta", registo?.controla === true)

  // 4. With the worker controlling the page, reload twice: each one must
  // reach the server. A worker with cache would answer itself, and the counter
  // would stall.
  //
  // A worker that reaches the network itself never even counts: the policy
  // `default-src 'none'` with which the `sw.js` is served forbids its request, and the
  // reload dies with ERR_FAILED (seen by mutation). It is a fault, and
  // is reported as a fault instead of crashing the script.
  //
  // WHAT THAT POLICY DOES NOT DO: it does not prevent the Cache API. A
  // `respondWith(caches.match(...))` or a `cache.put(pedido, new Response(...))`
  // make no request at all, and no CSP directive rules them. What prevents a cache in `sw.js` is `pwa.test.ts` and who reads it; here we catch the
  // effect, by the three checks below (the counter, the origin of
  // responses, and the empty Cache API).
  const antes = pedidosAoIndex
  let recarregou = ""
  try {
    await pagina.reload({ waitUntil: "load" })
    await pagina.reload({ waitUntil: "load" })
  } catch (erro) {
    recarregou = String(erro?.message ?? erro).split("\n")[0]
  }
  check("a página recarrega com o Service Worker activo", recarregou === "", recarregou)
  check("o index.html vem da rede em cada carregamento", pedidosAoIndex - antes === 2, `${pedidosAoIndex - antes} pedidos em 2 recarregamentos`)
  check("nenhuma resposta veio do Service Worker", doServiceWorker.length === 0, doServiceWorker.slice(0, 3).join(" "))
  const chaves = await pagina.evaluate(() => caches.keys())
  check("a Cache API está vazia", chaves.length === 0, chaves.join(", "))

  // 6. Web Push, without a phone: Chromium delivers a push to the registration by
  // CDP, as the push service would. The Service Worker must show ONE notice with a
  // fixed sentence per language, folded by its tag, and nothing else must change:
  // index.html from the network, no response from the worker, empty Cache API.
  await contexto.grantPermissions(["notifications"], { origin: base })
  const cdp = await contexto.newCDPSession(pagina)
  const registos = new Map()
  cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
    for (const r of registrations) registos.set(r.scopeURL, r.registrationId)
  })
  await cdp.send("ServiceWorker.enable")
  for (let i = 0; i < 50 && !registos.has(`${base}/app/`); i++) await pagina.waitForTimeout(100)
  const registrationId = registos.get(`${base}/app/`)
  check("(o CDP vê o registo do Service Worker)", registrationId !== undefined, String(registrationId))
  const avisosDepoisDe = async (dados, { fecharAntes = true } = {}) => {
    // Closing first makes the read wait for THIS push's notice, not the last one.
    if (fecharAntes) {
      await pagina.evaluate(async () => {
        for (const n of await (await navigator.serviceWorker.ready).getNotifications()) n.close()
      })
    }
    await cdp.send("ServiceWorker.deliverPushMessage", { origin: `${base}/`, registrationId, data: dados })
    // Without closing, a second notice would show up next to the first: give it time to.
    if (!fecharAntes) await pagina.waitForTimeout(500)
    // The worker shows the notice asynchronously; read until it settles.
    let ultimo = []
    for (let i = 0; i < 30; i++) {
      await pagina.waitForTimeout(100)
      ultimo = await pagina.evaluate(async () => {
        const registo = await navigator.serviceWorker.ready
        return (await registo.getNotifications()).map((n) => ({ titulo: n.title, corpo: n.body, etiqueta: n.tag, data: n.data }))
      })
      if (ultimo.length > 0) break
    }
    return ultimo
  }
  const antesDosPushes = pedidosAoIndex
  const pt = await avisosDepoisDe("pt")
  check("push \"pt\": um aviso, «Nova mensagem no Orwell»", pt.length === 1 && pt[0].titulo === "Orwell" && pt[0].corpo === "Nova mensagem no Orwell", JSON.stringify(pt))
  check("o aviso do push leva a etiqueta e nenhum data", pt[0]?.etiqueta === "orwell-push" && (pt[0]?.data ?? null) === null)
  const outraVez = await avisosDepoisDe("pt", { fecharAntes: false })
  check("push \"pt\" outra vez: continua um (a etiqueta junta)", outraVez.length === 1, JSON.stringify(outraVez))
  const en = await avisosDepoisDe("en")
  check("push \"en\": «New message in Orwell»", en.length === 1 && en[0].corpo === "New message in Orwell", JSON.stringify(en))
  const vazio = await avisosDepoisDe("")
  check("push vazio: em inglês", vazio.length === 1 && vazio[0].corpo === "New message in Orwell", JSON.stringify(vazio))
  await pagina.reload({ waitUntil: "load" })
  check("depois dos pushes, o index.html continua a vir da rede", pedidosAoIndex - antesDosPushes === 1, `${pedidosAoIndex - antesDosPushes} pedido(s)`)
  check("depois dos pushes, nenhuma resposta veio do Service Worker", doServiceWorker.length === 0)
  const chavesDepois = await pagina.evaluate(() => caches.keys())
  check("depois dos pushes, a Cache API continua vazia", chavesDepois.length === 0, chavesDepois.join(", "))

  if (process.argv.includes("--captura")) {
    await pagina.waitForTimeout(800)
    await pagina.screenshot({ path: join(REPO, "capturas/pwa-telemovel.png") })
    console.log("      capturas/pwa-telemovel.png (390 × 844)")
  }

  // 5. Swap the index.html on the server for one that points to a different
  // bundle, and go back to the tab. `version-watch` compares the name of its own
  // bundle with the one the server now sends to load: it must catch the
  // difference.
  const meuBundle = /index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0] ?? ""
  indexTrocado = html.replace(meuBundle, "index-OUTRAVERSAO.js")
  check("(o index.html construído nomeia um bundle com hash)", meuBundle !== "", meuBundle)
  await pagina.evaluate(() => window.dispatchEvent(new Event("focus")))
  const barra = await pagina
    .waitForSelector('[role="status"] >> text=Recarregar', { timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  check("o version-watch ainda detecta um index.html trocado", barra)
  indexTrocado = null

  check("nenhum pedido saiu de 127.0.0.1", paraFora.length === 0, paraFora.slice(0, 3).join(" "))
  check("nenhum socket foi aberto (perfil sem cofre não liga a ninguém)", sockets.length === 0, sockets.join(" "))
  const daPolitica = erros.filter((texto) => /Content Security Policy|manifest/i.test(texto))
  check("a consola não se queixa da política nem do manifesto", daPolitica.length === 0, daPolitica.slice(0, 2).join(" | "))
} finally {
  await browser.close()
  servidor.close()
}

const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} passaram`)
process.exit(falhas === 0 ? 0 : 1)
