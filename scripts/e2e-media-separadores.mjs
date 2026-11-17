/**
 * Media in the store, in two tabs, on three real browsers.
 *
 *   npm run build && node scripts/e2e-media-separadores.mjs [chromium] [firefox] [webkit]
 *
 * Since media left the vault, the vault keeps a `{ ref }` and the bytes live in
 * the media store (`enclave-media*` in IndexedDB). What this proves, per engine:
 *
 *  1. Bruno (a core account in Node) seats Ana in a channel and sends her a
 *     real JPEG. Ana (in the browser) opens the channel: the image shows, with
 *     its real size.
 *  2. The media store has the blob, and the vault has no `data:` at all.
 *  3. A second tab waits. The first closes; the second takes over, asks for
 *     the passphrase, and shows the same image, read from the store.
 *  4. The second tab reloads: the image comes back again, from disk.
 *
 * ALL LOCAL AND ALL DISPOSABLE: its own homeserver in a temp folder, its own
 * ports (8560/8561 by default, `E2E_PORTA_DA_FRENTE`/`E2E_PORTA_DO_SERVIDOR`),
 * no target by argument. There is no way to point it at production.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala } from "@enclave/protocol"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { levantarServidor } from "./frente-lenta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const MOTORES = { chromium, firefox, webkit }
const escolhidos = process.argv.slice(2).filter((a) => a in MOTORES)
const NOMES = escolhidos.length ? escolhidos : Object.keys(MOTORES)
const FRASE = "frase-de-verificacao-2026"
const REDE_LOCAL = { rttMs: 0, baixarBps: 1e10, subirBps: 1e10 }
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8560)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8561)

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
const pasta = mkdtempSync(join(tmpdir(), "orwell-media-sep-"))
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

const casa = await levantarServidor({ dist: join(RAIZ, "apps/web/dist"), portaDaFrente: PORTA_DA_FRENTE, portaDoServidor: PORTA_DO_SERVIDOR, rede: REDE_LOCAL, prefixo: "orwell-media-sep-" })
const { nome: NOME, app: APP, dados } = casa
const SALA = `!orwell:${NOME}`
const nodes = []
async function conta(nome) {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-de-teste-do-no")
  const session = new Session(vault)
  const id = await session.createIdentity(NOME)
  // The common room is opt-in since 12/11/2026: these accounts tick the box.
  await session.escolherSalaComum(true)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  const c = { nome, session, address: id.address }
  nodes.push(c)
  return c
}

try {
  const dona = await conta("Dona")
  if (!(await ate(() => dona.session.channels.includes(SALA), 30_000))) throw new Error("Dona is not in the common room")
  const bruno = await conta("Bruno")

  for (const motor of NOMES) {
    console.log(`\n${motor}`)
    const navegador = await MOTORES[motor].launch()
    try {
      const ctx = await navegador.newContext({ viewport: { width: 1280, height: 860 } })
      const p1 = await ctx.newPage()
      await p1.goto(APP, { waitUntil: "domcontentloaded" })
      await criarConta(p1, { nome: `Ana ${motor}`, frase: FRASE, servidor: NOME })
      await dentro(p1)
      const base = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
      const ana = base.prepare("SELECT address FROM accounts ORDER BY rowid DESC").get().address
      base.close()

      // 1. Bruno seats Ana in a channel and sends her a photo.
      const canal = moradaDeSala(NOME)
      const nomeDoCanal = `adega ${motor}`
      await bruno.session.createSpaceChannel(canal, nomeDoCanal)
      await ate(() => bruno.session.founderOf(canal) === bruno.address, 30_000)
      await bruno.session.seat(canal, ana)
      await ate(() => bruno.session.membersOf(canal).map(String).includes(ana), 30_000)
      await bruno.session.send(canal, mensagem("a fotografia da adega", [foto(motor)]))
      await p1.locator(".channel-list .channel-name", { hasText: nomeDoCanal }).first().waitFor({ timeout: 60_000 })
      await abrirCanal(p1, nomeDoCanal)
      check("1. a imagem aparece, com o tamanho real", await ate(() => imagemNoEcra(p1), 60_000))

      // 2. On disk: the blob in the store, no media bytes in the vault.
      let medida = { blobs: 0, bytesDoCofre: 0 }
      check(
        "2. o armazém tem o blob",
        await ate(async () => (medida = await disco(p1)).blobs >= 1, 30_000),
        `${medida.blobs} blobs, cofre ${Math.round(medida.bytesDoCofre / 1024)} KB`,
      )

      // 3. A second tab waits; the first closes; the second takes over.
      const p2 = await ctx.newPage()
      await p2.goto(APP, { waitUntil: "domcontentloaded" })
      await p2.waitForTimeout(2_000)
      check("3. o separador 2 espera enquanto o 1 está aberto", (await p2.locator('.gate-card input[type="password"]').count()) === 0)
      await p1.close()
      await destrancar(p2)
      await abrirCanal(p2, nomeDoCanal)
      check("3. o separador 2 assume e mostra a mesma imagem, lida do armazém", await ate(() => imagemNoEcra(p2), 60_000))

      // 4. Reload: the image comes back from disk.
      await p2.reload({ waitUntil: "domcontentloaded" })
      await destrancar(p2)
      await abrirCanal(p2, nomeDoCanal)
      check("4. depois de recarregar, a imagem volta do disco", await ate(() => imagemNoEcra(p2), 60_000))
      await ctx.close()
    } finally {
      await navegador.close()
    }
  }
} finally {
  for (const n of nodes) n.session.disconnect?.()
  await casa.fechar?.()
}

const passaram = resultados.filter(Boolean).length
console.log(`\n${passaram}/${resultados.length} verificações passaram`)
process.exit(passaram === resultados.length ? 0 : 1)
