/**
 * Memory of a loaded account in the browser (1.3.12 report, 12/11/2026).
 *
 *   node --max-old-space-size=6144 scripts/medir-memoria-conta-carregada.mjs --rotulo hotfix
 *   node ... --dist <other web dist> --rotulo media-fora
 *
 * The case, built against a disposable homeserver (ALL LOCAL, own ports):
 *   - the common room with `--membros` real MLS members, Dona founder, Ana (in the
 *     browser), Bruno and Carla admins, `--atribuicoes` role assignments, 12 rooms,
 *     `--mensagens` messages;
 *   - `--canais` small channels with `--texto` messages each and `--fotos` real JPEGs
 *     (~0.9 MB each) per channel, so Ana's vault holds ~20 MB of media.
 *
 * Measured on Ana's page (Chromium): JS heap and renderer RSS at start-up, at 60 s
 * and after 5 channels; the heap at each stage of every vault write; CPU time of
 * the renderer; two heap snapshots, summed by kind; and the events the common room
 * gained when admins reconnect after joins happened while they were away.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
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
const MEMBROS = Number(arg("--membros", 110))
const ATRIBUICOES = Number(arg("--atribuicoes", 150))
const MENSAGENS = Number(arg("--mensagens", 3000))
const CANAIS = Number(arg("--canais", 6))
const TEXTO = Number(arg("--texto", 150))
const FOTOS = Number(arg("--fotos", 3))
const SAIDA = arg("--saida", join(RAIZ, ".verify-data/medidas-memoria", `${ROTULO}.json`))
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8530)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8531)
const FRASE = "frase-de-verificacao-2026"

const casa = await levantarServidor({ dist: DIST, portaDaFrente: PORTA_DA_FRENTE, portaDoServidor: PORTA_DO_SERVIDOR, prefixo: "orwell-memoria-" })
const { nome: NOME, app: APP, dados } = casa
const SALA = `!orwell:${NOME}`
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

// Real JPEGs of ~0.9 MB (noise does not compress), each made unique by a tail after the EOI marker.
const pasta = mkdtempSync(join(tmpdir(), "orwell-fotos-"))
execFileSync("magick", ["-size", "1200x960", "xc:", "+noise", "Random", "-quality", "88", join(pasta, "base.jpg")])
const BASE = readFileSync(join(pasta, "base.jpg"))
let nFoto = 0
function foto() {
  const cauda = Buffer.alloc(32)
  crypto.getRandomValues(cauda)
  const bytes = Buffer.concat([BASE, cauda])
  const i = nFoto++
  return { url: "", inline: `data:image/jpeg;base64,${bytes.toString("base64")}`, key: "", nonce: "", digest: "", kind: "image", name: `foto-${i}.jpg`, mediaType: "image/jpeg", byteLength: bytes.length }
}

/** In the page, before the app: the heap at each stage of a vault write, and a heap/time series. */
const SONDA = () => {
  const mem = () => performance.memory?.usedJSHeapSize ?? 0
  const s = { t0: performance.now(), origem: performance.timeOrigin, serie: [], saves: [], grandes: [] }
  globalThis.__m = s
  const stringify = JSON.stringify
  let inicio = null
  JSON.stringify = function (...a) {
    const t = performance.now()
    const h = mem()
    const r = stringify.apply(this, a)
    if (typeof r === "string" && r.length > 2_000_000) {
      if (!inicio) inicio = { t, h }
      s.grandes.push({ etapa: "stringify", t, len: r.length, heap: mem() })
    }
    return r
  }
  const encode = TextEncoder.prototype.encode
  TextEncoder.prototype.encode = function (x) {
    const r = encode.call(this, x)
    if (r.length > 2_000_000) s.grandes.push({ etapa: "encode", t: performance.now(), len: r.length, heap: mem() })
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
            const n = valor?.byteLength ?? valor?.length ?? 0
            s.saves.push({ t: performance.now(), bytes: n, heapNoPut: mem(), heapAntes: inicio?.h ?? null, msSincronos: inicio ? performance.now() - inicio.t : null })
            inicio = null
          }
          return put.call(loja, valor, chave)
        }
        return loja
      }
    }
    return tx
  }
  setInterval(() => s.serie.push([Math.round(performance.now() - s.t0), mem()]), 25)
  // Media counters: object URLs live (and their bytes), bitmaps decoded, workers started.
  s.contadores = { urlsCriados: 0, urlsRevogados: 0, bytesEmUrls: 0, bitmaps: 0, workers: 0 }
  const tamanhos = new Map()
  const criarUrl = URL.createObjectURL
  URL.createObjectURL = function (obj) {
    const url = criarUrl.call(this, obj)
    s.contadores.urlsCriados++
    const n = obj?.size ?? 0
    tamanhos.set(url, n)
    s.contadores.bytesEmUrls += n
    return url
  }
  const revogarUrl = URL.revokeObjectURL
  URL.revokeObjectURL = function (url) {
    if (tamanhos.has(url)) { s.contadores.urlsRevogados++; s.contadores.bytesEmUrls -= tamanhos.get(url); tamanhos.delete(url) }
    return revogarUrl.call(this, url)
  }
  if (typeof createImageBitmap === "function") {
    const cib = createImageBitmap
    globalThis.createImageBitmap = function (...a) { s.contadores.bitmaps++; return cib.apply(this, a) }
  }
  s.contadores.audioContexts = 0
  s.contadores.buffersDeAudio = 0
  for (const nome of ["AudioContext", "webkitAudioContext", "OfflineAudioContext"]) {
    const A = globalThis[nome]
    if (typeof A !== "function") continue
    globalThis[nome] = class extends A {
      constructor(...a) { super(...a); s.contadores.audioContexts++ }
      decodeAudioData(...a) { s.contadores.buffersDeAudio++; return super.decodeAudioData(...a) }
    }
  }
  if (typeof Worker === "function") {
    const W = Worker
    globalThis.Worker = class extends W { constructor(...a) { super(...a); s.contadores.workers++ } }
  }
}

// ---- the renderer from outside: RSS and CPU time ----
let navegador, cdpNav
let pidRenderer = null
async function descobrirRenderer() {
  const { processInfo } = await cdpNav.send("SystemInfo.getProcessInfo")
  const saida = execFileSync("ps", ["-axo", "pid=,rss="], { encoding: "utf8" })
  const rss = new Map(saida.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number)))
  const rend = processInfo.filter((p) => p.type === "renderer").sort((a, b) => (rss.get(b.id) ?? 0) - (rss.get(a.id) ?? 0))
  pidRenderer = rend[0]?.id ?? null
  return processInfo
}
const rssMB = () => {
  if (!pidRenderer) return null
  try { return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", String(pidRenderer)], { encoding: "utf8" })) / 1024) } catch { return null }
}
async function cpuS() {
  const { processInfo } = await cdpNav.send("SystemInfo.getProcessInfo")
  return +(processInfo.find((p) => p.id === pidRenderer)?.cpuTime ?? 0).toFixed(2)
}
const rssSerie = []
let relogioRss = null
const iniciarRss = () => { relogioRss = setInterval(() => { const v = rssMB(); if (v) rssSerie.push([Date.now(), v]) }, 100) }


/*
  `--rastreio`: memory-infra dumps right before and right after the first
  channel click, per process and per allocator (malloc, partition_alloc, v8,
  skia, font_caches, blink_gc, ...). Shows WHICH allocator grows.
*/
const RASTREIO = process.argv.includes("--rastreio")
async function comecarRastreio() {
  const eventos = []
  cdpNav.on("Tracing.dataCollected", ({ value }) => eventos.push(...value))
  await cdpNav.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: { includedCategories: ["disabled-by-default-memory-infra"], memoryDumpConfig: { triggers: [] } },
  })
  return eventos
}
async function despejo() {
  await cdpNav.send("Tracing.requestMemoryDump", { deterministic: true, levelOfDetail: "detailed" })
}
async function acabarRastreio(eventos) {
  const fim = new Promise((r) => cdpNav.once("Tracing.tracingComplete", r))
  await cdpNav.send("Tracing.end")
  await fim
  // Per dump (in order) and per pid: the top-level allocators, in MB.
  const porDump = new Map()
  for (const e of eventos) {
    if (e.ph !== "v" || !e.args?.dumps?.allocators) continue
    const chave = e.id
    if (!porDump.has(chave)) porDump.set(chave, {})
    const alvo = (porDump.get(chave)[e.pid] ??= {})
    for (const [nome, dump] of Object.entries(e.args.dumps.allocators)) {
      if (nome.includes("/")) continue
      const tam = dump.attrs?.size?.value
      if (tam) alvo[nome] = +(parseInt(tam, 16) / 1048576).toFixed(1)
    }
  }
  return [...porDump.values()]
}
// ---- heap snapshot summed by kind ----
async function resumoDoSnapshot(cdp) {
  const pedacos = []
  const f = (p) => pedacos.push(p.chunk)
  cdp.on("HeapProfiler.addHeapSnapshotChunk", f)
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false })
  cdp.off("HeapProfiler.addHeapSnapshotChunk", f)
  const bruto = pedacos.join("")
  pedacos.length = 0
  const snap = JSON.parse(bruto)
  const { node_fields: campos, node_types: tipos } = snap.snapshot.meta
  const n = campos.length
  const iTipo = campos.indexOf("type"), iNome = campos.indexOf("name"), iTam = campos.indexOf("self_size")
  const nomes = snap.strings
  const porTipo = {}, porNome = {}, grandes = {}
  let total = 0
  for (let i = 0; i < snap.nodes.length; i += n) {
    const tipo = tipos[0][snap.nodes[i + iTipo]]
    const tam = snap.nodes[i + iTam]
    const nome = nomes[snap.nodes[i + iNome]] ?? ""
    total += tam
    porTipo[tipo] = (porTipo[tipo] ?? 0) + tam
    if (tipo === "string" || tipo === "concatenated string" || tipo === "sliced string") {
      if (tam > 200_000) {
        const k = nome.startsWith("data:image") ? "string data:image (media in the vault)" : nome.startsWith("{") ? "string JSON (vault copy)" : nome.startsWith("AAAA") || /^[A-Za-z0-9+/=]{40}/.test(nome) ? "string base64 (ciphertext/file)" : "string other >200 KB"
        const g = (grandes[k] ??= { n: 0, mb: 0 })
        g.n++; g.mb += tam / 1048576
      }
    } else {
      const k = `${tipo}:${nome.slice(0, 40)}`
      porNome[k] = (porNome[k] ?? 0) + tam
    }
  }
  const mb = (x) => +(x / 1048576).toFixed(1)
  return {
    totalMB: mb(total),
    porTipoMB: Object.fromEntries(Object.entries(porTipo).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, mb(v)])),
    stringsGrandes: Object.fromEntries(Object.entries(grandes).map(([k, v]) => [k, { n: v.n, mb: +v.mb.toFixed(1) }])),
    topPorNomeMB: Object.fromEntries(Object.entries(porNome).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, mb(v)])),
  }
}

const eventosNaSala = () => {
  const b = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
  const n = b.prepare("SELECT COUNT(*) AS n FROM events WHERE channel = ?").get(SALA).n
  b.close()
  return Number(n)
}
const resultado = { rotulo: ROTULO, dist: DIST, membros: MEMBROS, mensagens: MENSAGENS, canais: CANAIS, fotos: CANAIS * FOTOS }
function gravar() {
  mkdirSync(join(RAIZ, ".verify-data/medidas-memoria"), { recursive: true })
  writeFileSync(SAIDA, JSON.stringify(resultado, null, 2))
}
async function arrumar(codigo) {
  clearInterval(relogioRss)
  for (const c of nodes) c.session.disconnect()
  await navegador?.close().catch(() => {})
  casa.fechar()
  process.exit(codigo)
}
const mb = (x) => Math.round(x / 1048576)
const heapMB = async (page) => page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576))
async function instante(page, nome) {
  const contadores = await page.evaluate(() => globalThis.__m?.contadores ?? null).catch(() => null)
  /*
    The renderer is looked up again at every instant. Picked once, right after a
    navigation, it could be the renderer of a page just closed (still alive, and
    the largest then): the RSS and CPU stood still across instants and reopens.
  */
  const processos = await descobrirRenderer()
  const saida = execFileSync("ps", ["-axo", "pid=,rss="], { encoding: "utf8" })
  const rss = new Map(saida.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number)))
  const renderers = processos.filter((p) => p.type === "renderer").map((p) => Math.round((rss.get(p.id) ?? 0) / 1024)).filter((v) => v > 0)
  /*
    RSS on macOS counts clean file-backed pages (fonts mapped by CoreText, for
    example), which the system takes back for free. The physical footprint
    (`vmmap -summary`) is the memory that really weighs.
  */
  const pegadas = processos.filter((p) => p.type === "renderer").map((p) => {
    try {
      const texto = execFileSync("vmmap", ["-summary", String(p.id)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 })
      const pegada = texto.match(/Physical footprint:\s+([\d.]+)([KMG])/)
      const emMB = pegada ? +(Number(pegada[1]) * ({ K: 1 / 1024, M: 1, G: 1024 }[pegada[2]])).toFixed(0) : null
      const ficheiros = texto.match(/^mapped file\s+\S+\s+(\S+)/m)?.[1] ?? null
      return { pid: p.id, pegadaMB: emMB, residenteDeFicheiros: ficheiros }
    } catch {
      return { pid: p.id, pegadaMB: null }
    }
  })
  return { nome, heapMB: await heapMB(page), rssMB: rssMB(), rssRenderersMB: renderers, pegadas, cpuS: await cpuS(), contadores }
}

try {
  const argsExtra = process.argv.includes("--sem-gpu") ? ["--disable-gpu", "--disable-gpu-compositing", "--disable-gpu-rasterization"] : []
  navegador = await chromium.launch({ headless: true, args: ["--enable-precise-memory-info", "--js-flags=--expose-gc", ...argsExtra] })
  cdpNav = await navegador.newBrowserCDPSession()
  const ctx = await navegador.newContext({ locale: "pt-PT", viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(SONDA)
  // Experiment: `--sem-sons` takes Web Audio away, to weigh what the sound engine costs.
  if (process.argv.includes("--sem-sons")) {
    await ctx.addInitScript(() => {
      for (const nome of ["AudioContext", "webkitAudioContext", "OfflineAudioContext", "webkitOfflineAudioContext"]) delete globalThis[nome]
    })
  }
  // Experiment: `--sem-vidro` turns off backdrop filters, to weigh what they cost.
  if (process.argv.includes("--sem-vidro")) {
    await ctx.addInitScript(() => {
      const pôr = () => { const st = document.createElement("style"); st.textContent = "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}"; document.documentElement.appendChild(st) }
      if (document.documentElement) pôr(); else document.addEventListener("DOMContentLoaded", pôr)
    })
  }
  let page = await ctx.newPage()
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  const t0 = Date.now()
  // Dona first (founder of the common room), then Ana in the browser, then the others.
  const dona = await conta("Dona")
  if (!(await ate(() => dona.session.channels.includes(SALA), 30_000))) throw new Error("Dona is not in the common room")
  await criarConta(page, { nome: "Ana", frase: FRASE, servidor: NOME, memorizar: true })
  await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })
  const base = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
  const ana = base.prepare("SELECT address FROM accounts ORDER BY rowid DESC").get().address
  base.close()
  const bruno = await conta("Bruno")
  const carla = await conta("Carla")
  await ate(() => bruno.session.channels.includes(SALA) && carla.session.channels.includes(SALA) && dona.session.membersOf(SALA).map(String).includes(ana), 60_000)
  for (let i = 0; i < MEMBROS - 4; i++) {
    const m = await conta(`m${i}`, false)
    await ate(() => m.session.channels.includes(SALA), 30_000)
    m.session.disconnect()
    await wait(300)
    if (i % 25 === 24) console.log(`  ..  ${i + 5} membros (${Math.round((Date.now() - t0) / 1000)} s)`)
  }
  console.log(`  ..  membros na sala comum: ${dona.session.membersOf(SALA).length}`)
  const reais = dona.session.membersOf(SALA).map(String).filter((a) => ![dona.address, ana, bruno.address, carla.address].includes(a))
  await dona.session.defineRole(SALA, { role: "guarda", name: "Guarda", powers: ["convidar"] })
  for (const quem of [bruno.address, carla.address, ana]) await dona.session.assignRoles(SALA, quem, ["admin"])
  const atrib = []
  for (let i = 0; i < ATRIBUICOES; i++) atrib.push({ t: "role.assign", subject: reais[i] ?? `@sem-conta-${i}:${NOME}`, roles: ["guarda"], assignedAt: Date.now() + i })
  await dona.session.sendBatch(SALA, atrib)
  for (const c of ["Geral", "Jogos", "Arquivo", "Voz"]) await dona.session.upsertCategory(SALA, { category: c })
  for (let i = 0; i < 12; i++) await dona.session.upsertRoom(SALA, { room: `sala-${i}`, name: `sala ${i}`, category: ["Geral", "Jogos", "Arquivo", "Voz"][i % 4] })
  const FRASES = ["Alguém já viu o novo relatório?", "Bom dia a todos, hoje há reunião às dez.", "Concordo, mas convém ler o documento antes de decidir.", "Deixo aqui a ligação que prometi ontem, vejam com calma."]
  for (let i = 0; i < MENSAGENS; i += 50) await dona.session.sendBatch(SALA, Array.from({ length: Math.min(50, MENSAGENS - i) }, (_, k) => mensagem(`${FRASES[(i + k) % 4]} (${i + k + 1})`)))
  console.log(`  ..  ${MENSAGENS} mensagens na sala comum (${Math.round((Date.now() - t0) / 1000)} s)`)
  for (let n = 0; n < CANAIS; n++) {
    const outro = moradaDeSala(NOME)
    await bruno.session.createSpaceChannel(outro, `comunidade ${n}`)
    await ate(() => bruno.session.founderOf(outro) === bruno.address, 30_000)
    await bruno.session.seat(outro, ana)
    for (let i = 0; i < TEXTO; i += 50) await bruno.session.sendBatch(outro, Array.from({ length: Math.min(50, TEXTO - i) }, (_, k) => mensagem(`${i + k} na comunidade ${n}`)))
    for (let f = 0; f < FOTOS; f++) await bruno.session.send(outro, mensagem(`foto ${f}`, [foto()]))
  }
  console.log(`  ..  caso montado em ${Math.round((Date.now() - t0) / 1000)} s`)
  await ate(async () => (await page.locator(".channel-name").count()) >= CANAIS + 1, 240_000, 1_000)
  await wait(20_000)
  const saves1 = await page.evaluate(() => globalThis.__m.saves)
  resultado.cofreMB = +(Math.max(...saves1.map((s) => s.bytes)) / 1048576).toFixed(1)
  resultado.escritasNoCasoMontado = saves1.length
  console.log(`  ..  cofre da Ana: ${resultado.cofreMB} MB (${saves1.length} escritas)`)
  gravar()
  await page.close()

  // ---- cascade: joins while the admins were away, then they reconnect (1.3.12 code) ----
  for (const a of [bruno, carla]) a.session.disconnect()
  const antesJoins = eventosNaSala()
  const novos = []
  for (let i = 0; i < 3; i++) {
    const m = await conta(`novo${i}`, false)
    await ate(() => m.session.channels.includes(SALA), 30_000)
    novos.push(m)
    await wait(1_500)
  }
  await wait(3_000)
  const depoisJoins = eventosNaSala()
  const serie = []
  const antesReligar = eventosNaSala()
  for (const a of [bruno, carla]) { await a.session.connect() }
  for (let s = 0; s < 8; s++) { await wait(5_000); serie.push(eventosNaSala() - antesReligar) }
  resultado.cascata = { eventosDuranteOs3Joins: depoisJoins - antesJoins, eventosApósReligarBrunoECarla_a_cada5s: serie }
  console.log("  ..  cascata", JSON.stringify(resultado.cascata))
  gravar()

  // ---- cold reopen of Ana: start-up, 60 s, 5 channels ----
  page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send("HeapProfiler.enable")
  await page.goto("about:blank")
  await descobrirRenderer()
  iniciarRss()
  const antesAna = eventosNaSala()
  const inicio = Date.now()
  await page.goto(APP, { waitUntil: "commit" })
  await descobrirRenderer()
  const entrou = await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 120_000 }).then(() => Date.now() - inicio, () => -1)
  resultado.arranque = { msAteApp: entrou, ...(await instante(page, "app aberta")) }
  await wait(Math.max(0, 60_000 - (Date.now() - inicio)))
  resultado.aos60s = await instante(page, "60 s")
  resultado.cascata.eventosNaSalaDepoisDeAnaReabrir60s = eventosNaSala() - antesAna
  resultado.snapshotAos60s = await resumoDoSnapshot(cdp)
  console.log("== 60 s", JSON.stringify(resultado.aos60s), "\n   snapshot", JSON.stringify(resultado.snapshotAos60s))
  gravar()
  const canais = page.locator(".channel-name")
  const total = await canais.count()
  resultado.porCanal = []
  for (let i = 1; i <= 5 && i < total; i++) {
    const rastreio = RASTREIO && i === 1 ? await comecarRastreio() : null
    if (rastreio) { await despejo(); await wait(500) }
    await canais.nth(i).click().catch(() => {})
    await wait(3_000)
    if (rastreio) {
      await despejo()
      await wait(500)
      const [antes, depois] = await acabarRastreio(rastreio)
      // The process that grew the most is the page's renderer (the largest at 60 s can be a stale one).
      const soma = (o) => Object.values(o ?? {}).reduce((t, v) => t + v, 0)
      const pid = Object.keys(depois ?? {}).sort((x, y) => (soma(depois[y]) - soma(antes?.[y])) - (soma(depois[x]) - soma(antes?.[x])))[0]
      const a = antes?.[pid] ?? {}, d = depois?.[pid] ?? {}
      const delta = Object.fromEntries(Object.keys({ ...a, ...d }).map((k) => [k, +((d[k] ?? 0) - (a[k] ?? 0)).toFixed(1)]).filter(([, v]) => Math.abs(v) >= 1).sort((x, y) => y[1] - x[1]))
      const porProcesso = Object.fromEntries(Object.keys({ ...antes, ...depois }).map((p) => [p, { antes: antes?.[p] ?? {}, depois: depois?.[p] ?? {} }]))
      console.log("== rastreio, todos os processos", JSON.stringify(porProcesso))
      resultado.rastreioDoPrimeiroCanal = { pid, antes: a, depois: d, delta, porProcesso }
      console.log("== rastreio do canal 1 (MB, renderer da página)", JSON.stringify({ delta, depois: d }))
    }
    const ecra = await page.evaluate(() => ({
      nos: document.getElementsByTagName("*").length,
      imagens: document.images.length,
      pixeisMP: +([...document.images].reduce((t, im) => t + (im.complete ? im.naturalWidth * im.naturalHeight : 0), 0) / 1e6).toFixed(1),
      mensagens: document.querySelectorAll("[data-seq], .message, .msg").length,
      canvas: [...document.querySelectorAll("canvas")].map((c) => `${c.width}x${c.height}`),
      vidro: [...document.querySelectorAll("*")].filter((el) => { const st = getComputedStyle(el); return (st.backdropFilter && st.backdropFilter !== "none") || (st.webkitBackdropFilter && st.webkitBackdropFilter !== "none") }).length,
      filtros: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).filter !== "none").length,
      animacoes: document.getAnimations().length,
      camadas: [...document.querySelectorAll("*")].filter((el) => { const st = getComputedStyle(el); return st.willChange !== "auto" || st.position === "fixed" || (st.transform !== "none") }).length,
      sombras: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).boxShadow !== "none").length,
    }))
    if (i === 1) {
      // The cost of rendering one sound on demand: a 1.5 s stereo render at 48 kHz, like the longest notice.
      resultado.msParaDesenharUmSom = await page.evaluate(async () => {
        const C = globalThis.OfflineAudioContext
        if (!C) return null
        const t = performance.now()
        const c = new C(2, Math.ceil(1.5 * 48_000), 48_000)
        const o = c.createOscillator()
        o.connect(c.destination)
        o.start()
        await c.startRendering()
        return Math.round(performance.now() - t)
      })
      console.log("== um som a pedido", resultado.msParaDesenharUmSom, "ms")
    }
    const agora = await instante(page, `canal ${i}`)
    resultado.porCanal.push({ ...agora, ...ecra })
    console.log(`== canal ${i}`, JSON.stringify({ rss: agora.rssRenderersMB, pegadas: agora.pegadas, heapMB: agora.heapMB, ...ecra, contadores: agora.contadores }))
  }
  resultado.depoisDe5Canais = await instante(page, "depois de 5 canais")
  await cdp.send("HeapProfiler.collectGarbage")
  await wait(500)
  resultado.depoisDe5CanaisAposGC = await instante(page, "depois de 5 canais e GC")
  resultado.snapshotDepoisDe5Canais = await resumoDoSnapshot(cdp)
  console.log("== 5 canais", JSON.stringify(resultado.depoisDe5Canais), JSON.stringify(resultado.depoisDe5CanaisAposGC), "\n   snapshot", JSON.stringify(resultado.snapshotDepoisDe5Canais))

  // ---- writes seen in the page after the reopen ----
  const m = await page.evaluate(() => ({ saves: globalThis.__m.saves, grandes: globalThis.__m.grandes, t0: globalThis.__m.t0 }))
  resultado.escritasDoCofre = m.saves.map((s) => ({ tMs: Math.round(s.t - m.t0), MB: +(s.bytes / 1048576).toFixed(1), heapAntesMB: s.heapAntes ? mb(s.heapAntes) : null, heapNoPutMB: mb(s.heapNoPut), transitorioMB: s.heapAntes ? mb(s.heapNoPut - s.heapAntes) : null, msSincronos: s.msSincronos ? Math.round(s.msSincronos) : null }))
  resultado.etapasDeUmaEscrita = m.grandes.slice(0, 8).map((g) => ({ etapa: g.etapa, MB: +(g.len / 1048576).toFixed(1), heapMB: mb(g.heap), tMs: Math.round(g.t - m.t0) }))
  const trans = resultado.escritasDoCofre.map((e) => e.transitorioMB).filter((x) => x != null)
  resultado.escritasResumo = { n: resultado.escritasDoCofre.length, transitorioMaxMB: trans.length ? Math.max(...trans) : null, msSincronosMax: Math.max(0, ...resultado.escritasDoCofre.map((e) => e.msSincronos ?? 0)) }
  resultado.rssPicoMB = Math.max(...rssSerie.map(([, v]) => v))
  gravar()
  console.log("== escritas", JSON.stringify(resultado.escritasResumo), "rss pico", resultado.rssPicoMB)

  // ---- second cold reopen: the account is already settled (migrated, thumbnails made) ----
  await page.close()
  page = await ctx.newPage()
  await page.goto("about:blank")
  rssSerie.length = 0
  const inicio2 = Date.now()
  await page.goto(APP, { waitUntil: "commit" })
  await descobrirRenderer()
  await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 120_000 })
  await wait(Math.max(0, 60_000 - (Date.now() - inicio2)))
  resultado.segundoArranque = { aos60s: await instante(page, "2.º arranque, 60 s") }
  const canais2 = page.locator(".channel-name")
  const total2 = await canais2.count()
  for (let i = 1; i <= 5 && i < total2; i++) {
    await canais2.nth(i).click().catch(() => {})
    await wait(3_000)
  }
  resultado.segundoArranque.depoisDe5Canais = await instante(page, "2.º arranque, 5 canais")
  resultado.segundoArranque.rssPicoMB = Math.max(...rssSerie.map(([, v]) => v))
  gravar()
  console.log("== 2.º arranque", JSON.stringify(resultado.segundoArranque))
} catch (erro) {
  console.error("O guião caiu:", erro?.stack ?? erro)
  console.error(casa.registo().slice(-1500))
  gravar()
  await arrumar(1)
}
console.log(`guardado em ${SAIDA}`)
await arrumar(0)
