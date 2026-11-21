/**
 * Export an account on one device and import it on another (1.3.26, 21/11/2026): importing makes a NEW device of the account and never
 * removes one. Line 2 of phase 7, rewritten.
 *
 *   npm run build && node scripts/e2e-exportar-importar.mjs                     (all)
 *   node scripts/e2e-exportar-importar.mjs --so=chromium-firefox                (one)
 *
 * The combinations cover the rule for multi-device work: three browsers
 * (Chromium, Firefox, WebKit), two devices (the browser and the desktop app,
 * `sec`), and two tabs (a second tab of the destination). In each one, through
 * the interface:
 *  1. Ana is created on the SOURCE device; Bruno (Chromium) asks her for
 *     friendship, she accepts; Bruno creates the channel and invites her;
 *  2. Ana exports in Settings › Devices (on desktop the keychain vault asks for
 *     an export password);
 *  3. the DESTINATION device, with no account, imports the file at the gate;
 *  4. the destination has the history of the channel, gets its own seat, and
 *     reads and writes; Bruno reads it;
 *  5. the SOURCE keeps working: never sent out, it reads the destination and
 *     writes, and the destination reads it;
 *  6. the source's bell says "Novo aparelho entrou na conta.", and "Remover"
 *     there takes the destination out ("Este aparelho foi tirado da conta
 *     noutro aparelho."); the source still writes and Bruno reads it;
 *  7. a second tab of the destination says the app is open in another tab and
 *     does not act, while the first keeps reading.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, abrirDirecta, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, dizer, escutar, importarFicheiro, ouviu, pedirAmizade, separador, temCanal, verificador } from "./fase7-comum.mjs"
import { abrirSecretaria } from "./secretaria.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const FRASE_DE_EXPORTACAO = "frase-do-ficheiro-2026"
const so = process.argv.find((a) => a.startsWith("--so="))?.split("=")[1]
const COMBINACOES = [
  ["chromium", "firefox"],
  ["firefox", "webkit"],
  ["webkit", "sec"],
  ["sec", "chromium"],
].filter(([o, d]) => !so || so === `${o}-${d}`)
const MOTORES = { chromium, firefox, webkit }
const AVISO_REMOVIDO = "Este aparelho saiu da conta"
const AVISO_NOVO = "Novo aparelho entrou na conta."
const OUTRO_SEPARADOR = "Já tens o Orwell aberto noutro separador."
const INICIO = "Como queres mostrar o teu nome?"

const { check, resumo } = verificador()
const registo = []
const pastaDosFicheiros = mkdtempSync(join(tmpdir(), "orwell-e2e-ficheiros-"))
const srv = await levantarServidor({ frente: 8482, servidor: 8483, etiqueta: "exportar-importar" })
const browsers = {}
async function browserDe(motor) {
  browsers[motor] ??= await MOTORES[motor].launch({ headless: true })
  return browsers[motor]
}
const abertos = []
/** The open devices, so a failure diagnosis can say what each screen showed. */
const aparelhos = []

async function abrirAparelho(tipo, rotulo) {
  if (tipo === "sec") {
    const sec = await abrirSecretaria({ rotulo })
    abertos.push(() => sec.fechar())
    sec.page.on("console", () => {})
    const aparelho = { tipo, rotulo, page: sec.page, sec }
    aparelhos.push(aparelho)
    return aparelho
  }
  const ctx = await (await browserDe(tipo)).newContext({ locale: "pt-PT", acceptDownloads: true })
  escutar(ctx, registo, rotulo)
  const page = await ctx.newPage()
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  abertos.push(() => ctx.close())
  const aparelho = { tipo, rotulo, page, ctx }
  aparelhos.push(aparelho)
  return aparelho
}

/** Settings › Devices › Export account. Returns the file path. */
async function exportar(aparelho, destino) {
  const { page } = aparelho
  await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await page.getByRole("button", { name: "Conta e segurança", exact: true }).click()
  // 21/11/2026: a row of "Conta e segurança" opens the sheet with "Guardar o ficheiro".
  await page.getByRole("button", { name: "Guardar o ficheiro da conta" }).click()
  const botao = page.locator(".sheet").getByRole("button", { name: "Guardar o ficheiro", exact: true }).first()
  if (aparelho.tipo === "sec") {
    /*
      In the installed app the `<a download>` opens the system save dialog, and the
      user picks the folder. Here the main process receives the choice already made
      (`setSavePath` in `will-download`), which is what the dialog would do.
    */
    await aparelho.sec.app.evaluate(({ BrowserWindow }, caminho) => {
      for (const janela of BrowserWindow.getAllWindows()) {
        janela.webContents.session.once("will-download", (_evento, item) => item.setSavePath(caminho))
      }
    }, destino)
    await botao.click()
    /*
      A keychain vault (no password) asks for an export password; a password
      vault, which is what `criarConta` makes, saves the file at once.
    */
    const campo = page.locator('input[name="export-password"]')
    await ate(async () => existsSync(destino) || (await campo.count()) > 0, 15_000, 300)
    if (!existsSync(destino) && (await campo.count()) > 0) {
      await campo.fill(FRASE_DE_EXPORTACAO)
      await page.locator("form.export-pass").getByRole("button", { name: "Guardar o ficheiro" }).click()
      aparelho.fraseDoFicheiro = FRASE_DE_EXPORTACAO
    }
    const ms = await ate(async () => existsSync(destino), 60_000, 300)
    return ms >= 0 ? destino : null
  }
  const descarga = page.waitForEvent("download", { timeout: 60_000 })
  await botao.click()
  const d = await descarga
  await d.saveAs(destino)
  return destino
}

async function importar(aparelho, ficheiro, frase) {
  const { page } = aparelho
  /*
    In the installed app the file is chosen in the system dialog, opened by the
    main process (Task 11b): here the main process receives the choice already
    made, which is what the dialog would do.
  */
  const escolherNaSecretaria =
    aparelho.tipo === "sec"
      ? (caminho) =>
          aparelho.sec.app.evaluate(({ dialog }, c) => {
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [c] })
          }, caminho)
      : null
  await importarFicheiro(page, ficheiro, frase, { escolherNaSecretaria })
  await dentro(page)
}

try {
  for (const [origem, destino] of COMBINACOES) {
    const etiqueta = `${origem}→${destino}`
    console.log(`\n=== ${etiqueta} ===`)
    // Names fit in 12 characters: the initials of the two ends.
    const curto = `${origem[0]}${destino[0]}`
    const nomeDaAna = `Ana ${curto}`
    const canal = `lagar-${origem}-${destino}`

    // 1. Ana on the source, Bruno on the browser, friendship and channel.
    const antes = contasDoServidor(srv.base).length
    const anaOrigem = await abrirAparelho(origem, `origem-${origem}`)
    if (origem === "sec") {
      /*
        The desktop app: the account-file step right after creating saves through
        the system dialog, so the download event never reaches the page. The main
        process gets the choice already made, as in `exportar`.
      */
      await criarConta(anaOrigem.page, { nome: nomeDaAna, frase: FRASE, servidor: srv.NOME, ficheiro: false })
      const primeiro = join(pastaDosFicheiros, `primeiro-${origem}-${destino}.enclave`)
      await anaOrigem.sec.app.evaluate(({ BrowserWindow }, caminho) => {
        for (const janela of BrowserWindow.getAllWindows()) {
          janela.webContents.session.once("will-download", (_evento, item) => item.setSavePath(caminho))
        }
      }, primeiro)
      const botao = anaOrigem.page.getByRole("button", { name: "Guardar o ficheiro" })
      await botao.and(anaOrigem.page.locator(":enabled")).waitFor({ timeout: 60_000 })
      await botao.click()
      await ate(async () => existsSync(primeiro), 60_000, 300)
    } else {
      await criarConta(anaOrigem.page, { nome: nomeDaAna, frase: FRASE, servidor: srv.NOME })
    }
    await dentro(anaOrigem.page)
    const bruno = await abrirAparelho("chromium", `bruno-${etiqueta}`)
    await criarConta(bruno.page, { nome: `Bruno ${curto}`, frase: FRASE, servidor: srv.NOME })
    await dentro(bruno.page)
    const [enderecoAna, enderecoBruno] = contasDoServidor(srv.base).slice(antes)
    await pedirAmizade(bruno.page, enderecoAna)
    check(`${etiqueta}: a Ana (origem) aceita a amizade do Bruno`, (await aceitarAmizade(anaOrigem.page)) >= 0)
    await criarCanal(bruno.page, canal)
    check(`${etiqueta}: o Bruno convida a Ana para o canal`, await convidar(bruno.page, canal, enderecoAna))
    check(`${etiqueta}: a Ana (origem) entra no canal`, await aceitarConvite(anaOrigem.page, canal, { espera: 60_000 }))
    await abrirCanal(anaOrigem.page, canal)
    await abrirCanal(bruno.page, canal)
    const antesDeExportar = `antes de exportar ${Date.now().toString(36)}`
    await dizer(bruno.page, antesDeExportar)
    check(`${etiqueta}: a origem lê o canal antes de exportar`, (await ouviu(anaOrigem.page, antesDeExportar)) >= 0)

    // 2. Exportar.
    const caminho = join(pastaDosFicheiros, `conta-${origem}-${destino}.enclave`)
    const ficheiro = await exportar(anaOrigem, caminho)
    check(`${etiqueta}: a origem exporta o ficheiro da conta`, Boolean(ficheiro) && existsSync(caminho))

    // 3. Importar no destino.
    const anaDestino = await abrirAparelho(destino, `destino-${destino}`)
    const t0 = Date.now()
    await importar(anaDestino, caminho, anaOrigem.fraseDoFicheiro ?? FRASE)
    check(`${etiqueta}: o destino importa e entra na conta`, true, `${Date.now() - t0} ms`)
    check(`${etiqueta}: importar não cria conta nenhuma no servidor`, contasDoServidor(srv.base).length === antes + 2)

    // 4. The destination has the history, gets its own seat, and talks.
    check(`${etiqueta}: o destino tem o canal ${canal}`, await temCanal(anaDestino.page, canal, 120_000))
    await abrirCanal(anaDestino.page, canal)
    check(`${etiqueta}: o histórico veio no ficheiro`, (await ouviu(anaDestino.page, antesDeExportar, 30_000)) >= 0)
    await separador(anaDestino.page, "Todos")
    const temAmigo = await ate(async () => anaDestino.page.locator(".people-scroll .person-row", { hasText: "Bruno" }).first().isVisible(), 30_000, 1000)
    check(`${etiqueta}: o destino tem o Bruno nos amigos`, temAmigo >= 0)
    await abrirCanal(anaDestino.page, canal)
    await abrirCanal(bruno.page, canal)
    const doBruno = `depois de importar, do Bruno ${Date.now().toString(36)}`
    await dizer(bruno.page, doBruno)
    const msDestinoLe = await ouviu(anaDestino.page, doBruno)
    check(`${etiqueta}: o destino lê o canal`, msDestinoLe >= 0, `${msDestinoLe} ms`)
    const doDestino = `do destino ${Date.now().toString(36)}`
    await dizer(anaDestino.page, doDestino)
    const msBrunoLe = await ouviu(bruno.page, doDestino)
    check(`${etiqueta}: o Bruno lê o destino no canal`, msBrunoLe >= 0, `${msBrunoLe} ms`)

    // 5. The source keeps working: never sent out, it reads and writes.
    const foiPostaFora = (await anaOrigem.page.locator("body").innerText()).includes(AVISO_REMOVIDO)
    check(`${etiqueta}: a origem NÃO é posta fora (sem Erro 748)`, !foiPostaFora)
    check(
      `${etiqueta}: a origem continua dentro da aplicação`,
      (await anaOrigem.page.getByRole("button", { name: "Configurações", exact: true }).count()) > 0,
    )
    await abrirCanal(anaOrigem.page, canal)
    const msOrigemLe = await ouviu(anaOrigem.page, doDestino, 30_000)
    check(`${etiqueta}: a origem lê o que o destino escreveu`, msOrigemLe >= 0, `${msOrigemLe} ms`)
    const daOrigem = `da origem depois de importar ${Date.now().toString(36)}`
    await dizer(anaOrigem.page, daOrigem)
    check(`${etiqueta}: o Bruno lê a origem`, (await ouviu(bruno.page, daOrigem)) >= 0)
    check(`${etiqueta}: o destino lê a origem`, (await ouviu(anaDestino.page, daOrigem)) >= 0)

    // 7. A second tab of the destination (browsers only): it waits, the first keeps reading.
    if (destino !== "sec") {
      const segunda = await anaDestino.ctx.newPage()
      await segunda.goto(srv.APP, { waitUntil: "domcontentloaded" })
      const msEspera = await ate(async () => (await segunda.locator("body").innerText()).includes(OUTRO_SEPARADOR), 30_000, 500)
      check(`${etiqueta}: o segundo separador do destino diz que a app está aberta noutro`, msEspera >= 0, `${msEspera} ms`)
      const comDois = `com dois separadores ${Date.now().toString(36)}`
      await dizer(bruno.page, comDois)
      check(`${etiqueta}: o primeiro separador do destino continua a ler`, (await ouviu(anaDestino.page, comDois)) >= 0)
      await segunda.close().catch(() => {})
    }

    // 6. The bell on the source: the notice, and "Remover" takes the destination out.
    await anaOrigem.page.getByRole("button", { name: /^Notificações/ }).first().click()
    const msAvisoNovo = await ate(async () => (await anaOrigem.page.locator("body").innerText()).includes(AVISO_NOVO), 30_000, 500)
    check(`${etiqueta}: o sino da origem diz "${AVISO_NOVO}"`, msAvisoNovo >= 0, `${msAvisoNovo} ms`)
    const remover = anaOrigem.page.locator('.notif-evento[data-tipo="device-new"]').getByRole("button", { name: "Remover", exact: true })
    const temRemover = await remover.first().waitFor({ timeout: 30_000 }).then(() => true, () => false)
    check(`${etiqueta}: o aviso tem "Remover"`, temRemover)
    if (temRemover) {
      await remover.first().click()
      // "Remover" asks first, as in Settings › Devices.
      const confirmar = anaOrigem.page.getByRole("alertdialog").getByRole("button", { name: "Revogar", exact: true })
      const pediu = await confirmar.waitFor({ timeout: 10_000 }).then(() => true, () => false)
      check(`${etiqueta}: "Remover" asks for confirmation before it removes the device`, pediu)
      if (pediu) await confirmar.click()
    }
    /*
      Removed with the signed proof, the destination erases its vault and goes back
      to the start: the notice is a toast for a few seconds, then the sign-up.
      Either one says the device left the account.
    */
    const msFora = await ate(async () => {
      const t = await anaDestino.page.locator("body").innerText({ timeout: 2_000 })
      return t.includes(AVISO_REMOVIDO) || t.includes(INICIO)
    }, 60_000, 500)
    check(`${etiqueta}: "Remover" tira o destino da conta (o aviso, ou o ecrã de criar conta)`, msFora >= 0, `${msFora} ms`)
    await anaOrigem.page.keyboard.press("Escape").catch(() => {})
    await abrirCanal(anaOrigem.page, canal)
    const depoisDeRemover = `depois de remover ${Date.now().toString(36)}`
    await dizer(anaOrigem.page, depoisDeRemover)
    check(`${etiqueta}: a origem continua a escrever depois de remover`, (await ouviu(bruno.page, depoisDeRemover)) >= 0)

    while (abertos.length) await abertos.pop()().catch(() => {})
  }
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of aparelhos) {
    const texto = await a.page.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
    console.log(`--- ${a.rotulo} mostra: "${texto.replace(/\s+/g, " ").slice(0, 1500)}"`)
    if (a.sec) console.log(a.sec.registo.filter((l) => /PRINCIPAL!|PAGEERROR/.test(l)).slice(-15).join("\n"))
  }
  console.log("--- browsers (fim) ---\n" + registo.filter((l) => !l.includes("TRAMA")).slice(-25).join("\n"))
  console.log("--- servidor (fim) ---\n" + srv.registo.texto.split("\n").filter((l) => !/Experimental|trace-warnings/.test(l)).slice(-40).join("\n"))
}

while (abertos.length) await abertos.pop()().catch(() => {})
for (const aberto of Object.values(browsers)) await aberto.close().catch(() => {})
srv.fechar()
rmSync(pastaDosFicheiros, { recursive: true, force: true })
process.exit(resumo() ? 0 : 1)
