/**
 * The call ring and the nudge, across three browsers and two tabs (21/11/2026).
 *
 *   npm run build && node scripts/e2e-call-ring-and-nudge.mjs
 *
 * Local and throwaway server with SFU, never production. Ana has three devices,
 * one per engine (Chromium, Firefox, WebKit), each with a second tab of the same
 * origin that waits ("You already have Orwell open in another tab"). Bruno is a
 * separate Chromium. Fake microphone and camera; no system dialog opens.
 *
 *  1. Bruno nudges Ana: Ana's three devices shake (the frame of whatever screen
 *     is open) and play the nudge sound; Bruno shakes and hears it too.
 *  2. Ana nudges Bruno from Chromium: Bruno shakes and hears it, and Ana's
 *     Firefox and WebKit (the sender's other devices) shake and hear it too.
 *  3. Bruno calls Ana in their direct conversation: Ana's three devices ring and
 *     show "Recusar"; Bruno hears the waiting tone and has no notice.
 *  4. Firefox declines: its notice goes and it stops ringing; the others go on.
 *  5. Chromium answers: WebKit's notice goes and it stops ringing (another
 *     device of the account answered); Bruno's waiting tone stops.
 *  6. The waiting tabs never ring, shake or show a notice.
 *
 * **No ears.** The instrument is the one from `e2e-sons-paridade.mjs`: it logs
 * the fundamental frequencies of each sound the engine renders, and each
 * `AudioBufferSourceNode.start`. A MutationObserver logs each shake.
 */
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { abrirDirecta, aceitarAmizade, ate, contasDoServidor, dentro, espera, irParaEmparelhar, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { abrirJuntarUmAparelho, colarCodigo, confirmarEAbrir } from "./juntar-aparelho.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const ESPERA = "Já tens o Orwell aberto noutro separador."
const RECUSAR = "Recusar"
/** Signatures by fundamental frequency (Hz), from `sons/familia.ts`. */
const FIGURAS = {
  "a-chamar": [587.33, 739.99, 587.33, 739.99],
  chamada: [880, 739.99, 880, 1174.66, 880, 739.99, 880, 1174.66],
}

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8562, servidor: 8563, sfu: 44362, etiqueta: "call-ring-and-nudge" })
const browsers = []
const registo = []

/** Runs in each document before the app: the sound instrument and the shake log. */
function INSTRUMENT() {
  window.__sons = []
  window.__abanoes = []
  const watch = () => {
    new MutationObserver(() => {
      const app = document.querySelector(".app")
      const shaking = (app?.classList.contains("buzzing") ?? false) || document.querySelector(".main.buzzing") !== null
      if (shaking && !window.__aAbanar) window.__abanoes.push(Date.now())
      window.__aAbanar = shaking
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true })
  }
  if (document.documentElement) watch()
  else document.addEventListener("DOMContentLoaded", watch)
  const figuras = new WeakMap()
  const descricao = Object.getOwnPropertyDescriptor(AudioParam.prototype, "value")
  const Offline = window.OfflineAudioContext
  if (!Offline || !descricao) return
  const criarOscilador = Offline.prototype.createOscillator
  Offline.prototype.createOscillator = function () {
    const oscilador = criarOscilador.call(this)
    const contexto = this
    contexto.__hz ??= []
    Object.defineProperty(oscilador.frequency, "value", {
      configurable: true,
      get() {
        return descricao.get.call(this)
      },
      set(valor) {
        contexto.__hz.push(valor)
        descricao.set.call(this, valor)
      },
    })
    return oscilador
  }
  const renderizar = Offline.prototype.startRendering
  Offline.prototype.startRendering = function () {
    const contexto = this
    return renderizar.call(this).then((buffer) => {
      const hz = (contexto.__hz ?? []).filter((_, i) => i % 3 === 0).map((valor) => Math.round(valor * 100) / 100)
      figuras.set(buffer, hz)
      return buffer
    })
  }
  const comecar = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (this.context instanceof Offline) return comecar.apply(this, args)
    window.__sons.push({ hz: figuras.get(this.buffer) ?? null, t: Date.now() })
    return comecar.apply(this, args)
  }
}

const OPCOES = {
  chromium: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
  firefox: { firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true, "media.autoplay.default": 0 } },
  webkit: {},
}
const MOTORES = { chromium, firefox, webkit }

async function abrir(motor, nome) {
  const browser = await MOTORES[motor].launch({ headless: true, ...OPCOES[motor] })
  browsers.push(browser)
  const ctx = await browser.newContext({
    locale: "pt-PT",
    viewport: { width: 1280, height: 860 },
    // Playwright's Firefox does not know the "microphone" permission; its preference above does the same.
    ...(motor === "chromium" ? { permissions: ["microphone", "camera"] } : {}),
  })
  await ctx.addInitScript(INSTRUMENT)
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  return { nome, motor, browser, ctx, page }
}

const nomeDaFigura = (hz) => {
  if (!hz) return "?"
  for (const [nome, figura] of Object.entries(FIGURAS)) {
    if (figura.length === hz.length && figura.every((valor, i) => Math.abs(valor - hz[i]) < 0.02)) return nome
  }
  return hz.join(",")
}
const sons = async (page) => (await page.evaluate(() => window.__sons)).map((som) => nomeDaFigura(som.hz))
const abanoes = (page) => page.evaluate(() => window.__abanoes.length)
const notices = (page) => page.getByRole("button", { name: RECUSAR, exact: true }).count()

/** A gesture, so the engine can play. */
async function gesto(page) {
  await page.locator("main").first().click({ position: { x: 5, y: 5 } }).catch(() => {})
  await espera(800)
}

/** The direct conversation's menu, in Friends. */
async function menuDaPrivada(page, comQuem, item) {
  await abrirDirecta(page, comQuem)
  await page.locator(".direct-row").filter({ hasText: comQuem }).first().click({ button: "right" })
  await page.getByRole("menuitem", { name: item, exact: true }).first().click({ timeout: 15_000 })
}

async function emparelhar(dono, novo) {
  await dono.page.keyboard.press("Escape").catch(() => {})
  const { folha, link } = await abrirJuntarUmAparelho(dono.page)
  await irParaEmparelhar(novo.page)
  await colarCodigo(novo.page, folha, link)
  const feito = await confirmarEAbrir(novo.page, folha, FRASE).then(() => true, () => false)
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await dentro(novo.page)
  await dono.page.keyboard.press("Escape").catch(() => {})
  return feito
}

/** The nudge button in the open direct conversation, then wait for the send. */
async function cotovelar(page, comQuem) {
  await abrirDirecta(page, comQuem)
  await page.getByRole("button", { name: /Cotovelada/ }).first().click({ timeout: 15_000 })
}

try {
  const ana = await abrir("chromium", "Ana/chromium")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir("chromium", "Bruno")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const [enderecoAna] = contasDoServidor(srv.base)
  await pedirAmizade(bruno.page, enderecoAna)
  check("Ana accepts Bruno's friendship", (await aceitarAmizade(ana.page)) >= 0)

  const anaFirefox = await abrir("firefox", "Ana/firefox")
  check("Firefox pairs with Ana's Chromium", await emparelhar(ana, anaFirefox))
  const anaWebkit = await abrir("webkit", "Ana/webkit")
  check("WebKit pairs with Ana's Chromium", await emparelhar(ana, anaWebkit))
  const anas = [ana, anaFirefox, anaWebkit]

  // The second tab of each of Ana's browsers: it waits, and must stay silent.
  const esperas = []
  for (const a of anas) {
    const p2 = await a.ctx.newPage()
    await p2.goto(srv.APP, { waitUntil: "domcontentloaded" })
    const espera2 = await ate(async () => (await p2.locator("body").innerText()).includes(ESPERA), 20_000, 500)
    check(`${a.nome}: the second tab waits`, espera2 >= 0)
    esperas.push({ nome: a.nome, page: p2 })
  }

  for (const a of [...anas, bruno]) {
    await abrirDirecta(a.page, a === bruno ? "Ana" : "Bruno")
    await gesto(a.page)
  }
  // Ana's Firefox and WebKit look at Communities: the shake is not only for the open conversation.
  for (const a of [anaFirefox, anaWebkit]) await a.page.getByRole("button", { name: "Comunidades", exact: true }).first().click()
  await espera(1500)

  // 1. Bruno nudges Ana.
  const antes1 = Object.fromEntries(await Promise.all([...anas, bruno].map(async (a) => [a.nome, { s: (await sons(a.page)).length, a: await abanoes(a.page) }])))
  await cotovelar(bruno.page, "Ana")
  await espera(4000)
  const somDaCotovelada = (await sons(bruno.page)).slice(antes1[bruno.nome].s)
  check("1. Bruno, who sent it, hears the nudge", somDaCotovelada.length >= 1, JSON.stringify(somDaCotovelada))
  check("1. Bruno's screen shakes", (await abanoes(bruno.page)) > antes1[bruno.nome].a)
  const figura = somDaCotovelada[0]
  for (const a of anas) {
    const novos = (await sons(a.page)).slice(antes1[a.nome].s)
    check(`1. ${a.nome} hears the nudge`, novos.includes(figura), JSON.stringify(novos))
    check(`1. ${a.nome} shakes`, (await abanoes(a.page)) > antes1[a.nome].a)
  }

  // 2. Ana nudges Bruno from Chromium (the cooldown is per device: Chromium never nudged).
  const antes2 = Object.fromEntries(await Promise.all([...anas, bruno].map(async (a) => [a.nome, { s: (await sons(a.page)).length, a: await abanoes(a.page) }])))
  await espera(4500) // the engine's 4 s burst cap for the nudge sound, after step 1
  await cotovelar(ana.page, "Bruno")
  await espera(4000)
  for (const a of [bruno, anaFirefox, anaWebkit, ana]) {
    const novos = (await sons(a.page)).slice(antes2[a.nome].s)
    check(`2. ${a.nome} hears Ana's nudge`, novos.includes(figura), JSON.stringify(novos))
    check(`2. ${a.nome} shakes`, (await abanoes(a.page)) > antes2[a.nome].a)
  }

  // 3. Bruno calls Ana.
  const antes3 = Object.fromEntries(await Promise.all([...anas, bruno].map(async (a) => [a.nome, (await sons(a.page)).length])))
  await menuDaPrivada(bruno.page, "Ana", "Entrar em chamada")
  for (const a of anas) {
    const ms = await ate(async () => (await notices(a.page)) > 0, 30_000, 300)
    check(`3. ${a.nome} shows the incoming call with "${RECUSAR}"`, ms >= 0, `${ms} ms`)
  }
  await espera(4000)
  for (const a of anas) {
    const novos = (await sons(a.page)).slice(antes3[a.nome])
    check(`3. ${a.nome} rings, and it repeats`, novos.filter((s) => s === "chamada").length >= 2, JSON.stringify(novos))
  }
  const doBruno3 = (await sons(bruno.page)).slice(antes3[bruno.nome])
  check("3. Bruno hears the waiting tone", doBruno3.includes("a-chamar"), JSON.stringify(doBruno3))
  check("3. Bruno does not ring and has no notice", !doBruno3.includes("chamada") && (await notices(bruno.page)) === 0)

  // 4. Firefox declines.
  await anaFirefox.page.getByRole("button", { name: RECUSAR, exact: true }).first().click()
  await espera(500)
  const depoisDeRecusar = (await sons(anaFirefox.page)).length
  await espera(6500)
  check("4. Firefox's notice goes", (await notices(anaFirefox.page)) === 0)
  check("4. Firefox stops ringing", !(await sons(anaFirefox.page)).slice(depoisDeRecusar).includes("chamada"))
  const webkitAntes4 = (await sons(anaWebkit.page)).length
  await espera(3500)
  check("4. WebKit still rings", (await sons(anaWebkit.page)).slice(webkitAntes4).includes("chamada"))

  // 5. Chromium answers.
  await menuDaPrivada(ana.page, "Bruno", "Entrar em chamada")
  const foi = await ate(async () => (await notices(anaWebkit.page)) === 0, 20_000, 300)
  check("5. WebKit's notice goes when Chromium answers", foi >= 0, `${foi} ms`)
  await espera(1500)
  const webkitAntes5 = (await sons(anaWebkit.page)).length
  const brunoAntes5 = (await sons(bruno.page)).length
  await espera(7000)
  check("5. WebKit stops ringing: another device of the account answered", !(await sons(anaWebkit.page)).slice(webkitAntes5).includes("chamada"))
  check("5. Bruno's waiting tone stops", !(await sons(bruno.page)).slice(brunoAntes5).includes("a-chamar"))
  check("5. Chromium has no notice after answering", (await notices(ana.page)) === 0)

  // 6. The waiting tabs.
  for (const p of esperas) {
    check(`6. ${p.nome}'s waiting tab never rang, shook or showed a notice`, (await sons(p.page)).length === 0 && (await abanoes(p.page)) === 0 && (await notices(p.page)) === 0)
  }
  await menuDaPrivada(ana.page, "Bruno", "Sair da chamada").catch(() => {})
  await menuDaPrivada(bruno.page, "Ana", "Sair da chamada").catch(() => {})
} catch (erro) {
  check("the script reached the end", false, String(erro?.message ?? erro).split("\n")[0])
}

if (registo.length > 0) console.log(registo.join("\n"))
check("no page error", registo.length === 0, registo.slice(0, 3).join(" | "))
for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
process.exit(resumo() ? 0 : 1)
