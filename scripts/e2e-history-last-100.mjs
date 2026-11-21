/**
 * The newest 100 lines on joining, the rest a page at a time (history-last-100, 1.3.26).
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/e2e-history-last-100.mjs [--dist <apps/web/dist>] [label]
 *
 * Through the interface, with reduced motion (as a Windows with animations off), in
 * Chromium, Firefox and WebKit, each with two tabs of the same origin:
 *  1. Xavier and Yuri, two accounts of the core here in Node, have the channel "dia"
 *     with the room "conversa". Xavier writes 1 000 lines there.
 *  2. Per engine, Wanda creates a NEW account in the browser, and Xavier seats her. The
 *     past comes from the members (D2): she receives the newest 100 lines (dia-0900 to
 *     dia-0999), and nothing older comes by itself.
 *  3. She goes up to the top and presses "Carregar mais antigas" once: the next 100
 *     (dia-0800 to dia-0899) come from a member, and she stays on the line she was
 *     reading (like Discord).
 *  4. The second tab waits while the first is open. "Usar este separador": the first
 *     stops, the second opens with what the first stored. The 200 lines are there,
 *     from the device: the tap there does not ask any member.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8646 and 8647 (`E2E_PORTA_DA_FRENTE`,
 * `E2E_PORTA_DO_SERVIDOR`). Captures in `.verify-data/prova-history-last-100/<label>-<date>/`.
 */
import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { moradaDeSala } from "@enclave/protocol"
import { Session, Vault } from "@enclave/client-core"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { abrirCanal, ate, contasDoServidor, dentro, espera, temCanal, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const argumentos = process.argv.slice(2)
const iDist = argumentos.indexOf("--dist")
const DIST = iDist >= 0 ? resolve(argumentos[iDist + 1]) : undefined
const ETIQUETA = argumentos.filter((_, i) => i !== iDist && i !== iDist + 1)[0] ?? "prova"
const FRASE = "frase-de-verificacao-2026"
const LINHAS = 1_000
/** `HISTORY_PAGE_LINES`: the lines on joining, and per tap. */
const PAGINA = 100
const ESPERA = "Já tens o Orwell aberto noutro separador."
const CAPTURAS = join(RAIZ, ".verify-data/prova-history-last-100", `${ETIQUETA}-${new Date().toISOString().replace(/[:.]/g, "-")}`)
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({
  frente: Number(process.env.E2E_PORTA_DA_FRENTE ?? 8646),
  servidor: Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8647),
  sfu: 0,
  etiqueta: "history-last-100",
  ...(DIST ? { dist: DIST } : {}),
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

async function contaNoNode(nome) {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-de-teste-do-no")
  const session = new Session(vault)
  const identidade = await session.createIdentity(srv.NOME)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  const conta = { nome, session, vault, address: identidade.address }
  nos.push(conta)
  return conta
}

async function desbloquear(page) {
  const campo = page.locator('input[type="password"]').first()
  await campo.or(page.getByRole("button", { name: "Configurações", exact: true }).first()).first().waitFor({ timeout: 60_000 })
  if (await campo.count()) {
    await campo.fill(FRASE)
    await page.keyboard.press("Enter")
  }
  await dentro(page)
}

/** The "dia-NNNN" lines drawn now. */
const linhasNoEcra = async (page) =>
  page.evaluate(() => [...new Set((document.querySelector(".timeline")?.textContent ?? "").match(/dia-\d{4}/g) ?? [])])

/** The first line in view (or, with `texto`, that line) and the distance of its bottom from the timeline's top. See `e2e-carregar-antigas.mjs`. */
const linhaNoTopo = async (page, texto = null) =>
  page.evaluate((procurada) => {
    const el = document.querySelector(".timeline")
    if (!el) return null
    const topo = el.getBoundingClientRect().top
    for (const linha of el.querySelectorAll(".message")) {
      const caixa = linha.getBoundingClientRect()
      const dia = (linha.textContent ?? "").match(/dia-\d{4}/)?.[0] ?? ""
      if (procurada === null ? caixa.bottom > topo && dia !== "" : dia === procurada) return { texto: dia, distancia: Math.round(caixa.bottom - topo) }
    }
    return null
  }, texto)

/** The empty space under the last line, in px, when the lines do not fill the timeline. See `e2e-carregar-antigas.mjs`. */
const vazioEmBaixo = async (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".timeline")
    const linhas = el?.querySelectorAll(".message")
    if (!el || !linhas?.length) return 0
    const fundo = el.getBoundingClientRect().bottom - parseFloat(getComputedStyle(el).paddingBottom || "0")
    return Math.max(0, Math.round(fundo - linhas[linhas.length - 1].getBoundingClientRect().bottom))
  })

const linhaDaSala = (page, nome) => page.locator(".room-row", { has: page.locator(`.room-name:text-is("${nome}")`) }).first()
async function abrirSala(page, nome) {
  await linhaDaSala(page, nome).locator("button.room").first().click({ timeout: 30_000 })
  await espera(500)
}

/** Whether the element is drawn inside the visible part of the timeline. */
const noEcra = async (page, seletor) =>
  page
    .locator(".timeline")
    .evaluate((el, alvo) => {
      const coisa = el.querySelector(alvo)
      if (!coisa) return false
      const vista = el.getBoundingClientRect()
      const caixa = coisa.getBoundingClientRect()
      return caixa.height > 0 && caixa.top >= vista.top && caixa.bottom <= vista.bottom
    }, seletor)
    .catch(() => false)

/** Up with the wheel, as a person does, until the button or the end line is on the screen. */
async function aoTopo(page, vistas) {
  const caixa = await page.locator(".timeline").boundingBox()
  if (caixa) await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
  for (let volta = 0; volta < 80; volta++) {
    await page.mouse.wheel(0, -4_000)
    await espera(150)
    for (const dia of await linhasNoEcra(page)) vistas.add(dia)
    if ((await noEcra(page, ".timeline-load-older")) || (await noEcra(page, ".timeline-inicio-do-aparelho"))) {
      // The wheel turn ends before the finger presses (see `e2e-carregar-antigas.mjs`).
      await espera(1_000)
      return
    }
  }
}

/** Every line between the top and the bottom of the timeline. */
async function todasAsLinhas(page, vistas) {
  const altura = await page.evaluate(() => document.querySelector(".timeline")?.scrollHeight ?? 0)
  for (let topo = 0; topo <= altura + 2_000; topo += 300) {
    await page.evaluate((y) => document.querySelector(".timeline")?.scrollTo({ top: y }), topo)
    await espera(40)
    for (const dia of await linhasNoEcra(page)) vistas.add(dia)
  }
  return vistas
}

const numeros = (vistas) => [...vistas].map((d) => Number(d.slice(4))).sort((a, b) => a - b)
const intervalo = (vistas) => {
  const n = numeros(vistas)
  return n.length ? `${n.length} linhas, ${n[0]}..${n.at(-1)}` : "nenhuma"
}
const servidas = () => nos.reduce((soma, conta) => soma + conta.session.estatisticasDosMembros.paginasServidas, 0)

const MOTORES = { chromium, firefox, webkit }

try {
  // 1. The channel, with 1 000 lines.
  const xavier = await contaNoNode("Xavier")
  const yuri = await contaNoNode("Yuri")
  const sala = moradaDeSala(srv.NOME)
  await xavier.session.createSpace(sala, [{ kind: "text", name: "conversa" }], "dia")
  await ate(async () => xavier.session.founderOf(sala) === xavier.address, 15_000, 100)
  await xavier.session.seat(sala, yuri.address)
  await ate(async () => yuri.session.channels.includes(sala), 60_000, 300)
  const conversa = xavier.session.roomsOf(sala).find((s) => s.name === "conversa")?.room
  check("a sala «conversa» existe", Boolean(conversa))
  const linha = (i) => ({ t: "message", room: conversa, body: `dia-${String(i).padStart(4, "0")}`, sentAt: Date.now() + i, id: `dia-${String(i).padStart(6, "0")}` })
  const inicio = Date.now()
  for (let i = 0; i < LINHAS; i += 100) await xavier.session.sendBatch(sala, Array.from({ length: 100 }, (_, j) => linha(i + j)))
  await ate(async () => yuri.session.history(sala).some((e) => e.payload.body === `dia-${LINHAS - 1}`), 120_000, 500)
  console.log(`  (${LINHAS} linhas em ${Math.round((Date.now() - inicio) / 1000)} s)`)

  for (const motor of ["chromium", "firefox", "webkit"]) {
    const browser = await MOTORES[motor].launch({ headless: true })
    browsers.push(browser)
    const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" })
    const erros = []
    const page = await ctx.newPage()
    page.on("pageerror", (erro) => erros.push(erro.message))
    await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await criarConta(page, { nome: `Wanda ${motor.slice(0, 6)}`, frase: FRASE, servidor: srv.NOME })
    await dentro(page)
    const wanda = contasDoServidor(srv.base).at(-1)

    // 2. Seated after the 1 000 lines: the newest 100 come from the members.
    const entrou = Date.now()
    await xavier.session.seat(sala, wanda)
    check(`${motor}: o canal «dia» aparece`, (await temCanal(page, "dia", 90_000)) !== false)
    await abrirCanal(page, "dia")
    await abrirSala(page, "conversa")
    const ultima = `dia-${String(LINHAS - 1).padStart(4, "0")}`
    const chegou = await ate(async () => (await linhasNoEcra(page)).includes(ultima), 180_000, 1_000)
    const aoEntrar = Date.now() - entrou
    check(`${motor}: a última linha chega`, chegou >= 0)
    // The sync on joining ends with 100: wait for it to be quiet, then nothing older.
    const vistas = new Set()
    let antes = -1
    for (let volta = 0; volta < 30; volta++) {
      await aoTopo(page, vistas)
      await todasAsLinhas(page, vistas)
      if (vistas.size === antes && vistas.size >= PAGINA) break
      antes = vistas.size
      await espera(2_000)
    }
    await espera(5_000)
    await todasAsLinhas(page, vistas)
    console.log(`  ${motor}: ao entrar, ${intervalo(vistas)} em ${Math.round(aoEntrar / 1000)} s até à última`)
    check(`${motor}: ao entrar recebe as 100 mais recentes, e só essas`, vistas.size === PAGINA && numeros(vistas)[0] === LINHAS - PAGINA, intervalo(vistas))
    await page.screenshot({ path: join(CAPTURAS, `${motor}-1-ao-entrar.png`) })

    // 3. One tap: 100 more from a member, and the reader stays on the same line.
    await aoTopo(page, vistas)
    const botao = page.locator(".timeline-load-older")
    check(`${motor}: o botão «Carregar mais antigas» está no topo, à vista`, await noEcra(page, ".timeline-load-older"))
    const ondeEstava = await linhaNoTopo(page)
    const vazioAntes = await vazioEmBaixo(page)
    const servidasAntes = servidas()
    await botao.click()
    const primeira = `dia-${String(LINHAS - 2 * PAGINA).padStart(4, "0")}`
    const trouxe = await ate(async () => (await page.evaluate(() => document.querySelector(".timeline")?.textContent ?? "")).includes(primeira), 120_000, 500)
    await espera(1_500)
    const ondeFicou = ondeEstava ? await linhaNoTopo(page, ondeEstava.texto) : null
    const desceu = vazioAntes - (await vazioEmBaixo(page))
    check(`${motor}: o toque traz as 100 seguintes de um membro`, trouxe >= 0 && servidas() > servidasAntes, `${servidas() - servidasAntes} páginas servidas`)
    check(
      `${motor}: depois do toque, quem lê fica na mesma linha`,
      ondeEstava !== null && ondeFicou !== null && ondeFicou.texto === ondeEstava.texto && Math.abs(ondeFicou.distancia - ondeEstava.distancia - desceu) <= 2,
      `${JSON.stringify(ondeEstava)} -> ${JSON.stringify(ondeFicou)}, vazio em baixo ${vazioAntes} -> ${vazioAntes - desceu} px`,
    )
    await page.screenshot({ path: join(CAPTURAS, `${motor}-2-depois-do-toque.png`) })
    const depois = await todasAsLinhas(page, new Set())
    check(`${motor}: no ecrã estão as 200 mais recentes`, depois.size === 2 * PAGINA && numeros(depois)[0] === LINHAS - 2 * PAGINA, intervalo(depois))

    // 4. The second tab waits; then it takes over, and the 200 are on this device.
    const p2 = await ctx.newPage()
    p2.on("pageerror", (erro) => erros.push(`2.º separador: ${erro.message}`))
    await p2.goto(srv.APP, { waitUntil: "domcontentloaded" })
    check(`${motor}: o 2.º separador espera`, (await ate(async () => (await p2.locator("body").innerText()).includes(ESPERA), 30_000, 500)) >= 0)
    await p2.getByRole("button", { name: "Usar este separador" }).click({ timeout: 15_000 })
    await desbloquear(p2)
    await abrirCanal(p2, "dia")
    await abrirSala(p2, "conversa")
    check(`${motor}: o 2.º separador abre a conversa`, (await ate(async () => (await linhasNoEcra(p2)).includes(ultima), 90_000, 1_000)) >= 0)
    await espera(3_000)
    const servidasAntes2 = servidas()
    const vistas2 = new Set()
    for (let toque = 0; toque < 3; toque++) {
      await aoTopo(p2, vistas2)
      if (!(await noEcra(p2, ".timeline-load-older"))) break
      if ((await todasAsLinhas(p2, vistas2)).size >= 2 * PAGINA) break
      await p2.locator(".timeline-load-older").click()
      await espera(1_500)
    }
    await todasAsLinhas(p2, vistas2)
    check(`${motor}: no 2.º separador as 200 vêm do aparelho`, vistas2.size >= 2 * PAGINA && numeros(vistas2)[0] <= LINHAS - 2 * PAGINA, intervalo(vistas2))
    check(`${motor}: o 2.º separador não pede a nenhum membro o que já tem`, servidas() === servidasAntes2, `${servidas() - servidasAntes2} páginas servidas`)
    await p2.screenshot({ path: join(CAPTURAS, `${motor}-3-segundo-separador.png`) })
    check(`${motor}: sem erros na página`, erros.length === 0, erros.join(" | ").slice(0, 200))
    await browser.close()
  }
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log(`\ncapturas: ${CAPTURAS}`)
await arrumar(resumo() ? 0 : 1)
