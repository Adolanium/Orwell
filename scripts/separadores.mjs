/**
 * Moving around the phone layout (option B, 20/11/2026) from a script.
 *
 * At 840 px or less the app has four tabs at the bottom (Comunidades,
 * Mensagens, Amigos, Tu), a 72 px rail of communities, and conversations
 * pushed full screen over their list. The old drawer ("Abrir o painel
 * lateral", `.rail-menu`) and the "Voltar às conversas" handle are not drawn
 * there any more. These helpers are what the scripts use in their place.
 *
 * On a computer (no `.app.telemovel`) every helper falls back to the rail
 * and the sidebar, so a script can call them at any width.
 */

const espera = (page, ms) => page.waitForTimeout(ms)

/** The app is in the phone layout. */
export async function noTelemovel(page) {
  return (await page.locator(".app.telemovel").count()) > 0
}

/** How many screens sit over the list (`data-profundidade`), 0 on a computer. */
export async function profundidade(page) {
  const valor = await page.locator(".app.telemovel").first().getAttribute("data-profundidade").catch(() => null)
  return Number(valor ?? 0)
}

/** The tab on screen (`data-separador`), or null on a computer. */
export async function separadorActual(page) {
  return page.locator(".app.telemovel").first().getAttribute("data-separador").catch(() => null)
}

/**
 * One screen back: the back arrow of the topmost pushed screen (members over a
 * conversation, a conversation over its list, a screen of "Tu"). The arrow
 * chosen is the one the finger would hit at its centre.
 */
export async function voltarUm(page) {
  const antes = await profundidade(page)
  if (antes === 0) return false
  const tocou = await page.evaluate(() => {
    const setas = [...document.querySelectorAll(".topbar-voltar")].filter((el) => {
      const caixa = el.getBoundingClientRect()
      if (caixa.width === 0 || caixa.height === 0) return false
      const ponto = document.elementFromPoint(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
      return ponto !== null && el.contains(ponto)
    })
    const seta = setas.at(-1)
    if (!seta) return false
    seta.click()
    return true
  })
  if (!tocou) await page.goBack().catch(() => {})
  await page.waitForFunction((n) => Number(document.querySelector(".app.telemovel")?.getAttribute("data-profundidade") ?? 0) < n, antes, { timeout: 5_000 }).catch(() => {})
  await espera(page, 350)
  return true
}

/** Back until the list of the open tab is on screen (the tabs are drawn). */
export async function voltarALista(page) {
  for (let i = 0; i < 4 && (await profundidade(page)) > 0; i++) await voltarUm(page)
}

const NOMES = { comunidades: "Comunidades", mensagens: "Mensagens", amigos: "Amigos", tu: "Tu" }

/**
 * Go to a tab and show its list. `separador` is "comunidades", "mensagens",
 * "amigos" or "tu". On a computer: the rail button of the same destination
 * (Mensagens and Amigos are both "Amigos" there; Tu is the profile).
 */
export async function irPara(page, separador) {
  if (!(await noTelemovel(page))) {
    const nome = separador === "comunidades" ? "Comunidades" : separador === "tu" ? "Eu" : "Amigos"
    await page.getByRole("button", { name: nome, exact: true }).first().click({ timeout: 5_000 }).catch(() => {})
    return
  }
  await voltarALista(page)
  if ((await separadorActual(page)) !== separador) {
    await page.locator(".separadores").getByRole("button", { name: NOMES[separador], exact: true }).click({ timeout: 5_000 })
    await page.waitForFunction((s) => document.querySelector(".app.telemovel")?.getAttribute("data-separador") === s, separador, { timeout: 5_000 }).catch(() => {})
  }
  await voltarALista(page)
  await espera(page, 250)
}

/**
 * Show the channels of one community (phone): the Communities list with that
 * face chosen on the rail. Nothing opens yet. `nome` is the community's name
 * as the rail says it (a part of it is enough).
 */
export async function escolherComunidade(page, nome, { timeout = 30_000 } = {}) {
  await irPara(page, "comunidades")
  if (!(await noTelemovel(page))) return
  const caras = page.locator(".carril-comunidade:not(.carril-nova)")
  // `nome` may be a RegExp (`/orwell/i`): match it against the face's label.
  const alvo =
    nome instanceof RegExp
      ? caras.nth(await indiceDaCara(caras, nome))
      : page.locator(`.carril-comunidade[aria-label*="${String(nome).replace(/"/g, '\\"')}"]`).first()
  if (await alvo.count()) {
    if ((await alvo.getAttribute("aria-current")) !== "true") await alvo.click({ timeout: 5_000 })
  } else if ((await caras.count()) === 1) {
    await caras.first().click({ timeout: 5_000 }).catch(() => {})
  }
  await page.locator(".sidebar .channel-name", { hasText: nome }).first().waitFor({ timeout }).catch(() => {})
}

/** The index of the first rail face whose label matches `padrao`, or a large number (no face). */
async function indiceDaCara(caras, padrao) {
  const nomes = await caras.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""))
  const i = nomes.findIndex((n) => padrao.test(n))
  return i < 0 ? 10_000 : i
}

/**
 * The community is in the account, visible or not: its line in the sidebar
 * (`title`), or on a phone its face on the rail (the sidebar there lists only
 * the chosen community). For "it arrived", not "it is on screen".
 */
export async function temComunidade(page, nome, timeout = 90_000) {
  return page
    .locator(`.channel-name[title="${nome}"], .carril-comunidade[aria-label="${nome}"]`)
    .first()
    .waitFor({ state: "attached", timeout })
    .then(() => true, () => false)
}

/** The names of the communities in the account: the sidebar lines, or the rail faces on a phone. */
export async function nomesDasComunidades(page) {
  if (await noTelemovel(page)) {
    return page.locator(".carril-comunidade:not(.carril-nova)").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""))
  }
  return page.locator(".channel-name").allInnerTexts().catch(() => [])
}

/**
 * Show the list where a channel row lives, at any width: on a phone the
 * Communities list with the community chosen; on a computer nothing to do
 * (the sidebar is a column). For a check that reads the list, not the chat.
 */
export async function mostrarLista(page, comunidade) {
  if (!(await noTelemovel(page))) return
  if (comunidade) await escolherComunidade(page, comunidade)
  else await irPara(page, "comunidades")
}

/**
 * Open a community's conversation full screen, as a tap on its line does.
 * At any width. Waits for the message box.
 */
export async function abrirComunidade(page, nome, { timeout = 60_000 } = {}) {
  if (await noTelemovel(page)) await escolherComunidade(page, nome)
  else await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  await page.locator(".channel-name", { hasText: nome }).first().click({ timeout })
  await page.locator('textarea[placeholder="Escreve uma mensagem"]').first().waitFor({ timeout: 30_000 })
}

/**
 * Back to the conversation of the open community after a look at its list
 * (phone): a tap on the community line pushes it again. On a computer the
 * conversation never left.
 */
export async function voltarAConversa(page) {
  if (!(await noTelemovel(page)) || (await profundidade(page)) > 0) return
  await page.locator(".sidebar .channel-row.current button.channel, .sidebar button.channel").first().click({ timeout: 5_000 }).catch(() => {})
  await page.locator(".ecra-empurrado").first().waitFor({ timeout: 5_000 }).catch(() => {})
}

/**
 * The list of direct conversations: the Messages tab on a phone, Friends on a
 * computer (where the list is the column at the left).
 */
export async function irParaDirectas(page) {
  if (await noTelemovel(page)) await irPara(page, "mensagens")
  else await page.getByRole("button", { name: "Amigos", exact: true }).first().click({ timeout: 5_000 })
}

/** Open a direct conversation (the first, or the one with `texto`). At any width. */
export async function abrirDirecta(page, texto, { timeout = 60_000 } = {}) {
  await irParaDirectas(page)
  let linha = page.locator(".direct-row button.direct-open")
  if (texto) linha = linha.filter({ hasText: texto })
  await linha.first().click({ timeout })
  await page.locator('textarea[placeholder="Escreve uma mensagem"]').first().waitFor({ timeout })
}

/** Open a screen of "Tu" (phone) or the same destination on a computer: "O teu perfil", "Feed", "Configurações". */
export async function abrirNoTu(page, entrada) {
  if (await noTelemovel(page)) {
    await irPara(page, "tu")
    await page.locator(".menu-do-tu-entrada", { hasText: entrada }).first().click({ timeout: 5_000 })
    await page.locator(".barra-do-telemovel").first().waitFor({ timeout: 5_000 }).catch(() => {})
    return
  }
  // On a computer the profile is the rail's "Eu".
  const nome = entrada === "O teu perfil" ? "Eu" : entrada
  await page.getByRole("button", { name: nome, exact: true }).first().click({ timeout: 5_000 })
}

/**
 * The app is open: the "Configurações" rail button on a computer, the bar of
 * tabs on a phone (the rail is not drawn there). The same sign as
 * `criarContaEEntrar` in `conta.mjs`.
 */
export function appAberta(page, timeout = 90_000) {
  return page
    .getByRole("button", { name: "Configurações", exact: true })
    .or(page.locator(".separadores"))
    .first()
    .waitFor({ timeout })
}

/**
 * The text of what is on screen: the pushed screen on a phone (the list under
 * it stays mounted, and its previews would answer for the conversation), the
 * whole page on a computer.
 */
export async function textoNoEcra(page) {
  if ((await noTelemovel(page)) && (await profundidade(page)) > 0) {
    return page.locator(".ecra-empurrado").last().innerText().catch(() => "")
  }
  return page.locator("body").innerText().catch(() => "")
}
