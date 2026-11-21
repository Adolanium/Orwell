/**
 * The two `+` of the channel list, at the right end of their line: "Create
 * channel" in the column header and "Create room" in each category header.
 * Dark, Light and Aurora; 1280 px and 390 px (touch); device scale 1, 1.25, 1.5.
 *
 * Measured, not eyeballed. The right edge of each drawn `+` (the svg, not the hit
 * box) must land on the list's right content edge: the end of a room row minus
 * its padding, which is where the unread counts end. Both `+` then share one
 * right edge. At 390 px, under a coarse pointer, both hit boxes are 44 px or more.
 *
 *   sh scripts/dev-reiniciar-servidor.sh
 *   npm run dev:web
 *   node scripts/capturar-mais-a-direita.mjs [--rotulo antes] [--saida dir]
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const argumento = (nome, omissao) => {
  const i = process.argv.indexOf(nome)
  return i > 0 ? process.argv[i + 1] : omissao
}
const APP = comLingua(process.env.ORWELL_APP ?? "http://127.0.0.1:5173")
const SERVIDOR = process.env.ORWELL_SERVER ?? "localhost:8452"
const ROTULO = argumento("--rotulo", "depois")
const MARCA = Date.now().toString(36)
const CATEGORIA = "Cozinha"
const CAPTURAS = argumento("--saida", join(".verify-data", "prova-mais-a-direita", MARCA))
mkdirSync(CAPTURAS, { recursive: true })

/** Half a pixel: at 125 % one CSS pixel is 1.25 device pixels and an edge rounds. */
const TOLERANCIA = 0.5

const falhas = []
function verificar(descricao, condicao, extra = "") {
  console.log(`  ${condicao ? "ok  " : "FALHA"}  ${descricao}${extra ? `  ${extra}` : ""}`)
  if (!condicao) falhas.push(descricao)
}

const browser = await chromium.launch({ headless: true })
const confirmar = /^(Criar|Confirmar)$/

/** The channel's room tree in sight. On a phone the list is its own screen and
 *  opening a channel covers it: "Voltar" brings it back. */
async function abrirLista(page, canal) {
  const visivel = (l) => l.first().isVisible().catch(() => false)
  const voltar = page.locator(".topbar-voltar")
  if (await visivel(voltar)) {
    await voltar.first().click()
    await page.waitForTimeout(1200)
  }
  // The tree already open is enough: a click on the channel would open its chat.
  if (await visivel(page.locator(".room-tree"))) return
  // After a reload the rail may come back on another community.
  const linha = page.locator("button.channel", { hasText: canal })
  if (!(await visivel(linha))) {
    await page.locator(".rail-btn", { hasText: "" }).and(page.getByRole("button", { name: canal, exact: true })).first().click().catch(() => {})
    await page.waitForTimeout(1500)
    if (await visivel(page.locator(".room-tree"))) return
  }
  await linha.first().click()
  await page.waitForTimeout(1500)
  if (await visivel(voltar)) {
    await voltar.first().click()
    await page.waitForTimeout(1200)
  }
}

const medir = (page) =>
  page.evaluate((categoria) => {
    const r2 = (n) => Math.round(n * 100) / 100
    const caixa = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { esq: r2(r.left), dir: r2(r.right), larg: r2(r.width), alt: r2(r.height) }
    }
    const maisCanal = document.querySelector(".sidebar-header .header-add")
    const cat = [...document.querySelectorAll(".room-category")].find((h) => h.textContent?.includes(categoria))
    const maisSala = cat?.querySelector(".category-criar")
    const sala = document.querySelector(".room-tree .room-row .room")
    const raiz = document.documentElement
    return {
      maisCanal: caixa(maisCanal),
      maisCanalIcone: caixa(maisCanal?.querySelector("svg")),
      maisSala: caixa(maisSala),
      maisSalaIcone: caixa(maisSala?.querySelector("svg")),
      nomeCategoria: caixa(cat?.querySelector(".category-name")),
      /** Where a room row's content ends: the unread count sits there. */
      bordaDaLista: sala ? r2(sala.getBoundingClientRect().right - parseFloat(getComputedStyle(sala).paddingRight)) : null,
      transborda: raiz.scrollWidth - raiz.clientWidth,
      coarse: matchMedia("(pointer: coarse)").matches,
    }
  }, CATEGORIA)

for (const escala of [1, 1.25, 1.5]) {
  for (const largura of [1280, 390]) {
    const movel = largura === 390
    const ctx = await browser.newContext({
      viewport: { width: largura, height: movel ? 844 : 900 },
      deviceScaleFactor: escala,
      hasTouch: movel,
      isMobile: movel,
      reducedMotion: "reduce",
    })
    const page = await ctx.newPage()
    const erros = []
    page.on("pageerror", (e) => erros.push(String(e.message).slice(0, 200)))
    const canal = `Lagar ${MARCA}${escala * 100}${largura}`
    await page.goto(APP, { waitUntil: "domcontentloaded" })
    await criarContaEEntrar(page, { nome: "Ana", frase: `mais-${MARCA}-${escala}-${largura}`, servidor: SERVIDOR, timeout: 30_000 })
    await page.getByRole("button", { name: "Criar canal" }).first().click()
    await page.getByRole("dialog").getByLabel("Nome").fill(canal)
    await page.getByRole("dialog").getByRole("button", { name: confirmar }).click()
    await page.waitForTimeout(3000)
    await abrirLista(page, canal)
    await page.locator("button.channel", { hasText: canal }).first().click({ button: "right" })
    await page.getByRole("menuitem", { name: "Nova categoria" }).first().click()
    await page.getByRole("dialog").getByLabel("Nome").fill(CATEGORIA)
    await page.getByRole("dialog").getByRole("button", { name: confirmar }).click()
    await page.waitForTimeout(2500)

    for (const tema of ["escuro", "claro", "aurora"]) {
      await page.evaluate((t) => {
        const actual = JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}") ?? {}
        localStorage.setItem("enclave.prefs", JSON.stringify({ ...actual, tema: t }))
      }, tema)
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForTimeout(3000)
      await abrirLista(page, canal)
      const m = await medir(page)
      const nota = `${tema} ${largura}px ${escala}×`
      console.log(`\n  ${nota}: ${JSON.stringify(m)}`)
      verificar(`${nota}: os dois + existem`, m.maisCanalIcone !== null && m.maisSalaIcone !== null)
      if (m.maisSala && m.nomeCategoria) {
        verificar(`${nota}: o + da categoria fica à direita do nome`, m.maisSala.esq >= m.nomeCategoria.dir)
      }
      if (m.maisCanalIcone && m.maisSalaIcone && m.bordaDaLista !== null) {
        verificar(
          `${nota}: o + do canal acaba na borda da lista`,
          Math.abs(m.maisCanalIcone.dir - m.bordaDaLista) <= TOLERANCIA,
          `(${m.maisCanalIcone.dir} vs ${m.bordaDaLista})`,
        )
        verificar(
          `${nota}: o + da categoria acaba na borda da lista`,
          Math.abs(m.maisSalaIcone.dir - m.bordaDaLista) <= TOLERANCIA,
          `(${m.maisSalaIcone.dir} vs ${m.bordaDaLista})`,
        )
      }
      if (movel) {
        const alvo = (c) => c !== null && c.larg >= 44 && c.alt >= 44
        verificar(`${nota}: alvo de toque do + do canal ≥ 44 px`, alvo(m.maisCanal), JSON.stringify(m.maisCanal))
        verificar(`${nota}: alvo de toque do + da categoria ≥ 44 px`, alvo(m.maisSala), JSON.stringify(m.maisSala))
      }
      verificar(`${nota}: a página não rola de lado`, m.transborda <= 0)
      const nome = `${ROTULO}-${tema}-${largura}-${escala * 100}`
      await page.locator(".sidebar").first().screenshot({ path: join(CAPTURAS, `${nome}-lista.png`) }).catch(() => {})
      if (escala === 1) await page.screenshot({ path: join(CAPTURAS, `${nome}.png`) })
    }
    if (erros.length > 0) {
      console.log(`\n  erros de página (${largura}px ${escala}×):`)
      for (const erro of erros) console.log(`    ${erro}`)
      falhas.push(`erros de página ${largura}px ${escala}×`)
    }
    await ctx.close()
  }
}

await browser.close()
console.log(`\ncapturas: ${CAPTURAS}`)
console.log(`${falhas.length === 0 ? "TUDO OK" : `FALHAS (${falhas.length}):`}`)
for (const falha of falhas) console.log(`  - ${falha}`)
process.exit(falhas.length === 0 ? 0 : 1)
