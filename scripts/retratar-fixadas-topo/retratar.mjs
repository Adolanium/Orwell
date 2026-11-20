/**
 * Captures of the pinned bar (fixadas-topo, 20/11/2026): three themes, 1280 and 390 px,
 * one pin and three, before and after the jump, and the hidden bar.
 *
 *   node scripts/retratar-fixadas-topo/retratar.mjs <pasta-de-saida>
 *
 * Starts the harness (`vite.config.mjs`, 127.0.0.1:5191) and Chromium headless. It also
 * measures what the eye cannot: the bar ends where the conversation starts (no overlap),
 * and the page has no sideways scroll.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import { chromium } from "playwright"

const AQUI = fileURLToPath(new URL(".", import.meta.url))
const SAIDA = resolve(process.argv[2] ?? join(AQUI, "capturas"))
mkdirSync(SAIDA, { recursive: true })

const vite = await createServer({ configFile: join(AQUI, "vite.config.mjs") })
await vite.listen()
const BASE = "http://127.0.0.1:5191/"
const browser = await chromium.launch({ headless: true })
const medidas = []
try {
  for (const tema of ["escuro", "claro", "aurora"]) {
    for (const [largura, altura] of [[1280, 800], [390, 844]]) {
      for (const fixadas of [1, 3]) {
        const ctx = await browser.newContext({ viewport: { width: largura, height: altura }, locale: "pt-PT", ...(largura < 500 ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) })
        const page = await ctx.newPage()
        const erros = []
        page.on("pageerror", (e) => erros.push(String(e)))
        await page.goto(`${BASE}?tema=${tema}&fixadas=${fixadas}`)
        await page.getByRole("button", { name: /Comunidades|Communities/ }).first().click()
        const barra = page.locator(".barra-fixadas")
        await barra.waitFor({ timeout: 15_000 })
        // The opening splash fades over the app: wait until it has left.
        await page.waitForFunction(() => !document.querySelector(".abertura"), null, { timeout: 15_000 }).catch(() => {})
        await page.waitForTimeout(800)
        const nome = `${tema}-${largura}-${fixadas}`
        const medir = () =>
          page.evaluate(() => {
            const b = document.querySelector(".barra-fixadas")?.getBoundingClientRect()
            const t = document.querySelector(".conversa > .timeline")?.getBoundingClientRect()
            const topo = document.querySelector(".topbar")?.getBoundingClientRect()
            return {
              barra: b ? { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height), width: Math.round(b.width) } : null,
              conversaTop: t ? Math.round(t.top) : null,
              topbarBottom: topo ? Math.round(topo.bottom) : null,
              semSobreposicao: !!b && !!t && t.top >= b.bottom - 0.5,
              // No line of the conversation behind any point of the bar.
              linhasPorTras: (() => {
                if (!b) return null
                let n = 0
                for (let x = b.left + 2; x < b.right; x += 12)
                  for (let y = b.top + 1; y < b.bottom; y += 4) if (document.elementsFromPoint(x, y).some((el) => el.closest(".timeline"))) n += 1
                return n
              })(),
              fundoOpaco: b ? !/rgba\([^)]*,\s*0?\.\d+\)|\/\s*0?\.\d+\)/.test(getComputedStyle(document.querySelector(".barra-fixadas")).backgroundColor) : null,
              debaixoDoTopo: !!b && !!topo && b.top >= topo.bottom - 0.5,
              scrollLateral: document.documentElement.scrollWidth > document.documentElement.clientWidth,
              destacada: !!document.querySelector('.message.destacada[data-mensagem="m10"]'),
            }
          })
        await page.screenshot({ path: join(SAIDA, `${nome}-barra.png`) })
        const antes = await medir()
        // The jump: to the 10th of 500, outside the memory window.
        if (fixadas === 1) {
          await barra.locator(".barra-fixadas-abrir").click()
          await page.waitForSelector('.message.destacada[data-mensagem="m10"]', { timeout: 10_000 }).catch(() => {})
          // The scroll to it is smooth: let it arrive before the capture.
          await page.waitForTimeout(1500)
          await page.screenshot({ path: join(SAIDA, `${nome}-depois-do-salto.png`) })
        } else {
          await barra.getByRole("button", { name: /seguinte|Next/ }).click()
          await page.waitForTimeout(150)
          await page.screenshot({ path: join(SAIDA, `${nome}-seguinte.png`) })
        }
        const depois = await medir()
        // The reading place when the bar goes and comes back: at the bottom stays at the bottom,
        // higher up keeps the same first line.
        const lugar = () =>
          page.evaluate(() => {
            const t = document.querySelector(".conversa > .timeline")
            const topo = t.getBoundingClientRect().top
            const primeira = [...t.querySelectorAll(".message")].find((m) => m.getBoundingClientRect().bottom > topo + 1)
            return { aoFundo: Math.round(t.scrollHeight - t.scrollTop - t.clientHeight), primeira: primeira?.dataset.mensagem ?? null }
          })
        const paraOFundo = () => page.evaluate(() => { const t = document.querySelector(".conversa > .timeline"); t.scrollTop = t.scrollHeight })
        const aMeio = () => page.evaluate(() => { const t = document.querySelector(".conversa > .timeline"); t.scrollTop = Math.round(t.scrollHeight / 2); t.dispatchEvent(new Event("scroll")) })
        const mostrar = async () => {
          await page.locator(".pinned-anchor button").first().click()
          await page.getByRole("button", { name: /Mostrar no topo|Show at the top/ }).click()
          await page.waitForTimeout(300)
        }
        const esconder = async () => {
          await page.locator(".barra-fixadas .barra-fixadas-botao").last().click()
          await page.waitForTimeout(300)
        }
        await paraOFundo()
        await page.waitForTimeout(300)
        await esconder()
        await page.screenshot({ path: join(SAIDA, `${nome}-escondida.png`) })
        const escondida = await page.locator(".barra-fixadas").count()
        const fundoAoEsconder = await lugar()
        await mostrar()
        const fundoAoMostrar = await lugar()
        await aMeio()
        await page.waitForTimeout(300)
        const meioAntes = await lugar()
        await esconder()
        const meioEscondida = await lugar()
        await mostrar()
        const meioMostrada = await lugar()
        const leitura = {
          fundoAoEsconder: fundoAoEsconder.aoFundo <= 1,
          fundoAoMostrar: fundoAoMostrar.aoFundo <= 1,
          mesmaLinha: meioAntes.primeira !== null && meioAntes.primeira === meioEscondida.primeira && meioAntes.primeira === meioMostrada.primeira,
        }
        medidas.push({ nome, antes, depois, escondida: escondida === 0, leitura, erros })
        console.log(nome, JSON.stringify({ antes, saltou: depois.destacada, escondida: escondida === 0, leitura, erros: erros.length }))
        await ctx.close()
      }
    }
  }
} finally {
  writeFileSync(join(SAIDA, "medidas.json"), JSON.stringify(medidas, null, 2))
  await browser.close()
  await vite.close()
}
