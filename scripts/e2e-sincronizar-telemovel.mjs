/**
 * "Sync the account" on a paired phone, then close and open (hotfix 1.3.10).
 *
 *   node scripts/e2e-sincronizar-telemovel.mjs                 (needs `npm run build` first)
 *   node scripts/e2e-sincronizar-telemovel.mjs --motor webkit --canais 20
 *   node scripts/e2e-sincronizar-telemovel.mjs --dist <old apps/web/dist>   (to see the flaw)
 *
 * Owner (12/11/2026): "I tapped sync and now every time I open on mobile I get:
 * a problem repeatedly occurred". That is the iOS browser's own page for a tab
 * that crashed again and again. The button empties `deadWelcomes`; the next
 * start receives every pending Welcome again, in one burst, and each death
 * wrote the whole vault at once. Here:
 *   1. Ana on a computer browser. Bruno (in Node) opens `--canais` channels with Ana seated.
 *   2. A phone (390x844, touch) pairs by link and gets every channel.
 *   3. The phone taps "Sincronizar conta" in Ajuda e diagnóstico.
 *   4. The phone closes and opens. Counted in the page: whole-vault writes to
 *      IndexedDB, and how many were in flight at the same time. The marks must be
 *      back on the disk after this first start, and every channel still there.
 *   5. It opens once more: no burst left.
 *
 * ALL LOCAL AND ALL DISPOSABLE: `frente-lenta.mjs` (own homeserver in a temp
 * folder, ports 8486/8487 or E2E_PORTA_DA_FRENTE / E2E_PORTA_DO_SERVIDOR), and
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
import { levantarServidor } from "./frente-lenta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const argumento = (nome, omissao) => {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : omissao
}
const DIST = resolve(argumento("--dist", join(RAIZ, "apps/web/dist")))
const MOTOR = argumento("--motor", "chromium")
const CANAIS = Number(argumento("--canais", 20))
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
    portaDaFrente: Number(process.env.E2E_PORTA_DA_FRENTE ?? 8486),
    portaDoServidor: Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8487),
    prefixo: "orwell-e2e-sincronizar-telemovel-",
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

/** Open a channel by its name on the phone (drawer), and say whether `texto` shows. */
async function abrirEVer(page, rotulo, texto) {
  const gaveta = page.getByRole("button", { name: "Abrir o painel lateral" })
  if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) !== "true") await gaveta.click({ timeout: 2_000 }).catch(() => {})
  await page.locator(".channel-name", { hasText: rotulo }).first().click({ timeout: 2_000 }).catch(() => {})
  if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) === "true") await gaveta.click({ timeout: 2_000 }).catch(() => {})
  return (await page.locator("body").innerText()).includes(texto)
}
async function abrirDirectaEVer(page, texto) {
  await page.getByRole("button", { name: "Amigos", exact: true }).first().click({ timeout: 2_000 }).catch(() => {})
  await page.evaluate(() => document.querySelector(".direct-open")?.click())
  // At 390 px the conversation list is a drawer: close it, or it covers the input bar.
  const gaveta = page.getByRole("button", { name: "Abrir o painel lateral" })
  if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) === "true") await gaveta.click({ timeout: 2_000 }).catch(() => {})
  return (await page.locator("body").innerText()).includes(texto)
}
async function dizer(page, frase) {
  const caixa = page.locator('input[placeholder="Escreve uma mensagem"]')
  await caixa.click()
  await caixa.fill(frase)
  await page.keyboard.press("Enter")
}


/**
 * Counts writes of the vault record, and the most waiting at once. IndexedDB
 * runs readwrite transactions on one store one after another, so counting at
 * `put` always says 1. What costs memory is a write that is waiting: its copy
 * of the vault is already built. So a write counts from the moment its
 * transaction is created until it completes or fails.
 */
const CONTADOR = () => {
  const estado = { escritas: 0, emCurso: 0, maximo: 0, bytes: 0 }
  globalThis.__escritasDoCofre = estado
  const transaccao = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (lojas, modo, ...resto) {
    const tx = transaccao.call(this, lojas, modo, ...resto)
    const nomes = Array.isArray(lojas) ? lojas : [lojas]
    if (modo === "readwrite" && nomes.includes("vault")) {
      let escreveCofre = false
      const put = tx.objectStore("vault").put
      // Only transactions that write the vault record count, not the ownership record alone.
      tx.objectStore = function (nome) {
        const loja = IDBTransaction.prototype.objectStore.call(tx, nome)
        const original = loja.put
        loja.put = function (valor, chave) {
          if (chave === "current" && valor instanceof ArrayBuffer) {
            escreveCofre = true
            estado.bytes = Math.max(estado.bytes, valor.byteLength)
          }
          return original.call(loja, valor, chave)
        }
        return loja
      }
      void put
      estado.emCurso++
      estado.maximo = Math.max(estado.maximo, estado.emCurso)
      const fim = () => {
        estado.emCurso--
        if (escreveCofre) estado.escritas++
      }
      tx.addEventListener("complete", fim, { once: true })
      tx.addEventListener("abort", fim, { once: true })
    }
    return tx
  }
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
const mortosNoCofre = (cofre) => (cofre?.deadWelcomes ?? []).length
let passo = ""
let telAgora = null
try {
  // 1. Ana on the computer, and Bruno's channels.
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
  const canais = []
  for (let n = 1; n <= CANAIS; n++) {
    const canal = moradaDeSala(NOME)
    await bruno.session.createSpaceChannel(canal, `canal ${n}`)
    await ate(async () => bruno.session.founderOf(canal) === bruno.address, 30_000, 300)
    await bruno.session.seat(canal, ana)
    await bruno.session.send(canal, mensagem(`olá no ${n}`))
    canais.push(canal)
  }
  check(`o computador vê os ${CANAIS} canais`, (await ate(async () => (await pc.locator(".channel-name").count()) >= CANAIS, 120_000)) >= 0)
  await wait(3_000)

  // 2. Pairing.
  await pc.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await pc.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await pc.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  browserTel = await (MOTOR === "webkit" ? webkit : chromium).launch({ headless: true })
  const ctxTel = await browserTel.newContext({ locale: "pt-PT", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctxTel.addInitScript(CONTADOR)
  let tel = await ctxTel.newPage()
  telAgora = tel
  tel.on("pageerror", (e) => erros.push(`telemóvel: ${e.message}`))
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
  let cofre = null
  await ate(async () => {
    cofre = await cofreDe(tel)
    return canais.every((c) => cofre?.groups?.[c] !== undefined)
  }, 180_000, 3_000)
  cofre = await cofreDe(tel)
  // Seating every channel on the phone is not what this tests: use the ones it has.
  const noTelemovel = canais.filter((c) => cofre?.groups?.[c] !== undefined)
  check("o telemóvel tem canais", noTelemovel.length > 0, `${noTelemovel.length} de ${CANAIS}`)
  await wait(5_000)
  cofre = await cofreDe(tel)
  const mortosAntes = mortosNoCofre(cofre)
  console.log(`  ..  Welcomes mortos no cofre do telemóvel antes do botão: ${mortosAntes}`)

  // 3. "Sincronizar conta".
  passo = "abrir as Configurações"
  const gaveta = tel.getByRole("button", { name: "Abrir o painel lateral" })
  if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) !== "true") await gaveta.click({ timeout: 2_000 }).catch(() => {})
  await tel.getByRole("button", { name: "Configurações", exact: true }).first().click()
  passo = "abrir Ajuda e diagnóstico"
  // At 390 px the drawer covers the page, and the section list is the page itself.
  if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) === "true") await gaveta.click({ timeout: 2_000 }).catch(() => {})
  await tel.getByRole("button", { name: "Ajuda e diagnóstico" }).last().click()
  passo = "carregar em Sincronizar conta"
  await tel.getByRole("button", { name: "Sincronizar conta", exact: true }).click()
  const msFeito = await ate(async () => !(await tel.locator("body").innerText()).includes("A sincronizar…"), 60_000, 500)
  check("o botão acaba", msFeito >= 0)
  await wait(3_000)

  // 4. Close and open. The marks went away with the button: this start gets the burst.
  await tel.close()
  const abrir = async () => {
    const pagina = await ctxTel.newPage()
    pagina.on("pageerror", (e) => erros.push(`telemóvel: ${e.message}`))
    pagina.on("crash", () => erros.push("telemóvel: a página rebentou"))
    telAgora = pagina
    await pagina.goto(APP, { waitUntil: "commit" })
    await pagina.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 120_000 })
    await wait(20_000)
    return pagina
  }
  tel = await abrir()
  const primeira = await tel.evaluate(() => ({ ...globalThis.__escritasDoCofre }))
  cofre = await cofreDe(tel)
  console.log(`  ..  primeiro arranque depois do botão: ${primeira.escritas} escritas do cofre, até ${primeira.maximo} ao mesmo tempo, cofre ${Math.round(primeira.bytes / 1024)} KiB`)
  check("nunca duas escritas inteiras do cofre ao mesmo tempo", primeira.maximo <= 1, `máximo ${primeira.maximo}`)
  check("as marcas voltam ao disco logo no primeiro arranque", mortosNoCofre(cofre) >= mortosAntes, `${mortosNoCofre(cofre)} de ${mortosAntes}`)
  check("todos os canais continuam", noTelemovel.every((c) => cofre?.groups?.[c] !== undefined))

  // 5. Once more: nothing left to burst.
  await tel.close()
  tel = await abrir()
  const segunda = await tel.evaluate(() => ({ ...globalThis.__escritasDoCofre }))
  console.log(`  ..  segundo arranque: ${segunda.escritas} escritas do cofre, até ${segunda.maximo} ao mesmo tempo`)
  check("no segundo arranque também nunca há duas ao mesmo tempo", segunda.maximo <= 1, `máximo ${segunda.maximo}`)
  const primeiroNoTel = canais.indexOf(noTelemovel[0]) + 1
  check("o telemóvel mostra um canal", (await ate(() => abrirEVer(tel, `canal ${primeiroNoTel}`, `olá no ${primeiroNoTel}`), 60_000, 1_000)) >= 0)
  check("nenhum erro de página", erros.length === 0, erros.slice(0, 2).join(" | "))
} catch (erro) {
  check("o guião chegou ao fim", false, `${passo}: ${String(erro?.message ?? erro).split("\n")[0]}`)
  if (process.env.E2E_CAPTURA) await telAgora?.screenshot({ path: process.env.E2E_CAPTURA }).catch(() => {})
  console.error(casa.registo().slice(-1500))
}
console.log("")
const passaram = resultados.filter(Boolean).length
console.log(`${passaram}/${resultados.length} verificações passaram`)
await arrumar(passaram === resultados.length ? 0 : 1)
