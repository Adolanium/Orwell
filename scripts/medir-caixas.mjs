/**
 * Is the checkbox mark centered? Measured in pixels, at 100 %, 125 % and 150 %,
 * on the web and on desktop.
 *
 *   npm run build && node scripts/medir-caixas.mjs
 *   node scripts/medir-caixas.mjs --rotulo before      (the name of the screenshots)
 *   node scripts/medir-caixas.mjs --sem-secretaria    (Chromium only)
 *
 * Born on November 4, 2026: the owner (Windows, fractional scale, reduced
 * motion) saw the "Remember session" mark off-center when signing in, after
 * 33c6f526 removed the padding from the boxes. Measured with `caixas-medidas.mjs`:
 *
 *  1. **The grid.** The built app stylesheet, on a page with only 64 checked
 *     boxes at fractional positions (0, 1/8, ..., 7/8 of a pixel on both
 *     axes). This is what catches the rounding: a single box can happen to
 *     land on a good position.
 *  2. **The web.** The gate in Chromium: "Remember session" when creating the
 *     account, "Join the Orwell channel" in the last step, "Remember session"
 *     when signing in (the report screen), the checked boxes of Settings ›
 *     Notifications, and "Include the images" in Settings › Devices (Task 11b).
 *  3. **The desktop.** The same gate in the real Electron app
 *     (`secretaria.mjs`), with `force-device-scale-factor`: when creating the
 *     account and when signing in.
 *
 * Passes when the center of the mark is within half a pixel of the center of
 * the box on both axes. Half a pixel is the floor: at 125 % a 17 px CSS box is
 * 21.25 px, the mark 13.75, and one of them rounds to the odd side.
 *
 * Records in `capturas/` the "Remember session" box when signing in, zoomed
 * 12×, at each scale: `checkbox-centro-<rotulo>-<web|secretaria>-<100|125|150>.png`.
 *
 * All local and disposable (`servidor-descartavel.mjs`), ports 8546 and 8547.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { fecharMedidas, medirCaixa, recorteAmpliado } from "./caixas-medidas.mjs"
import { criarConta, passarOFicheiroDaConta } from "./conta.mjs"
import { verificador } from "./fase7-comum.mjs"
import { abrirSecretaria } from "./secretaria.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const argumentos = process.argv.slice(2)
const ROTULO = argumentos.includes("--rotulo") ? argumentos[argumentos.indexOf("--rotulo") + 1] : "depois"
const COM_SECRETARIA = !argumentos.includes("--sem-secretaria")
const ESCALAS = [1, 1.25, 1.5]
const TOLERANCIA = 0.5
const FRASE = "frase-de-verificacao-2026"
const CAPTURAS = join(RAIZ, "capturas")
const SEGUINTE = /^(Continuar|Seguinte)$/

const { check, resumo } = verificador()
const pior = { dx: 0, dy: 0 }

function provar(nome, medida) {
  pior.dx = Math.max(pior.dx, Math.abs(medida.dx))
  pior.dy = Math.max(pior.dy, Math.abs(medida.dy))
  check(
    nome,
    Math.abs(medida.dx) <= TOLERANCIA && Math.abs(medida.dy) <= TOLERANCIA,
    `dx ${medida.dx}, dy ${medida.dy} px do ecrã; caixa ${medida.caixa.w}×${medida.caixa.h}, visto ${medida.visto.w}×${medida.visto.h}, y CSS ${medida.posicaoCss.y}`,
  )
}

const percentagem = (escala) => Math.round(escala * 100)
const campoDaFrase = (page) => page.locator('.gate-card input[type="password"]')
const configuracoes = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first()

/** From the gate to "Criar conta" (21/11/2026: one form, no box to remember the session). */
async function irAtePalavraPasse(page, servidor) {
  const entrada = page.getByRole("heading", { name: "Bem-vindo ao Orwell" })
  await entrada.waitFor({ timeout: 60_000 })
  await page.getByRole("button", { name: "Criar conta", exact: true }).click()
  if (servidor) {
    await page.getByRole("button", { name: "Opções avançadas" }).click()
    await page.getByLabel("Servidor").fill(servidor)
  }
  await campoDaFrase(page).first().waitFor({ timeout: 10_000 })
}

/** The box of the gate when creating the account: "Entrar no canal oficial", ticked to measure the mark. */
async function medirSetup(page, onde, servidor) {
  await irAtePalavraPasse(page, servidor)
  await page.locator('.gate input[autocomplete="nickname"]').fill("Caixas")
  await campoDaFrase(page).nth(0).fill(FRASE)
  await campoDaFrase(page).nth(1).fill(FRASE)
  const canal = page.locator('input[name="canal-oficial"]')
  await canal.setChecked(true)
  provar(`${onde}: «Entrar no canal oficial do Orwell.» ao criar a conta`, await medirCaixa(page, canal))
}

/** Store the session on entry: the telemetry session and its snapshot. */
async function medirUnlock(page, onde, ficheiro) {
  await campoDaFrase(page).waitFor({ timeout: 60_000 })
  const caixa = page.locator('input[name="memorizar"]')
  await caixa.waitFor({ timeout: 10_000 })
  provar(`${onde}: «Manter sessão iniciada» ao entrar`, await medirCaixa(page, caixa))
  writeFileSync(join(CAPTURAS, ficheiro), await recorteAmpliado(page, caixa, 12, 4))
}

// --- 1. a grelha ---------------------------------------------------------------
const DIST_ASSETS = join(RAIZ, "apps/web/dist/assets")
const folhaDaApp = readdirSync(DIST_ASSETS)
  .filter((nome) => nome.endsWith(".css"))
  .map((nome) => readFileSync(join(DIST_ASSETS, nome), "utf8"))
  .join("\n")
const FRACCOES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]

const browser = await chromium.launch({ headless: true })
for (const escala of ESCALAS) {
  const ctx = await browser.newContext({ deviceScaleFactor: escala, viewport: { width: 420, height: 420 }, reducedMotion: "reduce" })
  const page = await ctx.newPage()
  const caixas = FRACCOES.flatMap((fy, i) =>
    FRACCOES.map((fx, j) => `<input type="checkbox" checked data-k="${i}-${j}" style="position:absolute;left:${30 + j * 40 + fx}px;top:${30 + i * 40 + fy}px">`),
  ).join("")
  await page.setContent(`<!doctype html><html><head><style>${folhaDaApp}</style></head><body><div class="gate-card" style="position:fixed;inset:0">${caixas}</div></body></html>`)
  const medidas = []
  for (let i = 0; i < FRACCOES.length; i++) for (let j = 0; j < FRACCOES.length; j++) medidas.push(await medirCaixa(page, page.locator(`input[data-k="${i}-${j}"]`)))
  const piorDx = Math.max(...medidas.map((m) => Math.abs(m.dx)))
  const piorDy = Math.max(...medidas.map((m) => Math.abs(m.dy)))
  const mediaDy = medidas.reduce((soma, m) => soma + m.dy, 0) / medidas.length
  pior.dx = Math.max(pior.dx, piorDx)
  pior.dy = Math.max(pior.dy, piorDy)
  check(
    `grelha a ${percentagem(escala)} %: 64 posições fraccionárias, o visto a ${TOLERANCIA} px do centro ou menos`,
    piorDx <= TOLERANCIA && piorDy <= TOLERANCIA,
    `pior dx ${piorDx}, pior dy ${piorDy}, dy médio ${mediaDy.toFixed(2)} px do ecrã`,
  )
  await ctx.close()
}

// --- 2. web and 3. desktop, against a throwaway homeserver --------------
const srv = await levantarServidor({ frente: 8546, servidor: 8547, etiqueta: "medir-caixas" })
let codigo = 1
try {
  for (const escala of ESCALAS) {
    const onde = `web ${percentagem(escala)} %`
    const ctx = await browser.newContext({ deviceScaleFactor: escala, viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" })
    const page = await ctx.newPage()
    await page.goto(srv.APP)
    check(`${onde}: devicePixelRatio ${escala}`, (await page.evaluate(() => devicePixelRatio)) === escala)
    await medirSetup(page, onde)

    // The real account, and logging back in without the separator key: the gate
    // asks for the password, with the box below it.
    await page.reload()
    await criarConta(page, { nome: "Ana", frase: FRASE, servidor: srv.NOME, memorizar: false })
    await configuracoes(page)
      .waitFor({ timeout: 90_000 })
      .catch(async (erro) => {
        console.error((await page.locator("body").innerText()).slice(0, 800))
        throw erro
      })

    // Settings › Notifications: the sound boxes are born checked.
    await configuracoes(page).click()
    await page.getByRole("button", { name: "Notificações", exact: true }).first().click()
    const marcadas = page.locator('input[type="checkbox"]:checked:visible')
    await marcadas.first().waitFor({ timeout: 15_000 })
    const quantas = await marcadas.count()
    for (let i = 0; i < quantas; i++) {
      const rotulo = (await marcadas.nth(i).evaluate((el) => el.closest("label")?.textContent?.trim() ?? "")).slice(0, 40)
      provar(`${onde}: Notificações, «${rotulo}»`, await medirCaixa(page, marcadas.nth(i)))
    }

    // Settings › Devices: "Include the images" (Task 11b). It starts
    // unchecked; it is checked by hand to measure the mark. Checking exports nothing.
    await page.getByRole("button", { name: "Conta e segurança", exact: true }).first().click()
    await page.getByRole("button", { name: "Guardar o ficheiro da conta" }).click()
    const imagens = page.locator('input[name="incluir-imagens"]')
    await imagens.waitFor({ timeout: 15_000 })
    await imagens.setChecked(true)
    provar(`${onde}: Aparelhos, «Incluir as imagens»`, await medirCaixa(page, imagens))

    await page.evaluate(() => sessionStorage.clear())
    await page.reload()
    await medirUnlock(page, onde, `checkbox-centro-${ROTULO}-web-${percentagem(escala)}.png`)
    await ctx.close()
  }

  if (COM_SECRETARIA) {
    for (const escala of ESCALAS) {
      const onde = `secretaria ${percentagem(escala)} %`
      let sec = await abrirSecretaria({ rotulo: onde, escala })
      try {
        check(`${onde}: devicePixelRatio ${escala}`, (await sec.page.evaluate(() => devicePixelRatio)) === escala)
        await medirSetup(sec.page, onde, srv.NOME)
        await sec.page.locator(".gate form").getByRole("button", { name: "Criar conta", exact: true }).click()
        await passarOFicheiroDaConta(sec.page, { guardar: false })
      } catch (erro) {
        console.error(sec.registo.slice(-30).join("\n"))
        throw erro
      }
      await configuracoes(sec.page).waitFor({ timeout: 90_000 })
      // Close and reopen the app: without the stored session, it asks for the password.
      const dados = sec.dados
      await sec.fechar({ guardarDados: true })
      sec = await abrirSecretaria({ rotulo: onde, dados, escala })
      try {
        await medirUnlock(sec.page, onde, `checkbox-centro-${ROTULO}-secretaria-${percentagem(escala)}.png`)
      } finally {
        await sec.fechar()
      }
    }
  }
  console.log(`\npior dx ${pior.dx}, pior dy ${pior.dy} px do ecrã (tolerância ${TOLERANCIA})`)
  codigo = resumo() ? 0 : 1
} finally {
  await browser.close()
  await fecharMedidas()
  srv.fechar()
}
process.exit(codigo)
