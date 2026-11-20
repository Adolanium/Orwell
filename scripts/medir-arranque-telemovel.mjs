/**
 * Phone startup, measured by phase, on a loaded account.
 *
 *   node scripts/medir-arranque-telemovel.mjs                 (needs `npm run build` first)
 *   node scripts/medir-arranque-telemovel.mjs --dist <folder> --rotulo antes
 *   node scripts/medir-arranque-telemovel.mjs --motor webkit
 *   node scripts/medir-arranque-telemovel.mjs --sem-pc        (the computer closes before the phone reloads)
 *
 * The bug: "the phone loading is extremely slow". This
 * script builds the case and times it:
 *
 *   1. Ana creates her account on a desktop browser. Bruno, a core account in
 *      Node, makes three channels with Ana seated and writes in each, plus a
 *      direct chat with Ana. All before the phone exists.
 *   2. A phone (390x844, touch) pairs by link, with "Remember session" on (the
 *      default the screen offers), and waits for the history to arrive.
 *   3. The phone closes. Bruno writes more, so the next start has catch-up work.
 *   4. The phone opens again under a phone profile: CPU 4x slower (Chromium,
 *      by CDP) and a slow 4G link (150 ms round trip, 1.6 Mbit/s down, 750
 *      kbit/s up), applied at TCP level by the front below, so it covers the
 *      bundle AND the WebSocket, in every engine.
 *   5. A second cold open with the password typed (no remembered session), to
 *      measure the key derivation on its own.
 *
 * Phases come from inside the page: a `WebSocket` wrapper notes when each
 * frame type first goes out and comes in, a `MutationObserver` notes when the
 * screen reaches each milestone, and `performance` marks named `orwell:*` add
 * what the app itself says (none in builds before 12/11/2026; the frames and
 * the screen still split the time).
 *
 * ALL LOCAL AND ALL DISPOSABLE: its own homeserver in a temp folder, its own
 * ports (8496 and 8497, or E2E_PORTA_DA_FRENTE / E2E_PORTA_DO_SERVIDOR), and no
 * way to point it at production.
 */
import { writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala } from "@enclave/protocol"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { irParaEmparelhar } from "./fase7-comum.mjs"
import { levantarServidor } from "./frente-lenta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const argumento = (nome, omissao) => {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : omissao
}
const DIST = resolve(argumento("--dist", join(RAIZ, "apps/web/dist")))
const ROTULO = argumento("--rotulo", "agora")
const MOTOR = argumento("--motor", "chromium")
const SEM_PC = process.argv.includes("--sem-pc")
/** A Windows machine may have reduced motion on: the opening must not get longer there. */
const REDUZIDO = process.argv.includes("--movimento-reduzido")
/** Only the remembered-session opens (no password open): quicker, for the opening measures. */
const SO_REABRIR = process.argv.includes("--so-reabrir")
const MENSAGENS = Number(argumento("--mensagens", 60))
/**
 * A loaded common room, built while the phone is closed: `--membros N` more
 * core accounts join it (N commits; production has 409 members), and each one
 * writes `--sala-comum-depois M` messages there.
 */
const MEMBROS = Number(argumento("--membros", 0))
const NA_SALA_DEPOIS = Number(argumento("--sala-comum-depois", 0))
const SAIDA = argumento("--saida", null)
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8496)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8497)
const FRASE = "frase-de-verificacao-2026"

let casa
try {
  casa = await levantarServidor({ dist: DIST, portaDaFrente: PORTA_DA_FRENTE, portaDoServidor: PORTA_DO_SERVIDOR, prefixo: "orwell-medir-arranque-" })
} catch (erro) {
  console.error(erro.message)
  process.exit(2)
}
const { nome: NOME, app: APP, dados, rede: REDE } = casa
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function ate(condicao, ms = 60_000, passo = 500) {
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
async function contaNoNode(nome) {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-de-teste-do-no")
  const session = new Session(vault)
  const id = await session.createIdentity(NOME)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  const conta = { nome, session, address: id.address }
  nodes.push(conta)
  return conta
}
const mensagem = (body) => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: [], links: [], mentions: [] })

/** What the page notes about itself: frames by type, screen milestones, marks. */
const SONDA = () => {
  const t0 = performance.timeOrigin
  const notas = { frames: {}, ecra: {}, contagens: { enviadas: 0, recebidas: 0, backfillPaginas: 0 } }
  window.__arranque = notas
  const marcar = (saco, nome) => {
    if (saco[nome] === undefined) saco[nome] = performance.now()
  }
  const Original = window.WebSocket
  class Sonda extends Original {
    constructor(...a) {
      super(...a)
      marcar(notas.frames, "ws:new")
      this.addEventListener("open", () => marcar(notas.frames, "ws:open"))
      this.addEventListener("message", (e) => {
        notas.contagens.recebidas++
        try {
          const t = JSON.parse(String(e.data)).t
          marcar(notas.frames, `<${t}`)
          if (t === "channel.backfill.page") {
            notas.contagens.backfillPaginas++
            notas.frames["<channel.backfill.page:last"] = performance.now()
          }
        } catch {}
      })
    }
    send(d) {
      notas.contagens.enviadas++
      try {
        const t = JSON.parse(String(d)).t
        marcar(notas.frames, `>${t}`)
        if (t === "channel.backfill") notas.frames[">channel.backfill:last"] = performance.now()
      } catch {}
      return super.send(d)
    }
  }
  window.WebSocket = Sonda
  const olhar = () => {
    const d = document
    if (d.querySelector(".abertura")) marcar(notas.ecra, "splash")
    if (d.querySelector(".gate-card")) marcar(notas.ecra, "portao")
    if (d.querySelector('button[aria-label="Configurações"]') || [...d.querySelectorAll("button")].some((b) => b.textContent === "Configurações" || b.getAttribute("aria-label") === "Configurações")) marcar(notas.ecra, "app")
    if (d.querySelector(".channel-name")) marcar(notas.ecra, "canais")
    if (d.querySelector(".message, .msg, [data-message-id]")) marcar(notas.ecra, "mensagem")
    if (d.querySelector('textarea[placeholder="Escreve uma mensagem"]')) marcar(notas.ecra, "caixa")
    // Usable: the app is there, and the opening (and its fading copy) no longer covers it.
    const html = d.documentElement
    if (notas.ecra.app !== undefined && !d.querySelector(".abertura") && !html.classList.contains("abertura-a-segurar") && !html.classList.contains("abertura-a-sair")) marcar(notas.ecra, "utilizavel")
  }
  new MutationObserver(olhar).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] })
  void t0
}

const resultado = { rotulo: ROTULO, motor: MOTOR, semPc: SEM_PC, reduzido: REDUZIDO, rede: REDE, cpu: MOTOR === "chromium" ? 4 : 1, corridas: [] }
let browserPc
let browserTel
async function arrumar(codigo) {
  for (const n of nodes) n.session.disconnect()
  await browserPc?.close().catch(() => {})
  await browserTel?.close().catch(() => {})
  casa.fechar()
  process.exit(codigo)
}

async function medirAbertura(ctx, rotulo, { frase = null, alvo } = {}) {
  const page = await ctx.newPage()
  if (MOTOR === "chromium") {
    const cdp = await ctx.newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  }
  casa.redeLenta(true)
  const inicio = Date.now()
  await page.goto(APP, { waitUntil: "commit" })
  if (frase) {
    const campo = page.locator('.gate-card input[type="password"]').first()
    await campo.waitFor({ timeout: 120_000 })
    const caixa = page.locator('input[name="memorizar"]')
    if (await caixa.count()) await caixa.setChecked(false)
    await campo.fill(frase)
    await page.evaluate(() => (window.__arranque.ecra.submeteu = performance.now()))
    await page.keyboard.press("Enter")
  }
  const entrou = await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 180_000 }).then(() => true, () => false)
  const tEntrou = Date.now() - inicio
  // The first conversation the person opens: the channel with most history.
  let tConversa = -1
  if (entrou && alvo) {
    const t = Date.now()
    const vista = await ate(async () => {
      const gaveta = page.getByRole("button", { name: "Abrir o painel lateral" })
      if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) !== "true") await gaveta.click({ timeout: 2_000 }).catch(() => {})
      await page.locator(".channel-name", { hasText: alvo.canal }).first().click({ timeout: 2_000 }).catch(() => {})
      return (await page.locator("body").innerText()).includes(alvo.texto)
    }, 120_000, 300)
    tConversa = vista ? Date.now() - inicio : -1
    void t
  }
  // Wait for the background work to settle (no new backfill page for 3 s).
  await ate(async () => {
    const n = await page.evaluate(() => window.__arranque.frames["<channel.backfill.page:last"] ?? 0)
    const agora = await page.evaluate(() => performance.now())
    return agora - n > 3_000
  }, 120_000, 1_000)
  const notas = await page.evaluate(async () => ({
    ...window.__arranque,
    marcas: performance.getEntriesByType("mark").filter((m) => m.name.startsWith("orwell:")).map((m) => [m.name, Math.round(m.startTime)]),
    recuperacoes: performance
      .getEntriesByType("measure")
      .filter((m) => m.name === "orwell:recuperar")
      .map((m) => ({ canal: String(m.detail?.canal ?? "").slice(0, 12), inicio: Math.round(m.startTime), ms: Math.round(m.duration), eventos: m.detail?.eventos, commits: m.detail?.commits })),
    cofreBytes: await new Promise((r) => {
      const o = indexedDB.open("enclave", 1)
      o.onsuccess = () => {
        const g = o.result.transaction("vault", "readonly").objectStore("vault").get("current")
        g.onsuccess = () => r(g.result ? g.result.byteLength ?? g.result.length ?? 0 : 0)
        g.onerror = () => r(-1)
      }
      o.onerror = () => r(-1)
    }),
    nav: (() => {
      const n = performance.getEntriesByType("navigation")[0]
      return n ? { domInteractive: Math.round(n.domInteractive), domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null
    })(),
    recursos: performance.getEntriesByType("resource").filter((r) => /\.js$|\.css$/.test(r.name)).map((r) => [r.name.split("/").pop(), Math.round(r.responseEnd), r.transferSize]),
  }))
  const bytesDescidos = casa.bytesDescidos()
  casa.redeLenta(false)
  const arredondar = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]))
  const corrida = { cofreBytes: notas.cofreBytes, recuperacoes: notas.recuperacoes, rotulo, entrou, msAteApp: tEntrou, msAteConversa: tConversa, bytesDescidos, nav: notas.nav, frames: arredondar(notas.frames), ecra: arredondar(notas.ecra), contagens: notas.contagens, marcas: notas.marcas, recursos: notas.recursos }
  resultado.corridas.push(corrida)
  console.log(`\n== ${rotulo}: app em ${tEntrou} ms, conversa em ${tConversa} ms, ${Math.round(bytesDescidos / 1024)} KiB descidos`)
  console.log("   ecrã:", JSON.stringify(corrida.ecra))
  console.log("   tramas:", JSON.stringify(Object.fromEntries(Object.entries(corrida.frames).filter(([k]) => /ws:|hello|auth|subscribe|backfill|welcome|keypackage|pronto|cofre|estado/.test(k)))))
  console.log("   contagens:", JSON.stringify(corrida.contagens), "marcas:", JSON.stringify(corrida.marcas))
  console.log(`   cofre: ${(notas.cofreBytes / 1_048_576).toFixed(2)} MB; recuperação por canal: ${JSON.stringify(notas.recuperacoes)}`)
  await page.close()
  return corrida
}

try {
  const motorTel = MOTOR === "webkit" ? webkit : chromium
  browserPc = await chromium.launch({ headless: true })
  const ctxPc = await browserPc.newContext({ locale: "pt-PT" })
  const pc = await ctxPc.newPage()
  await pc.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(pc, { nome: "Ana", frase: FRASE, servidor: NOME })
  await pc.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })
  const base = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
  const ana = base.prepare("SELECT address FROM accounts ORDER BY rowid ASC").get().address
  base.close()

  // Bruno: three channels with Ana seated, and a direct chat.
  const bruno = await contaNoNode("Bruno")
  const canais = []
  for (const n of [1, 2, 3]) {
    const canal = moradaDeSala(NOME)
    await bruno.session.createSpaceChannel(canal, `canal ${n}`)
    await ate(async () => bruno.session.founderOf(canal) === bruno.address, 30_000, 300)
    await bruno.session.seat(canal, ana)
    canais.push(canal)
  }
  const dm = await bruno.session.openDirect(ana)
  await ate(async () => bruno.session.channels.includes(dm), 30_000, 300)
  const t0 = Date.now()
  for (const canal of canais) for (let i = 1; i <= MENSAGENS; i++) await bruno.session.send(canal, mensagem(`${i} antes no ${canais.indexOf(canal) + 1}`))
  for (let i = 1; i <= MENSAGENS; i++) await bruno.session.send(dm, mensagem(`${i} antes na directa`))
  console.log(`  ..  Bruno escreveu ${MENSAGENS * 4} mensagens em ${Date.now() - t0} ms`)
  // Ana's desktop sees all channels before pairing.
  await ate(async () => (await pc.locator(".channel-name").count()) >= 4, 90_000)
  await wait(3_000)

  // Pair the phone (no throttling here: we measure the opens after).
  await pc.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await pc.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await pc.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  browserTel = await motorTel.launch({ headless: true })
  const ctxTel = await browserTel.newContext({ ...(REDUZIDO ? { reducedMotion: "reduce" } : {}), locale: "pt-PT", viewport: { width: 390, height: 844 }, deviceScaleFactor: MOTOR === "webkit" ? 3 : 2, isMobile: MOTOR !== "firefox", hasTouch: true })
  await ctxTel.addInitScript(SONDA)
  const tel = await ctxTel.newPage()
  await tel.goto(APP, { waitUntil: "domcontentloaded" })
  await irParaEmparelhar(tel)
  await tel.getByLabel("Ou cola o link").fill(link)
  await tel.getByRole("button", { name: "Continuar" }).click()
  await tel.getByRole("heading", { name: "Palavra-passe deste aparelho" }).waitFor({ timeout: 10_000 })
  const frases = tel.locator('.gate-card input[type="password"]')
  await frases.nth(0).fill(FRASE)
  await frases.nth(1).fill(FRASE)
  const caixa = tel.locator('input[name="memorizar"]')
  if (await caixa.count()) await caixa.setChecked(true)
  await tel.getByRole("button", { name: "Continuar" }).click()
  await tel.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await tel.getByRole("button", { name: "São as mesmas" }).click()
  await folha.getByRole("button", { name: "São as mesmas" }).click()
  await tel.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 })
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await tel.getByRole("button", { name: "Entrar", exact: true }).click()
  await tel.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })
  const histOk = await ate(async () => (await tel.locator(".barra-historico").count()) === 0 && (await tel.locator(".channel-name").count()) >= 4, 240_000, 2_000)
  console.log(`  ..  telemóvel emparelhado; histórico e canais ${histOk ? "chegaram" : "NÃO chegaram em 4 min"}`)
  await wait(4_000)
  await tel.close()

  // More while the phone is closed: work for the next start's catch-up.
  for (const canal of canais) for (let i = 1; i <= 20; i++) await bruno.session.send(canal, mensagem(`${i} depois no ${canais.indexOf(canal) + 1}`))
  if (MEMBROS > 0 || NA_SALA_DEPOIS > 0) {
    const t1 = Date.now()
    const entram = []
    for (let i = 0; i < MEMBROS; i++) entram.push(await contaNoNode(`Membro ${i + 1}`))
    const sala = casa.salaComum
    await ate(async () => entram.every((c) => c.session.channels.includes(sala)), 600_000, 1_000)
    const escrevem = [bruno, ...entram]
    for (let i = 1; i <= NA_SALA_DEPOIS; i++) {
      await Promise.all(escrevem.map((c) => c.session.send(sala, mensagem(`sala ${i} de ${c.nome}`)).catch(() => {})))
    }
    const base2 = new DatabaseSync(casa.base, { readOnly: true })
    const linhas = base2.prepare("SELECT kind, count(*) AS n FROM events WHERE channel = ? GROUP BY kind").all(sala)
    base2.close()
    console.log(`  ..  sala comum com o telemóvel fechado: ${MEMBROS} membros novos, ${NA_SALA_DEPOIS * escrevem.length} mensagens, em ${Date.now() - t1} ms; eventos no servidor: ${JSON.stringify(linhas)}`)
    // The new members go away: the phone opens alone with them, like most of the 409.
    for (const c of entram) c.session.disconnect()
  }
  if (SEM_PC) await ctxPc.close()

  await medirAbertura(ctxTel, "reabrir (sessão memorizada)", { alvo: { canal: "canal 1", texto: "20 depois no 1" } })
  await medirAbertura(ctxTel, "reabrir outra vez (sem trabalho novo)", { alvo: { canal: "canal 1", texto: "20 depois no 1" } })
  if (SO_REABRIR) throw new Error("fim (--so-reabrir)")
  // Forget the remembered session: the next open asks for the password.
  const p = await ctxTel.newPage()
  await p.goto(APP, { waitUntil: "domcontentloaded" })
  await p.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })
  await p.evaluate(async () => {
    // The remembered-session record lives beside the vault: the gate shows the password again without it.
    await new Promise((r) => {
      const o = indexedDB.open("enclave", 1)
      o.onsuccess = () => {
        const tx = o.result.transaction(o.result.objectStoreNames, "readwrite")
        for (const nome of o.result.objectStoreNames) {
          const loja = tx.objectStore(nome)
          const pedido = loja.getAllKeys()
          pedido.onsuccess = () => {
            for (const k of pedido.result) if (String(k).includes("sess")) loja.delete(k)
          }
        }
        tx.oncomplete = () => r()
        tx.onerror = () => r()
      }
      o.onerror = () => r()
    })
    sessionStorage.clear()
  })
  await p.close()
  await medirAbertura(ctxTel, "abrir com palavra-passe (KDF)", { frase: FRASE, alvo: { canal: "canal 1", texto: "20 depois no 1" } })
} catch (erro) {
  console.error("O guião caiu:", erro?.stack ?? erro)
  console.error(casa.registo().slice(-1500))
  if (SAIDA) writeFileSync(SAIDA, JSON.stringify(resultado, null, 2))
  await arrumar(1)
}
if (SAIDA) writeFileSync(SAIDA, JSON.stringify(resultado, null, 2))
await arrumar(0)
