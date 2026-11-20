/**
 * "Load older" in a channel with a busy polls room (carregar-antigas, 18/11/2026).
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/e2e-carregar-antigas.mjs [--dist <apps/web/dist>] [etiqueta]
 *
 * The bug: "when I press load older in the chat, it does not load". Through the
 * interface, in Chromium with reduced motion (as a Windows with animations off), in Escuro and Aurora:
 *  1. Wanda creates an account in the browser. Xavier, an account of the core here in
 *     Node, creates the room "dia" with the rooms "conversa" and "votos", and seats her
 *     and ten helpers.
 *  2. Wanda closes the app. Xavier writes 600 lines in "conversa" and 100 polls in
 *     "votos"; each helper votes on every poll (1 000 votes); Xavier writes 10 lines.
 *     The vault keeps 400 of the conversation and the rest goes to the archive.
 *  3. Per skin: Wanda opens the app, opens "conversa", presses "Carregar mais antigas"
 *     ONCE and counts the new lines. Then she goes to another room and back, and
 *     presses again. Then on to the start: every one of the 610 lines passes through
 *     the screen. Xavier writes one more line: the first line of the day stays.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8620 and 8621. Captures in
 * `.verify-data/prova-carregar-antigas/<etiqueta>-<data>/`.
 */
import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { moradaDeSala } from "@enclave/protocol"
import { Session, Vault } from "@enclave/client-core"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { abrirCanal, ate, contasDoServidor, dentro, espera, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const argumentos = process.argv.slice(2)
const iDist = argumentos.indexOf("--dist")
const DIST = iDist >= 0 ? resolve(argumentos[iDist + 1]) : undefined
const ETIQUETA = argumentos.filter((_, i) => i !== iDist && i !== iDist + 1)[0] ?? "prova"
const FRASE = "frase-de-verificacao-2026"
const LINHAS_ANTES = 600
const VOTACOES = 100
const AJUDANTES = 10
const LINHAS_DEPOIS = 10
const TOTAL = LINHAS_ANTES + LINHAS_DEPOIS
const CAPTURAS = join(RAIZ, ".verify-data/prova-carregar-antigas", `${ETIQUETA}-${new Date().toISOString().replace(/[:.]/g, "-")}`)
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8620, servidor: 8621, sfu: 0, etiqueta: "carregar-antigas", ...(DIST ? { dist: DIST } : {}) })
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

async function enviarTudo(conta, canal, payloads) {
  for (let i = 0; i < payloads.length; i += 100) await conta.session.sendBatch(canal, payloads.slice(i, i + 100))
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

/**
 * Where the reader is: the first line in view (or, with `texto`, that same line) and the
 * distance of its BOTTOM from the top of the timeline, in px. After the click the same line
 * is measured again, not the first one in view: with the button on the screen the first
 * line sits below it, and the older lines that come in fill the place of the button. The
 * bottom, because the line can join the group of the lines that come in and lose the name
 * above its text (see `distanciaAoTopo` in `Timeline.tsx`).
 */
const linhaNoTopo = async (page, texto = null) =>
  page.evaluate((procurada) => {
    const el = document.querySelector(".timeline")
    if (!el) return null
    const topo = el.getBoundingClientRect().top
    for (const linha of el.querySelectorAll(".message")) {
      const caixa = linha.getBoundingClientRect()
      const dia = (linha.textContent ?? "").match(/dia-\d{4}/)?.[0] ?? ""
      if (procurada === null ? caixa.bottom > topo : dia === procurada) return { texto: dia, distancia: Math.round(caixa.bottom - topo) }
    }
    return null
  }, texto)

/**
 * The empty space under the last line, in px, when the lines do not fill the timeline.
 * A short conversation (the lines kept on this device) starts at the top and leaves room
 * at the bottom. When the older lines come in the screen fills, the scroller can go no
 * lower than its end, and every line comes down by that room: the line the reader holds
 * cannot stay closer than that.
 */
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

try {
  const browser = await chromium.launch({ headless: true })
  browsers.push(browser)
  const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" })
  let page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (erro) => erros.push(erro.message))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome: "Wanda", frase: FRASE, servidor: srv.NOME })
  await dentro(page)
  const wanda = contasDoServidor(srv.base).at(-1)

  // 1. The room, with Wanda and the helpers.
  const xavier = await contaNoNode("Xavier")
  const ajudantes = []
  for (let i = 0; i < AJUDANTES; i++) ajudantes.push(await contaNoNode(`Ajudante ${i}`))
  const sala = moradaDeSala(srv.NOME)
  await xavier.session.createSpace(
    sala,
    [
      { kind: "text", name: "conversa" },
      { kind: "text", name: "votos" },
    ],
    "dia",
  )
  await ate(async () => xavier.session.founderOf(sala) === xavier.address, 15_000, 100)
  for (const quem of [wanda, ...ajudantes.map((a) => a.address)]) await xavier.session.seat(sala, quem)
  await ate(async () => ajudantes.every((a) => a.session.channels.includes(sala)), 60_000, 300)
  const salas = xavier.session.roomsOf(sala)
  const conversa = salas.find((s) => s.name === "conversa")?.room
  const votos = salas.find((s) => s.name === "votos")?.room
  check("as salas «conversa» e «votos» existem", Boolean(conversa && votos), JSON.stringify(salas.map((s) => s.name)))
  await abrirCanal(page, "dia")

  // 2. Wanda goes away; the day happens.
  await page.close()
  const inicio = Date.now()
  const linha = (i) => ({ t: "message", room: conversa, body: `dia-${String(i).padStart(4, "0")}`, sentAt: Date.now() + i, id: `dia-${String(i).padStart(6, "0")}` })
  await enviarTudo(xavier, sala, Array.from({ length: LINHAS_ANTES }, (_, i) => linha(i)))
  const ids = Array.from({ length: VOTACOES }, (_, i) => `votacao-${String(i).padStart(4, "0")}`)
  await enviarTudo(
    xavier,
    sala,
    ids.map((id, i) => ({ t: "message", room: votos, id, sentAt: Date.now() + i, body: `Pergunta ${i}?\n1. Sim\n2. Não`, poll: { question: `Pergunta ${i}?`, options: ["Sim", "Não"] } })),
  )
  await Promise.all(
    ajudantes.map((ajudante, a) =>
      enviarTudo(
        ajudante,
        sala,
        ids.map((target) => ({ t: "post.reaction", id: crypto.randomUUID(), target, emoji: "", at: Date.now(), remove: false, vote: a % 2 })),
      ),
    ),
  )
  await enviarTudo(xavier, sala, Array.from({ length: LINHAS_DEPOIS }, (_, i) => linha(LINHAS_ANTES + i)))
  console.log(`  (${TOTAL} linhas, ${VOTACOES} votações e ${VOTACOES * AJUDANTES} votos em ${Math.round((Date.now() - inicio) / 1000)} s)`)

  const botao = () => page.locator(".timeline-load-older")
  const fim = () => page.locator(".timeline-inicio-do-aparelho")
  /**
   * Whether the element is drawn INSIDE the visible part of the timeline. `isVisible` is
   * not enough: when the last step of the drawn window opens, the button is drawn at the
   * top of the scroller and the browser anchors the reader about 1 000 px below it, out
   * of view. A click there scrolls the button into view first (Playwright, or the focus
   * of the keyboard), so the reader is no longer where the script measured.
   */
  const noEcra = async (alvo) =>
    page
      .locator(".timeline")
      .evaluate((el, seletor) => {
        const coisa = el.querySelector(seletor)
        if (!coisa) return false
        const vista = el.getBoundingClientRect()
        const caixa = coisa.getBoundingClientRect()
        return caixa.height > 0 && caixa.top >= vista.top && caixa.bottom <= vista.bottom
      }, alvo)
      .catch(() => false)
  /** Up with the wheel, as a person does, until the button or the end line is on the screen. */
  const aoTopo = async (vistas) => {
    const caixa = await page.locator(".timeline").boundingBox()
    if (caixa) await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
    for (let volta = 0; volta < 80; volta++) {
      await page.mouse.wheel(0, -4_000)
      await espera(150)
      for (const dia of await linhasNoEcra(page)) vistas.add(dia)
      if ((await noEcra(".timeline-load-older")) || (await noEcra(".timeline-inicio-do-aparelho"))) {
        /*
          The hand leaves the wheel before the finger presses. Chromium plays a wheel
          turn as a smooth scroll of a few hundred ms, latched to the timeline: a click
          inside it let the rest of the turn play on the lines that came in, and the
          reader went 130 px up with no line of ours moving the scroller.
        */
        await espera(1_000)
        return
      }
    }
  }

  for (const tema of ["escuro", "aurora"]) {
    // 3. Back, in this skin.
    page = await ctx.newPage()
    page.on("pageerror", (erro) => erros.push(erro.message))
    await page.addInitScript((t) => {
      const actual = JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}") ?? {}
      localStorage.setItem("enclave.prefs", JSON.stringify({ ...actual, tema: t }))
    }, tema)
    await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await desbloquear(page)
    await abrirCanal(page, "dia")
    await abrirSala(page, "conversa")
    const ultima = `dia-${String(TOTAL - 1).padStart(4, "0")}`
    check(`${tema}: a última linha chega`, (await ate(async () => (await linhasNoEcra(page)).includes(ultima), 300_000, 1_000)) >= 0)
    await espera(1_500)
    const vistas = new Set(await linhasNoEcra(page))
    const antes = vistas.size
    await page.screenshot({ path: join(CAPTURAS, `${tema}-1-recente.png`) })

    // One click: how many new lines?
    await aoTopo(vistas)
    const tinhaBotao = await noEcra(".timeline-load-older")
    check(`${tema}: o botão «Carregar mais antigas» está no topo, à vista`, tinhaBotao)
    const naJanelaAntes = new Set(await linhasNoEcra(page))
    const ondeEstava = await linhaNoTopo(page)
    const vazioAntes = await vazioEmBaixo(page)
    if (tinhaBotao) await botao().click()
    await espera(1_000)
    // Like Discord (1.3.25): the older lines come in above, and the reader stays on the same line.
    const ondeFicou = ondeEstava ? await linhaNoTopo(page, ondeEstava.texto) : null
    // Down by the room that was empty under the last line and is now filled, never more.
    const desceu = vazioAntes - (await vazioEmBaixo(page))
    check(
      `${tema}: depois do toque, quem lê fica na mesma linha`,
      ondeEstava !== null && ondeFicou !== null && ondeFicou.texto === ondeEstava.texto && Math.abs(ondeFicou.distancia - ondeEstava.distancia - desceu) <= 2,
      `${JSON.stringify(ondeEstava)} -> ${JSON.stringify(ondeFicou)}, vazio em baixo ${vazioAntes} -> ${vazioAntes - desceu} px`,
    )
    const depois1 = new Set(await linhasNoEcra(page))
    const novas1 = [...depois1].filter((d) => !naJanelaAntes.has(d)).length
    const topo1 = await page.evaluate(() => document.querySelector(".timeline")?.scrollTop ?? -1)
    console.log(`  ${tema}: ${antes} linhas ao abrir; o 1.º toque desenhou ${novas1} linhas novas (scrollTop ${topo1})`)
    await page.screenshot({ path: join(CAPTURAS, `${tema}-2-primeiro-toque.png`) })
    check(`${tema}: o 1.º toque desenha linhas mais antigas`, novas1 > 0, `${novas1} novas`)
    check(`${tema}: depois do toque, o ecrã não salta para o fundo`, !(await linhasNoEcra(page)).includes(ultima) || depois1.size > naJanelaAntes.size)
    for (const dia of depois1) vistas.add(dia)

    // Another room and back, then a second click.
    await abrirSala(page, "votos")
    await abrirSala(page, "conversa")
    await aoTopo(vistas)
    const naJanela2 = new Set(await linhasNoEcra(page))
    let novas2 = -1
    if (await botao().isVisible().catch(() => false)) {
      await botao().click()
      await espera(1_000)
      const depois2 = new Set(await linhasNoEcra(page))
      novas2 = [...depois2].filter((d) => !naJanela2.has(d)).length
      for (const dia of depois2) vistas.add(dia)
    }
    console.log(`  ${tema}: depois de trocar de sala, o 2.º toque desenhou ${novas2} linhas novas`)
    check(`${tema}: depois de trocar de sala, o toque seguinte também carrega`, novas2 > 0, `${novas2}`)

    // On to the start.
    let toques = 2
    for (; toques < 40; toques++) {
      await aoTopo(vistas)
      if (await fim().isVisible().catch(() => false)) break
      if (!(await botao().isVisible().catch(() => false))) break
      await botao().click()
      await espera(700)
    }
    await page.screenshot({ path: join(CAPTURAS, `${tema}-3-inicio.png`) })
    check(`${tema}: no topo, a linha «Não há mensagens mais antigas neste aparelho»`, await fim().isVisible().catch(() => false), `${toques} toques`)

    // A new line arrives while Wanda reads the start: the start stays.
    await xavier.session.sendBatch(sala, [linha(TOTAL + (tema === "aurora" ? 1 : 0))])
    await espera(3_000)
    const noTopo = await linhasNoEcra(page)
    check(`${tema}: chega uma linha nova e a primeira do dia continua no ecrã`, noTopo.includes("dia-0000"), noTopo.slice(0, 3).join(","))
    const altura = await page.evaluate(() => document.querySelector(".timeline")?.scrollHeight ?? 0)
    for (let topo = 0; topo <= altura + 2_000; topo += 300) {
      await page.evaluate((y) => document.querySelector(".timeline")?.scrollTo({ top: y }), topo)
      await espera(40)
      for (const dia of await linhasNoEcra(page)) vistas.add(dia)
    }
    const doDia = [...vistas].filter((d) => Number(d.slice(4)) < TOTAL)
    check(`${tema}: as ${TOTAL} linhas passam no ecrã`, doDia.length === TOTAL, `${doDia.length} de ${TOTAL}, ${toques} toques`)
    await page.close()
  }
  const toasts = []
  check("sem erros na página", erros.length === 0 && !toasts.some((t) => /Erro \d+/.test(t)), erros.join(" | ").slice(0, 200))
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log(`\ncapturas: ${CAPTURAS}`)
await arrumar(resumo() ? 0 : 1)
