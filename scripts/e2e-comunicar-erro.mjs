/**
 * "Report a bug" end to end (12/11/2026): 2 tabs and 3 browsers, on a disposable server.
 *
 *   npm run build && node scripts/e2e-comunicar-erro.mjs
 *
 *  - Ana in Chromium, from a second tab that takes ownership: details on, no contact;
 *  - Bruno in Firefox: details on, "Podem contactar-me" checked;
 *  - Carla in WebKit: details off.
 *
 * Checked on the server folder `bugs/`: three files, the address only in Bruno's,
 * no details in Carla's, and `fila.json` with numbers and dates only.
 * Screenshots in `.verify-data/prova-comunicar-erro/<hora>/`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { ate, contasDoServidor, dentro, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CAPTURAS = join(RAIZ, ".verify-data/prova-comunicar-erro", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8540, servidor: 8541, etiqueta: "bugs" })
const PASTA = join(srv.dados, "bugs")
const browsers = []
const paginas = []

async function abrir(motor, nome) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  paginas.push({ nome, page })
  return { nome, ctx, page }
}

const foto = async (page, nome) => {
  await page.bringToFront().catch(() => {})
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`) }).catch(() => {})
}

const bugsGuardados = () =>
  existsSync(PASTA)
    ? readdirSync(PASTA)
        .filter((nome) => /^\d+\.json$/.test(nome))
        .map((nome) => JSON.parse(readFileSync(join(PASTA, nome), "utf8")))
    : []

/** Open the form from Settings > Help and diagnostics, fill it and send. Returns the list text. */
async function comunicar(page, rotulo, { descricao, detalhes = true, contacto = false }) {
  await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await page.getByRole("button", { name: "Ajuda e diagnóstico" }).first().click()
  const botao = page.getByRole("button", { name: "Comunicar um erro", exact: true })
  await botao.waitFor({ timeout: 20_000 })
  await botao.click()
  const folha = page.locator(".comunicar-erro").first()
  await folha.waitFor({ timeout: 10_000 })
  await folha.locator("textarea").fill(descricao)
  const caixa = folha.getByRole("checkbox", { name: "Juntar detalhes técnicos" })
  const marcadaPorOmissao = await caixa.isChecked()
  await folha.getByText("Vai isto, e só isto:").waitFor({ timeout: 10_000 })
  const lista = (await folha.innerText()).replace(/\s+/g, " ")
  if (!detalhes) await caixa.uncheck()
  if (contacto) await folha.getByRole("checkbox", { name: "Podem contactar-me" }).check()
  await foto(page, `${rotulo}-1-formulario`)
  await folha.getByRole("button", { name: "Enviar", exact: true }).click()
  const enviado = await folha.getByText("Recebemos o relato.").waitFor({ timeout: 20_000 }).then(() => true, () => false)
  await foto(page, `${rotulo}-2-enviado`)
  await folha.getByRole("button", { name: "Fechar" }).last().click().catch(() => {})
  return { marcadaPorOmissao, lista, enviado }
}

try {
  const ana = await abrir(chromium, "ana-chromium")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(firefox, "bruno-firefox")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const carla = await abrir(webkit, "carla-webkit")
  await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
  await dentro(carla.page)
  const [enderecoAna, enderecoBruno, enderecoCarla] = contasDoServidor(srv.base)

  // Ana's second tab takes ownership and reports from there.
  const ana2 = await ana.ctx.newPage()
  await ana2.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const espera = await ate(async () => (await ana2.locator("body").innerText()).includes("Já tens o Orwell aberto noutro separador."), 30_000, 500)
  check("o segundo separador da Ana espera pelo primeiro", espera >= 0)
  await ana2.getByRole("button", { name: "Usar este separador" }).click()
  const campo = ana2.locator('.gate-card input[type="password"]').first()
  await campo.or(ana2.getByRole("button", { name: "Configurações", exact: true }).first()).first().waitFor({ timeout: 60_000 })
  if (await campo.isVisible().catch(() => false)) {
    await campo.fill(FRASE)
    await ana2.getByRole("button", { name: "Entrar", exact: true }).click()
  }
  await dentro(ana2)

  const daAna = await comunicar(ana2, "ana", { descricao: "A lista de canais não actualiza." })
  check("Ana: a caixa dos detalhes vem marcada", daAna.marcadaPorOmissao)
  check("Ana: a lista diz o que vai", /Versão da app: .*Tipo: web.*Sistema e browser: .*Língua: pt.*Ligação: online/.test(daAna.lista), daAna.lista.slice(0, 220))
  check("Ana: a confirmação aparece", daAna.enviado)

  const doBruno = await comunicar(bruno.page, "bruno", { descricao: "O som cortou na chamada.", contacto: true })
  check("Bruno: a confirmação aparece", doBruno.enviado)
  check("Bruno: Firefox na lista", doBruno.lista.includes("Firefox"), doBruno.lista.slice(0, 220))

  const daCarla = await comunicar(carla.page, "carla", { descricao: "A foto não abriu.", detalhes: false })
  check("Carla: a confirmação aparece", daCarla.enviado)

  // The server folder.
  const guardados = await ate(async () => bugsGuardados().length === 3, 10_000, 300).then(() => bugsGuardados())
  check("três relatos no servidor", guardados.length === 3, String(guardados.length))
  const porTexto = (texto) => guardados.find((g) => g.corpo?.descricao === texto)
  const gAna = porTexto("A lista de canais não actualiza.")
  const gBruno = porTexto("O som cortou na chamada.")
  const gCarla = porTexto("A foto não abriu.")
  check("o da Ana tem os detalhes e não tem o endereço", gAna?.corpo?.detalhes?.plataforma === "web" && !JSON.stringify(gAna).includes(enderecoAna))
  check("o do Bruno tem o endereço dele, porque pediu contacto", gBruno?.contacto === enderecoBruno)
  check("o da Carla não tem detalhes nem endereço", gCarla !== undefined && gCarla.corpo.detalhes === undefined && !JSON.stringify(gCarla).includes(enderecoCarla))
  const fila = JSON.parse(readFileSync(join(PASTA, "fila.json"), "utf8"))
  check("a fila tem três entradas, só números e datas", fila.bugs.length === 3 && !JSON.stringify(fila).includes("chamada"))
  check("a fila marca quem pediu contacto", fila.bugs.filter((b) => b.comContacto).length === 1)
} catch (erro) {
  check("o guião correu até ao fim", false, String(erro?.stack ?? erro).slice(0, 400))
  for (const { nome, page } of paginas) await foto(page, `falha-${nome}`)
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  srv.fechar()
}
console.log(`capturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
