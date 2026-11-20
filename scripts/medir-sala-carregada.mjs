/**
 * A loaded account at startup and during a burst of channel state (hotfix 1.3.12).
 *
 *   npx tsc -b && npm run build -w @enclave/web     (and the server dist)
 *   node scripts/medir-sala-carregada.mjs --motor chromium --rotulo depois
 *   node scripts/medir-sala-carregada.mjs --motor webkit --dist <backups>/orwell/web-dist-1.3.10 --rotulo antes
 *
 * Owner reports, 12/11/2026, on 1.3.10: "the app restarts on mobile for no
 * obvious reason" (iPhone) and "every time, it does not respond after entering;
 * it freezes 15 to 20 seconds" (PC). The cause: every admin device said the whole
 * state of every channel it runs on every connection (~176 frames in `!984`),
 * and every receiver applied, wrote and rendered each frame.
 *
 * The case, built in Node against a disposable homeserver:
 *   - Dona (founder), Bruno and Carla (admins) in a room of `--membros` real MLS
 *     members (default 100), with `--atribuicoes` role assignments (default 150,
 *     past the real members they go to addresses with no account, which costs the
 *     receiver the same), 4 categories, 12 rooms and a banner.
 *   - Ana, in the browser, is an admin too, like the owner. Her vault is made big:
 *     `--imagens` messages with an inline image of ~900 KB each (default 16).
 *   - `--canais` more small channels with 30 messages (default 8).
 *
 * Measured, in the page, with a probe injected before the app:
 *   - vault writes (IndexedDB transactions on the `vault` record) and the largest one;
 *   - React commits (a stub devtools hook counts `onCommitFiberRoot`);
 *   - event-loop lag: a 50 ms timer that notes how late it fires. The max is the
 *     worst wait a click would have had; the sum over 50 ms is the blocked time;
 *   - Chromium: Long Tasks over 50 ms, JS heap peak, and a CPU profile of the
 *     first 30 s (top functions by own time);
 *   - WebKit: the peak RSS of the WebContent processes, sampled by `ps`.
 *
 * Two phases per run: a cold reopen after the old admins reconnected
 * `--religacoes` times while Ana was away (the backlog), then 20 s live while the
 * three old admins reconnect once more each. "Old" means they say the whole state
 * on connect, as 1.3.10 does (`republishAuthority` + `republishRooms`).
 *
 * ALL LOCAL: own homeserver in a temp folder, own ports (8520 and 8521, or
 * E2E_PORTA_DA_FRENTE / E2E_PORTA_DO_SERVIDOR), no way to point at production.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala } from "@enclave/protocol"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { levantarServidor } from "./frente-lenta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const argumento = (nome, omissao) => {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : omissao
}
const DIST = resolve(argumento("--dist", join(RAIZ, "apps/web/dist")).replace(/^~/, process.env.HOME ?? "~"))
const ROTULO = argumento("--rotulo", "agora")
const MOTOR = argumento("--motor", "chromium")
const MEMBROS = Number(argumento("--membros", 100))
const ATRIBUICOES = Number(argumento("--atribuicoes", 150))
const IMAGENS = Number(argumento("--imagens", 16))
const CANAIS = Number(argumento("--canais", 8))
const RELIGACOES = Number(argumento("--religacoes", 3))
const SAIDA = argumento("--saida", join(RAIZ, ".verify-data/medidas-1.3.12", `${ROTULO}-${MOTOR}.json`))
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8520)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8521)
const FRASE = "frase-de-verificacao-2026"
const TELEMOVEL = MOTOR === "webkit"

const casa = await levantarServidor({ dist: DIST, portaDaFrente: PORTA_DA_FRENTE, portaDoServidor: PORTA_DO_SERVIDOR, prefixo: "orwell-sala-carregada-" })
const { nome: NOME, app: APP, dados } = casa
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function ate(condicao, ms = 60_000, passo = 300) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await condicao().catch(() => false)) return true
    await wait(passo)
  }
  return false
}
class CofreEmMemoria {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(b) {
    this.bytes = b
  }
  async clear() {
    this.bytes = null
  }
}
const nodes = []
async function contaNoNode(nome, perfil = true) {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-de-teste-do-no")
  const session = new Session(vault)
  const id = await session.createIdentity(NOME)
  await session.connect()
  if (perfil) await session.updateProfile({ displayName: nome, donations: [] })
  const conta = { nome, session, address: id.address }
  nodes.push(conta)
  return conta
}
const mensagem = (body, attachments = []) => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments, links: [], mentions: [] })
function imagemInline(i) {
  // ~900 KB of base64 that does not compress: what a photo is to the vault.
  const bytes = new Uint8Array(660_000)
  for (let o = 0; o < bytes.length; o += 65_536) crypto.getRandomValues(bytes.subarray(o, Math.min(bytes.length, o + 65_536)))
  const inline = `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`
  return { url: "", inline, key: "", nonce: "", digest: "", kind: "image", name: `foto-${i}.jpg`, mediaType: "image/jpeg", byteLength: bytes.length }
}

/** In the page, before the app: vault writes, React commits, event-loop lag, long tasks. */
const SONDA = () => {
  const s = { escritas: 0, maiorEscrita: 0, emCurso: 0, maximoEmCurso: 0, commits: 0, atrasos: [], longas: [], heap: 0, t0: performance.now() }
  globalThis.__medida = s
  const transaccao = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (lojas, modo, ...resto) {
    const tx = transaccao.call(this, lojas, modo, ...resto)
    const nomes = Array.isArray(lojas) ? lojas : [lojas]
    if (modo === "readwrite" && nomes.includes("vault")) {
      let escreve = false
      tx.objectStore = function (nome) {
        const loja = IDBTransaction.prototype.objectStore.call(tx, nome)
        const put = loja.put
        loja.put = function (valor, chave) {
          if (chave === "current") {
            escreve = true
            const n = valor?.byteLength ?? valor?.length ?? 0
            s.maiorEscrita = Math.max(s.maiorEscrita, n)
          }
          return put.call(loja, valor, chave)
        }
        return loja
      }
      s.emCurso++
      s.maximoEmCurso = Math.max(s.maximoEmCurso, s.emCurso)
      const fim = () => {
        s.emCurso--
        if (escreve) s.escritas++
      }
      tx.addEventListener("complete", fim, { once: true })
      tx.addEventListener("abort", fim, { once: true })
    }
    return tx
  }
  // A stub devtools hook: React calls it on every commit, in production builds too.
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      const id = this.renderers.size + 1
      this.renderers.set(id, renderer)
      return id
    },
    onCommitFiberRoot() {
      s.commits++
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  }
  let esperado = performance.now() + 50
  setInterval(() => {
    const agora = performance.now()
    s.atrasos.push([Math.round(agora - s.t0), Math.round(agora - esperado)])
    esperado = agora + 50
    const memoria = performance.memory
    if (memoria) s.heap = Math.max(s.heap, memoria.usedJSHeapSize)
  }, 50)
  try {
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) s.longas.push([Math.round(e.startTime - s.t0), Math.round(e.duration)])
    }).observe({ type: "longtask", buffered: true })
  } catch {}
}

/** Peak RSS of WebKit's content processes, in MB, sampled until stopped. */
function vigiarRss() {
  let pico = 0
  const relogio = setInterval(() => {
    try {
      const saida = execFileSync("ps", ["-axo", "rss=,comm="], { encoding: "utf8" })
      let total = 0
      for (const linha of saida.split("\n")) if (/WebContent|WebProcess/i.test(linha)) total += Number(linha.trim().split(/\s+/)[0]) || 0
      pico = Math.max(pico, total / 1024)
    } catch {}
  }, 250)
  return () => {
    clearInterval(relogio)
    return Math.round(pico)
  }
}

function resumir(m, desde, ate_) {
  const atrasos = m.atrasos.filter(([t]) => t >= desde && t < ate_).map(([, a]) => a)
  const longas = m.longas.filter(([t]) => t >= desde && t < ate_)
  return {
    escritas: m.escritas,
    maiorEscritaMB: +(m.maiorEscrita / 1048576).toFixed(1),
    maisEscritasAoMesmoTempo: m.maximoEmCurso,
    commitsReact: m.commits,
    atrasoMaximoMs: atrasos.length ? Math.max(...atrasos) : null,
    bloqueadoMs: atrasos.reduce((soma, a) => soma + Math.max(0, a - 50), 0),
    tarefasLongas: longas.length,
    tarefasLongasMs: longas.reduce((soma, [, d]) => soma + d, 0),
    maiorTarefaLongaMs: longas.length ? Math.max(...longas.map(([, d]) => d)) : null,
    heapPicoMB: m.heap ? Math.round(m.heap / 1048576) : null,
    // The five worst waits, [ms since the probe started, ms late]: to read beside the profile.
    piores: m.atrasos.filter(([t]) => t >= desde && t < ate_).sort((a, b) => b[1] - a[1]).slice(0, 5),
  }
}

const resultado = { rotulo: ROTULO, motor: MOTOR, dist: DIST, membros: MEMBROS, atribuicoes: ATRIBUICOES, imagens: IMAGENS, canais: CANAIS, religacoes: RELIGACOES, fases: {} }
let browser
async function arrumar(codigo) {
  for (const n of nodes) n.session.disconnect()
  await browser?.close().catch(() => {})
  casa.fechar()
  process.exit(codigo)
}

/** What a 1.3.10 admin does on every connection. */
async function ligarComoAntigo(conta, canal) {
  conta.session.disconnect()
  await wait(200)
  await conta.session.connect()
  await conta.session.republishAuthority(canal).catch(() => {})
  await conta.session.republishRooms(canal).catch(() => {})
}

try {
  browser = await (TELEMOVEL ? webkit : chromium).launch({ headless: true, ...(TELEMOVEL ? {} : { args: ["--enable-precise-memory-info"] }) })
  const ctx = await browser.newContext(
    TELEMOVEL
      ? { locale: "pt-PT", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { locale: "pt-PT", viewport: { width: 1440, height: 900 } },
  )
  await ctx.addInitScript(SONDA)
  let page = await ctx.newPage()
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome: "Ana", frase: FRASE, servidor: NOME, memorizar: true, canalOficial: false })
  await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })
  const base = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
  const ana = base.prepare("SELECT address FROM accounts ORDER BY rowid ASC").get().address
  base.close()

  const t0 = Date.now()
  const dona = await contaNoNode("Dona")
  const bruno = await contaNoNode("Bruno")
  const carla = await contaNoNode("Carla")
  const canal = moradaDeSala(NOME)
  await dona.session.createSpaceChannel(canal, "Sala grande")
  await ate(async () => dona.session.founderOf(canal) === dona.address, 30_000)
  for (const quem of [bruno, carla]) await dona.session.seat(canal, quem.address)
  await dona.session.seat(canal, ana)
  // The other members: real leaves, seated one by one, then gone.
  for (let i = 0; i < MEMBROS - 4; i++) {
    const membro = await contaNoNode(`m${i}`, false)
    await dona.session.seat(canal, membro.address)
    membro.session.disconnect()
    if (i % 20 === 19) console.log(`  ..  ${i + 5} membros (${Math.round((Date.now() - t0) / 1000)} s)`)
  }
  const reais = dona.session.membersOf(canal).map(String).filter((a) => ![dona.address, ana, bruno.address, carla.address].includes(a))
  await dona.session.defineRole(canal, { role: "guarda", name: "Guarda", powers: ["convidar"] })
  await dona.session.assignRoles(canal, bruno.address, ["admin"])
  await dona.session.assignRoles(canal, carla.address, ["admin"])
  await dona.session.assignRoles(canal, ana, ["admin"])
  const atribuicoes = []
  for (let i = 0; i < ATRIBUICOES; i++) {
    const subject = reais[i] ?? `@sem-conta-${i}:${NOME}`
    atribuicoes.push({ t: "role.assign", subject, roles: ["guarda"], assignedAt: Date.now() + i })
  }
  await dona.session.sendBatch(canal, atribuicoes)
  for (const c of ["Geral", "Jogos", "Arquivo", "Voz"]) await dona.session.upsertCategory(canal, { category: c })
  for (let i = 0; i < 12; i++) await dona.session.upsertRoom(canal, { room: `sala-${i}`, name: `sala ${i}`, category: ["Geral", "Jogos", "Arquivo", "Voz"][i % 4] })
  await dona.session.updateSpaceMeta(canal, { name: "Sala grande", topic: "a sala de toda a gente" })
  for (let i = 0; i < IMAGENS; i++) await dona.session.send(canal, mensagem(`foto ${i}`, [imagemInline(i)]))
  for (let n = 0; n < CANAIS; n++) {
    const outro = moradaDeSala(NOME)
    await bruno.session.createSpaceChannel(outro, `canal ${n}`)
    await ate(async () => bruno.session.founderOf(outro) === bruno.address, 30_000)
    await bruno.session.seat(outro, ana)
    for (let i = 0; i < 30; i++) await bruno.session.send(outro, mensagem(`${i} no canal ${n}`))
  }
  console.log(`  ..  caso montado em ${Math.round((Date.now() - t0) / 1000)} s`)

  // Ana's app takes it all in, then closes.
  await ate(async () => (await page.locator(".channel-name").count()) >= CANAIS + 1, 240_000, 1_000)
  await ate(async () => (await page.evaluate(() => globalThis.__medida.escritas)) > 0, 30_000)
  await wait(15_000)
  const tamanho = await page.evaluate(() => globalThis.__medida.maiorEscrita)
  resultado.cofreMB = +(tamanho / 1048576).toFixed(1)
  console.log(`  ..  cofre da Ana: ${resultado.cofreMB} MB`)
  await page.close()

  // While Ana is away, the old admins reconnect: the backlog of a morning.
  for (let r = 0; r < RELIGACOES; r++) for (const admin of [dona, bruno, carla]) await ligarComoAntigo(admin, canal)
  for (let i = 0; i < 5; i++) await dona.session.send(canal, mensagem(`enquanto a Ana não estava ${i}`))
  await wait(2_000)

  // Phase 1: cold reopen, 30 s.
  let cdp = null
  const pararRss = TELEMOVEL ? vigiarRss() : null
  page = await ctx.newPage()
  if (!TELEMOVEL) {
    cdp = await ctx.newCDPSession(page)
    await cdp.send("Profiler.enable")
    await cdp.send("Profiler.setSamplingInterval", { interval: 1000 })
    await cdp.send("Profiler.start")
  }
  const inicio = Date.now()
  await page.goto(APP, { waitUntil: "commit" })
  const entrou = await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 120_000 }).then(() => Date.now() - inicio, () => -1)
  await wait(Math.max(0, 30_000 - (Date.now() - inicio)))
  const m1 = await page.evaluate(() => globalThis.__medida)
  resultado.fases.arranque = { msAteApp: entrou, ...resumir(m1, 0, 30_000), rssPicoMB: pararRss ? pararRss() : null }
  if (cdp) {
    const { profile } = await cdp.send("Profiler.stop")
    mkdirSync(join(RAIZ, ".verify-data/medidas-1.3.12"), { recursive: true })
    writeFileSync(SAIDA.replace(/\.json$/, ".cpuprofile"), JSON.stringify(profile))
  }
  console.log(`\n== ${ROTULO} ${MOTOR}: arranque`, JSON.stringify(resultado.fases.arranque))

  // Phase 2: live, the three old admins reconnect once more each.
  const pararRss2 = TELEMOVEL ? vigiarRss() : null
  const antes = await page.evaluate(() => ({ escritas: globalThis.__medida.escritas, commits: globalThis.__medida.commits, t: performance.now() - globalThis.__medida.t0 }))
  if (cdp) await cdp.send("Profiler.start")
  for (const admin of [dona, bruno, carla]) await ligarComoAntigo(admin, canal)
  await wait(20_000)
  if (cdp) {
    const { profile } = await cdp.send("Profiler.stop")
    writeFileSync(SAIDA.replace(/\.json$/, "-ao-vivo.cpuprofile"), JSON.stringify(profile))
  }
  const m2 = await page.evaluate(() => globalThis.__medida)
  const r2 = resumir(m2, antes.t, antes.t + 60_000)
  resultado.fases.aoVivo = { ...r2, escritas: m2.escritas - antes.escritas, commitsReact: m2.commits - antes.commits, rssPicoMB: pararRss2 ? pararRss2() : null }
  // Did the page survive? A killed WebContent reloads it: the probe starts over.
  resultado.fases.aoVivo.paginaViva = (await page.evaluate(() => globalThis.__medida.t0).catch(() => -1)) === m1.t0
  console.log(`== ${ROTULO} ${MOTOR}: ao vivo`, JSON.stringify(resultado.fases.aoVivo))
} catch (erro) {
  console.error("O guião caiu:", erro?.stack ?? erro)
  console.error(casa.registo().slice(-1500))
  await arrumar(1)
}
mkdirSync(join(RAIZ, ".verify-data/medidas-1.3.12"), { recursive: true })
writeFileSync(SAIDA, JSON.stringify(resultado, null, 2))
console.log(`\nguardado em ${SAIDA}`)
await arrumar(0)
