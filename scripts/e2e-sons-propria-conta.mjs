/**
 * No sound for what the account itself writes, from any device (16/11/2026).
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/e2e-sons-propria-conta.mjs
 *
 * Two devices of the same account and one other account, three browsers:
 *  - Ana on Chromium at 1280 px (writes);
 *  - Ana's phone: WebKit at 390 px, paired by link (listens, on the Friends page);
 *  - Bruno on Firefox at 1280 px (writes, the control).
 *
 *  1. Control: Bruno writes in the channel and in the direct: the phone hears the
 *     channel sound and the direct sound. The instrument works.
 *  2. Ana writes on the computer, in the channel and in the direct: the phone
 *     hears nothing, and the computer hears nothing either (no send sound).
 *
 * **No ears.** The instrument (`ESPIAR`) is the one from `e2e-sons-canal-mencao.mjs`.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8796 and 8797.
 */
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, abrirDirecta, aceitarAmizade, contasDoServidor, criarCanal, dentro, dizer, espera, irParaEmparelhar, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"
import { juntarComPalavras } from "./juntar-aparelho.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "lagar"
const FIGURAS = {
  canal: [587.33, 659.25],
  mencao: [987.77, 1174.66, 1479.98],
  directa: [1318.51, 987.77],
  enviada: [987.77, 1174.66],
}

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8796, servidor: 8797, sfu: 0, etiqueta: "sons-propria-conta" })
const browsers = []
const registo = []

/** The instrument. Runs in each document before the app code. */
function ESPIAR() {
  window.__sons = []
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
      // Three oscillators per note (the marimba partials): the fundamental is the first.
      const hz = (contexto.__hz ?? []).filter((_, i) => i % 3 === 0).map((valor) => Math.round(valor * 100) / 100)
      figuras.set(buffer, hz)
      return buffer
    })
  }
  const ligar = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (destino, ...resto) {
    if (this instanceof AudioBufferSourceNode) this.__destino = destino
    return ligar.call(this, destino, ...resto)
  }
  const comecar = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...args) {
    // The mallet of each note (the marimba click) plays inside the render: it is not a sound.
    if (this.context instanceof Offline) return comecar.apply(this, args)
    const ganho = this.__destino && this.__destino.gain ? this.__destino.gain.value : null
    window.__sons.push({ hz: figuras.get(this.buffer) ?? null, ganho, t: Date.now() })
    return comecar.apply(this, args)
  }
}

function nomeDaFigura(hz) {
  if (!hz) return "?"
  for (const [nome, figura] of Object.entries(FIGURAS)) {
    if (figura.length === hz.length && figura.every((valor, i) => Math.abs(valor - hz[i]) < 0.02)) return nome
  }
  return `outro(${hz.join(",")})`
}

async function abrir(motor, nome, contexto = {}) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 }, ...contexto })
  await ctx.addInitScript(ESPIAR)
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  return { nome, browser: b, ctx, page }
}

const contar = (page) => page.evaluate(() => window.__sons.length)
async function sonsDesde(page, desde) {
  const lista = await page.evaluate(() => window.__sons)
  return lista.slice(desde).map((som) => nomeDaFigura(som.hz))
}

async function emparelhar(pc, motor, nome, contexto) {
  await pc.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await pc.getByRole("button", { name: "Conta e segurança", exact: true }).click()
  await pc.getByRole("button", { name: "Juntar um aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  const tel = await abrir(motor, nome, contexto)
  await irParaEmparelhar(tel.page)
  await juntarComPalavras(tel.page, folha, link, FRASE)
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await pc.keyboard.press("Escape").catch(() => {})
  await dentro(tel.page)
  return tel
}

try {
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(firefox, "bruno")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const [enderecoAna, enderecoBruno] = contasDoServidor(srv.base)
  await pedirAmizade(bruno.page, enderecoAna)
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  const tel = await emparelhar(ana.page, webkit, "telemovel", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  check("o telemóvel da Ana (WebKit) entra na conta", true)
  await abrirCanal(tel.page, CANAL)
  // The browser plays nothing before a gesture: one tap on each page.
  for (const p of [ana, tel]) await p.page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {})
  // The phone waits on the Friends page: no conversation open, so nothing is "being read".
  await tel.page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await espera(1500)

  // 1. Control: Bruno writes.
  let desde = await contar(tel.page)
  await abrirCanal(bruno.page, CANAL)
  await dizer(bruno.page, "Bom dia, do Bruno")
  await espera(4000)
  await abrirDirecta(bruno.page, "Ana")
  await dizer(bruno.page, "Olá Ana, do Bruno")
  await espera(4000)
  const controlo = await sonsDesde(tel.page, desde)
  console.log("   o telemóvel ouviu, do Bruno:", JSON.stringify(controlo))
  check("controlo: o telemóvel ouve o canal e a directa do Bruno", controlo.includes("canal") && controlo.includes("directa"), JSON.stringify(controlo))

  // 2. Ana writes on the computer.
  desde = await contar(tel.page)
  const desdeNoComputador = await contar(ana.page)
  await abrirCanal(ana.page, CANAL)
  await dizer(ana.page, "Bom dia, da Ana no computador")
  await abrirDirecta(ana.page, "Bruno")
  await dizer(ana.page, "Olá Bruno, da Ana")
  await espera(5000)
  const noTelemovel = await sonsDesde(tel.page, desde)
  const noComputador = await sonsDesde(ana.page, desdeNoComputador)
  console.log("   o telemóvel ouviu, da Ana:", JSON.stringify(noTelemovel), " o computador:", JSON.stringify(noComputador))
  check("o telemóvel da mesma conta não toca nada", noTelemovel.length === 0, JSON.stringify(noTelemovel))
  check("o computador que envia não toca nada", noComputador.length === 0, JSON.stringify(noComputador))
} catch (erro) {
  check("o guião correu até ao fim", false, String(erro?.message ?? erro).split("\n")[0])
} finally {
  for (const linha of registo.slice(-20)) console.log(linha)
  for (const b of browsers) await b.close().catch(() => {})
  srv.fechar()
  process.exitCode = resumo() ? 0 : 1
}
