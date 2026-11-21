/**
 * The paired phone works like the main device, also with the computer off.
 *
 *   node scripts/e2e-telemovel-paridade.mjs              (needs `npm run build` first)
 *   node scripts/e2e-telemovel-paridade.mjs --motor webkit
 *
 * Owner (12/11/2026): "I want full parity on the phone", and the users'
 * complaint behind it: on the phone the history did not show for four to five
 * hours. The model is the linked devices of the big messengers: the main device
 * passes history and state to the phone, end to end, and from then on the phone
 * stands alone.
 *
 * What runs:
 *   1. Ana creates her account on a computer browser. A busy common room:
 *      three core accounts in Node (Bruno, Carla, Dani) join it and write
 *      `--sala-comum` messages each. Bruno also opens three channels with Ana
 *      seated, writes in each, and a direct chat with Ana.
 *   2. A phone (390x844, touch) pairs by link. Measured: the seconds until the
 *      phone SHOWS the oldest message of a channel and of the direct chat, and
 *      until its vault has every channel's history.
 *   3. The computer closes for good. Bruno writes more.
 *   4. The phone opens again on a slow link (CPU 4x and slow 4G in Chromium):
 *      it shows the old history and the new messages, it sends in a channel and
 *      in the direct chat and Bruno reads both, Bruno answers and the phone
 *      reads it.
 *   5. The phone reloads once more: everything is still there.
 *
 * ALL LOCAL AND ALL DISPOSABLE: `frente-lenta.mjs` (own homeserver in a temp
 * folder, ports 8498/8499 or E2E_PORTA_DA_FRENTE / E2E_PORTA_DO_SERVIDOR), and
 * no way to point it at production.
 */
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala } from "@enclave/protocol"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { irParaEmparelhar } from "./fase7-comum.mjs"
import { appAberta, escolherComunidade, irParaDirectas, textoNoEcra } from "./separadores.mjs"
import { levantarServidor } from "./frente-lenta.mjs"
import { colarCodigo, confirmarEAbrir } from "./juntar-aparelho.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const argumento = (nome, omissao) => {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : omissao
}
const DIST = resolve(argumento("--dist", join(RAIZ, "apps/web/dist")))
const MOTOR = argumento("--motor", "chromium")
const NA_SALA_COMUM = Number(argumento("--sala-comum", 150))
const MENSAGENS = Number(argumento("--mensagens", 40))
/** Messages EACH Node account writes in the common room while the phone is closed (production: ~10 000 events in 12 h). */
const NA_SALA_DEPOIS = Number(argumento("--sala-comum-depois", 0))
const FRASE = "frase-de-verificacao-2026"

const resultados = []
function check(nome, ok, detalhe = "") {
  resultados.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
  return Boolean(ok)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function ate(condicao, ms = 60_000, passo = 500) {
  const inicio = Date.now()
  while (Date.now() - inicio < ms) {
    if (await condicao().catch(() => false)) return Date.now() - inicio
    await wait(passo)
  }
  return -1
}

let casa
try {
  casa = await levantarServidor({
    dist: DIST,
    portaDaFrente: Number(process.env.E2E_PORTA_DA_FRENTE ?? 8498),
    portaDoServidor: Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8499),
    prefixo: "orwell-e2e-telemovel-paridade-",
  })
} catch (erro) {
  console.error(erro.message)
  process.exit(2)
}
const { nome: NOME, app: APP } = casa

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
  // The common room is opt-in since 12/11/2026: these accounts tick the box, as the harness does.
  await session.escolherSalaComum(true)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  const conta = { nome, session, vault, address: id.address }
  nodes.push(conta)
  return conta
}
const mensagem = (body) => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: [], links: [], mentions: [] })
/** The bodies a core account holds for a channel. */
const corposNoNode = (conta, canal) => [...(conta.vault.contents.history?.[canal] ?? [])].map((e) => e.payload?.body).filter(Boolean)

/** The phone's vault, read from IndexedDB and opened with the passphrase, here in Node. */
async function cofreDe(page) {
  const bruto = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const pedido = indexedDB.open("enclave", 1)
        pedido.onerror = () => reject(pedido.error)
        pedido.onsuccess = () => {
          const leitura = pedido.result.transaction("vault", "readonly").objectStore("vault").get("current")
          leitura.onsuccess = () => resolve(leitura.result ? new TextDecoder().decode(leitura.result) : null)
          leitura.onerror = () => reject(leitura.error)
        }
      }),
  )
  if (!bruto) return null
  const ficheiro = JSON.parse(bruto.startsWith("orwv2\n") ? bruto.slice(6) : bruto)
  const b64 = (t) => Buffer.from(t.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  const chave = argon2id(new TextEncoder().encode(FRASE), b64(ficheiro.salt), { t: 3, m: 65_536, p: 4, dkLen: 32 })
  return JSON.parse(new TextDecoder().decode(xchacha20poly1305(chave, b64(ficheiro.nonce)).decrypt(b64(ficheiro.ciphertext))))
}
const corposNoCofre = (cofre, canal) => [...(cofre?.history?.[canal] ?? [])].map((e) => e.payload?.body).filter(Boolean)

/**
 * Open a channel by its name on the phone (its face on the rail of
 * communities, then its line: the conversation is pushed full screen), and
 * say whether `texto` shows in it.
 */
async function abrirEVer(page, rotulo, texto) {
  await escolherComunidade(page, rotulo, { timeout: 2_000 }).catch(() => {})
  await page.locator(".sidebar .channel-name", { hasText: rotulo }).first().click({ timeout: 2_000 }).catch(() => {})
  return (await textoNoEcra(page)).includes(texto)
}
/** Open the direct chat from the Messages tab, and say whether `texto` shows in it. */
async function abrirDirectaEVer(page, texto) {
  await irParaDirectas(page).catch(() => {})
  await page.locator(".direct-open").first().click({ timeout: 2_000 }).catch(() => {})
  return (await textoNoEcra(page)).includes(texto)
}
async function dizer(page, frase) {
  const caixa = page.locator('textarea[placeholder="Escreve uma mensagem"]')
  await caixa.click()
  await caixa.fill(frase)
  await page.keyboard.press("Enter")
  // With a finger (a touch context), Enter starts a new line and the send
  // button sends (1.3.25). The text is still in the box: send it.
  if ((await caixa.inputValue().catch(() => "")) !== "") await page.locator("form.chat-composer .composer-enviar").first().click()
}

let browserPc
let browserTel
async function arrumar(codigo) {
  for (const n of nodes) n.session.disconnect()
  await browserPc?.close().catch(() => {})
  await browserTel?.close().catch(() => {})
  casa.fechar()
  process.exit(codigo)
}

const erros = []
try {
  // ---------------------------------------------------------------------------
  // 1. Ana on the computer, a busy common room, and Bruno's channels.
  // ---------------------------------------------------------------------------
  browserPc = await chromium.launch({ headless: true })
  const ctxPc = await browserPc.newContext({ locale: "pt-PT" })
  const pc = await ctxPc.newPage()
  pc.on("pageerror", (e) => erros.push(`pc: ${e.message}`))
  await pc.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(pc, { nome: "Ana", frase: FRASE, servidor: NOME })
  await pc.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })
  const base = new DatabaseSync(casa.base, { readOnly: true })
  const ana = base.prepare("SELECT address FROM accounts ORDER BY rowid ASC").get().address
  base.close()

  const bruno = await contaNoNode("Bruno")
  const carla = await contaNoNode("Carla")
  const dani = await contaNoNode("Dani")
  const sala = casa.salaComum
  const dentroDaSala = await ate(async () => [bruno, carla, dani].every((c) => c.session.channels.includes(sala)), 90_000)
  check("três contas no Node entram na sala comum", dentroDaSala >= 0)
  const t0 = Date.now()
  for (let i = 1; i <= NA_SALA_COMUM; i++) {
    for (const conta of [bruno, carla, dani]) await conta.session.send(sala, mensagem(`sala ${i} de ${conta.nome}`)).catch(() => {})
  }
  console.log(`  ..  ${NA_SALA_COMUM * 3} mensagens na sala comum em ${Date.now() - t0} ms`)

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
  // Direct chats are between friends: Bruno asks, Ana accepts on the computer.
  await bruno.session.sendFriendRequest(dm)
  await pc.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await pc.locator(".people-tabs").getByRole("button", { name: /^Recebidos/ }).click()
  const aceitar = pc.locator(".people-requests").getByRole("button", { name: "Aceitar" }).first()
  check("a Ana aceita a amizade do Bruno no computador", (await ate(() => aceitar.isVisible(), 60_000)) >= 0)
  await aceitar.click()
  check("são amigos", (await ate(async () => bruno.session.friendTies().get(ana)?.link === "amigos", 60_000)) >= 0)
  for (const [i, canal] of canais.entries()) for (let k = 1; k <= MENSAGENS; k++) await bruno.session.send(canal, mensagem(`${k} antes no ${i + 1}`))
  for (let k = 1; k <= MENSAGENS; k++) await bruno.session.send(dm, mensagem(`${k} antes na directa`))
  // The channel list lives in "Comunidades"; the friendship step left the computer in "Amigos".
  await pc.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  check("o computador vê os três canais", (await ate(async () => (await pc.locator(".channel-name").count()) >= 4, 90_000)) >= 0)
  await wait(3_000)

  // ---------------------------------------------------------------------------
  // 2. Pairing, and the seconds until the phone shows the history.
  // ---------------------------------------------------------------------------
  await pc.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await pc.getByRole("button", { name: "Conta e segurança", exact: true }).click()
  await pc.getByRole("button", { name: "Juntar um aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  browserTel = await (MOTOR === "webkit" ? webkit : chromium).launch({ headless: true })
  const ctxTel = await browserTel.newContext({ locale: "pt-PT", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  let tel = await ctxTel.newPage()
  tel.on("pageerror", (e) => erros.push(`telemóvel: ${e.message}`))
  await tel.goto(APP, { waitUntil: "domcontentloaded" })
  await irParaEmparelhar(tel)
  await colarCodigo(tel, folha, link)
  /*
    "Deixa este aparelho ligado" (16/11/2026): on the computer, in the sheet where
    the pairing ends, while the history goes to the phone. Watched from the yes to
    the end of the transfer: what it said, and whether it closed by itself.
  */
  const avisoNoPc = { visto: "", fechou: false, parar: false }
  const vigiaDoPc = (async () => {
    while (!avisoNoPc.parar) {
      const textos = await pc.locator(".barra-envio").allInnerTexts().catch(() => [])
      if (textos.length > 0) avisoNoPc.visto = textos[0]
      else if (avisoNoPc.visto) avisoNoPc.fechou = true
      await wait(100)
    }
  })()
  await confirmarEAbrir(tel, folha, FRASE)
  const tPar = Date.now()
  // The sheet stays open on the computer: that is where "Keep this device on" shows.
  await appAberta(tel, 90_000)
  const msDentro = Date.now() - tPar

  const msCanal = await ate(() => abrirEVer(tel, "canal 1", "1 antes no 1"), 600_000, 1_000)
  check("o telemóvel MOSTRA a primeira mensagem de um canal, anterior a ele", msCanal >= 0, `${Math.round((msDentro + Math.max(0, msCanal)) / 100) / 10} s depois do sim`)
  const msDirecta = await ate(() => abrirDirectaEVer(tel, "1 antes na directa"), 300_000, 1_000)
  check("e a primeira mensagem da conversa directa", msDirecta >= 0, `${Math.round((Date.now() - tPar) / 100) / 10} s depois do sim`)
  let cofreTel = null
  const msTudo = await ate(async () => {
    cofreTel = await cofreDe(tel)
    return canais.every((c, i) => corposNoCofre(cofreTel, c).includes(`1 antes no ${i + 1}`)) && corposNoCofre(cofreTel, dm).includes("1 antes na directa")
  }, 300_000, 3_000)
  check("o cofre do telemóvel tem o histórico de todos os canais", msTudo >= 0, `${Math.round((Date.now() - tPar) / 100) / 10} s depois do sim`)
  // The computer's notice: it showed the approved text with the progress, and it closes once the phone has it all.
  check(
    'o computador mostrou "Deixa este aparelho ligado" com o progresso, durante a passagem',
    avisoNoPc.visto.includes("Deixa este aparelho ligado") && /Enviado: \d+ de \d+ mensagens/.test(avisoNoPc.visto),
    avisoNoPc.visto.replace(/\n/g, " | ").slice(0, 200),
  )
  check("e o aviso fecha sozinho quando o telemóvel tem tudo", (await ate(async () => avisoNoPc.fechou, 180_000, 500)) >= 0)
  avisoNoPc.parar = true
  await vigiaDoPc
  const naSala = corposNoCofre(cofreTel, sala).filter((b) => b.startsWith("sala ")).length
  console.log(`  ..  mensagens da sala comum no cofre do telemóvel: ${naSala}`)

  // ---------------------------------------------------------------------------
  // 3. The computer goes away for good. Bruno writes more.
  // ---------------------------------------------------------------------------
  await wait(3_000)
  await tel.close()
  await ctxPc.close()
  check("o computador fecha (e não volta)", true)
  for (const [i, canal] of canais.entries()) for (let k = 1; k <= 5; k++) await bruno.session.send(canal, mensagem(`${k} depois no ${i + 1}`))
  await bruno.session.send(dm, mensagem("depois na directa"))
  if (NA_SALA_DEPOIS > 0) {
    const t1 = Date.now()
    for (let i = 1; i <= NA_SALA_DEPOIS; i++) {
      await Promise.all([bruno, carla, dani].map((conta) => conta.session.send(sala, mensagem(`sala depois ${i} de ${conta.nome}`)).catch(() => {})))
    }
    console.log(`  ..  ${NA_SALA_DEPOIS * 3} mensagens na sala comum com o telemóvel fechado, em ${Date.now() - t1} ms`)
  }

  // ---------------------------------------------------------------------------
  // 4. The phone alone, on a slow link.
  // ---------------------------------------------------------------------------
  casa.redeLenta(true)
  tel = await ctxTel.newPage()
  tel.on("pageerror", (e) => erros.push(`telemóvel: ${e.message}`))
  if (MOTOR === "chromium") await (await ctxTel.newCDPSession(tel)).send("Emulation.setCPUThrottlingRate", { rate: 4 })
  const tAbre = Date.now()
  await tel.goto(APP, { waitUntil: "commit" })
  await appAberta(tel, 120_000)
  const msApp = Date.now() - tAbre
  const msVelho = await ate(() => abrirEVer(tel, "canal 1", "1 antes no 1"), 60_000, 500)
  check("sem o computador, o telemóvel abre e mostra o histórico antigo", msVelho >= 0, `app em ${msApp} ms, histórico em ${msApp + Math.max(0, msVelho)} ms`)
  const msNovo = await ate(() => abrirEVer(tel, "canal 1", "5 depois no 1"), 120_000, 1_000)
  check("e recebe o que se disse com ele fechado", msNovo >= 0, `${Date.now() - tAbre} ms`)
  const doTel = `do telemóvel sozinho ${Date.now().toString(36)}`
  await dizer(tel, doTel)
  check("o telemóvel envia num canal e o Bruno lê", (await ate(async () => corposNoNode(bruno, canais[0]).includes(doTel), 60_000)) >= 0)
  check("a directa mostra o que o Bruno disse com o computador fechado", (await ate(() => abrirDirectaEVer(tel, "depois na directa"), 60_000, 1_000)) >= 0)
  const naDirecta = `na directa, do telemóvel ${Date.now().toString(36)}`
  await dizer(tel, naDirecta)
  check("o telemóvel envia na directa e o Bruno lê", (await ate(async () => corposNoNode(bruno, dm).includes(naDirecta), 60_000)) >= 0)
  const resposta = `resposta do Bruno ${Date.now().toString(36)}`
  await bruno.session.send(dm, mensagem(resposta))
  check("o Bruno responde e o telemóvel lê", (await ate(async () => (await tel.locator("body").innerText()).includes(resposta), 60_000)) >= 0)

  // ---------------------------------------------------------------------------
  // 5. Reload: still the same.
  // ---------------------------------------------------------------------------
  await tel.reload({ waitUntil: "commit" })
  await appAberta(tel, 120_000)
  check("depois de recarregar, o histórico antigo continua", (await ate(() => abrirEVer(tel, "canal 1", "1 antes no 1"), 60_000, 500)) >= 0)
  check("e o que o telemóvel enviou também", (await ate(() => abrirEVer(tel, "canal 1", doTel), 60_000, 500)) >= 0)
  check("e a directa com a resposta do Bruno", (await ate(() => abrirDirectaEVer(tel, resposta), 60_000, 500)) >= 0)
  casa.redeLenta(false)
  check("nenhum erro de página", erros.length === 0, erros.slice(0, 2).join(" | "))
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  // What the phone showed when it stopped, for whoever reads the failure.
  for (const p of browserTel?.contexts().flatMap((c) => c.pages()) ?? []) await p.screenshot({ path: join(RAIZ, "capturas/paridade-falha.png") }).catch(() => {})
  console.error(casa.registo().slice(-1500))
}
console.log("")
const passaram = resultados.filter(Boolean).length
console.log(`${passaram}/${resultados.length} verificações passaram`)
await arrumar(passaram === resultados.length ? 0 : 1)
