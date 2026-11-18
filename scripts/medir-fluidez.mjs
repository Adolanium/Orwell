/**
 * Fluidity of a loaded account in the web app.
 *
 *   npx tsc -b && npm run build -w apps/server && npm run build -w @enclave/web
 *   node --max-old-space-size=6144 scripts/medir-fluidez.mjs --saida <results> --caso <folder> --montar     (once, slow)
 *   node --max-old-space-size=6144 scripts/medir-fluidez.mjs --saida <results> --caso <folder> --rotulo antes [--cpu 4] [--perfil]
 *
 * The complaint: the app "is painfully slow" and freezes often. This measures
 * the fluidity targets on a heavy account: founder and admin,
 * 4 communities, ~70 direct conversations, a common room of 400+ members,
 * thousands of messages, ~150 role assignments and photos.
 *
 * `--montar` builds the case once, against a disposable homeserver whose data
 * folder lives in the case folder, with Ana's browser profile (session
 * remembered) and the vaults of the three Node accounts that act live (Dona,
 * Bruno, Carla). Each measuring run copies the case and works on the copy, so
 * every run starts from the same state.
 *
 * Measured on Ana's page, in Chromium, with the CPU slowed `--cpu` times (CDP):
 *   - start-up: from navigation to the channel list and to the first message;
 *     Long Tasks and key responses (Event Timing) during the first 15 s;
 *   - channel switch: from the pointerdown to the frame where the timeline shows
 *     the new channel;
 *   - typing, scrolling, menus: Long Tasks and Event Timing durations (INP);
 *   - live messages: 20 messages one by one, the main-thread CPU per message
 *     (CPU profile, minus an idle window of the same length);
 *   - a burst of 200 messages, and a new member joining the common room (a
 *     commit in a group of 400+ leaves).
 * Every Long Task comes with its Long Animation Frame scripts when Chromium has
 * them: that is who ran.
 *
 * ALL LOCAL: own homeserver, own ports (8560/8561 or E2E_PORTA_DA_FRENTE /
 * E2E_PORTA_DO_SERVIDOR). There is no way to point this at production.
 */
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
const tem = (nome) => process.argv.includes(nome)
const casa_ = (p) => resolve(String(p).replace(/^~/, process.env.HOME ?? "~"))
const DIST = casa_(arg("--dist", join(RAIZ, "apps/web/dist")))
const CASO = casa_(arg("--caso", join(tmpdir(), "orwell-fluidez-caso")))
const ROTULO = arg("--rotulo", "agora")
const CPU = Number(arg("--cpu", 4))
const MEMBROS = Number(arg("--membros", 400))
const DIRECTAS = Number(arg("--directas", 70))
const COMUNIDADES = Number(arg("--comunidades", 3))
const ATRIBUICOES = Number(arg("--atribuicoes", 150))
const MENSAGENS = Number(arg("--mensagens", 3000))
const TEXTO = Number(arg("--texto", 300))
const FOTOS = Number(arg("--fotos", 4))
const PERFIL = tem("--perfil")
// Where the results go: always given, so a measure never writes into the tree by surprise.
if (!arg("--saida")) {
  console.error("pass --saida <folder> (the results and profiles go there)")
  process.exit(2)
}
const SAIDA = casa_(arg("--saida"))
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8560)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8561)
const FRASE_ANA = "frase-de-medida-da-fluidez-2026"
const FRASE_NO = "frase-de-teste-do-no"

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function ate(condicao, ms = 60_000, passo = 300) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await Promise.resolve(condicao()).catch(() => false)) return true
    await wait(passo)
  }
  return false
}
function cofreEmFicheiro(caminho) {
  return {
    supportsOsProtection: false,
    async read() {
      try { return new Uint8Array(readFileSync(caminho)) } catch { return null }
    },
    async write(bytes) { writeFileSync(caminho, bytes) },
    async clear() { rmSync(caminho, { force: true }) },
  }
}
class CofreEmMemoria {
  bytes = null
  supportsOsProtection = false
  async read() { return this.bytes }
  async write(b) { this.bytes = b }
  async clear() { this.bytes = null }
}
const mensagem = (body, attachments = []) => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments, links: [], mentions: [] })
const FRASES = ["Alguém já viu o novo relatório?", "Bom dia a todos, hoje há reunião às dez.", "Concordo, mas convém ler o documento antes de decidir.", "Deixo aqui a ligação que prometi ontem, vejam com calma."]

/** In the page, before the app: Long Tasks with their LoAF scripts, Event Timing, the last pointerdown. */
const SONDA = () => {
  const s = { longas: [], quadros: [], eventos: [], ultimoToque: 0 }
  globalThis.__f = s
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) s.longas.push({ t: e.startTime, d: e.duration }) }).observe({ type: "longtask", buffered: true })
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.duration < 50) continue
        s.quadros.push({
          t: e.startTime, d: e.duration, bloqueio: e.blockingDuration, render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
          scripts: (e.scripts ?? []).map((x) => ({ d: Math.round(x.duration), f: x.sourceFunctionName, u: (x.sourceURL ?? "").split("/").pop(), c: x.sourceCharPosition, i: x.invoker, tipo: x.invokerType, layout: Math.round(x.forcedStyleAndLayoutDuration ?? 0) })),
        })
      }
    }).observe({ type: "long-animation-frame", buffered: true })
  } catch {}
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) s.eventos.push({ t: e.startTime, d: e.duration, n: e.name, atraso: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart }) }).observe({ type: "event", durationThreshold: 16, buffered: true })
  } catch {}
  addEventListener("pointerdown", (e) => { s.ultimoToque = e.timeStamp }, true)
}

// ------------------------------------------------------------------ building the case
async function montar() {
  if (!tem("--retomar")) rmSync(CASO, { recursive: true, force: true })
  mkdirSync(join(CASO, "servidor"), { recursive: true })
  mkdirSync(join(CASO, "nos"), { recursive: true })
  const casa = await levantarServidor({ dist: DIST, portaDaFrente: PORTA_DA_FRENTE, portaDoServidor: PORTA_DO_SERVIDOR, dados: join(CASO, "servidor") })
  const { nome: NOME, app: APP } = casa
  const SALA = `!orwell:${NOME}`
  const vivas = []
  async function conta(nome, { guardar = false, perfil = true } = {}) {
    const vault = new Vault(guardar ? cofreEmFicheiro(join(CASO, "nos", `${nome}.cofre`)) : new CofreEmMemoria())
    await vault.create(FRASE_NO)
    const session = new Session(vault)
    const id = await session.createIdentity(NOME)
    // A loaded machine can drop a connection: try again, slowly, before giving up.
    for (let volta = 0; ; volta++) {
      try { await session.connect(); break } catch (erro) { if (volta >= 10) throw erro; await wait(2_000 * (volta + 1)) }
    }
    if (perfil) await session.updateProfile({ displayName: nome, donations: [] })
    const c = { nome, session, address: id.address }
    vivas.push(c)
    return c
  }
  const pasta = join(CASO, "fotos")
  mkdirSync(pasta, { recursive: true })
  execFileSync("magick", ["-size", "1600x1200", "xc:", "+noise", "Random", "-quality", "85", join(pasta, "base.jpg")])
  const BASE = readFileSync(join(pasta, "base.jpg"))
  let nFoto = 0
  const foto = () => {
    const cauda = Buffer.alloc(32)
    crypto.getRandomValues(cauda)
    const bytes = Buffer.concat([BASE, cauda])
    return { url: "", inline: `data:image/jpeg;base64,${bytes.toString("base64")}`, key: "", nonce: "", digest: "", kind: "image", name: `foto-${nFoto++}.jpg`, mediaType: "image/jpeg", byteLength: bytes.length }
  }
  const t0 = Date.now()
  const s = () => `${Math.round((Date.now() - t0) / 1000)} s`
  /*
    The end of the case, with Ana online: the communities seat her (that spends
    her key packages, and her app tops them up only while it runs), then she
    takes in everything, and the case is saved when her vault stops writing.
  */
  async function fimDaMontagem({ dona, bruno, carla, ana }) {
    const nav2 = await chromium.launchPersistentContext(join(CASO, "perfil-ana"), { headless: true, locale: "pt-PT", viewport: { width: 1440, height: 900 } })
    const p2 = nav2.pages()[0] ?? (await nav2.newPage())
    await p2.goto(APP, { waitUntil: "domcontentloaded" })
    await p2.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 600_000 })
    for (let n = 0; n < COMUNIDADES; n++) {
      const outro = moradaDeSala(NOME)
      await bruno.session.createSpaceChannel(outro, `comunidade ${n}`)
      await ate(() => bruno.session.founderOf(outro) === bruno.address, 30_000)
      for (const quem of [ana, carla.address]) {
        let sentado = false
        for (let volta = 0; volta < 40 && !sentado; volta++) {
          sentado = await bruno.session.seat(outro, quem).then(() => true, async (erro) => { if (!/invite keys/.test(String(erro?.message))) throw erro; await wait(5_000); return false })
        }
        if (!sentado) throw new Error(`${quem} não se sentou na comunidade ${n}: sem pacotes de chaves`)
      }
      await bruno.session.assignRoles(outro, ana, ["admin"]).catch(() => {})
      for (let i = 0; i < TEXTO; i += 50) await bruno.session.sendBatch(outro, Array.from({ length: Math.min(50, TEXTO - i) }, (_, k) => mensagem(`${FRASES[(i + k) % 4]} ${i + k} na comunidade ${n}`)))
      for (let f = 0; f < FOTOS; f++) await carla.session.send(outro, mensagem(`foto ${f}`, [foto()]))
    }
    console.log(`  ..  ${COMUNIDADES} comunidades a mais (${s()})`)
    await ate(async () => (await p2.locator(".channel-name").count()) >= COMUNIDADES + 1, 900_000, 2_000)
    // Settled: no new IndexedDB write in 30 s.
    await p2.evaluate(() => {
      globalThis.__ultimaEscrita = performance.now()
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...a) { globalThis.__ultimaEscrita = performance.now(); return put.apply(this, a) }
    })
    await ate(async () => (await p2.evaluate(() => performance.now() - globalThis.__ultimaEscrita)) > 30_000, 1_800_000, 2_000)
    console.log(`  ..  Ana recebeu tudo (${s()}), ${await p2.locator(".channel-name").count()} canais na barra`)
    await nav2.close()
    for (const c of [dona, bruno, carla]) { await c.session.flush().catch(() => {}); c.session.disconnect() }
    writeFileSync(join(CASO, "caso.json"), JSON.stringify({ ana, dona: dona.address, bruno: bruno.address, carla: carla.address, NOME, SALA, MEMBROS, DIRECTAS, COMUNIDADES, ATRIBUICOES, MENSAGENS, TEXTO, FOTOS, montadoEm: new Date().toISOString(), segundos: Math.round((Date.now() - t0) / 1000) }, null, 2))
    await wait(1_000)
  }

  /*
    `--retomar`: a build that fell after the common room was ready (the
    communities step) goes on from the case folder: the server's data, the three
    Node vaults and Ana's profile are all there.
  */
  if (tem("--retomar")) {
    try {
      const reabrirNo = async (nome) => {
        const vault = new Vault(cofreEmFicheiro(join(CASO, "nos", `${nome}.cofre`)))
        await vault.unlock(FRASE_NO)
        const session = new Session(vault)
        const id = session.loadIdentity()
        await session.connect()
        const c = { nome, session, address: id.address }
        vivas.push(c)
        return c
      }
      const [dona, bruno, carla] = [await reabrirNo("Dona"), await reabrirNo("Bruno"), await reabrirNo("Carla")]
      const base = new DatabaseSync(join(CASO, "servidor", "enclave.sqlite"), { readOnly: true })
      // Dona was the first account, Ana the second.
      const ana = base.prepare("SELECT address FROM accounts ORDER BY rowid LIMIT 1 OFFSET 1").get().address
      base.close()
      console.log(`  ..  retomado: Ana ${ana}`)
      await wait(10_000)
      await fimDaMontagem({ dona, bruno, carla, ana })
      casa.fechar()
      console.log(`caso montado em ${CASO} (${s()})`)
      process.exit(0)
    } catch (erro) {
      console.error("A montagem caiu:", erro?.stack ?? erro)
      for (const c of vivas) c.session.disconnect()
      casa.fechar()
      process.exit(1)
    }
  }
  try {
    const dona = await conta("Dona", { guardar: true })
    if (!(await ate(() => dona.session.channels.includes(SALA), 30_000))) throw new Error("Dona is not in the common room")
    // Ana, in the browser, with the session remembered; the profile stays in the case.
    const nav = await chromium.launchPersistentContext(join(CASO, "perfil-ana"), { headless: true, locale: "pt-PT", viewport: { width: 1440, height: 900 } })
    const page = nav.pages()[0] ?? (await nav.newPage())
    await page.goto(APP, { waitUntil: "domcontentloaded" })
    await criarConta(page, { nome: "Ana", frase: FRASE_ANA, servidor: NOME, memorizar: true })
    await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })
    const base = new DatabaseSync(join(CASO, "servidor", "enclave.sqlite"), { readOnly: true })
    const ana = base.prepare("SELECT address FROM accounts ORDER BY rowid DESC").get().address
    base.close()
    const bruno = await conta("Bruno", { guardar: true })
    const carla = await conta("Carla", { guardar: true })
    await ate(() => bruno.session.channels.includes(SALA) && carla.session.channels.includes(SALA) && dona.session.membersOf(SALA).map(String).includes(ana), 90_000)
    for (const quem of [bruno.address, carla.address, ana]) await dona.session.assignRoles(SALA, quem, ["admin"])
    console.log(`  ..  Ana criada (${ana}), admin na sala comum (${s()})`)

    for (let i = 0; i < MEMBROS - 4; i++) {
      const m = await conta(`m${i}`, { perfil: i < 150 })
      await ate(() => m.session.channels.includes(SALA), 60_000)
      if (i < DIRECTAS) {
        // Ana stays online while the directs open: each one spends one of her key packages, and her app tops them up.
        let dm = null
        for (let volta = 0; volta < 20 && !dm; volta++) dm = await m.session.openDirect(ana).catch(async (erro) => { if (!/invite keys/.test(String(erro?.message))) throw erro; await wait(3_000); return null })
        if (!dm) throw new Error(`a directa ${i} não abriu: a Ana não tem pacotes de chaves`)
        for (let k = 0; k < 6; k++) await m.session.send(dm, mensagem(`${FRASES[k % 4]} (directa ${i}, ${k})`))
      }
      m.session.disconnect()
      vivas.splice(vivas.indexOf(m), 1)
      await wait(300)
      // Then Ana goes away while the case grows: she receives the whole backlog when she comes back, like the owner.
      if (i === DIRECTAS - 1) { await nav.close(); console.log(`  ..  ${DIRECTAS} directas com a Ana (${s()})`) }
      if (i % 25 === 24) console.log(`  ..  ${i + 5} membros, sala com ${dona.session.membersOf(SALA).length} (${s()})`)
    }
    if (DIRECTAS === 0) await nav.close()
    const reais = dona.session.membersOf(SALA).map(String).filter((a) => ![dona.address, ana, bruno.address, carla.address].includes(a))
    await dona.session.defineRole(SALA, { role: "guarda", name: "Guarda", powers: ["convidar"] })
    const atrib = []
    for (let i = 0; i < ATRIBUICOES; i++) atrib.push({ t: "role.assign", subject: reais[i] ?? `@sem-conta-${i}:${NOME}`, roles: ["guarda"], assignedAt: Date.now() + i })
    await dona.session.sendBatch(SALA, atrib)
    for (const c of ["Geral", "Jogos", "Arquivo", "Voz"]) await dona.session.upsertCategory(SALA, { category: c })
    for (let i = 0; i < 12; i++) await dona.session.upsertRoom(SALA, { room: `sala-${i}`, name: `sala ${i}`, category: ["Geral", "Jogos", "Arquivo", "Voz"][i % 4] })
    for (let i = 0; i < MENSAGENS; i += 50) await dona.session.sendBatch(SALA, Array.from({ length: Math.min(50, MENSAGENS - i) }, (_, k) => mensagem(`${FRASES[(i + k) % 4]} (${i + k + 1})`)))
    for (let f = 0; f < FOTOS; f++) await bruno.session.send(SALA, mensagem(`foto ${f} na sala comum`, [foto()]))
    console.log(`  ..  sala comum: ${dona.session.membersOf(SALA).length} membros, ${MENSAGENS} mensagens, ${ATRIBUICOES} atribuições (${s()})`)
    writeFileSync(join(CASO, "parcial.json"), JSON.stringify({ ana, dona: dona.address, bruno: bruno.address, carla: carla.address }))
    await fimDaMontagem({ dona, bruno, carla, ana })
    casa.fechar()
    console.log(`caso montado em ${CASO} (${s()})`)
    process.exit(0)
  } catch (erro) {
    console.error("A montagem caiu:", erro?.stack ?? erro)
    console.error(casa.registo().slice(-1500))
    for (const c of vivas) c.session.disconnect()
    casa.fechar()
    process.exit(1)
  }
}

// ------------------------------------------------------------------ measuring
const p = (xs, q) => {
  if (!xs.length) return 0
  const o = [...xs].sort((a, b) => a - b)
  return Math.round(o[Math.min(o.length - 1, Math.floor(q * o.length))])
}
function janela(f, t0, t1) {
  const longas = f.longas.filter((l) => l.t >= t0 && l.t <= t1)
  const eventos = f.eventos.filter((e) => e.t >= t0 && e.t <= t1 && /^(click|pointerdown|pointerup|keydown|keyup|keypress|input|contextmenu|wheel)$/.test(e.n))
  const quadros = f.quadros.filter((q) => q.t >= t0 && q.t <= t1)
  // The worst scripts in the window's long frames, grouped by function: who ran.
  const porFuncao = new Map()
  for (const q of quadros) for (const x of q.scripts) {
    const k = `${x.f || "(anon)"} ${x.u}:${x.c} <${x.tipo}:${x.i}>`
    porFuncao.set(k, (porFuncao.get(k) ?? 0) + x.d)
  }
  return {
    longas: longas.length,
    longaMaxMs: Math.round(Math.max(0, ...longas.map((l) => l.d))),
    longasSomaMs: Math.round(longas.reduce((t, l) => t + l.d, 0)),
    inpMs: Math.round(Math.max(0, ...eventos.map((e) => e.d))),
    eventos: eventos.length,
    quadroMaxMs: Math.round(Math.max(0, ...quadros.map((q) => q.d))),
    quemCorre: [...porFuncao].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${v} ms ${k}`),
  }
}
function cpuDoPerfil(perfil) {
  // Main-thread busy time: every sample that is not idle, garbage collection included.
  const porId = new Map(perfil.nodes.map((n) => [n.id, n]))
  let ocupado = 0
  for (let i = 0; i < perfil.samples.length; i++) {
    const n = porId.get(perfil.samples[i])
    if (n?.callFrame.functionName === "(idle)") continue
    ocupado += perfil.timeDeltas[i] ?? 0
  }
  return ocupado / 1000
}

async function medir() {
  if (!existsSync(join(CASO, "caso.json"))) throw new Error(`Não há caso em ${CASO}. Corre primeiro com --montar.`)
  const caso = JSON.parse(readFileSync(join(CASO, "caso.json"), "utf8"))
  const CORRIDA = join(tmpdir(), `orwell-fluidez-corrida-${process.pid}`)
  rmSync(CORRIDA, { recursive: true, force: true })
  for (const parte of ["servidor", "nos", "perfil-ana"]) cpSync(join(CASO, parte), join(CORRIDA, parte), { recursive: true })
  for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) rmSync(join(CORRIDA, "perfil-ana", f), { force: true })
  const casa = await levantarServidor({ dist: DIST, portaDaFrente: PORTA_DA_FRENTE, portaDoServidor: PORTA_DO_SERVIDOR, dados: join(CORRIDA, "servidor") })
  const { app: APP, nome: NOME } = casa
  const SALA = caso.SALA
  const sessoes = []
  async function reabrir(nome) {
    const vault = new Vault(cofreEmFicheiro(join(CORRIDA, "nos", `${nome}.cofre`)))
    await vault.unlock(FRASE_NO)
    const session = new Session(vault)
    session.loadIdentity()
    await session.connect()
    sessoes.push(session)
    return session
  }
  const resultado = { rotulo: ROTULO, cpu: CPU, dist: DIST, caso, fases: {} }
  mkdirSync(SAIDA, { recursive: true })
  const gravar = () => writeFileSync(join(SAIDA, `${ROTULO}.json`), JSON.stringify(resultado, null, 2))
  let nav
  try {
    const bruno = await reabrir("Bruno")
    nav = await chromium.launchPersistentContext(join(CORRIDA, "perfil-ana"), { headless: true, locale: "pt-PT", viewport: { width: 1440, height: 900 }, args: ["--enable-precise-memory-info"] })
    await nav.addInitScript(SONDA)
    const page = nav.pages()[0] ?? (await nav.newPage())
    const cdp = await nav.newCDPSession(page)
    if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU })
    await cdp.send("Profiler.enable")
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 })
    const agora = () => page.evaluate(() => performance.now())
    const sonda = () => page.evaluate(() => globalThis.__f)
    const perfis = {}
    async function comPerfil(nome, fn) {
      if (PERFIL) await cdp.send("Profiler.start")
      const r = await fn()
      if (PERFIL) {
        const { profile } = await cdp.send("Profiler.stop")
        mkdirSync(join(SAIDA, "perfis"), { recursive: true })
        writeFileSync(join(SAIDA, "perfis", `${ROTULO}-${nome}.cpuprofile`), JSON.stringify(profile))
        perfis[nome] = profile
      }
      return r
    }
    const fase = (nome, dados) => {
      resultado.fases[nome] = dados
      console.log(`== ${nome}`, JSON.stringify(dados))
      gravar()
    }

    // ---- A. start-up with the session remembered, then 15 s of recovery
    await comPerfil("arranque", async () => {
      const t0 = Date.now()
      await page.goto(APP, { waitUntil: "commit" })
      await page.locator(".channel-name").first().waitFor({ timeout: 180_000 })
      const lista = Date.now() - t0
      await page.locator(".timeline .message").first().waitFor({ timeout: 180_000 }).catch(() => {})
      const mensagem1 = Date.now() - t0
      const nav0 = await page.evaluate(() => performance.timeOrigin)
      // A key every 400 ms during the recovery: its response is the INP of a person who acts right away.
      const fim = Date.now() + 15_000
      while (Date.now() < fim) { await page.keyboard.press("Shift"); await wait(400) }
      const f = await sonda()
      fase("arranque", { msAteALista: lista, msAteAPrimeiraMensagem: mensagem1, ...janela(f, 0, await agora()), nav0 })
    })

    // The account file reminder (a case built before it existed) covers the app: close it, or every click lands on it.
    const lembrete = page.locator(".overlay").getByRole("button", { name: "Fechar" })
    if (await lembrete.count()) await lembrete.first().click().catch(() => {})
    await ate(async () => (await page.locator(".overlay").count()) === 0, 30_000, 300)

    const canais = page.locator(".channel-name")
    const nCanais = await canais.count()
    const nomes = await canais.allTextContents()
    resultado.canaisNaBarra = nCanais

    /*
      `--esconder M`: the return from a minimized window. The page is
      hidden (visibilitychange) and frozen (CDP lifecycle) for M minutes while
      Bruno writes one message a second in the common room. Then it comes back,
      and the first click lands right away: its INP, and the Long Tasks of the
      next 15 s. Only this phase runs.
    */
    const ESCONDER = Number(arg("--esconder", 0))
    if (ESCONDER > 0) {
      const iSala0 = (await canais.allTextContents()).findIndex((n) => /orwell|comum/i.test(n))
      await canais.nth(Math.max(0, iSala0)).click().catch(() => {})
      await wait(5_000)
      await page.evaluate(() => {
        let estado = "hidden"
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado })
        Object.defineProperty(document, "hidden", { configurable: true, get: () => estado === "hidden" })
        globalThis.__mostrar = () => { estado = "visible"; document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")) }
        document.dispatchEvent(new Event("visibilitychange"))
        window.dispatchEvent(new Event("blur"))
      })
      await cdp.send("Page.setWebLifecycleState", { state: "frozen" })
      const fimDoEsconder = Date.now() + ESCONDER * 60_000
      let enviadas = 0
      while (Date.now() < fimDoEsconder) { await bruno.send(SALA, mensagem(`escondida ${enviadas++}`)); await wait(1_000) }
      await comPerfil(`volta-${ESCONDER}`, async () => {
        await cdp.send("Page.setWebLifecycleState", { state: "active" })
        const t0 = await agora()
        await page.evaluate(() => globalThis.__mostrar())
        // The first click, at once: the person comes back and clicks a channel.
        const iOutro = (await canais.allTextContents()).findIndex((n) => /comunidade/i.test(n))
        await canais.nth(Math.max(0, iOutro)).click({ timeout: 60_000 }).catch(() => {})
        const primeiro = await page.evaluate(() => globalThis.__f.eventos.filter((e) => e.n === "click" || e.n === "pointerdown").at(-1) ?? null)
        await wait(15_000)
        const chegou = await page.evaluate((n) => document.body.innerText.includes(`escondida ${n - 1}`), enviadas).catch(() => false)
        fase(`volta-${ESCONDER}`, { minutos: ESCONDER, enviadas, primeiroCliqueMs: primeiro ? Math.round(primeiro.d) : null, atrasoDoCliqueMs: primeiro ? Math.round(primeiro.atraso) : null, ...janela(await sonda(), t0, await agora()) })
        resultado.voltaUltimaVisivel = chegou
      })
      gravar()
      throw Object.assign(new Error("fim do esconder"), { fim: true })
    }

    // ---- B. channel switch: pointerdown to the frame where the timeline changed
    const trocas = []
    // `--rastreio`: a devtools timeline trace of the switches, the scroll and the menus,
    // summed by event (style, layout, paint, script), one summary per phase.
    const RASTREAR = tem("--rastreio")
    const eventosDoRastreio = []
    if (RASTREAR) cdp.on("Tracing.dataCollected", ({ value }) => eventosDoRastreio.push(...value))
    resultado.rastreio = {}
    // `--seletores` (with `--rastreio`): Blink's selector stats, the style-recalc time per selector.
    const SELETORES = tem("--seletores")
    // `--invalidacoes` (with `--rastreio`): who invalidates layout and style, by reason and node.
    const INVALIDACOES = tem("--invalidacoes")
    // `--mutacoes` (with `--rastreio`): the DOM mutations of each traced phase,
    // counted by target and attribute: who changes the page while it scrolls.
    const MUTACOES = tem("--mutacoes")
    async function comRastreio(nome, fn) {
      if (!RASTREAR) return fn()
      if (MUTACOES) {
        await page.evaluate(() => {
          const contas = new Map()
          const alvo = (n) => {
            const el = n.nodeType === 1 ? n : n.parentElement
            if (!el) return "?"
            const c = [...el.classList].slice(0, 2).join(".")
            return `${el.tagName.toLowerCase()}${c ? "." + c : ""}`
          }
          globalThis.__mutacoes = contas
          globalThis.__obsMutacoes?.disconnect()
          globalThis.__obsMutacoes = new MutationObserver((lista) => {
            for (const m of lista) {
              const k = `${m.type}${m.attributeName ? "[" + m.attributeName + "]" : ""} ${alvo(m.target)}`
              contas.set(k, (contas.get(k) ?? 0) + 1)
            }
          })
          globalThis.__obsMutacoes.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
        })
      }
      eventosDoRastreio.length = 0
      await cdp.send("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink", ...(SELETORES ? ["disabled-by-default-blink.debug"] : []), ...(INVALIDACOES ? ["disabled-by-default-devtools.timeline.invalidationTracking", "disabled-by-default-devtools.timeline.stack"] : [])] } })
      const r = await fn()
      const fim = new Promise((res) => cdp.once("Tracing.tracingComplete", res))
      await cdp.send("Tracing.end")
      await fim
      const porNome = new Map()
      const grandes = []
      for (const e of eventosDoRastreio) {
        if (e.ph !== "X" || !e.dur) continue
        porNome.set(e.name, (porNome.get(e.name) ?? 0) + e.dur / 1000)
        if (e.name === "Layout" && e.dur > 5000) grandes.push({ ms: Math.round(e.dur / 1000), nos: e.args?.beginData?.dirtyObjects, total: e.args?.beginData?.totalObjects, raiz: e.args?.endData?.layoutRoots?.length })
        if (e.name === "UpdateLayoutTree" && e.dur > 5000) grandes.push({ estilo: Math.round(e.dur / 1000), elementos: e.args?.elementCount })
      }
      // Style recalcs and layouts: how many, how many elements, how long.
      const contas = { recalcs: 0, elementos: 0, recalcMs: 0, layouts: 0, layoutMs: 0, pinturaMs: 0 }
      for (const e of eventosDoRastreio) {
        if (e.ph !== "X" || !e.dur) continue
        if (e.name === "UpdateLayoutTree") { contas.recalcs++; contas.elementos += e.args?.elementCount ?? 0; contas.recalcMs += e.dur / 1000 }
        else if (e.name === "Layout") { contas.layouts++; contas.layoutMs += e.dur / 1000 }
        else if (e.name === "Paint" || e.name === "PrePaint") contas.pinturaMs += e.dur / 1000
      }
      for (const k of ["recalcMs", "layoutMs", "pinturaMs"]) contas[k] = Math.round(contas[k])
      const porInvalidacao = new Map()
      if (INVALIDACOES) for (const e of eventosDoRastreio) {
        if (!/Invalidat|ScheduleStyleRecalc|LayoutInvalidationTracking|StyleRecalcInvalidationTracking/.test(e.name)) continue
        const d = e.args?.data ?? {}
        const pilha = (d.stackTrace ?? []).slice(0, 3).map((f) => `${f.functionName || "?"}@${String(f.url ?? "").split("/").pop()}:${f.lineNumber}:${f.columnNumber}`).join(" < ")
        const k = `${e.name} ${d.reason ?? ""} ${d.nodeName ?? ""} ${d.changedClass ?? d.changedAttribute ?? d.changedPseudo ?? ""} ${pilha}`.replace(/\s+/g, " ").trim()
        porInvalidacao.set(k, (porInvalidacao.get(k) ?? 0) + 1)
      }
      const porSeletor = new Map()
      for (const e of eventosDoRastreio) {
        for (const t of e.args?.selector_stats?.selector_timings ?? []) {
          const v = porSeletor.get(t.selector) ?? { us: 0, tentativas: 0, casou: 0, rejeitadoCedo: 0, folha: t.style_sheet_id }
          v.us += t["elapsed (us)"] ?? 0
          v.tentativas += t.match_attempts ?? 0
          v.casou += t.match_count ?? 0
          v.rejeitadoCedo += t.fast_reject_count ?? 0
          porSeletor.set(t.selector, v)
        }
      }
      const mutacoes = MUTACOES
        ? await page.evaluate(() => { globalThis.__obsMutacoes?.disconnect(); return [...globalThis.__mutacoes].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v} ${k}`) })
        : undefined
      resultado.rastreio[nome] = {
        ...contas,
        ...(mutacoes ? { mutacoes } : {}),
        ...(INVALIDACOES ? { invalidacoes: [...porInvalidacao].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${v} ${k}`) } : {}),
        porEvento: [...porNome].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${Math.round(v)} ms ${k}`),
        grandes: grandes.sort((a, b) => (b.ms ?? b.estilo) - (a.ms ?? a.estilo)).slice(0, 20),
        ...(SELETORES ? {
          seletoresUs: Math.round([...porSeletor.values()].reduce((t, v) => t + v.us, 0)),
          seletores: [...porSeletor].sort((a, b) => b[1].us - a[1].us).slice(0, 150).map(([k, v]) => ({ seletor: k, ...v, us: Math.round(v.us) })),
        } : {}),
      }
      console.log(`== rastreio ${nome}`, JSON.stringify(resultado.rastreio[nome]))
      return r
    }
    await comRastreio("canais", () => comPerfil("canais", async () => {
      const ordem = [...Array(Math.min(nCanais, 8)).keys()].concat([0, 1, 0])
      for (const i of ordem) {
        const t0 = await agora()
        // The first DOM change after the click, then the next frame: the timeline is on screen.
        // A MutationObserver, not a poll: the probe must not cost what it measures.
        await page.evaluate(() => {
          globalThis.__troca = new Promise((r) => {
            const tl = document.querySelector(".chat-main, main") ?? document.body
            const limite = setTimeout(() => (obs.disconnect(), r(-1)), 5_000)
            const obs = new MutationObserver(() => {
              obs.disconnect()
              clearTimeout(limite)
              requestAnimationFrame(() => {
                // What the first frame shows: lines drawn and the distance of the view to the bottom.
                const t = document.querySelector(".timeline")
                globalThis.__quadro1 = t ? { linhas: t.querySelectorAll(".message").length, aoFundo: Math.round(t.scrollHeight - t.scrollTop - t.clientHeight) } : null
                r(performance.now())
              })
            })
            obs.observe(tl, { childList: true, subtree: true })
          })
        })
        await canais.nth(i).click({ timeout: 10_000 }).catch(() => {})
        const fimTroca = await page.evaluate(() => globalThis.__troca)
        const toque = await page.evaluate(() => globalThis.__f.ultimoToque)
        await wait(1_200)
        const f = await sonda()
        // And 1.2 s later: a window that grew after the frame must leave the view where it was.
        const ecra = await page.evaluate(() => {
          const t = document.querySelector(".timeline")
          return { primeiro: globalThis.__quadro1 ?? null, depois: t ? { linhas: t.querySelectorAll(".message").length, aoFundo: Math.round(t.scrollHeight - t.scrollTop - t.clientHeight) } : null }
        })
        trocas.push({ canal: nomes[i]?.slice(0, 30), ms: fimTroca < 0 ? null : Math.round(fimTroca - toque), ecra, ...janela(f, t0, await agora()) })
      }
    }))
    const ms = trocas.map((t) => t.ms).filter((x) => x != null)
    fase("canais", { trocas, trocaP50Ms: p(ms, 0.5), trocaMaxMs: Math.max(0, ...ms), longaMaxMs: Math.max(0, ...trocas.map((t) => t.longaMaxMs)), inpMs: Math.max(0, ...trocas.map((t) => t.inpMs)) })

    // Back to the common room for the rest (the heaviest channel).
    const iSala = nomes.findIndex((n) => /orwell|comum/i.test(n))
    await canais.nth(Math.max(0, iSala)).click().catch(() => {})
    await wait(2_000)

    // ---- C. typing
    await comPerfil("escrever", async () => {
      const t0 = await agora()
      const caixa = page.locator(".composer-line input:not([type=file])").first()
      await caixa.click()
      await page.keyboard.type("Uma frase escrita devagar para medir a caixa de escrita.", { delay: 70 })
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.press("Backspace")
      await wait(500)
      fase("escrever", janela(await sonda(), t0, await agora()))
    })

    // ---- D. scrolling the common room
    await comRastreio("scroll", () => comPerfil("scroll", async () => {
      const t0 = await agora()
      const tl = page.locator(".timeline").first()
      const caixa = await tl.boundingBox()
      if (caixa) await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
      for (let k = 0; k < 30; k++) { await page.mouse.wheel(0, -500); await wait(80) }
      for (let k = 0; k < 30; k++) { await page.mouse.wheel(0, 500); await wait(80) }
      await wait(500)
      fase("scroll", janela(await sonda(), t0, await agora()))
    }))

    // ---- E. menus: settings, the members panel, a channel's context menu
    await comRastreio("menus", () => comPerfil("menus", async () => {
      const t0 = await agora()
      // Each action's own window too: which of them is slow (the INP is the worst one).
      const marcas = []
      const accao = async (nome, fn, ms) => { const a = await agora(); await fn(); await wait(ms); marcas.push({ nome, a, b: await agora() }) }
      for (let k = 0; k < 3; k++) {
        // Settings is a screen, not a sheet: open it, and back to the communities by the rail.
        await accao("definicoes", () => page.locator('button[aria-label="Configurações"], button[title="Configurações"]').first().click().catch(() => {}), 600)
        await accao("comunidades", () => page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {}), 600)
        await accao("menu-do-canal", () => canais.nth(0).click({ button: "right" }).catch(() => {}), 500)
        await accao("escape", () => page.keyboard.press("Escape"), 500)
        const membros = page.getByRole("button", { name: /membros/i }).first()
        if (await membros.count()) {
          await accao("membros-abrir", () => membros.click().catch(() => {}), 600)
          await accao("membros-fechar", () => membros.click().catch(() => {}), 600)
        }
      }
      const f = await sonda()
      const porAccao = {}
      for (const m of marcas) {
        const j = janela(f, m.a, m.b)
        porAccao[m.nome] = (porAccao[m.nome] ?? []).concat(j.inpMs)
      }
      fase("menus", { ...janela(f, t0, await agora()), porAccao })
    }))
    await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
    await wait(800)
    await canais.nth(Math.max(0, iSala)).click().catch(() => {})
    await wait(1_500)

    // ---- F. live messages one by one: main-thread CPU per message, minus idle
    const N = 20
    const repouso = await comPerfil("repouso", async () => {
      const t0 = await agora()
      await wait(N * 500)
      return { ...janela(await sonda(), t0, await agora()) }
    })
    const vivo = await comPerfil("ao-vivo", async () => {
      const t0 = await agora()
      for (let k = 0; k < N; k++) { await bruno.send(SALA, mensagem(`ao vivo ${k}`)); await wait(500) }
      const chegou = await ate(() => page.evaluate(() => document.querySelector(".timeline")?.textContent?.includes("ao vivo 19") ?? false), 30_000, 200)
      await wait(1_000)
      if (!chegou) {
        // Why not: what the screen shows, for whoever reads the result.
        await page.screenshot({ path: join(SAIDA, `${ROTULO}-ao-vivo.png`) })
        resultado.aoVivoNaoChegou = await page.evaluate(() => ({
          ultima: [...document.querySelectorAll(".timeline .message")].at(-1)?.textContent?.slice(0, 120) ?? null,
          titulo: document.querySelector("main header, .chat-header, h1, h2")?.textContent?.slice(0, 80) ?? null,
        }))
      }
      return { chegou, ...janela(await sonda(), t0, await agora()) }
    })
    const porMensagem = PERFIL ? +((cpuDoPerfil(perfis["ao-vivo"]) - cpuDoPerfil(perfis.repouso) * ((N * 500 + 1000) / (N * 500))) / N).toFixed(1) : null
    fase("ao-vivo", { ...vivo, repousoLongas: repouso.longas, msDeThreadPorMensagem: porMensagem })

    // ---- G. a burst of 200 messages
    await comPerfil("rajada", async () => {
      const t0 = await agora()
      const marca = `rajada-${Date.now()}`
      await bruno.sendBatch(SALA, Array.from({ length: 200 }, (_, k) => mensagem(`${marca} ${k}`)))
      const tEnviada = Date.now()
      const chegou = await ate(() => page.evaluate((m) => document.querySelector(".timeline")?.textContent?.includes(`${m} 199`) ?? false, marca), 60_000, 100)
      const msAteAUltima = chegou ? Date.now() - tEnviada : null
      await wait(2_000)
      fase("rajada", { msAteAUltima, ...janela(await sonda(), t0, await agora()) })
    })

    // ---- H. a new member joins the common room: a commit in a group of 400+ leaves
    await comPerfil("entrada", async () => {
      const t0 = await agora()
      const vault = new Vault(new CofreEmMemoria())
      await vault.create(FRASE_NO)
      const novo = new Session(vault)
      sessoes.push(novo)
      await novo.createIdentity(NOME)
      await novo.connect()
      const entrou = await ate(() => novo.channels.includes(SALA), 90_000)
      await wait(8_000)
      fase("entrada", { entrou, ...janela(await sonda(), t0, await agora()) })
    })

    const f = await sonda()
    resultado.total = janela(f, 0, await agora())
    resultado.heapMB = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576))
    gravar()
    console.log("== total", JSON.stringify(resultado.total))
  } catch (erro) {
    if (!erro?.fim) {
      console.error("O guião caiu:", erro?.stack ?? erro)
      console.error(casa.registo().slice(-1500))
    }
    if (!erro?.fim) {
      resultado.erro = String(erro?.message ?? erro)
      gravar()
    }
  } finally {
    for (const s of sessoes) s.disconnect()
    await nav?.close().catch(() => {})
    casa.fechar()
    rmSync(CORRIDA, { recursive: true, force: true })
  }
  console.log(`guardado em ${join(SAIDA, `${ROTULO}.json`)}`)
  process.exit(resultado.erro ? 1 : 0)
}

if (tem("--montar")) await montar()
else await medir()
