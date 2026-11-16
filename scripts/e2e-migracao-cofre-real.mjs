/**
 * The migration of a REAL 1.3.14 vault with images, in the browser.
 *
 *   npm run build && ORWELL_DIST_ANTIGO=<apps/web/dist of 1.3.14> node scripts/e2e-migracao-cofre-real.mjs
 *
 * One origin, two versions of the web behind it (a symlink swapped between the
 * two, so IndexedDB is the same):
 *
 *  1. With 1.3.14: Ana (Chromium) gets three real JPEGs from Bruno (a core
 *     account in Node) and sees them. The vault holds the bytes (`data:`).
 *  2. The web becomes this version. Ana reloads and unlocks: the migration
 *     runs; the vault ends up with no `data:` and smaller; the media store has
 *     the blobs; the three images show, with their real size.
 *  3. Reload once more: the images come back from the store.
 *
 * ALL LOCAL AND ALL DISPOSABLE: its own homeserver in a temp folder, its own
 * ports (8570/8571 by default), no target by argument.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs"
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
const DIST_NOVO = join(RAIZ, "apps/web/dist")
const DIST_ANTIGO = process.env.ORWELL_DIST_ANTIGO ? resolve(process.env.ORWELL_DIST_ANTIGO) : null
if (!DIST_ANTIGO) throw new Error("Falta ORWELL_DIST_ANTIGO (o apps/web/dist da 1.3.14).")
const FRASE = "frase-de-verificacao-2026"
const REDE_LOCAL = { rttMs: 0, baixarBps: 1e10, subirBps: 1e10 }
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8570)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8571)
const FOTOS = 3

const resultados = []
const check = (rotulo, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`  ${ok ? "ok  " : "FAIL"} ${rotulo}${detalhe ? `  (${detalhe})` : ""}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function ate(condicao, ms = 60_000, passo = 500) {
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

// A real JPEG of 320x200, made unique per engine by a tail after the EOI marker.
const pasta = mkdtempSync(join(tmpdir(), "orwell-migracao-real-"))
execFileSync("magick", ["-size", "320x200", "xc:", "+noise", "Random", "-quality", "85", join(pasta, "base.jpg")])
const BASE = readFileSync(join(pasta, "base.jpg"))
const LARGURA = 320
function foto(nome) {
  const bytes = Buffer.concat([BASE, Buffer.from(nome)])
  return { url: "", inline: `data:image/jpeg;base64,${bytes.toString("base64")}`, key: "", nonce: "", digest: "", kind: "image", name: `${nome}.jpg`, mediaType: "image/jpeg", byteLength: bytes.length }
}
const mensagem = (body, attachments = []) => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments, links: [], mentions: [] })

const dentro = (page, timeout = 90_000) => page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout })
async function destrancar(page) {
  const campo = page.locator('.gate-card input[type="password"]')
  const entrou = page.getByRole("button", { name: "Configurações", exact: true }).first()
  // A reload in the same tab may keep the key (no passphrase asked): both are fine.
  await campo.or(entrou).first().waitFor({ timeout: 30_000 })
  if (!(await campo.count())) return
  await campo.fill(FRASE)
  const caixa = page.locator('input[name="memorizar"]')
  if (await caixa.count()) await caixa.setChecked(false)
  await campo.press("Enter")
  await dentro(page)
}
async function abrirCanal(page, nome) {
  await page.locator(".channel-list .channel-name", { hasText: nome }).first().click()
}
/** An image on screen with the real width of the photo, loaded. */
const imagemNoEcra = (page) =>
  page.evaluate((largura) => [...document.images].some((i) => i.complete && i.naturalWidth === largura), LARGURA)

/** What the page holds on disk: blobs in the media store, and whether the vault still has a `data:`. */
async function disco(page) {
  return page.evaluate(async () => {
    const abrir = (nome) =>
      new Promise((resolve, reject) => {
        const pedido = indexedDB.open(nome)
        pedido.onerror = () => reject(pedido.error)
        pedido.onsuccess = () => resolve(pedido.result)
      })
    const contar = (db, store) =>
      new Promise((resolve) => {
        if (!db.objectStoreNames.contains(store)) return resolve(0)
        const pedido = db.transaction(store, "readonly").objectStore(store).count()
        pedido.onsuccess = () => resolve(pedido.result)
        pedido.onerror = () => resolve(0)
      })
    let blobs = 0
    let bytesDoCofre = 0
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue
      const db = await abrir(name)
      if (name.startsWith("enclave-media")) blobs += await contar(db, "blobs")
      else if (name.startsWith("enclave") && db.objectStoreNames.contains("vault")) {
        bytesDoCofre += await new Promise((resolve) => {
          const pedido = db.transaction("vault", "readonly").objectStore("vault").get("current")
          pedido.onsuccess = () => resolve(pedido.result?.byteLength ?? pedido.result?.length ?? 0)
          pedido.onerror = () => resolve(0)
        })
      }
      db.close()
    }
    return { blobs, bytesDoCofre }
  })
}


/** How many images on screen have the real width of the photo, loaded. */
const imagensNoEcra = (page) =>
  page.evaluate((largura) => [...document.images].filter((i) => i.complete && i.naturalWidth === largura).length, LARGURA)
const pastaDaFrente = mkdtempSync(join(tmpdir(), "orwell-migracao-real-dist-"))
const DIST = join(pastaDaFrente, "dist")
const apontar = (destino) => {
  // The link itself, never what it points to.
  try { unlinkSync(DIST) } catch {}
  symlinkSync(destino, DIST)
}
apontar(DIST_ANTIGO)

const casa = await levantarServidor({ dist: DIST, portaDaFrente: PORTA_DA_FRENTE, portaDoServidor: PORTA_DO_SERVIDOR, rede: REDE_LOCAL, prefixo: "orwell-migracao-real-" })
const { nome: NOME, app: APP, dados } = casa
const SALA = `!orwell:${NOME}`
const nodes = []
async function conta(nome) {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-de-teste-do-no")
  const session = new Session(vault)
  const id = await session.createIdentity(NOME)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  const c = { nome, session, address: id.address }
  nodes.push(c)
  return c
}

const navegador = await chromium.launch()
try {
  const dona = await conta("Dona")
  if (!(await ate(() => dona.session.channels.includes(SALA), 30_000))) throw new Error("Dona is not in the common room")
  const bruno = await conta("Bruno")
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: "block" })
  const page = await ctx.newPage()
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome: "Ana", frase: FRASE, servidor: NOME })
  await dentro(page)
  const versaoAntiga = await page.evaluate(() => document.documentElement.outerHTML.match(/1\.3\.\d+/)?.[0] ?? "?")
  const base = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
  const ana = base.prepare("SELECT address FROM accounts ORDER BY rowid DESC").get().address
  base.close()

  // 1. With the old web: three photos, in the vault.
  const canal = moradaDeSala(NOME)
  const nomeDoCanal = "adega"
  await bruno.session.createSpaceChannel(canal, nomeDoCanal)
  await ate(() => bruno.session.founderOf(canal) === bruno.address, 30_000)
  await bruno.session.seat(canal, ana)
  await ate(() => bruno.session.membersOf(canal).map(String).includes(ana), 30_000)
  for (let f = 0; f < FOTOS; f++) await bruno.session.send(canal, mensagem(`foto ${f}`, [foto(`foto-${f}`)]))
  await page.locator(".channel-list .channel-name", { hasText: nomeDoCanal }).first().waitFor({ timeout: 60_000 })
  await abrirCanal(page, nomeDoCanal)
  check(`1. com a web antiga (${versaoAntiga}), as ${FOTOS} imagens aparecem`, await ate(async () => (await imagensNoEcra(page)) >= FOTOS, 60_000))
  let antes = { blobs: 0, bytesDoCofre: 0 }
  await page.waitForTimeout(4_000) // the batched vault write lands
  antes = await disco(page)
  check("1. o cofre antigo tem os bytes e não há armazém", antes.bytesDoCofre > FOTOS * BASE.length && antes.blobs === 0, `cofre ${Math.round(antes.bytesDoCofre / 1024)} KB, ${antes.blobs} blobs`)

  // 2. The web becomes this version: reload, unlock, migrate.
  apontar(DIST_NOVO)
  casa.esquecerFicheiros()
  await page.reload({ waitUntil: "domcontentloaded" })
  await destrancar(page)
  await abrirCanal(page, nomeDoCanal)
  check(`2. com a web nova, as ${FOTOS} imagens aparecem`, await ate(async () => (await imagensNoEcra(page)) >= FOTOS, 90_000))
  let depois = { blobs: 0, bytesDoCofre: 0 }
  const migrou = await ate(async () => {
    depois = await disco(page)
    return depois.blobs >= FOTOS && depois.bytesDoCofre < antes.bytesDoCofre - FOTOS * BASE.length
  }, 90_000, 1_000)
  const diagnostico = await page.evaluate(async () => ({ bases: (await indexedDB.databases()).map((d) => d.name), script: document.querySelector('script[type="module"]')?.getAttribute("src") }))
  console.log(`  ..  ${JSON.stringify(diagnostico)}`)
  check("2. a migração: os blobs no armazém e o cofre mais pequeno", migrou, `cofre ${Math.round(antes.bytesDoCofre / 1024)} KB -> ${Math.round(depois.bytesDoCofre / 1024)} KB, ${depois.blobs} blobs`)

  // 3. Once more: from the store.
  await page.reload({ waitUntil: "domcontentloaded" })
  await destrancar(page)
  await abrirCanal(page, nomeDoCanal)
  check("3. depois de recarregar, as imagens voltam do armazém", await ate(async () => (await imagensNoEcra(page)) >= FOTOS, 60_000))
  await ctx.close()
} finally {
  await navegador.close()
  for (const n of nodes) n.session.disconnect?.()
  await casa.fechar?.()
  rmSync(pastaDaFrente, { recursive: true, force: true })
}

const passaram = resultados.filter(Boolean).length
console.log(`\n${passaram}/${resultados.length} verificações passaram`)
process.exit(passaram === resultados.length ? 0 : 1)
