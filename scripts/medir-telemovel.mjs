/**
 * The 1.3.6 phone layout, measured in the three engines.
 *
 *   node scripts/medir-telemovel.mjs                 (needs `npm run build` first)
 *   node scripts/medir-telemovel.mjs webkit          (one engine only)
 *
 * The reports this locks down, all measured at 390x844 before 1.3.6:
 *
 *  1. Settings in the rail was cut off on a phone in landscape
 *     (568x320, 750x342): the rail did not scroll.
 *  2. The settings sections only existed in the hamburger drawer.
 *
 * Since the phone layout with tabs (option B, 20/11/2026) there is no rail
 * and no drawer at 840 px or less: Settings is a screen of the "Tu" tab, and
 * the direct chat is pushed full screen from Messages. The checks of the rail
 * and of the drawer became the same checks on the tabs.
 *  3. In Friends, "Encontrar" was cut off (347 px of tabs in 304).
 *  4. The compose box was 119 px wide.
 *  5. The header of a direct chat wrapped onto three lines.
 *  6. The "request sent" alert sat on top of the direct chat's compose bar.
 *
 * For each engine: Ana and Bruno, new accounts, at 390x844 (Chromium and
 * WebKit with touch and `isMobile`; Playwright's Firefox has no `isMobile`,
 * and runs with the width only). Bruno sends a friend request through the
 * link, opens the direct chat, Ana accepts, and we measure. Then at 360x740
 * and in landscape. And at 1200x860 we check the wide screen stayed as it was.
 *
 * ALL LOCAL AND DISPOSABLE: `servidor-descartavel.mjs`, its own ports, and
 * no way to point it at production. Screenshots in `capturas/telemovel-*`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { abrirNoTu, appAberta, irPara, noTelemovel } from "./separadores.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const MOTORES = { chromium, firefox, webkit }
const pedidos = process.argv.slice(2).filter((nome) => nome in MOTORES)
const escolhidos = pedidos.length > 0 ? pedidos : Object.keys(MOTORES)
const CAPTURAS = join(RAIZ, "capturas")
mkdirSync(CAPTURAS, { recursive: true })

const resultados = []
function check(nome, ok, detalhe = "") {
  resultados.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

const ANA = "Ana"
const BRUNO = "Bruno"
const dentro = (page) => appAberta(page, 90_000)

/** An element's rectangle, rounded. */
async function caixa(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), direita: Math.round(r.right), fundo: Math.round(r.bottom) }
  })
}

/**
 * Settings can be reached at this size. On a computer: the rail's button,
 * with the rail scrolled to its end. On a phone: the "Tu" tab in view and to
 * the finger, and in its list the "Configurações" entry, also in view and to
 * the finger (scrolled into view, as a finger would).
 */
async function configuracoesAlcancaveis(page) {
  const acerto = (seletor, texto) =>
    page.evaluate(
      ([s, t]) => {
        const el = [...document.querySelectorAll(s)].find((e) => !t || e.getAttribute("aria-label") === t || e.textContent?.includes(t))
        if (!el) return { ok: false, motivo: `sem ${s}` }
        el.scrollIntoView({ block: "nearest" })
        const r = el.getBoundingClientRect()
        const dentroDoEcra = r.top >= 0 && r.bottom <= window.innerHeight + 0.5 && r.height >= 40
        const alvo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        const acerta = alvo !== null && el.contains(alvo)
        return { ok: dentroDoEcra && acerta, motivo: `${s}: topo ${Math.round(r.top)}, fundo ${Math.round(r.bottom)} em ${window.innerHeight}, altura ${Math.round(r.height)}, acerta ${acerta}` }
      },
      [seletor, texto],
    )
  if (await noTelemovel(page)) {
    await irPara(page, "tu")
    const tab = await acerto(".separadores .separador", "Tu")
    if (!tab.ok) return tab
    return acerto(".menu-do-tu-entrada", "Configurações")
  }
  return page.evaluate(() => {
    const carril = document.querySelector(".rail")
    const botao = [...document.querySelectorAll(".rail .rail-btn")].find((el) => el.getAttribute("aria-label") === "Configurações" || el.getAttribute("title") === "Configurações")
    if (!carril || !botao) return { ok: false, motivo: "sem carril ou sem botão" }
    carril.scrollTop = carril.scrollHeight
    const r = botao.getBoundingClientRect()
    const dentroDoEcra = r.top >= 0 && r.bottom <= window.innerHeight + 0.5 && r.height >= 40
    const alvo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    const acerta = alvo !== null && botao.contains(alvo)
    return { ok: dentroDoEcra && acerta, motivo: `topo ${Math.round(r.top)}, fundo ${Math.round(r.bottom)} em ${window.innerHeight}, altura ${Math.round(r.height)}, acerta ${acerta}` }
  })
}

async function separador(page, nome) {
  await irPara(page, "amigos")
  await page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await page.locator(".people-tabs").getByRole("button", { name: nome }).click()
}

async function medirMotor(nome, servidor, portaBase) {
  console.log(`\n== ${nome} ==`)
  const browser = await MOTORES[nome].launch({ headless: true })
  const telemovel = nome === "firefox" ? {} : { isMobile: true, hasTouch: true }
  const contexto = { locale: "pt-PT", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...telemovel }
  try {
    const ctxA = await browser.newContext(contexto)
    const a = await ctxA.newPage()
    await a.goto(servidor.APP, { waitUntil: "domcontentloaded" })
    await criarConta(a, { nome: ANA, servidor: servidor.NOME })
    await dentro(a)
    const ctxB = await browser.newContext(contexto)
    const b = await ctxB.newPage()
    await b.goto(servidor.APP, { waitUntil: "domcontentloaded" })
    await criarConta(b, { nome: BRUNO, servidor: servidor.NOME })
    await dentro(b)
    const grosso = await b.evaluate(() => window.matchMedia("(pointer: coarse)").matches)
    console.log(`  ..  ponteiro ${grosso ? "de dedo (coarse)" : "fino"}`)

    // --- Friends: all four tabs in view --------------------------------------
    for (const [w, h] of [[390, 844], [360, 740]]) {
      await a.setViewportSize({ width: w, height: h })
      await separador(a, "Todos")
      const tabs = await a.locator(".people-tabs").evaluate((nav) => {
        const n = nav.getBoundingClientRect()
        const fora = [...nav.querySelectorAll(".people-tab")].filter((tab) => {
          const r = tab.getBoundingClientRect()
          return r.left < n.left - 0.5 || r.right > n.right + 0.5 || r.right > window.innerWidth
        })
        const linhas = new Set([...nav.querySelectorAll(".people-tab")].map((tab) => Math.round(tab.getBoundingClientRect().top))).size
        return { sw: nav.scrollWidth, cw: nav.clientWidth, fora: fora.map((tab) => tab.textContent), linhas }
      })
      check(`${w}px: os quatro separadores de Amigos cabem, nenhum cortado`, tabs.sw <= tabs.cw + 1 && tabs.fora.length === 0, `scrollWidth ${tabs.sw}, clientWidth ${tabs.cw}, fora ${tabs.fora.join(",") || "nenhum"}`)
      check(`${w}px: e numa linha só`, tabs.linhas === 1, `${tabs.linhas} linha(s)`)
    }
    await a.setViewportSize({ width: 390, height: 844 })

    // --- The request, and the alert that does not cover the direct chat ------
    await separador(a, "Encontrar")
    const link = await a.getByLabel("O teu link de amizade", { exact: true }).inputValue()
    await separador(b, "Encontrar")
    await b.getByLabel("Cola um link ou endereço").fill(link)
    await b.getByRole("button", { name: "Abrir perfil" }).click()
    const folha = b.locator(".person-profile")
    await folha.waitFor({ timeout: 15_000 })
    await folha.getByRole("button", { name: "Pedir amizade" }).click()
    await b.locator(".toast", { hasText: "pedido enviado" }).waitFor({ timeout: 30_000 })
    check("o aviso de pedido enviado aparece", true)
    await folha.getByRole("button", { name: "Mensagem" }).click()
    await b.locator(".chat-composer, .chat-escrita-trancada").first().waitFor({ timeout: 15_000 })
    await b.waitForTimeout(400)
    check("abrir a directa tira o aviso de pedido enviado", (await b.locator(".toast", { hasText: "pedido enviado" }).count()) === 0)

    await separador(a, "Recebidos")
    await a.getByRole("button", { name: "Aceitar" }).waitFor({ timeout: 60_000 })
    await a.getByRole("button", { name: "Aceitar" }).click()

    // Bruno's direct chat, with the compose box already there.
    await b.locator(".chat-composer .composer-line").waitFor({ timeout: 90_000 })
    for (const [w, h, minimo] of [[390, 844, 150], [360, 740, 120]]) {
      await b.setViewportSize({ width: w, height: h })
      await b.waitForTimeout(300)
      const topo = await caixa(b.locator(".main .topbar").first())
      const botoes = await b.locator(".main .topbar button").evaluateAll((lista) => lista.filter((el) => el.offsetParent !== null).map((el) => { const r = el.getBoundingClientRect(); return { y: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), direita: Math.round(r.right) } }))
      // One line: there is a horizontal band that crosses every button (different
      // heights centre on different tops, and that is not another line).
      const linhas = botoes.length === 0 || Math.max(...botoes.map((b) => b.y)) < Math.min(...botoes.map((b) => b.y + b.h)) ? 1 : 2
      check(`${w}px: o cabeçalho da directa fica numa linha`, linhas === 1 && topo.h <= 64, `altura ${topo.h}, ${botoes.length} botões em ${linhas} linha(s)`)
      check(`${w}px: nenhum botão do cabeçalho sai do ecrã`, botoes.every((botao) => botao.direita <= w), botoes.map((botao) => botao.direita).join(","))
      if (grosso) check(`${w}px: os botões do cabeçalho têm 44 px para o dedo`, botoes.every((botao) => botao.h >= 44 && botao.w >= 44), botoes.map((botao) => `${botao.w}x${botao.h}`).join(" "))
      // Before option B the Friends tabs shared their bar with the
      // conversations handle, and had to fit beside it. On the phone the direct
      // chat is pushed full screen now: no handle, and no bar of tabs over it.
      const sobreAConversa = await b.evaluate(() => {
        const visivel = (el) => el !== null && el.getBoundingClientRect().width > 0
        return {
          pega: visivel(document.querySelector(".people-bar-conversas")),
          separadores: visivel(document.querySelector(".separadores")),
          empurrada: Math.round(document.querySelector(".ecra-empurrado")?.getBoundingClientRect().width ?? 0),
        }
      })
      check(`${w}px: a directa ocupa o ecrã, sem pega das conversas nem separadores por cima`, !sobreAConversa.pega && !sobreAConversa.separadores && sobreAConversa.empurrada === w, JSON.stringify(sobreAConversa))
      const entrada = b.locator(".chat-composer .composer-line > textarea")
      const largura = (await caixa(entrada)).w
      check(`${w}px: a caixa de escrita tem pelo menos ${minimo} px`, largura >= minimo, `${largura} px`)
      const letra = await entrada.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
      if (grosso) check(`${w}px: a letra da caixa fica nos 16 px (o iOS não amplia)`, letra >= 16, `${letra} px`)
      const daBarra = await b.locator(".chat-composer .composer-line > button, .chat-composer .composer-line > label").evaluateAll((lista) => lista.filter((el) => el.offsetParent !== null).map((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}` }))
      if (grosso) check(`${w}px: os botões da barra de escrita têm 44 px`, daBarra.every((m) => m.split("x").every((n) => Number(n) >= 44)), daBarra.join(" "))
      check(`${w}px: o Enviar continua a chamar-se "Enviar"`, (await b.getByRole("button", { name: "Enviar", exact: true }).count()) === 1)
      await b.screenshot({ path: join(CAPTURAS, `telemovel-${nome}-directa-${w}.png`) })
    }
    await b.setViewportSize({ width: 390, height: 844 })

    // --- The settings sections, on the screen itself -------------------------
    await abrirNoTu(b, "Configurações")
    const lista = b.getByRole("navigation", { name: "Secções das configurações" })
    await lista.waitFor({ timeout: 10_000 })
    // The pushed screen slides in (220 ms, 440 ms with reduced motion): measure it once it is in place.
    await b.waitForFunction(() => document.querySelector(".ecra-empurrado")?.getAnimations({ subtree: true }).every((a) => a.playState !== "running") ?? true, null, { timeout: 5_000 }).catch(() => {})
    const itens = lista.getByRole("button")
    // In view means above the bar of tabs too, when it is drawn.
    const visiveis = await itens.evaluateAll((botoes) => {
      const barra = document.querySelector(".separadores")?.getBoundingClientRect()
      const fundo = barra && barra.height > 0 ? barra.top : window.innerHeight
      const caixas = botoes.map((el) => el.getBoundingClientRect())
      return {
        n: caixas.filter((r) => r.height >= 44 && r.bottom <= fundo && r.right <= window.innerWidth).length,
        detalhe: `fundo ${Math.round(fundo)}, largura ${window.innerWidth}; ${caixas.map((r) => `${Math.round(r.top)}-${Math.round(r.bottom)} x${Math.round(r.left)}-${Math.round(r.right)}`).join(" ")}`,
      }
    })
    check("390px: as seis secções estão à vista no ecrã, sem rolar", visiveis.n === 6, `${visiveis.n} de ${await itens.count()}; ${visiveis.detalhe}`)
    check("e as Configurações são um ecrã empurrado do Tu, com a barra Voltar", (await b.locator(".ecra-empurrado .barra-do-telemovel").count()) === 1)
    await b.screenshot({ path: join(CAPTURAS, `telemovel-${nome}-configuracoes-lista.png`) })
    await lista.getByRole("button", { name: "Microfone e câmara" }).click()
    check("tocar numa secção abre-a", await b.getByRole("heading", { level: 2, name: "Microfone e câmara" }).first().isVisible().catch(() => false))
    await b.getByRole("button", { name: "Voltar às secções" }).click()
    check("e o voltar devolve a lista", await lista.isVisible().catch(() => false))

    // --- The rail: Settings can be reached at every size ---------------------
    for (const [w, h] of [[568, 320], [750, 342], [360, 740], [390, 844]]) {
      await b.setViewportSize({ width: w, height: h })
      await b.waitForTimeout(300)
      const alcance = await configuracoesAlcancaveis(b)
      check(`${w}x${h}: as Configurações estão à vista e ao dedo (separador Tu)`, alcance.ok, alcance.motivo)
      if (w === 568) await b.screenshot({ path: join(CAPTURAS, `telemovel-${nome}-deitado-568.png`) })
    }

    // --- Wide screen: as it was ----------------------------------------------
    await b.setViewportSize({ width: 1200, height: 860 })
    await b.waitForTimeout(600)
    await b.getByRole("button", { name: "Configurações", exact: true }).first().click()
    check("1200px: o menu das secções continua na barra lateral", await b.locator(".sidebar .settings-nav").isVisible().catch(() => false))
    check("1200px: sem lista no ecrã nem botão de voltar", (await b.getByRole("navigation", { name: "Secções das configurações" }).count()) === 0 && (await b.getByRole("button", { name: "Voltar às secções" }).count()) === 0)
    const rail = await b.locator(".rail").evaluate((el) => getComputedStyle(el).overflowY)
    check("1200px: o carril não rola (nada mudou num ecrã alto)", rail === "visible", rail)
    await b.screenshot({ path: join(CAPTURAS, `telemovel-${nome}-largo-1200.png`) })
    await ctxA.close()
    await ctxB.close()
  } catch (erro) {
    check(`${nome}: o percurso correu até ao fim`, false, String(erro?.message ?? erro).split("\n")[0])
  } finally {
    await browser.close()
  }
}

let servidor
try {
  let porta = 8781
  for (const nome of escolhidos) {
    servidor = await levantarServidor({ frente: porta, servidor: porta + 1, etiqueta: `telemovel-${nome}` })
    await medirMotor(nome, servidor, porta)
    servidor.fechar()
    servidor = null
    porta += 2
  }
} finally {
  servidor?.fechar()
}

const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)
