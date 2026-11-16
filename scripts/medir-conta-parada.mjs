/**
 * A loaded account left alone (hotfix 1.3.14, 13/11/2026).
 *
 *   npx tsc -b && (cd apps/web && npx vite build --minify false)   (readable names in the profile)
 *   node --max-old-space-size=6144 scripts/medir-conta-parada.mjs --minutos 15 --rotulo antes
 *
 * Owner report on 1.3.13 (Windows app, 20 MB vault, admin): "every 5 minutes or
 * so the app does not respond", also with no traffic. This finds what runs on a
 * clock and what it costs.
 *
 * The case, against a disposable homeserver (ALL LOCAL, own ports 8540/8541):
 * Dona founds the common room, Ana (in the browser) is admin there, with
 * `--membros` members and `--canais` channels with `--fotos` real JPEGs each
 * (~0.9 MB each), so Ana's vault holds ~`canais * fotos` MB. Ana reopens, waits
 * 60 s for the login to settle, then nobody does anything for `--minutos`.
 *
 * Measured in the page: Long Tasks (> 50 ms), the lateness of a 50 ms timer,
 * vault writes (IndexedDB put of `current`, bytes and the synchronous ms since the
 * JSON.stringify that started it), and a CPU profile of the idle phase. For
 * every Long Task the script lists the app functions with the most samples
 * inside it: that is who runs.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala } from "@enclave/protocol"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { levantarServidor } from "./frente-lenta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const arg = (nome, omissao) => {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : omissao
}
const DIST = resolve(arg("--dist", join(RAIZ, "apps/web/dist")).replace(/^~/, process.env.HOME ?? "~"))
const ROTULO = arg("--rotulo", "agora")
const MINUTOS = Number(arg("--minutos", 15))
// `--esconder N`: instead of the idle phase, freeze the page N minutes (CDP lifecycle, as a
// minimized window or a suspended tab), with messages arriving, then bring it back and measure 20 s.
const ESCONDER = Number(arg("--esconder", 0))
const MEMBROS = Number(arg("--membros", 30))
const CANAIS = Number(arg("--canais", 8))
const FOTOS = Number(arg("--fotos", 3))
const SAIDA = arg("--saida", join(RAIZ, ".verify-data/medidas-1.3.14", `parada-${ROTULO}.json`))
const casa = await levantarServidor({
  dist: DIST,
  portaDaFrente: Number(process.env.E2E_PORTA_DA_FRENTE ?? 8540),
  portaDoServidor: Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8541),
  prefixo: "orwell-parada-",
})
const { nome: NOME, app: APP } = casa
const SALA = `!orwell:${NOME}`
const FRASE = "frase-de-verificacao-2026"
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function ate(condicao, ms = 60_000, passo = 300) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await Promise.resolve(condicao()).catch(() => false)) return true
    await wait(passo)
  }
  return false
}
class CofreEmMemoria {
  bytes = null
  supportsOsProtection = false
  async read() { return this.bytes }
  async write(b) { this.bytes = b }
  async clear() { this.bytes = null }
}
const nodes = []
async function conta(nome, perfil = true) {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-de-teste-do-no")
  const session = new Session(vault)
  const id = await session.createIdentity(NOME)
  await session.connect()
  if (perfil) await session.updateProfile({ displayName: nome, donations: [] })
  const c = { nome, session, address: id.address }
  nodes.push(c)
  return c
}
const mensagem = (body, attachments = []) => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments, links: [], mentions: [] })
const pasta = mkdtempSync(join(tmpdir(), "orwell-fotos-"))
execFileSync("magick", ["-size", "1200x960", "xc:", "+noise", "Random", "-quality", "88", join(pasta, "base.jpg")])
const BASE = readFileSync(join(pasta, "base.jpg"))
let nFoto = 0
function foto() {
  const cauda = Buffer.alloc(32)
  crypto.getRandomValues(cauda)
  const bytes = Buffer.concat([BASE, cauda])
  return { url: "", inline: `data:image/jpeg;base64,${bytes.toString("base64")}`, key: "", nonce: "", digest: "", kind: "image", name: `foto-${nFoto++}.jpg`, mediaType: "image/jpeg", byteLength: bytes.length }
}

/** In the page, before the app. */
const SONDA = () => {
  const s = { t0: performance.now(), escritas: [], longas: [], atrasos: [], inicio: null }
  globalThis.__p = s
  const stringify = JSON.stringify
  JSON.stringify = function (...a) {
    const t = performance.now()
    const r = stringify.apply(this, a)
    if (typeof r === "string" && r.length > 2_000_000 && !s.inicio) s.inicio = t
    return r
  }
  const transaccao = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (lojas, modo, ...resto) {
    const tx = transaccao.call(this, lojas, modo, ...resto)
    if (modo === "readwrite") {
      const objectStore = tx.objectStore
      tx.objectStore = function (nome) {
        const loja = objectStore.call(tx, nome)
        const put = loja.put
        loja.put = function (valor, chave) {
          if (chave === "current") {
            const agora = performance.now()
            s.escritas.push([Math.round(agora - s.t0), valor?.byteLength ?? valor?.length ?? 0, s.inicio ? Math.round(agora - s.inicio) : null])
            s.inicio = null
          }
          return put.call(loja, valor, chave)
        }
        return loja
      }
    }
    return tx
  }
  let esperado = performance.now() + 50
  setInterval(() => {
    const agora = performance.now()
    const atraso = Math.round(agora - esperado)
    if (atraso > 30) s.atrasos.push([Math.round(agora - s.t0), atraso])
    esperado = agora + 50
  }, 50)
  try {
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) s.longas.push([Math.round(e.startTime - s.t0), Math.round(e.duration)])
    }).observe({ type: "longtask", buffered: true })
  } catch {}
}

/** For each window, the app functions with the most samples in it (self time, then on stack). */
function quemCorre(perfil, janelas) {
  const porId = new Map(perfil.nodes.map((n) => [n.id, n]))
  const pai = new Map()
  for (const n of perfil.nodes) for (const f of n.children ?? []) pai.set(f, n.id)
  const nome = (n) => `${n.callFrame.functionName || "(anon)"}@${(n.callFrame.url.split("/").pop() || "").slice(0, 30)}:${n.callFrame.lineNumber}`
  const tempos = []
  let t = perfil.startTime
  for (let i = 0; i < perfil.samples.length; i++) {
    t += perfil.timeDeltas[i]
    tempos.push(t)
  }
  return janelas.map(([de, ate]) => {
    const contagem = new Map()
    for (let i = 0; i < perfil.samples.length; i++) {
      if (tempos[i] < de || tempos[i] > ate) continue
      const vistos = new Set()
      let id = perfil.samples[i]
      while (id !== undefined) {
        const n = porId.get(id)
        if (!n) break
        const k = nome(n)
        if (!vistos.has(k) && n.callFrame.url.includes("/assets/")) {
          vistos.add(k)
          contagem.set(k, (contagem.get(k) ?? 0) + 1)
        }
        id = pai.get(id)
      }
    }
    return [...contagem].sort((a, b) => b[1] - a[1]).slice(0, 12)
  })
}

const resultado = { rotulo: ROTULO, minutos: MINUTOS, membros: MEMBROS, canais: CANAIS, fotos: FOTOS }
function gravar() {
  mkdirSync(join(RAIZ, ".verify-data/medidas-1.3.14"), { recursive: true })
  writeFileSync(SAIDA, JSON.stringify(resultado, null, 2))
}
let navegador
async function arrumar(codigo) {
  for (const c of nodes) c.session.disconnect()
  await navegador?.close().catch(() => {})
  casa.fechar()
  process.exit(codigo)
}

try {
  navegador = await chromium.launch({ headless: true })
  const ctx = await navegador.newContext({ locale: "pt-PT", viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(SONDA)
  let page = await ctx.newPage()
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  const t0 = Date.now()
  const dona = await conta("Dona")
  if (!(await ate(() => dona.session.channels.includes(SALA), 30_000))) throw new Error("Dona is not in the common room")
  await criarConta(page, { nome: "Ana", frase: FRASE, servidor: NOME, memorizar: true })
  await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })
  await ate(() => dona.session.membersOf(SALA).length >= 2, 60_000)
  const ana = dona.session.membersOf(SALA).map(String).find((a) => a !== dona.address)
  for (let i = 0; i < MEMBROS - 2; i++) {
    const m = await conta(`m${i}`, false)
    await ate(() => m.session.channels.includes(SALA), 30_000)
    m.session.disconnect()
    await wait(200)
  }
  await dona.session.assignRoles(SALA, ana, ["admin"])
  for (let i = 0; i < 6; i++) await dona.session.upsertRoom(SALA, { room: `sala-${i}`, name: `sala ${i}` })
  for (let i = 0; i < 300; i += 50) await dona.session.sendBatch(SALA, Array.from({ length: 50 }, (_, k) => mensagem(`mensagem ${i + k}`)))
  for (let n = 0; n < CANAIS; n++) {
    const outro = moradaDeSala(NOME)
    await dona.session.createSpaceChannel(outro, `comunidade ${n}`)
    await ate(() => dona.session.founderOf(outro) === dona.address, 30_000)
    await dona.session.seat(outro, ana)
    await dona.session.sendBatch(outro, Array.from({ length: 50 }, (_, k) => mensagem(`${k} na comunidade ${n}`)))
    for (let f = 0; f < FOTOS; f++) await dona.session.send(outro, mensagem(`foto ${f}`, [foto()]))
  }
  console.log(`  ..  caso montado em ${Math.round((Date.now() - t0) / 1000)} s`)
  await ate(async () => (await page.locator(".channel-name").count()) >= CANAIS + 1, 240_000, 1_000)
  await wait(20_000)
  const escritas = await page.evaluate(() => globalThis.__p.escritas)
  resultado.cofreMB = +(Math.max(0, ...escritas.map((e) => e[1])) / 1048576).toFixed(1)
  console.log(`  ..  cofre da Ana: ${resultado.cofreMB} MB`)
  await page.close()

  // Cold reopen, 60 s to settle, then idle.
  page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await page.goto(APP, { waitUntil: "commit" })
  await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 120_000 })
  await wait(60_000)
  if (ESCONDER > 0) {
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
    await cdp.send("Page.enable")
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" })
    const canais = dona.session.channels.filter((c) => c !== SALA)
    for (let m = 0; m < ESCONDER; m++) {
      for (const c of canais.slice(0, 4)) await dona.session.send(c, mensagem(`enquanto escondida ${m}`))
      await dona.session.send(SALA, mensagem(`sala ${m}`))
      await wait(60_000)
    }
    const antesDeVoltar = await page.evaluate(() => performance.now() - globalThis.__p.t0).catch(() => null)
    await cdp.send("Page.setWebLifecycleState", { state: "active" })
    const voltou = await page.evaluate(() => performance.now() - globalThis.__p.t0)
    await wait(20_000)
    const p = await page.evaluate(() => globalThis.__p)
    resultado.voltar = {
      escondidaMin: ESCONDER,
      antesDeVoltar,
      tarefasLongas: p.longas.filter(([t]) => t >= voltou - 1_000).map(([t, d]) => ({ msDepois: Math.round(t - voltou), ms: d })),
      escritas: p.escritas.filter(([t]) => t >= voltou - 1_000).map(([t, b, ms]) => ({ msDepois: Math.round(t - voltou), MB: +(b / 1048576).toFixed(1), msSincronos: ms })),
      piorAtraso: Math.max(0, ...p.atrasos.filter(([t]) => t >= voltou + 200).map(([, a]) => a)),
    }
    gravar()
    console.log(JSON.stringify(resultado.voltar))
    await arrumar(0)
  }
  const inicioParado = await page.evaluate(() => performance.now() - globalThis.__p.t0)
  const origem = await page.evaluate(() => performance.timeOrigin + globalThis.__p.t0)
  await cdp.send("Profiler.enable")
  await cdp.send("Profiler.setSamplingInterval", { interval: 2000 })
  await cdp.send("Profiler.start")
  const relogioTempo = Date.now()
  for (let m = 1; m <= MINUTOS; m++) {
    await wait(60_000)
    const p = await page.evaluate(() => globalThis.__p)
    const longas = p.longas.filter(([t]) => t >= inicioParado)
    console.log(`  ..  minuto ${m}: ${longas.length} tarefas longas, ${p.escritas.filter(([t]) => t >= inicioParado).length} escritas`)
  }
  const { profile } = await cdp.send("Profiler.stop")
  const p = await page.evaluate(() => globalThis.__p)
  const rel = (t) => Math.round((t - inicioParado) / 1000)
  const longas = p.longas.filter(([t]) => t >= inicioParado)
  resultado.parado = {
    segundos: Math.round((Date.now() - relogioTempo) / 1000),
    tarefasLongas: longas.map(([t, d]) => ({ s: rel(t), ms: d })),
    escritas: p.escritas.filter(([t]) => t >= inicioParado).map(([t, b, ms]) => ({ s: rel(t), MB: +(b / 1048576).toFixed(1), msSincronos: ms })),
    atrasos: p.atrasos.filter(([t]) => t >= inicioParado).map(([t, a]) => ({ s: rel(t), ms: a })),
  }
  // Profile times are microseconds on the monotonic clock of the page; the probe's are ms since its t0.
  // Align by the profile's start: it began at `inicioParado` (± a few ms).
  const janelas = longas.map(([t, d]) => [profile.startTime + (t - inicioParado) * 1000 - 5_000, profile.startTime + (t - inicioParado + d) * 1000 + 5_000])
  resultado.parado.quemCorreNasTarefasLongas = quemCorre(profile, janelas).map((top, i) => ({ s: rel(longas[i][0]), ms: longas[i][1], top }))
  void origem
  gravar()
  writeFileSync(SAIDA.replace(/\.json$/, ".cpuprofile"), JSON.stringify(profile))
  console.log(JSON.stringify({ tarefasLongas: resultado.parado.tarefasLongas, escritas: resultado.parado.escritas }, null, 0))
} catch (erro) {
  console.error("O guião caiu:", erro?.stack ?? erro)
  console.error(casa.registo().slice(-1500))
  gravar()
  await arrumar(1)
}
console.log(`guardado em ${SAIDA}`)
await arrumar(0)
