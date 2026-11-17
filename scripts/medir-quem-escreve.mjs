/**
 * "Who is typing" anchored to the composer, measured in the real web app (1.3.16.1).
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/medir-quem-escreve.mjs [--dist <apps/web/dist of any build>] [--etiqueta antes]
 *
 * The typing indicator must stay anchored to the bottom of the page instead of
 * following the scroll. Discord parity: a fixed strip by the
 * composer, not part of the message list, with its height reserved, so the
 * conversation never moves when a name comes and goes.
 *
 * Ana types, Bruno measures. Chromium and WebKit, at 1440 and at 390, with
 * Bruno's conversation in the middle of the scroll and at the bottom. For each:
 *  - before (nobody typing), with Ana typing, and after the signal expires:
 *    `scrollTop`, the top of the last message, the top of a message in view and
 *    the scroller's height must not move (less than 0.5 px);
 *  - the strip is outside the scroller, inside the window, the same rectangle in
 *    all three moments and in both scroll positions, and above the text box
 *    (the phone keyboard covers what is under the focused field);
 *  - with reduced motion the dots still pulse, slower.
 * Captures before, with and after in `.verify-data/quem-escreve/<etiqueta>-<time>/`.
 *
 * ALL LOCAL AND DISPOSABLE: ports 8796 and 8797, never production.
 */
import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, espera, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const arg = (nome, omissao) => {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : omissao
}
const ETIQUETA = arg("--etiqueta", "depois")
const DIST = resolve(arg("--dist", join(RAIZ, "apps/web/dist")))
const CAPTURAS = join(RAIZ, ".verify-data/quem-escreve", `${ETIQUETA}-${new Date().toISOString().replace(/[:.]/g, "-")}`)
mkdirSync(CAPTURAS, { recursive: true })
const MOTORES = { chromium, webkit }
const escolhidos = process.argv.includes("--so-webkit") ? ["webkit"] : process.argv.includes("--so-chromium") ? ["chromium"] : ["chromium", "webkit"]
const LARGURAS = [
  { largura: 1440, altura: 900 },
  { largura: 390, altura: 844 },
]
/** The strip, new and old: the old one only exists while someone types. */
const FAIXA = ".chat-a-escrever, .timeline-typing"
const CAIXA = 'input[placeholder="Escreve uma mensagem"]'

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8796, servidor: 8797, sfu: 0, dist: DIST, etiqueta: "quem-escreve" })
const browsers = []

async function abrirSala(page, nome) {
  const sala = page.locator(".room-row button.room").filter({ has: page.locator(".room-name", { hasText: nome }) }).first()
  await sala.click({ timeout: 30_000 })
  await page.locator(CAIXA).waitFor({ timeout: 30_000 })
  await espera(400)
}

async function dizer(page, frase) {
  const caixa = page.locator(CAIXA)
  await caixa.click()
  await caixa.fill(frase)
  await page.keyboard.press("Enter")
}

/** Everything that must not move, read in Bruno's page. */
const medir = (page) =>
  page.evaluate((FAIXA) => {
    const tl = document.querySelector(".timeline")
    const caixa = document.querySelector('input[placeholder="Escreve uma mensagem"]')
    const faixa = document.querySelector(FAIXA)
    const t = tl.getBoundingClientRect()
    const mensagens = [...tl.querySelectorAll("article.message")]
    const ultima = mensagens.at(-1)?.getBoundingClientRect()
    const iVista = mensagens.findIndex((m) => {
      const r = m.getBoundingClientRect()
      return r.top >= t.top + 20 && r.bottom <= t.bottom - 20
    })
    const r = (x) => (x ? { x: x.x, y: x.y, w: x.width, h: x.height, bottom: x.bottom, top: x.top } : null)
    return {
      scrollTop: tl.scrollTop,
      scrollMax: tl.scrollHeight - tl.clientHeight,
      timeline: r(t),
      ultimaTop: ultima?.top ?? null,
      vista: iVista >= 0 ? { i: iVista, top: mensagens[iVista].getBoundingClientRect().top } : null,
      faixa: r(faixa?.getBoundingClientRect()),
      faixaTexto: faixa?.textContent ?? "",
      faixaNaConversa: Boolean(faixa?.closest(".timeline")),
      caixa: r(caixa.getBoundingClientRect()),
      janela: { w: innerWidth, h: innerHeight },
      pontos: (() => {
        const i = document.querySelector(".typing-dots i")
        if (!i) return null
        const s = getComputedStyle(i)
        return { duracao: s.animationDuration, vezes: s.animationIterationCount, nome: s.animationName }
      })(),
    }
  }, FAIXA)

const igual = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.5
const mesmoRect = (a, b) => Boolean(a && b) && ["x", "y", "w", "h"].every((k) => igual(a[k], b[k]))

async function correr(motor) {
  console.log(`\n=== ${motor}`)
  const browser = await MOTORES[motor].launch({ headless: true })
  browsers.push(browser)
  const CONTEXTO = { locale: "pt-PT", viewport: { width: 1440, height: 900 } }
  const ana = await (await browser.newContext(CONTEXTO)).newPage()
  await ana.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(ana, { nome: `Ana ${motor}`, servidor: srv.NOME, canalOficial: false })
  await dentro(ana)
  const bruno = await (await browser.newContext(CONTEXTO)).newPage()
  await bruno.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(bruno, { nome: `Bruno ${motor}`, servidor: srv.NOME, canalOficial: false })
  await dentro(bruno)

  const [enderecoAna, enderecoBruno] = contasDoServidor(srv.base).slice(-2)
  await pedirAmizade(bruno, enderecoAna)
  check(`[${motor}] a Ana aceita a amizade do Bruno`, (await aceitarAmizade(ana)) >= 0)
  const canal = `lagar-${motor}`
  await criarCanal(ana, canal)
  check(`[${motor}] a Ana convida o Bruno`, await convidar(ana, canal, enderecoBruno))
  check(`[${motor}] o Bruno entra no canal`, await aceitarConvite(bruno, canal, { espera: 60_000 }))
  await abrirCanal(ana, canal)
  await abrirCanal(bruno, canal)
  await abrirSala(ana, "conversa")
  await abrirSala(bruno, "conversa")

  // A conversation long enough to scroll at both widths.
  const texto = "uma linha comprida para encher a conversa e obrigar a rolar, ".repeat(4)
  for (let i = 0; i < 45; i++) await dizer(ana, `m${String(i).padStart(2, "0")} ${texto}`)
  check(`[${motor}] o Bruno recebe a conversa`, (await ate(async () => (await bruno.locator("article.message", { hasText: /m44 uma linha/ }).count()) > 0, 60_000)) >= 0)
  await espera(800)

  for (const { largura, altura } of LARGURAS) {
    await bruno.setViewportSize({ width: largura, height: altura })
    await espera(600)
    const faixaPorPosicao = {}
    for (const posicao of ["meio", "fundo"]) {
      const id = `${motor}-${largura}-${posicao}`
      await bruno.emulateMedia({ reducedMotion: posicao === "fundo" ? "reduce" : "no-preference" })
      // A message from Ana closes her typing burst (`stopTyping`), so the next key signals at once.
      const marca = `marca-${id}`
      await dizer(ana, marca)
      await bruno.getByText(marca).first().waitFor({ timeout: 30_000 })
      await espera(600)
      await bruno.locator(".timeline").evaluate((tl, posicao) => {
        const max = tl.scrollHeight - tl.clientHeight
        tl.scrollTop = posicao === "meio" ? Math.round(max / 2) : max
        tl.dispatchEvent(new Event("scroll"))
      }, posicao)
      await espera(700)
      const antes = await medir(bruno)
      await bruno.screenshot({ path: join(CAPTURAS, `${id}-1-antes.png`) })

      // Ana types: one key sends the signal.
      await ana.locator(CAIXA).click()
      await ana.locator(CAIXA).pressSequentially("estou a esc", { delay: 40 })
      const apareceu = await ate(async () => ((await bruno.locator(FAIXA).first().textContent().catch(() => "")) ?? "").trim().length > 0, 15_000, 50)
      await espera(250)
      const com = await medir(bruno)
      await bruno.screenshot({ path: join(CAPTURAS, `${id}-2-com.png`) })

      // Ana stops and clears the box: no stop signal, the deadline clears the strip.
      await ana.locator(CAIXA).fill("")
      const sumiu = await ate(async () => ((await bruno.locator(FAIXA).first().textContent().catch(() => "")) ?? "").trim().length === 0, 20_000, 50)
      await espera(250)
      const depois = await medir(bruno)
      await bruno.screenshot({ path: join(CAPTURAS, `${id}-3-depois.png`) })

      console.log(`   ${id}: antes ${JSON.stringify(antes)}`)
      console.log(`   ${id}: com   ${JSON.stringify(com)}`)
      console.log(`   ${id}: depois scrollTop ${depois.scrollTop}, última ${depois.ultimaTop}, faixa ${JSON.stringify(depois.faixa)}`)

      check(`[${id}] a conversa rola (há para onde rolar)`, antes.scrollMax > 200, `max ${antes.scrollMax}`)
      if (posicao === "meio") check(`[${id}] a conversa está a meio`, antes.scrollTop > 50 && antes.scrollTop < antes.scrollMax - 50, `${antes.scrollTop}/${antes.scrollMax}`)
      check(`[${id}] o indicador aparece`, apareceu >= 0 && com.faixaTexto.trim().length > 0, com.faixaTexto)
      check(`[${id}] e desaparece`, sumiu >= 0)
      check(`[${id}] o indicador não está dentro da conversa`, com.faixa !== null && !com.faixaNaConversa)
      check(
        `[${id}] o indicador está dentro da janela`,
        com.faixa !== null && com.faixa.top >= 0 && com.faixa.bottom <= com.janela.h + 0.5 && com.faixa.x >= 0 && com.faixa.x + com.faixa.w <= com.janela.w + 0.5,
        JSON.stringify(com.faixa),
      )
      check(`[${id}] o indicador fica por cima da caixa de escrita, sem a tapar`, com.faixa !== null && com.faixa.bottom <= com.caixa.top + 0.5, `faixa ${com.faixa?.bottom}, caixa ${com.caixa.top}`)
      check(`[${id}] a faixa tem a altura reservada antes de alguém escrever`, mesmoRect(antes.faixa, com.faixa), `${JSON.stringify(antes.faixa)} -> ${JSON.stringify(com.faixa)}`)
      check(`[${id}] e continua lá depois`, mesmoRect(com.faixa, depois.faixa), `${JSON.stringify(depois.faixa)}`)
      for (const [nome, chave] of [["scrollTop", "scrollTop"], ["topo da última mensagem", "ultimaTop"]]) {
        check(`[${id}] ao aparecer, ${nome} não mexe`, igual(antes[chave], com[chave]), `${antes[chave]} -> ${com[chave]}`)
        check(`[${id}] ao desaparecer, ${nome} não mexe`, igual(com[chave], depois[chave]), `${com[chave]} -> ${depois[chave]}`)
      }
      check(`[${id}] a mensagem à vista não mexe`, antes.vista && igual(antes.vista.top, com.vista?.top) && igual(antes.vista.top, depois.vista?.top), `${antes.vista?.top} -> ${com.vista?.top} -> ${depois.vista?.top}`)
      check(`[${id}] a conversa não muda de altura`, mesmoRect(antes.timeline, com.timeline) && mesmoRect(com.timeline, depois.timeline))
      if (posicao === "fundo") {
        check(`[${id}] com movimento reduzido os pontos continuam a pulsar, mais devagar`, com.pontos?.duracao === "2.4s" && com.pontos?.vezes === "infinite", JSON.stringify(com.pontos))
      } else {
        check(`[${id}] sem movimento reduzido os pontos pulsam`, com.pontos?.duracao === "1.2s" && com.pontos?.vezes === "infinite", JSON.stringify(com.pontos))
      }
      faixaPorPosicao[posicao] = com.faixa
    }
    check(`[${motor}-${largura}] o indicador fica no mesmo sítio a meio e no fundo da conversa`, mesmoRect(faixaPorPosicao.meio, faixaPorPosicao.fundo), `${JSON.stringify(faixaPorPosicao.meio)} vs ${JSON.stringify(faixaPorPosicao.fundo)}`)
  }
  await browser.close()
}

let ok = false
try {
  for (const motor of escolhidos) await correr(motor)
  ok = resumo()
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  resumo()
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  srv.fechar()
}
console.log(`\nCapturas: ${CAPTURAS}`)
process.exit(ok ? 0 : 1)
