/**
 * The gestures that phase 7 scripts repeat, written once.
 *
 * Each one is what a person does in the UI and returns a FACT (it arrived, it
 * didn't), never "I clicked the button". The same gestures work for the browser
 * and the desktop app: the UI is the same (`@enclave/ui`), and that's what we
 * want to prove, that both bridges take you there.
 */
import { DatabaseSync } from "node:sqlite"
import { abrirComunidade, abrirDirecta as abrirDirectaEmQualquerLargura, appAberta, irPara, temComunidade } from "./separadores.mjs"

export const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function verificador() {
  const resultados = []
  const check = (nome, ok, detalhe = "") => {
    resultados.push({ nome, ok: Boolean(ok), detalhe })
    console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
    return Boolean(ok)
  }
  const resumo = () => {
    const passaram = resultados.filter((r) => r.ok).length
    console.log(`\n${passaram}/${resultados.length} verificações passaram`)
    return passaram === resultados.length
  }
  return { check, resumo, resultados }
}

/** Until the condition is true, or time runs out. Returns milliseconds, or -1. */
export async function ate(condicao, ms = 60_000, passo = 300) {
  const inicio = Date.now()
  while (Date.now() - inicio < ms) {
    if (await condicao().catch(() => false)) return Date.now() - inicio
    await espera(passo)
  }
  return -1
}

/** The app is open: the rail on a computer, the bar of tabs on a phone (`separadores.mjs`). */
export const dentro = (page, timeout = 90_000) => appAberta(page, timeout)

/** The server accounts, in the order they were born. Read from the database, read-only. */
export function contasDoServidor(base) {
  const db = new DatabaseSync(base, { readOnly: true })
  try {
    return db.prepare("SELECT address FROM accounts ORDER BY rowid ASC").all().map((l) => l.address)
  } finally {
    db.close()
  }
}

export function consultar(base, sql, ...args) {
  const db = new DatabaseSync(base, { readOnly: true })
  try {
    return db.prepare(sql).all(...args)
  } finally {
    db.close()
  }
}

/**
 * The addresses the server has seen debut (`channel_claims`).
 *
 * Since 1.0 "Arca" the app draws a room's address at random, and the name goes
 * encrypted inside it (slice 3): the script can't write it from the name
 * anymore. To find the address of a channel the app created, take this list
 * before creating it and ask `moradaNova` which appeared after.
 */
export function moradasEstreadas(base) {
  return new Set(consultar(base, "SELECT channel FROM channel_claims").map((l) => l.channel))
}

/** The only address that debuted since `before`; fails if there's none or more than one. */
export async function moradaNova(base, antes, ms = 15_000) {
  let novas = []
  // Async: `ate` calls `.catch` on what the condition returns.
  await ate(async () => {
    novas = [...moradasEstreadas(base)].filter((c) => !antes.has(c))
    return novas.length > 0
  }, ms)
  if (novas.length !== 1) throw new Error(`esperava uma morada nova no servidor, e há ${novas.length}: ${novas.join(", ")}`)
  return novas[0]
}

export async function separador(page, nome) {
  // On the phone, Friends is its own tab; on a computer, the rail button.
  await irPara(page, "amigos")
  await page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await page.locator(".people-tabs").getByRole("button", { name: nome }).click()
}

/** Open someone's profile sheet by address, in Friends › Find. */
export async function perfilDe(page, endereco) {
  await separador(page, "Encontrar")
  await page.getByLabel("Cola um link ou endereço").fill(endereco)
  await page.getByRole("button", { name: "Abrir perfil" }).click()
  const folha = page.locator(".person-profile")
  await folha.waitFor({ timeout: 15_000 })
  return folha
}

/**
 * Send a friend request from the profile sheet. In community mode the sheet
 * shows "Message" instead of "Send friend request" (see `e2e-emparelhar.mjs`):
 * open the conversation and request from the footer button.
 */
export async function pedirAmizade(page, endereco) {
  const folha = await perfilDe(page, endereco)
  const directo = folha.getByRole("button", { name: "Pedir amizade" })
  if (await directo.isVisible().catch(() => false)) {
    await directo.click()
    await folha.getByRole("status").filter({ hasText: "Pedido enviado" }).waitFor({ timeout: 30_000 })
    await page.keyboard.press("Escape")
    return true
  }
  await folha.getByRole("button", { name: "Mensagem", exact: true }).click()
  const rodape = page.getByRole("button", { name: "Pedir amizade" }).first()
  await rodape.waitFor({ timeout: 60_000 })
  await rodape.click()
  return true
}

/** Accept the first request in Friends › Received. Returns ms until the button appears, or -1. */
export async function aceitarAmizade(page, ms = 90_000) {
  const ms1 = await ate(async () => {
    await separador(page, /^Recebidos/)
    return page.locator(".people-requests").getByRole("button", { name: "Aceitar" }).first().isVisible()
  }, ms, 1500)
  if (ms1 < 0) return -1
  await page.locator(".people-requests").getByRole("button", { name: "Aceitar" }).first().click()
  return ms1
}

/** Open the first direct message (or the one with `text`). On the phone, from the Messages tab. */
export async function abrirDirecta(page, texto) {
  await abrirDirectaEmQualquerLargura(page, texto)
}

export async function dizer(page, frase) {
  const caixa = page.locator('textarea[placeholder="Escreve uma mensagem"]')
  await caixa.click()
  await caixa.fill(frase)
  await page.keyboard.press("Enter")
  // With a finger (a touch context), Enter starts a new line and the send
  // button sends (20/11/2026). The text is still in the box: send it.
  if ((await caixa.inputValue().catch(() => "")) !== "") await page.locator("form.chat-composer .composer-enviar").first().click()
}

/** Milliseconds until the message appears, or -1. */
export async function ouviu(page, frase, timeout = 60_000) {
  const inicio = Date.now()
  return page
    .getByText(frase, { exact: false })
    .first()
    .waitFor({ timeout })
    .then(() => Date.now() - inicio, () => -1)
}

export async function criarCanal(page, nome) {
  // On the phone the "+" lives on the Communities list, under any pushed conversation.
  await irPara(page, "comunidades").catch(() => {})
  await page.getByRole("button", { name: "Criar canal" }).first().click()
  await page.locator("form.prompt input").first().fill(nome)
  await page.locator("form.prompt button.primary").first().click()
  // Since 1.3.20 the top bar's heading is the room ("geral"), and the channel's
  // name sits beside it (`.topbar-comunidade`); before, the heading was the channel.
  const exacto = new RegExp(`^${nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
  await page.locator("h1, .topbar-comunidade").filter({ hasText: exacto }).first().waitFor({ timeout: 30_000 })
}

export async function abrirCanal(page, nome) {
  // On the phone: the Communities tab, the face on the rail, then the community line pushes the conversation.
  await abrirComunidade(page, nome)
}

export async function temCanal(page, nome, timeout = 90_000) {
  // The sidebar line, or on a phone the rail face (the sidebar lists only the chosen community there).
  return temComunidade(page, nome, timeout)
}

/** Join the voice room "voz" in the open channel (`Session.SALAS_INICIAIS`). */
export async function entrarNaVoz(page) {
  const voz = page
    .locator(".room-row button.room")
    .filter({ has: page.locator(".room-name", { hasText: "voz" }) })
    .first()
  if (!(await voz.isVisible({ timeout: 10_000 }).catch(() => false))) return false
  await voz.click()
  return true
}

/** Network and console logs from a Playwright context, for diagnostics. */
export function escutar(alvo, saco, rotulo) {
  const ligarPagina = (page) => {
    page.on("websocket", (ws) => {
      ws.on("framesent", (t) => saco.push(`${rotulo} TRAMA> ${typeof t.payload === "string" ? t.payload.slice(0, 400) : "(binário)"}`))
      ws.on("framereceived", (t) => saco.push(`${rotulo} TRAMA< ${typeof t.payload === "string" ? t.payload.slice(0, 400) : "(binário)"}`))
    })
    page.on("console", (m) => saco.push(`${rotulo} CONSOLA ${m.type()} ${m.text().slice(0, 400)}`))
    page.on("pageerror", (e) => saco.push(`${rotulo} PAGEERROR ${e.message}`))
  }
  if (typeof alvo.on === "function" && typeof alvo.pages === "function") {
    alvo.on("page", ligarPagina)
    for (const p of alvo.pages()) ligarPagina(p)
  } else ligarPagina(alvo)
}

/**
 * The gate of an app without an account, ready (21/11/2026): "Bem-vindo ao
 * Orwell" with the three ways in, or the "Criar conta" form already open.
 */
export async function portaoPronto(page, timeout = 60_000) {
  const entrada = page.getByRole("heading", { name: "Bem-vindo ao Orwell" })
  const nome = page.locator('.gate input[autocomplete="nickname"]')
  await entrada.or(nome).first().waitFor({ timeout })
}

/** From the gate to the "Criar conta" form. */
export async function irParaONome(page, timeout = 60_000) {
  await portaoPronto(page, timeout)
  const entrada = page.getByRole("heading", { name: "Bem-vindo ao Orwell" })
  if (await entrada.count()) await page.getByRole("button", { name: "Criar conta", exact: true }).click()
  await page.locator('.gate input[autocomplete="nickname"]').waitFor({ timeout })
}

/** From the gate to "Entrar com o ficheiro da conta". */
export async function irParaOFicheiro(page, timeout = 60_000) {
  await portaoPronto(page, timeout)
  await page.getByRole("button", { name: "Entrar com o ficheiro da conta" }).click()
  await page.locator('input[name="import-password"]').waitFor({ timeout })
}

/** From the gate to "Entrar com outro aparelho". */
export async function irParaEmparelhar(page, timeout = 60_000) {
  await portaoPronto(page, timeout)
  await page.getByRole("button", { name: "Entrar com outro aparelho" }).click()
}

/**
 * "Entrar com o ficheiro da conta": the file and the password, then "Entrar".
 * `escolherNaSecretaria` is for the installed app, where the main process opens
 * the system dialog: pass a function that answers it with the path.
 */
export async function importarFicheiro(page, ficheiro, frase, { timeout = 60_000, escolherNaSecretaria = null } = {}) {
  await irParaOFicheiro(page, timeout)
  if (escolherNaSecretaria) {
    await escolherNaSecretaria(ficheiro)
    await page.locator(".entrada-largar").click()
  } else {
    await page.locator('.gate input[type="file"]').setInputFiles(ficheiro)
  }
  await page.locator(".entrada-ficheiro-escolhido").waitFor({ timeout })
  await page.locator('input[name="import-password"]').fill(frase)
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
}
