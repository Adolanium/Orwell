/**
 * The new way in (21/11/2026), one path at a time, in Chromium, Firefox and WebKit.
 *
 *   npm run build && node --dns-result-order=ipv4first scripts/e2e-entrada-nova.mjs [--motor=chromium|firefox|webkit] [--so=<caminho>]
 *
 * The paths, each on its own contexts:
 *  - registo: "Bem-vindo ao Orwell", "Criar conta", "Guarda o ficheiro da conta", the app.
 *  - convite: a server that wants a code shows the field at once; a wrong code
 *    gives Erro 232 under the field; the right one gets in.
 *  - fechado: a closed server says Erro 230 and no vault is written.
 *  - ficheiro: the file saved on A signs in on B; A stays in.
 *  - voltar: "Olá", "Manter sessão iniciada" off, Erro 104, then in.
 *  - esqueci: "Esqueci-me da palavra-passe" › the file, in an empty account next
 *    to the old one; the old one is still in "Mudar de conta".
 *  - outro-aparelho: Settings › Conta e segurança › Juntar um aparelho on A, the
 *    code on B, the same three words, "Estás dentro" and the password; a new tab
 *    on B opens with it.
 *  - outra-conta: "Usar outra conta" opens the three ways in, a second account,
 *    and the first one back through "Mudar de conta".
 *  - versao-antiga: a server with a minimum version above this app says
 *    "Esta versão do Orwell é antiga." before any vault exists.
 *  - removido: A revokes B; B shows "Este aparelho saiu da conta." with the file
 *    and another device.
 *
 * ALL LOCAL AND DISPOSABLE: four servers on ports 8493 to 8500, never production.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta, passarOFicheiroDaConta } from "./conta.mjs"
import { dentro, espera, importarFicheiro, verificador } from "./fase7-comum.mjs"
import { abrirJuntarUmAparelho, colarCodigo, confirmarEAbrir, palavrasDe } from "./juntar-aparelho.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const MOTORES = { chromium, firefox, webkit }
const argumento = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1]
const escolhidos = argumento("motor") ? [argumento("motor")] : ["chromium", "firefox", "webkit"]
const so = argumento("so")
const pasta = mkdtempSync(join(tmpdir(), "orwell-entrada-nova-"))

const { check, resumo } = verificador()
const porMotor = {}
const servidores = {
  aberto: await levantarServidor({ frente: 8493, servidor: 8494, etiqueta: "entrada-aberto" }),
  convite: await levantarServidor({ frente: 8495, servidor: 8496, etiqueta: "entrada-convite", env: { ENCLAVE_REGISTO: "convite" } }),
  fechado: await levantarServidor({ frente: 8497, servidor: 8498, etiqueta: "entrada-fechado", env: { ENCLAVE_REGISTO: "fechado" } }),
  versao: await levantarServidor({ frente: 8499, servidor: 8500, etiqueta: "entrada-versao", env: { ENCLAVE_VERSAO_MINIMA_DO_CLIENTE: "9.0.0" } }),
}

let motorActual = ""
let browser = null
const fechos = []
const erros = []

async function contexto({ telemovel = false } = {}) {
  const extra = telemovel
    ? motorActual === "firefox"
      ? { viewport: { width: 390, height: 844 }, hasTouch: true }
      : { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
    : { viewport: { width: 1280, height: 860 } }
  const ctx = await browser.newContext({ locale: "pt-PT", acceptDownloads: true, ...extra })
  fechos.push(() => ctx.close())
  return ctx
}

async function abrir(ctx, srv) {
  const page = await ctx.newPage()
  page.on("pageerror", (e) => erros.push(`${motorActual}: ${e.message}`))
  await page.goto(`${srv.APP}&servidor=${srv.NOME}`, { waitUntil: "domcontentloaded" })
  return page
}

/** A new tab of the same browser, after the old one closes: the tab key stays behind, so the gate asks. */
async function outroSeparador(ctx, srv, anterior) {
  await anterior.close()
  return abrir(ctx, srv)
}

const ola = (page) => page.getByRole("heading", { name: /^Olá/ })
const bemVindo = (page) => page.getByRole("heading", { name: "Bem-vindo ao Orwell" })

/** Whether this browser has a vault for the main account. Read from IndexedDB, read-only. */
async function temCofre(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const pedido = indexedDB.open("enclave", 1)
        pedido.onupgradeneeded = () => pedido.result.createObjectStore("vault")
        pedido.onerror = () => resolve(false)
        pedido.onsuccess = () => {
          try {
            const ler = pedido.result.transaction("vault", "readonly").objectStore("vault").get("current")
            ler.onsuccess = () => {
              pedido.result.close()
              resolve(ler.result !== undefined)
            }
            ler.onerror = () => resolve(false)
          } catch {
            resolve(false)
          }
        }
      }),
  )
}

/** Create an account and save its file to disk. Returns the path. */
async function criarComFicheiro(page, nome) {
  await criarConta(page, { nome, frase: FRASE, ficheiro: false })
  const descarga = await passarOFicheiroDaConta(page)
  const caminho = join(pasta, `${motorActual}-${nome.replace(/\s+/g, "-")}.enclave`)
  await descarga.saveAs(caminho)
  await dentro(page)
  return caminho
}

/** The password at the gate, then the app. */
async function entrarComPalavraPasse(page, frase = FRASE) {
  await ola(page).waitFor({ timeout: 60_000 })
  await page.locator('input[name="password"]').fill(frase)
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
}

const caminhos = {
  async registo() {
    const page = await abrir(await contexto(), servidores.aberto)
    await bemVindo(page).waitFor({ timeout: 60_000 })
    const tres =
      (await page.getByRole("button", { name: "Criar conta", exact: true }).count()) === 1 &&
      (await page.getByRole("button", { name: "Entrar com o ficheiro da conta" }).count()) === 1 &&
      (await page.getByRole("button", { name: "Entrar com outro aparelho" }).count()) === 1
    check(`[${motorActual}] registo: a entrada tem os três caminhos`, tres)
    await page.getByRole("button", { name: "Criar conta", exact: true }).click()
    check(`[${motorActual}] registo: o campo do convite não aparece num servidor aberto`, (await page.locator('input[name="convite-de-registo"]').count()) === 0)
    check(`[${motorActual}] registo: sem pergunta de imagem de perfil`, (await page.locator('.gate input[type="file"]').count()) === 0)
    await criarConta(page, { nome: "Ana", frase: FRASE, ficheiro: false })
    await page.getByRole("heading", { name: "Guarda o ficheiro da conta" }).waitFor({ timeout: 90_000 })
    await page.getByRole("button", { name: "Fazer mais tarde" }).click()
    check(`[${motorActual}] registo: entra na app`, await dentro(page).then(() => true, () => false))
    const faixa = await page.locator(".faixa-do-ficheiro:visible").first().waitFor({ timeout: 30_000 }).then(() => true, () => false)
    if (!faixa) await page.screenshot({ path: join(pasta, `${motorActual}-registo-sem-faixa.png`) })
    check(`[${motorActual}] registo: "Fazer mais tarde" deixa a faixa do ficheiro`, faixa)
  },

  async convite() {
    const srv = servidores.convite
    const saida = execFileSync(process.execPath, [join(RAIZ, "scripts/convites-de-registo.mjs"), "criar", "--usos", "1"], {
      env: { ...process.env, ORWELL_BASE: srv.base },
      encoding: "utf8",
    })
    const codigo = /Código: (\S+)/.exec(saida)?.[1]
    check(`[${motorActual}] convite: o operador faz um código`, Boolean(codigo))
    const page = await abrir(await contexto({ telemovel: true }), srv)
    await bemVindo(page).waitFor({ timeout: 60_000 })
    await page.getByRole("button", { name: "Criar conta", exact: true }).click()
    const campo = page.locator('input[name="convite-de-registo"]')
    const logo = await campo.waitFor({ timeout: 15_000 }).then(() => true, () => false)
    check(`[${motorActual}] convite: o servidor pede código e o campo aparece logo`, logo)
    check(`[${motorActual}] convite: sem o link "Tenho um código de convite"`, (await page.getByRole("button", { name: "Tenho um código de convite" }).count()) === 0)
    await criarConta(page, { nome: "Bia", frase: FRASE, ficheiro: false, convite: "AAAA-BBBB-CCCC-DDDD" })
    const erro = page.locator(".gate .error").filter({ hasText: "232" })
    const recusou = await erro.waitFor({ timeout: 90_000 }).then(() => true, () => false)
    check(`[${motorActual}] convite: um código errado dá o Erro 232`, recusou, (await page.locator(".gate .error").allInnerTexts().catch(() => [])).join(" | "))
    await campo.fill(codigo ?? "")
    const criar = page.locator(".gate form").getByRole("button", { name: /^(Criar conta|A criar a conta…)/ })
    if (await criar.isDisabled()) console.log(`  ..  "Criar conta" desligado depois do Erro 232: ${JSON.stringify((await page.locator(".gate").innerText()).slice(0, 400))}`)
    await criar.click({ timeout: 10_000 })
    const passo = await page.getByRole("heading", { name: "Guarda o ficheiro da conta" }).waitFor({ timeout: 90_000 }).then(() => true, () => false)
    check(`[${motorActual}] convite: com o código certo a conta é criada`, passo)
    if (!passo) console.log(`  ..  o ecrã: ${JSON.stringify((await page.locator(".gate").innerText().catch(() => "")).slice(0, 500))}`)
    await page.getByRole("button", { name: "Fazer mais tarde" }).click()
    check(`[${motorActual}] convite: entra na app`, await dentro(page).then(() => true, () => false))
  },

  async fechado() {
    const page = await abrir(await contexto(), servidores.fechado)
    await bemVindo(page).waitFor({ timeout: 60_000 })
    await page.getByRole("button", { name: "Criar conta", exact: true }).click()
    const erro = page.locator(".gate .error").filter({ hasText: "230" })
    const disse = await erro.waitFor({ timeout: 30_000 }).then(() => true, () => false)
    check(`[${motorActual}] fechado: o servidor fechado diz o Erro 230`, disse)
    await page.locator('.gate input[autocomplete="nickname"]').fill("Carla")
    await page.locator('input[name="new-password"]').fill(FRASE)
    await page.locator('input[name="confirm-password"]').fill(FRASE)
    check(`[${motorActual}] fechado: "Criar conta" fica desligado`, await page.locator(".gate form").getByRole("button", { name: "Criar conta", exact: true }).isDisabled())
    check(`[${motorActual}] fechado: nenhum cofre escrito`, !(await temCofre(page)))
    await page.reload({ waitUntil: "domcontentloaded" })
    check(`[${motorActual}] fechado: recarregar volta à entrada`, await bemVindo(page).waitFor({ timeout: 60_000 }).then(() => true, () => false))
  },

  async ficheiro() {
    const a = await abrir(await contexto(), servidores.aberto)
    const caminho = await criarComFicheiro(a, "Dora")
    const b = await abrir(await contexto({ telemovel: true }), servidores.aberto)
    await importarFicheiro(b, caminho, FRASE)
    check(`[${motorActual}] ficheiro: o ficheiro e a palavra-passe entram noutro browser`, await dentro(b).then(() => true, () => false))
    await espera(5_000)
    const aindaDentro = (await a.locator(".app").count()) === 1 && (await a.getByRole("heading", { name: "Este aparelho saiu da conta." }).count()) === 0
    check(`[${motorActual}] ficheiro: o aparelho de origem continua dentro`, aindaDentro)
    check(`[${motorActual}] ficheiro: quem entrou pelo ficheiro não vê a faixa`, (await b.locator(".faixa-do-ficheiro").count()) === 0)
  },

  async voltar() {
    const ctx = await contexto()
    let page = await abrir(ctx, servidores.aberto)
    await criarConta(page, { nome: "Eva", frase: FRASE })
    await dentro(page)
    page = await outroSeparador(ctx, servidores.aberto, page)
    check(`[${motorActual}] voltar: o portão diz "Olá"`, await ola(page).waitFor({ timeout: 60_000 }).then(() => true, () => false))
    // One account only, and the name still shows: it is kept outside the vault.
    const greeting = await ola(page).innerText().catch(() => "")
    check(`[${motorActual}] voltar: with one account it says the name ("Olá, Eva")`, greeting === ["Olá", "Eva"].join(", "), greeting)
    const caixa = page.locator('input[name="memorizar"]')
    if (await caixa.count()) check(`[${motorActual}] voltar: "Manter sessão iniciada" vem desligado`, !(await caixa.isChecked()))
    await page.locator('input[name="password"]').fill("errada-de-proposito")
    await page.getByRole("button", { name: "Entrar", exact: true }).click()
    const erro = page.getByRole("alert").filter({ hasText: "104" })
    const disse = await erro.waitFor({ timeout: 60_000 }).then(() => true, () => false)
    check(`[${motorActual}] voltar: palavra-passe errada dá o Erro 104 "Palavra-passe errada."`, disse && (await erro.innerText()).includes("Palavra-passe errada."))
    await page.locator('input[name="password"]').fill(FRASE)
    await page.getByRole("button", { name: "Entrar", exact: true }).click()
    check(`[${motorActual}] voltar: a palavra-passe certa entra`, await dentro(page).then(() => true, () => false))
  },

  async esqueci() {
    const ctx = await contexto()
    let page = await abrir(ctx, servidores.aberto)
    const caminho = await criarComFicheiro(page, "Fabio")
    page = await outroSeparador(ctx, servidores.aberto, page)
    await ola(page).waitFor({ timeout: 60_000 })
    await page.getByRole("button", { name: "Esqueci-me da palavra-passe" }).click()
    await page.getByRole("heading", { name: "Esqueceste-te da palavra-passe?" }).waitFor({ timeout: 10_000 })
    check(`[${motorActual}] esqueci: não há "criar conta nova" nem "apagar"`, (await page.getByRole("button", { name: /apagar|conta nova/i }).count()) === 0)
    await Promise.all([page.waitForEvent("load", { timeout: 30_000 }), page.getByRole("button", { name: "Entrar com o ficheiro da conta" }).click()])
    const noFicheiro = await page.locator('input[name="import-password"]').waitFor({ timeout: 60_000 }).then(() => true, () => false)
    check(`[${motorActual}] esqueci: abre "Entrar com o ficheiro da conta" numa conta vazia`, noFicheiro)
    await page.locator('.gate input[type="file"]').setInputFiles(caminho)
    await page.locator('input[name="import-password"]').fill(FRASE)
    await page.getByRole("button", { name: "Entrar", exact: true }).click()
    check(`[${motorActual}] esqueci: entra com o ficheiro`, await dentro(page).then(() => true, () => false))
    await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
    await page.getByRole("button", { name: "Conta", exact: true }).first().click()
    await page.getByRole("button", { name: "Mudar de conta" }).first().click()
    const folha = page.getByRole("dialog", { name: "Mudar de conta" })
    // The account left behind was locked when the empty one was added, so the list may not know its name.
    const antiga = await folha.getByRole("button", { name: /^(Fabio|Conta sem nome)/ }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
    check(`[${motorActual}] esqueci: a conta antiga continua neste aparelho, em "Mudar de conta"`, antiga)
    // The name is kept outside the vault (`lib/accountNames.ts`): the account left behind keeps it in the list.
    check(`[${motorActual}] esqueci: e a lista sabe o nome dela`, (await folha.getByRole("button", { name: /^Fabio/ }).count()) === 1)
  },

  async "outro-aparelho"() {
    const a = await abrir(await contexto(), servidores.aberto)
    await criarConta(a, { nome: "Gil", frase: FRASE })
    await dentro(a)
    const ctxB = await contexto({ telemovel: true })
    let b = await abrir(ctxB, servidores.aberto)
    await bemVindo(b).waitFor({ timeout: 60_000 })
    await b.getByRole("button", { name: "Entrar com outro aparelho" }).click()
    check(`[${motorActual}] outro aparelho: o aparelho novo diz onde ir`, (await b.getByText("No aparelho onde tens a conta, abre Configurações › Juntar um aparelho.").count()) === 1)
    const { folha, link } = await abrirJuntarUmAparelho(a)
    await colarCodigo(b, folha, link)
    const [doNovo, daConta] = [await palavrasDe(b), await palavrasDe(folha)]
    check(`[${motorActual}] outro aparelho: as mesmas três palavras nos dois ecrãs`, doNovo === daConta && doNovo?.split("-").length === 3, `${doNovo} / ${daConta}`)
    await confirmarEAbrir(b, folha, FRASE)
    check(`[${motorActual}] outro aparelho: "Estás dentro" e "Abrir o Orwell" entram na app`, await dentro(b).then(() => true, () => false))
    await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
    b = await outroSeparador(ctxB, servidores.aberto, b)
    await entrarComPalavraPasse(b)
    check(`[${motorActual}] outro aparelho: um separador novo abre com a palavra-passe da conta`, await dentro(b).then(() => true, () => false))
  },

  async "outra-conta"() {
    const ctx = await contexto()
    let page = await abrir(ctx, servidores.aberto)
    await criarConta(page, { nome: "Helena", frase: FRASE })
    await dentro(page)
    page = await outroSeparador(ctx, servidores.aberto, page)
    await ola(page).waitFor({ timeout: 60_000 })
    await Promise.all([page.waitForEvent("load", { timeout: 30_000 }), page.getByRole("button", { name: "Usar outra conta" }).click()])
    const entrada = await bemVindo(page).waitFor({ timeout: 60_000 }).then(() => true, () => false)
    check(`[${motorActual}] outra conta: "Usar outra conta" abre os três caminhos`, entrada)
    check(`[${motorActual}] outra conta: com "Voltar a uma conta deste aparelho"`, await page.getByRole("button", { name: "Voltar a uma conta deste aparelho" }).waitFor({ timeout: 15_000 }).then(() => true, () => false))
    await criarConta(page, { nome: "Ivo", frase: "frase-do-ivo-2026" })
    check(`[${motorActual}] outra conta: a segunda conta entra`, await dentro(page).then(() => true, () => false))
    await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
    await page.getByRole("button", { name: "Conta", exact: true }).first().click()
    await page.getByRole("button", { name: "Mudar de conta" }).first().click()
    await Promise.all([
      page.waitForEvent("load", { timeout: 30_000 }),
      page.getByRole("dialog", { name: "Mudar de conta" }).getByRole("button", { name: /^(Helena|Conta sem nome)/ }).first().click(),
    ])
    const deVolta = await ola(page).waitFor({ timeout: 60_000 }).then(() => true, () => false)
    check(`[${motorActual}] outra conta: a primeira conta volta ao portão "Olá"`, deVolta)
    const saudacao = (await ola(page).innerText().catch(() => "")).trim()
    check(`[${motorActual}] outra conta: e diz o nome dela ("Olá, Helena")`, saudacao === ["Olá", "Helena"].join(", "), saudacao)
    await entrarComPalavraPasse(page)
    check(`[${motorActual}] outra conta: e abre com a palavra-passe dela`, await dentro(page).then(() => true, () => false))
  },

  async "versao-antiga"() {
    const page = await abrir(await contexto({ telemovel: true }), servidores.versao)
    await bemVindo(page).waitFor({ timeout: 60_000 })
    await page.getByRole("button", { name: "Criar conta", exact: true }).click()
    const disse = await page.getByText("Esta versão do Orwell é antiga. Actualiza para criar conta.").waitFor({ timeout: 30_000 }).then(() => true, () => false)
    check(`[${motorActual}] versão antiga: diz para actualizar antes de criar`, disse)
    check(`[${motorActual}] versão antiga: com o botão "Actualizar"`, (await page.getByRole("button", { name: "Actualizar" }).count()) === 1)
    check(`[${motorActual}] versão antiga: sem Erro 206`, !(await page.locator("body").innerText()).includes("206"))
    check(`[${motorActual}] versão antiga: nenhum cofre escrito`, !(await temCofre(page)))
    await page.reload({ waitUntil: "domcontentloaded" })
    const entrada = await bemVindo(page).waitFor({ timeout: 60_000 }).then(() => true, () => false)
    check(`[${motorActual}] versão antiga: recarregar mostra a entrada, não "Olá"`, entrada && (await ola(page).count()) === 0)
  },

  async removido() {
    const a = await abrir(await contexto(), servidores.aberto)
    await criarConta(a, { nome: "Joana", frase: FRASE })
    await dentro(a)
    const ctxB = await contexto({ telemovel: true })
    let b = await abrir(ctxB, servidores.aberto)
    await bemVindo(b).waitFor({ timeout: 60_000 })
    await b.getByRole("button", { name: "Entrar com outro aparelho" }).click()
    const { folha, link } = await abrirJuntarUmAparelho(a)
    await colarCodigo(b, folha, link)
    await confirmarEAbrir(b, folha, FRASE)
    await dentro(b)
    await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
    await b.close()
    await a.keyboard.press("Escape").catch(() => {})
    await a.getByRole("button", { name: /^Aparelhos/ }).click()
    await a.locator(".aparelhos-lista li").nth(1).waitFor({ timeout: 15_000 })
    await a.locator(".aparelhos-lista li:not(.este)").getByRole("button", { name: /^Revogar/ }).first().click()
    await a.getByRole("alertdialog").getByRole("button", { name: "Revogar" }).click()
    check(`[${motorActual}] removido: o aparelho com a conta revoga o outro`, await a.getByText("O aparelho foi revogado.").first().waitFor({ timeout: 30_000 }).then(() => true, () => false))
    b = await abrir(ctxB, servidores.aberto)
    await entrarComPalavraPasse(b)
    const ecra = await b.getByRole("heading", { name: "Este aparelho saiu da conta." }).waitFor({ timeout: 60_000 }).then(() => true, () => false)
    check(`[${motorActual}] removido: "Este aparelho saiu da conta." no seu ecrã`, ecra)
    const dois =
      (await b.getByRole("button", { name: "Entrar com o ficheiro da conta" }).count()) === 1 &&
      (await b.getByRole("button", { name: "Entrar com outro aparelho" }).count()) === 1
    check(`[${motorActual}] removido: com o ficheiro e outro aparelho, e nada que apague`, dois && (await b.getByRole("button", { name: /apagar/i }).count()) === 0)
  },
}

try {
  for (const motor of escolhidos) {
    motorActual = motor
    browser = await MOTORES[motor].launch({ headless: true })
    const antes = erros.length
    for (const [nome, fazer] of Object.entries(caminhos)) {
      if (so && so !== nome) continue
      console.log(`\n=== ${motor}: ${nome} ===`)
      try {
        await fazer()
      } catch (erro) {
        check(`[${motor}] ${nome}: o caminho chegou ao fim`, false, String(erro?.message ?? erro).split("\n")[0])
      } finally {
        while (fechos.length) await fechos.pop()().catch(() => {})
      }
    }
    porMotor[motor] = erros.length - antes
    await browser.close()
  }
} finally {
  for (const srv of Object.values(servidores)) srv.fechar()
  for (const erro of erros.slice(0, 10)) console.log(`  !! erro de página: ${erro}`)
  process.exitCode = resumo() ? 0 : 1
}
