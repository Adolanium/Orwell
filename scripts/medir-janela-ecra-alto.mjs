/**
 * The conversation window on a tall screen, in a real browser.
 *
 *   npx tsc -b && npm run build -w @enclave/web
 *   E2E_PORTA_DA_FRENTE=8570 E2E_PORTA_DO_SERVIDOR=8571 \
 *     node scripts/medir-janela-ecra-alto.mjs --caso <case folder of medir-fluidez> [--dist <web dist>]
 *
 * The timeline draws the last 30 lines and grows upward on `scroll`. On a
 * screen where 30 lines fit without a scrollbar no `scroll` fires, so it must
 * grow by itself until there is room to scroll up. This opens Ana's common room
 * (the large case of `medir-fluidez.mjs`, run on a copy) at 1440 and 2160 px of
 * height and checks, for each:
 *  1. the drawn lines are at least two scroller heights tall;
 *  2. the scroller can scroll up (`scrollTop > 0` at the bottom);
 *  3. scrolling to the top draws older lines.
 * Then Bruno writes 10 messages one by one: the drawn count stays bounded
 * (the window slides, it does not trim and regrow on each arrival).
 *
 * Exits 0 on pass, 1 on fail. ALL LOCAL: own ports, a copy of the case.
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Session, Vault } from "@enclave/client-core"
import { chromium } from "playwright"
import { levantarServidor } from "./frente-lenta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const arg = (nome, omissao) => {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : omissao
}
const casa_ = (p) => resolve(String(p).replace(/^~/, process.env.HOME ?? "~"))
if (!arg("--caso")) {
  console.error("pass --caso <folder> (a case built by medir-fluidez.mjs --montar)")
  process.exit(2)
}
const CASO = casa_(arg("--caso"))
const DIST = casa_(arg("--dist", join(RAIZ, "apps/web/dist")))
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8570)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8571)
const FRASE_NO = "frase-de-teste-do-no"
const ALTURAS = [1440, 2160]

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function ate(condicao, ms = 60_000, passo = 200) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await condicao()) return true
    await wait(passo)
  }
  return false
}
/** The same file vault the case was built with (`medir-fluidez.mjs`). */
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
const mensagem = (body) => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: [], links: [], mentions: [] })

let falhou = false
const linha = (ok, texto) => {
  if (!ok) falhou = true
  console.log(`${ok ? "OK   " : "FALHA"} ${texto}`)
}

if (!existsSync(join(CASO, "caso.json"))) throw new Error(`Não há caso em ${CASO}.`)
const caso = JSON.parse(readFileSync(join(CASO, "caso.json"), "utf8"))
const CORRIDA = join(tmpdir(), `orwell-janela-alta-${process.pid}`)
rmSync(CORRIDA, { recursive: true, force: true })
for (const parte of ["servidor", "nos", "perfil-ana"]) cpSync(join(CASO, parte), join(CORRIDA, parte), { recursive: true })
for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) rmSync(join(CORRIDA, "perfil-ana", f), { force: true })
const casa = await levantarServidor({ dist: DIST, portaDaFrente: PORTA_DA_FRENTE, portaDoServidor: PORTA_DO_SERVIDOR, dados: join(CORRIDA, "servidor") })
casa.redeLenta(false)
let nav
let bruno
try {
  const vault = new Vault(cofreEmFicheiro(join(CORRIDA, "nos", "Bruno.cofre")))
  await vault.unlock(FRASE_NO)
  bruno = new Session(vault)
  bruno.loadIdentity()
  await bruno.connect()

  let enviadas = 0
  for (const altura of ALTURAS) {
    // A fresh browser opened at this size: the window is measured as it opens, before any gesture.
    nav = await chromium.launchPersistentContext(join(CORRIDA, "perfil-ana"), { headless: true, locale: "pt-PT", viewport: { width: altura === 2160 ? 3840 : 2560, height: altura } })
    const page = nav.pages()[0] ?? (await nav.newPage())
    await page.goto(casa.app, { waitUntil: "commit" })
    await page.locator(".channel-name").first().waitFor({ timeout: 180_000 })
    // The account file reminder comes up over the app once it has loaded: close it.
    const lembrete = page.locator(".overlay").getByRole("button", { name: "Fechar" })
    await lembrete.waitFor({ timeout: 180_000 }).catch(() => {})
    await lembrete.click().catch(() => {})
    await ate(async () => (await page.locator(".overlay").count()) === 0, 30_000)
    await page.locator(".timeline .message").first().waitFor({ timeout: 180_000 })
    const medida = () =>
      page.evaluate(() => {
        const el = document.querySelector(".timeline")
        const nomes = [...document.querySelectorAll(".channel-name")].filter((n) => n.matches("[aria-current], .active, [data-activo]") || n.closest("[aria-current], .active")).map((n) => n.textContent)
        return { linhas: el.querySelectorAll(".message").length, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop, canal: nomes[0] ?? "" }
      })
    await ate(async () => {
      const m = await medida()
      return m.scrollHeight >= 2 * m.clientHeight
    }, 5_000)
    await wait(1_000)
    const m = await medida()
    if (process.env.CAPTURA) await page.screenshot({ path: `${process.env.CAPTURA}-${altura}.png` })
    linha(m.scrollHeight >= 2 * m.clientHeight, `${altura} px: ${m.linhas} linhas desenhadas, ${m.scrollHeight} px de conteúdo para ${m.clientHeight} px de altura (${m.canal})`)
    linha(m.scrollTop > 0, `${altura} px: há por onde subir (scrollTop ${m.scrollTop} no fundo)`)

    const primeira = await page.evaluate(() => document.querySelector(".timeline .message p")?.textContent ?? "")
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(1200, altura / 2)
      await page.mouse.wheel(0, -4_000)
      await wait(300)
    }
    const depois = await medida()
    const primeiraDepois = await page.evaluate(() => document.querySelector(".timeline .message p")?.textContent ?? "")
    linha(depois.linhas > m.linhas && primeiraDepois !== primeira, `${altura} px: subir com a roda desenha as anteriores (${m.linhas} → ${depois.linhas})`)

    // Back to the bottom, then live messages one by one.
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 20_000)
    await wait(1_000)
    const contagens = []
    for (let i = 0; i < 10; i++) {
      enviadas++
      const texto = `janela-alta-${altura}-${i}`
      await bruno.send(caso.SALA, mensagem(texto))
      await ate(() => page.evaluate((t) => [...document.querySelectorAll(".timeline .message p")].some((p) => p.textContent === t), texto), 20_000)
      contagens.push((await medida()).linhas)
    }
    const fim = await medida()
    linha(
      fim.scrollHeight >= 2 * fim.clientHeight && Math.max(...contagens) - Math.min(...contagens) <= 45,
      `${altura} px: 10 ao vivo, linhas desenhadas entre ${Math.min(...contagens)} e ${Math.max(...contagens)}, conteúdo ${fim.scrollHeight} px para ${fim.clientHeight} px`,
    )
    await nav.close()
    nav = null
  }
  console.log(`(${enviadas} mensagens do Bruno)`)
} catch (erro) {
  linha(false, `o guião rebentou: ${String(erro?.stack ?? erro)}`)
} finally {
  await nav?.close().catch(() => {})
  bruno?.disconnect()
  casa.fechar()
  rmSync(CORRIDA, { recursive: true, force: true })
}
process.exit(falhou ? 1 : 0)
