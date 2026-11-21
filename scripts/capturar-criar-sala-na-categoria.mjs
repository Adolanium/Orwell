/**
 * The `+` of a category (1.3.25), in the Dark, Light and Aurora themes, at 1280 px
 * and at 390 px. Right of the name since 1.3.26: `capturar-mais-a-direita.mjs`
 * measures the edge.
 *
 * One account, the founder of the common channel's copy it creates: it organizes
 * rooms, so the `+` is there. What is checked: the `+` sits right of the name, it
 * opens "New room" with that category chosen, "Create room" in the category menu
 * does the same, and nothing overflows sideways. Captures for the eye.
 *
 *   sh scripts/dev-reiniciar-servidor.sh
 *   npm run dev:web
 *   node scripts/capturar-criar-sala-na-categoria.mjs
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const APP = comLingua(process.env.ORWELL_APP ?? "http://127.0.0.1:5173")
const SERVIDOR = process.env.ORWELL_SERVER ?? "localhost:8452"
const MARCA = Date.now().toString(36)
const CATEGORIA = "Cozinha"
const CAPTURAS = join(".verify-data", "prova-criar-sala-na-categoria", MARCA)
mkdirSync(CAPTURAS, { recursive: true })

const falhas = []
function verificar(descricao, condicao, extra = "") {
  console.log(`  ${condicao ? "ok  " : "FALHA"}  ${descricao}${extra ? `  ${extra}` : ""}`)
  if (!condicao) falhas.push(descricao)
}

const ctx = await chromium.launchPersistentContext(join(CAPTURAS, "perfil"), {
  headless: true,
  viewport: { width: 1280, height: 900 },
  reducedMotion: "reduce",
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const erros = []
page.on("pageerror", (e) => erros.push(String(e.message).slice(0, 200)))

await page.goto(APP, { waitUntil: "domcontentloaded" })
await criarContaEEntrar(page, { nome: "Ana", frase: `criar-sala-${MARCA}`, servidor: SERVIDOR, timeout: 30_000 })

// A channel of our own, so this account organizes its rooms.
await page.getByRole("button", { name: "Criar canal" }).first().click()
await page.getByRole("dialog").getByLabel("Nome").fill(`Lagar ${MARCA}`)
await page.getByRole("dialog").getByRole("button", { name: "Criar" }).click()
await page.waitForTimeout(3000)
await page.locator("button.channel", { hasText: `Lagar ${MARCA}` }).first().click({ button: "right" })
await page.getByRole("menuitem", { name: "Nova categoria" }).first().click()
await page.getByRole("dialog").getByLabel("Nome").fill(CATEGORIA)
await page.getByRole("dialog").getByRole("button", { name: "Criar" }).click()
await page.waitForTimeout(2500)

// The aria-label carries the category name ("Criar sala em …"): found by its class in the header.
const mais = () => page.locator(".room-category", { hasText: CATEGORIA }).locator(".category-criar").first()

async function tema(nome) {
  await page.evaluate((t) => {
    const actual = JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}") ?? {}
    localStorage.setItem("enclave.prefs", JSON.stringify({ ...actual, tema: t }))
  }, nome)
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3000)
  await page.locator("button.channel", { hasText: `Lagar ${MARCA}` }).first().click()
  await page.waitForTimeout(1500)
}

for (const nome of ["escuro", "claro", "aurora"]) {
  for (const largura of [1280, 390]) {
    await page.setViewportSize({ width: largura, height: largura === 390 ? 844 : 900 })
    await tema(nome)
    // At 390 the sidebar is a drawer.
    if (largura === 390 && !(await mais().isVisible().catch(() => false))) {
      await page.getByRole("button", { name: /Abrir a barra|Canais|Menu/ }).first().click().catch(() => {})
      await page.waitForTimeout(800)
    }
    const nota = `${nome} ${largura}px`
    const medida = await page.evaluate((categoria) => {
      const cabecalho = [...document.querySelectorAll(".room-category")].find((h) => h.textContent?.includes(categoria))
      const botao = cabecalho?.querySelector(".category-criar")?.getBoundingClientRect()
      const nomeDela = cabecalho?.querySelector(".category-name")?.getBoundingClientRect()
      const raiz = document.documentElement
      return {
        botao: botao ? { x: Math.round(botao.x), w: Math.round(botao.width), h: Math.round(botao.height) } : null,
        nomeX: nomeDela ? Math.round(nomeDela.x) : null,
        transborda: raiz.scrollWidth - raiz.clientWidth,
        cor: cabecalho?.querySelector(".category-criar") ? getComputedStyle(cabecalho.querySelector(".category-criar")).color : null,
      }
    }, CATEGORIA)
    console.log(`\n  ${nota}: ${JSON.stringify(medida)}`)
    verificar(`${nota}: o + existe`, medida.botao !== null)
    verificar(`${nota}: o + fica à direita do nome`, medida.botao !== null && medida.nomeX !== null && medida.botao.x > medida.nomeX)
    verificar(`${nota}: a página não rola de lado`, medida.transborda <= 0)
    const cabecalho = page.locator(".room-category", { hasText: CATEGORIA }).first()
    await cabecalho.screenshot({ path: join(CAPTURAS, `${nome}-${largura}-cabecalho.png`) }).catch(() => {})
    await page.screenshot({ path: join(CAPTURAS, `${nome}-${largura}.png`) })
  }
}

// The gestures, once.
await page.setViewportSize({ width: 1280, height: 900 })
await tema("escuro")
await mais().click()
const campo = page.getByRole("dialog").getByLabel("Categoria")
verificar("o + abre «Nova sala» já na categoria", (await campo.inputValue().catch(() => "")) === CATEGORIA)
await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click()
await page.locator(".category-name", { hasText: CATEGORIA }).first().click({ button: "right" })
await page.getByRole("menuitem", { name: "Criar sala" }).first().click()
verificar("«Criar sala» no menu faz o mesmo", (await campo.inputValue().catch(() => "")) === CATEGORIA)

if (erros.length > 0) {
  console.log("\n  erros de página:")
  for (const erro of erros) console.log(`    ${erro}`)
  falhas.push("erros de página")
}
console.log(`\ncapturas: ${CAPTURAS}`)
console.log(`${falhas.length === 0 ? "TUDO OK" : `FALHAS (${falhas.length}):`}`)
for (const falha of falhas) console.log(`  - ${falha}`)
await ctx.close()
process.exit(falhas.length === 0 ? 0 : 1)
