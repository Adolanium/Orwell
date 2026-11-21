/**
 * A new device on an account with many channels, in WebKit and in Chromium (17/11/2026).
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/e2e-membros-aparelho-novo.mjs
 *
 * The report: "I opened the account I use on Windows in Safari on the Mac and it
 * does not show me half the users, though there are users online with full info".
 *
 * What is proved, all through the interface on the browsers' side:
 *  1. Ana creates an account in Chromium (the Windows app's stand-in).
 *  2. Twelve people, accounts of the core here in Node, ask her for friendship;
 *     she accepts each in Friends. Some have a profile name, some do not; some
 *     go offline before the pairing, some stay; one wrote long ago, one just now.
 *  3. One of them seats Ana in 30 rooms. Ana now has more channels than a new
 *     device has key packages (20, or 40).
 *  4. Ana pairs a WebKit device (Safari), then a Chromium device, by the link.
 *  5. On each new device: the same channels as the main one, "Amigos (12)", every
 *     friend with a name on the main one shows by name, and the common room
 *     members are the same as on the main one. Screenshots of each list.
 *
 * Before the fix (17/11/2026) the new device stayed in about 20 of the ~57
 * channels: the friends whose direct and feed came past the pool were missing.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8731 and 8732, or E2E_PORTA_DA_FRENTE /
 * E2E_PORTA_DO_SERVIDOR when two worktrees run it at once. Captures in
 * `.verify-data/prova-membros-aparelho-novo/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { moradaDeSala } from "@enclave/protocol"
import { Session, Vault } from "@enclave/client-core"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { ate, contasDoServidor, dentro, espera, irParaEmparelhar, separador, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"
import { juntarComPalavras } from "./juntar-aparelho.mjs"

const FRASE = "frase-de-verificacao-2026"
const CAPTURAS = join(RAIZ, ".verify-data/prova-membros-aparelho-novo", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })
const SALAS = Number(process.env.SALAS ?? 30)

const { check, resumo } = verificador()
const srv = await levantarServidor({
  frente: Number(process.env.E2E_PORTA_DA_FRENTE ?? 8731),
  servidor: Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8732),
  sfu: 0,
  etiqueta: "membros-aparelho-novo",
})
const browsers = []
const nos = []

async function arrumar(codigo) {
  for (const conta of nos) conta.session.disconnect()
  for (const browser of browsers) await browser.close().catch(() => {})
  srv.fechar()
  process.exit(codigo)
}

class CofreEmMemoria {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(bytes) {
    this.bytes = bytes
  }
  async clear() {
    this.bytes = null
  }
}

/** A core account here in Node, in the common room. `nome` null: no profile name. */
async function contaNoNode(nome) {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-de-teste-do-no")
  const session = new Session(vault)
  const identidade = await session.createIdentity(srv.NOME)
  await session.escolherSalaComum(true)
  await session.connect()
  if (nome !== null) await session.updateProfile({ displayName: nome, donations: [] })
  const conta = { nome, session, vault, address: identidade.address }
  nos.push(conta)
  return conta
}

/** A device's vault, read from IndexedDB and opened with the passphrase, here in Node. */
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
  if (!bruto) throw new Error("sem cofre")
  const ficheiro = JSON.parse(bruto.startsWith("orwv2\n") ? bruto.slice(6) : bruto)
  const b64 = (texto) => Buffer.from(texto.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  const chave = argon2id(new TextEncoder().encode(FRASE), b64(ficheiro.salt), { t: 3, m: 65_536, p: 4, dkLen: 32 })
  return JSON.parse(new TextDecoder().decode(xchacha20poly1305(chave, b64(ficheiro.nonce)).decrypt(b64(ficheiro.ciphertext))))
}

const gruposDe = async (page) => Object.keys((await cofreDe(page)).groups ?? {}).sort()

async function abrir(motor, rotulo, contexto = {}) {
  const browser = await motor.launch({ headless: true })
  browsers.push(browser)
  const ctx = await browser.newContext({ locale: "pt-PT", ...contexto })
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => console.log(`[${rotulo}] PAGEERROR ${erro.message}`))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  return page
}

/** Pair a new browser page with the main one, by the link, through both screens. */
async function emparelhar(pc, novo) {
  await pc.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await pc.getByRole("button", { name: "Conta e segurança", exact: true }).click()
  await pc.getByRole("button", { name: "Juntar um aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  await irParaEmparelhar(novo)
  await novo.getByLabel("Ou cola o código").waitFor({ timeout: 10_000 })
  await juntarComPalavras(novo, folha, link, FRASE)
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await pc.keyboard.press("Escape").catch(() => {})
  await dentro(novo)
}

/** The password gate after a reload, or nothing if the page is already in. */
async function desbloquear(page) {
  const campo = page.locator('input[type="password"]').first()
  const dentroJa = page.getByRole("button", { name: "Configurações", exact: true }).first()
  await campo.or(dentroJa).first().waitFor({ timeout: 60_000 })
  if (await campo.count()) {
    await campo.fill(FRASE)
    await page.keyboard.press("Enter")
  }
  await dentro(page)
}

const textoDosAmigos = async (page) => {
  await separador(page, "Todos")
  return page.locator(".people-destination").innerText()
}

/** The common room's member list, by the DOM (on a phone it is in a closed drawer). */
async function membrosDaSalaComum(page) {
  await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  // By name, not the first row: on a new device the communities can still be in
  // the order their Welcomes arrived, and live messages move rooms to the top.
  await page.locator(".channel-list .channel-name", { hasText: "Orwell" }).first().click().catch(() => {})
  await ate(async () => (await page.locator("header.topbar-conversa").first().innerText().catch(() => "")).includes("Orwell"), 15_000, 300)
  return page.evaluate(() => document.querySelector(".member-list")?.textContent ?? "")
}

try {
  // 1. Ana on the "Windows" machine.
  const pc = await abrir(chromium, "pc", { viewport: { width: 1280, height: 860 } })
  await criarConta(pc, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(pc)
  const ana = contasDoServidor(srv.base)[0]
  check("a Ana cria conta no Chromium", typeof ana === "string" && ana.startsWith("@"), ana)

  // 2. Twelve friends: names on most, none on two.
  const nomes = ["Bruno", "Carla", "Duarte", "Eva", "Filipe", "Graça", "Hugo", "Inês", "João", "Luísa", null, null]
  const amigos = []
  for (const nome of nomes) amigos.push(await contaNoNode(nome))
  for (const amigo of amigos) {
    const dm = await amigo.session.openDirect(ana)
    await ate(async () => amigo.session.channels.includes(dm), 30_000, 300)
    await amigo.session.sendFriendRequest(dm)
    amigo.dm = dm
  }
  for (let aceites = 0; aceites < amigos.length; aceites++) {
    await separador(pc, /^Recebidos/)
    const botao = pc.locator(".people-requests").getByRole("button", { name: "Aceitar" }).first()
    if ((await ate(async () => botao.isVisible(), 60_000, 500)) < 0) break
    await botao.click()
    await espera(800)
  }
  check(
    `a Ana vê "Amigos (${amigos.length})" no principal`,
    (await ate(async () => (await pc.locator(".people-bar-title").innerText()) === `Amigos (${amigos.length})`, 120_000, 1_000)) >= 0,
  )

  // One wrote long ago, one just now (in the direct each shares with Ana).
  await amigos[0].session.send(amigos[0].dm, { t: "message", body: "escrevi há muito", sentAt: Date.now() - 30 * 86_400_000, id: "antiga-00001" })

  // 3. Bruno seats Ana in many rooms, paced under the server's 60 subscriptions a minute.
  const bruno = amigos[0]
  const salas = []
  let recargasDoPc = 0
  for (let i = 0; i < SALAS; i++) {
    if (i > 0 && i % 25 === 0) await espera(61_000)
    const sala = moradaDeSala(srv.NOME)
    salas.push(sala)
    await bruno.session.createSpaceChannel(sala, `sala ${i + 1}`)
    await ate(async () => bruno.session.founderOf(sala) === bruno.address, 15_000, 100)
    // Before the fix, Ana's own pool ran out here too (same defect: the server
    // said `keypackage.low` only at login). A reload is a login: count them.
    for (let tentativa = 0; ; tentativa++) {
      try {
        await bruno.session.seat(sala, ana)
        break
      } catch (erro) {
        if (tentativa > 2 || !String(erro?.message).includes("no invite keys")) throw erro
        recargasDoPc++
        await pc.reload({ waitUntil: "domcontentloaded" })
        await desbloquear(pc)
        await espera(3_000)
      }
    }
  }
  check("o principal entra nas salas sem recarregar", recargasDoPc === 0, `${recargasDoPc} recargas por falta de chaves`)
  let gruposDoPc = []
  check(
    `o principal fica em mais de 40 canais`,
    (await ate(async () => (gruposDoPc = await gruposDe(pc)).length >= SALAS + 2 * amigos.length, 180_000, 2_000)) >= 0,
    `${gruposDoPc.length}`,
  )
  await pc.screenshot({ path: join(CAPTURAS, "01-principal-amigos.png") }).catch(() => {})
  const membrosNoPc = await membrosDaSalaComum(pc)
  await pc.screenshot({ path: join(CAPTURAS, "02-principal-sala-comum.png") }).catch(() => {})

  // Some go offline before the pairing, some stay.
  for (const amigo of amigos.slice(6, 10)) amigo.session.disconnect()
  await amigos[1].session.send(amigos[1].dm, { t: "message", body: "acabei de escrever", sentAt: Date.now(), id: "agora-000001" })
  await espera(65_000)

  // 4 and 5. Each new device, WebKit first (the Safari of the report).
  const comNome = amigos.filter((amigo) => amigo.nome !== null).map((amigo) => amigo.nome)
  for (const [motor, rotulo, contexto] of [
    [webkit, "webkit", { viewport: { width: 1280, height: 860 } }],
    [chromium, "chromium", { viewport: { width: 1280, height: 860 } }],
  ]) {
    const novo = await abrir(motor, rotulo, contexto)
    await emparelhar(pc, novo)
    let gruposDoNovo = []
    const tempo = await ate(async () => {
      gruposDoPc = await gruposDe(pc)
      gruposDoNovo = await gruposDe(novo)
      return gruposDoPc.every((canal) => gruposDoNovo.includes(canal))
    }, 300_000, 2_000)
    const faltam = gruposDoPc.filter((canal) => !gruposDoNovo.includes(canal))
    const saidosDoPc = gruposDoNovo.filter((canal) => !gruposDoPc.includes(canal))
    const tipo = (canal) =>
      canal === `!orwell:${srv.NOME}`
        ? "sala comum"
        : salas.includes(canal)
          ? "sala"
          : amigos.some((amigo) => amigo.dm === canal)
            ? `directa com ${amigos.findIndex((amigo) => amigo.dm === canal)}`
            : "outro"
    check(
      `${rotulo}: o aparelho novo fica nos mesmos canais que o principal`,
      tempo >= 0,
      `${gruposDoNovo.length} no novo, ${gruposDoPc.length} no principal${faltam.length ? `, faltam: ${faltam.map(tipo).join(", ")}` : `, em ${Math.round(tempo / 1000)} s`}`,
    )
    if (saidosDoPc.length) console.log(`  (no novo e não no cofre do principal: ${saidosDoPc.map(tipo).join(", ")})`)
    check(
      `${rotulo}: "Amigos (${amigos.length})"`,
      (await ate(async () => (await novo.locator(".people-bar-title").innerText().catch(() => "")) === `Amigos (${amigos.length})` || ((await separador(novo, "Todos").catch(() => {})), false), 60_000, 1_500)) >= 0,
      await novo.locator(".people-bar-title").innerText().catch(() => "?"),
    )
    const texto = await textoDosAmigos(novo)
    const emFalta = comNome.filter((nome) => !texto.includes(nome))
    check(`${rotulo}: todos os amigos com nome aparecem pelo nome`, emFalta.length === 0, emFalta.length ? `faltam: ${emFalta.join(", ")}` : `${comNome.length}`)
    await novo.screenshot({ path: join(CAPTURAS, `03-${rotulo}-amigos.png`) }).catch(() => {})
    const membrosNoNovo = await membrosDaSalaComum(novo)
    const nomesNoPc = comNome.filter((nome) => membrosNoPc.includes(nome))
    check(
      `${rotulo}: os membros da sala comum com nome são os mesmos do principal`,
      nomesNoPc.every((nome) => membrosNoNovo.includes(nome)),
      `${nomesNoPc.filter((nome) => membrosNoNovo.includes(nome)).length} de ${nomesNoPc.length}`,
    )
    await novo.screenshot({ path: join(CAPTURAS, `04-${rotulo}-sala-comum.png`) }).catch(() => {})

    // Live in every room: the new device is subscribed to each, not only seated.
    const marca = `ao vivo ${rotulo}`
    for (const [i, sala] of salas.entries()) {
      await bruno.session.send(sala, { t: "message", body: `${marca} ${i}`, sentAt: Date.now(), id: `vivo-${rotulo}-${String(i).padStart(4, "0")}` })
    }
    let semAMensagem = salas.length
    await ate(async () => {
      const historia = (await cofreDe(novo)).history ?? {}
      semAMensagem = salas.filter((sala, i) => !(historia[sala] ?? []).some((m) => m.payload?.body === `${marca} ${i}`)).length
      return semAMensagem === 0
    }, 60_000, 2_000)
    check(`${rotulo}: uma mensagem nova em cada sala chega ao aparelho novo sem recarregar`, semAMensagem === 0, `${salas.length - semAMensagem} de ${salas.length}`)
  }
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log(`\ncapturas: ${CAPTURAS}`)
await arrumar(resumo() ? 0 : 1)
