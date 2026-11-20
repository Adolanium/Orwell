/**
 * Live messages in each page state, measured in a real browser (17/11/2026).
 *
 *   npm run build && node scripts/medir-tempo-real.mjs [webkit|chromium|todos]
 *
 * The complaint, with 1.3.16 in production: "messages do not seem to arrive in
 * real time", in Safari on a Mac. Live messages enter the list once per frame
 * (`requestAnimationFrame`), and a window that is covered by another window, in
 * another Space or minimized has no frames, while `visibilityState` can stay
 * "visible". A headless browser always has frames, so each state is simulated
 * inside the page, before the app loads (`SIMULAR`):
 *
 *   a) visible and focused: nothing changes;
 *   b) visible, covered by another window: `requestAnimationFrame` never runs;
 *   b2) the same, and timers throttled to 1 s, as Safari does to an occluded window;
 *   c) tab in the background: hidden, no frames, timers aligned to 1 s;
 *   d) window minimized: the same as c, plus the window losing focus.
 *
 * Ana writes, Bruno measures. For each state Ana sends five messages in the room
 * Bruno has open ("conversa") and one in another room ("anúncios"). Bruno's page
 * records, with a MutationObserver (a microtask, it runs without frames), the
 * moment each message appears in the DOM, the moment the room's unread badge
 * appears. Latency = Bruno's moment minus the moment Ana pressed Enter (same
 * machine, same clock). The tab title counts the OTHER channels (`useUnreads`,
 * the open one excluded), so a room of the open channel never moves it: it is
 * read from the same message list as the badge, and is not measured here.
 *
 * Local and disposable server, never production.
 */
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, contasDoServidor, criarCanal, dentro, espera, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "lagar"
const MOTORES = { webkit, chromium }
const pedido = process.argv[2] ?? "todos"
const escolhidos = pedido === "todos" ? Object.keys(MOTORES) : [pedido]
/** A message not seen after this long counts as "did not arrive". */
const LIMITE = 12_000

const ESTADOS = {
  a: { nome: "a) visível e com foco", semQuadros: false, lentos: false, escondida: false, semFoco: false },
  b: { nome: "b) visível, tapada por outra janela (sem quadros)", semQuadros: true, lentos: false, escondida: false, semFoco: true },
  b2: { nome: "b2) tapada, sem quadros e temporizadores a 1 s", semQuadros: true, lentos: true, escondida: false, semFoco: true },
  c: { nome: "c) separador em fundo", semQuadros: true, lentos: true, escondida: true, semFoco: false },
  d: { nome: "d) janela minimizada", semQuadros: true, lentos: true, escondida: true, semFoco: true },
}

/** Runs in Bruno's page before the app: the page-state switch and the instruments. */
function SIMULAR() {
  const rafOriginal = window.requestAnimationFrame.bind(window)
  const timeoutOriginal = window.setTimeout.bind(window)
  const parados = []
  let semQuadros = false
  let lentos = false
  let escondida = false
  window.requestAnimationFrame = (f) => {
    if (semQuadros) {
      parados.push(f)
      return -parados.length
    }
    return rafOriginal(f)
  }
  // Throttled timers: nothing earlier than the next whole second, as Safari and Chrome do in the background.
  window.setTimeout = (f, ms = 0, ...resto) => {
    if (!lentos) return timeoutOriginal(f, ms, ...resto)
    const agora = performance.now()
    const alvo = Math.max(agora + ms, Math.ceil((agora + 1) / 1000) * 1000)
    return timeoutOriginal(f, alvo - agora, ...resto)
  }
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (escondida ? "hidden" : "visible") })
  Object.defineProperty(document, "hidden", { configurable: true, get: () => escondida })
  window.__simular = (estado) => {
    const mudouVisibilidade = escondida !== estado.escondida
    semQuadros = estado.semQuadros
    lentos = estado.lentos
    escondida = estado.escondida
    if (mudouVisibilidade) document.dispatchEvent(new Event("visibilitychange"))
    window.dispatchEvent(new Event(estado.semFoco ? "blur" : "focus"))
    // Back to normal: the frames that waited run now, as when the window shows again.
    if (!semQuadros) for (const f of parados.splice(0)) rafOriginal(f)
  }

  // What is seen, and when: text in the DOM and the room badge.
  window.__vistos = {}
  window.__procurar = []
  window.__sons = []
  const olhar = () => {
    const agora = Date.now()
    const texto = document.body ? document.body.textContent ?? "" : ""
    for (const ficha of window.__procurar) if (!(ficha in window.__vistos) && texto.includes(ficha)) window.__vistos[ficha] = agora
    if (!("badge" in window.__vistos) && window.__esperarBadge && document.querySelector(window.__esperarBadge)) window.__vistos.badge = agora
  }
  new MutationObserver(olhar).observe(document, { subtree: true, childList: true, characterData: true, attributes: true })
  const comecar = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...a) {
    if (typeof OfflineAudioContext === "undefined" || !(this.context instanceof OfflineAudioContext)) window.__sons.push(Date.now())
    return comecar.apply(this, a)
  }
}

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8536, servidor: 8537, etiqueta: "tempo-real" })
const browsers = []
const tabela = []

async function abrirSala(page, nome) {
  const sala = page.locator(".room-row button.room").filter({ has: page.locator(".room-name", { hasText: nome }) }).first()
  await sala.click({ timeout: 30_000 })
  await page.locator('textarea[placeholder="Escreve uma mensagem"]').waitFor({ timeout: 30_000 })
  await espera(400)
}

async function escrever(page, frase) {
  const caixa = page.locator('textarea[placeholder="Escreve uma mensagem"]')
  await caixa.click()
  await caixa.fill(frase)
  const enviada = Date.now()
  await page.keyboard.press("Enter")
  return enviada
}

const mediana = (xs) => {
  const s = [...xs].sort((x, y) => x - y)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const ms = (x) => (x === null ? `>${LIMITE / 1000}s` : `${x} ms`)

async function correr(motor) {
  console.log(`\n=== ${motor}`)
  const browser = await MOTORES[motor].launch({ headless: true })
  browsers.push(browser)
  const CONTEXTO = { locale: "pt-PT", viewport: { width: 1280, height: 860 } }
  const ana = await (await browser.newContext(CONTEXTO)).newPage()
  await ana.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(ana, { nome: `Ana ${motor}`, frase: FRASE, servidor: srv.NOME, canalOficial: false })
  await dentro(ana)
  const ctxB = await browser.newContext(CONTEXTO)
  await ctxB.addInitScript(SIMULAR)
  const bruno = await ctxB.newPage()
  await bruno.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(bruno, { nome: `Bruno ${motor}`, frase: FRASE, servidor: srv.NOME, canalOficial: false })
  await dentro(bruno)

  const contas = contasDoServidor(srv.base)
  const [enderecoAna, enderecoBruno] = contas.slice(-2)
  await pedirAmizade(bruno, enderecoAna)
  check(`[${motor}] a Ana aceita a amizade do Bruno`, (await aceitarAmizade(ana)) >= 0)
  const canal = `${CANAL}-${motor}`
  await criarCanal(ana, canal)
  check(`[${motor}] a Ana convida o Bruno`, await convidar(ana, canal, enderecoBruno))
  check(`[${motor}] o Bruno entra no canal`, await aceitarConvite(bruno, canal, { espera: 60_000 }))
  await abrirCanal(ana, canal)
  await abrirCanal(bruno, canal)
  await abrirSala(bruno, "conversa")
  await bruno.locator(".chat-main, main").first().click({ position: { x: 5, y: 5 } }).catch(() => {})
  await abrirSala(ana, "conversa")
  // Warm up: the first message of a channel can carry its first key work.
  const aquecer = `aquecer-${motor}`
  await escrever(ana, aquecer)
  await bruno.getByText(aquecer).first().waitFor({ timeout: 30_000 })
  await espera(1500)

  for (const [chave, estado] of Object.entries(ESTADOS)) {
    await bruno.evaluate((e) => window.__simular(e), estado)
    await espera(500)
    const latencias = []
    // Five in the open room, spaced as a conversation is.
    for (let i = 0; i < 5; i++) {
      const ficha = `tr-${motor}-${chave}-${i}-${Date.now().toString(36)}`
      await bruno.evaluate((f) => window.__procurar.push(f), ficha)
      const enviada = await escrever(ana, ficha)
      const limite = Date.now() + LIMITE
      let visto
      while (Date.now() < limite && visto === undefined) {
        visto = await bruno.evaluate((f) => window.__vistos[f], ficha)
        if (visto === undefined) await espera(50)
      }
      latencias.push(visto === undefined ? null : visto - enviada)
      await espera(1200)
    }
    // One in the other room: the badge and the title.
    await abrirSala(ana, "anúncios")
    await bruno.evaluate(() => {
      delete window.__vistos.badge
      window.__esperarBadge = ".room-unread"
    })
    const sonsAntes = await bruno.evaluate(() => window.__sons.length)
    const enviada = await escrever(ana, `noutra-sala-${motor}-${chave}`)
    const limite = Date.now() + LIMITE
    let vistos = {}
    while (Date.now() < limite && vistos.badge === undefined) {
      vistos = await bruno.evaluate(() => ({ badge: window.__vistos.badge }))
      await espera(50)
    }
    const som = await bruno.evaluate((n) => window.__sons[n] ?? null, sonsAntes)
    const linha = {
      motor,
      estado: estado.nome,
      dom: latencias.map((x) => (x === null ? null : x)),
      badge: vistos.badge === undefined ? null : vistos.badge - enviada,
      som: som === null ? null : som - enviada,
    }
    tabela.push(linha)
    const chegaram = latencias.filter((x) => x !== null)
    console.log(
      `  ${estado.nome}: DOM ${latencias.map(ms).join(" / ")} (mediana ${chegaram.length ? mediana(chegaram) : "-"} ms); por ler ${ms(linha.badge)}; som ${ms(linha.som)}`,
    )
    check(`[${motor}] ${estado.nome}: as cinco mensagens chegam ao DOM em menos de 1,5 s`, latencias.every((x) => x !== null && x < 1500), latencias.map(ms).join(", "))
    check(`[${motor}] ${estado.nome}: o contador de por ler da sala chega em menos de 1,5 s`, linha.badge !== null && linha.badge < 1500, ms(linha.badge))

    // Back to normal, and the unread cleared, before the next state.
    await bruno.evaluate((e) => window.__simular(e), ESTADOS.a)
    await bruno.evaluate(() => {
      window.__esperarBadge = null
    })
    await espera(500)
    await abrirSala(bruno, "anúncios")
    await abrirSala(bruno, "conversa")
    await abrirSala(ana, "conversa")
  }
  await browser.close()
}

let ok = false
try {
  for (const motor of escolhidos) await correr(motor)
  console.log("\nJSON " + JSON.stringify(tabela))
  ok = resumo()
} catch (erro) {
  console.error(erro)
  console.error(srv.registo.texto.slice(-1500))
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  srv.fechar()
}
process.exit(ok ? 0 : 1)
