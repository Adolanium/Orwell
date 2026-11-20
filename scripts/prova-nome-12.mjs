/**
 * Display names of 12 characters at most, proved in the real app.
 *
 *   node scripts/prova-nome-12.mjs     (needs `npm run build` first)
 *
 * Since 17/11/2026 a display name is 12 characters at most. In Chromium, at
 * 1440 and at 390 px, this checks and photographs:
 *
 * - signup: a 30-character paste is cut to 12, with "Máximo 12 caracteres."
 *   and the counter; 12 compound emojis go in whole;
 * - Settings, "Editar perfil": the same field, the same cut;
 * - an old name: a Node account publishes a 30-character name, as a 1.3.7 to
 *   1.3.18 client could. The app does not refuse it: the member list and the
 *   message author show 12 graphemes and "…", with the whole name in the
 *   `title`, and "@albuq" in the composer still finds the person by the whole
 *   name, and the sent mention is drawn cut.
 *
 * Screenshots in `capturas/nome-12-*.png`. ALL LOCAL AND DISPOSABLE: ports
 * 8612/8613 or E2E_PORTA_DA_FRENTE / E2E_PORTA_DO_SERVIDOR. Only the browser
 * this launches is closed.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Session, Vault } from "@enclave/client-core"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { levantarServidor } from "./frente-lenta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const CAPTURAS = join(RAIZ, "capturas")
const FRASE = "frase-de-verificacao-2026"
const ANTIGO = "Maria Eduarda Albuquerque Sous"
const ANTIGO_VISIVEL = "Maria Eduard…"
const DOZE_EMOJIS = "👨‍👩‍👧‍👦🇵🇹👍🏽😀🎉❤️👨‍👩‍👧‍👦🇵🇹👍🏽😀🎉❤️"
const AVISO = "Máximo 12 caracteres."
const SEM_LATENCIA = { rttMs: 0, baixarBps: 1e9, subirBps: 1e9 }

const resultados = []
function check(nome, ok, detalhe = "") {
  resultados.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

class CofreEmMemoria {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(b) {
    this.bytes = b
  }
  async clear() {
    this.bytes = null
  }
}

mkdirSync(CAPTURAS, { recursive: true })
const casa = await levantarServidor({
  dist: join(RAIZ, "apps/web/dist"),
  portaDaFrente: Number(process.env.E2E_PORTA_DA_FRENTE ?? 8612),
  portaDoServidor: Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8613),
  prefixo: "orwell-prova-nome-12-",
  rede: SEM_LATENCIA,
})

let browser
let bruno
let paginaActual = null
try {
  // The old client: a Node account in the common room with a 30-character name.
  // The core refuses a NEW long name, so this writes the stored profile directly,
  // as a profile written before the limit already is.
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-de-teste-do-no")
  bruno = new Session(vault)
  await bruno.createIdentity(casa.nome)
  await bruno.connect()
  await bruno.escolherSalaComum(true)
  await bruno.vault.update((c) => {
    c.profile = { displayName: ANTIGO, donations: [], updatedAt: Date.now() }
  })
  check("o núcleo guarda e publica o nome antigo de 30", bruno.profile.displayName === ANTIGO)

  browser = await chromium.launch({ headless: true })
  for (const [largura, altura] of [
    [1440, 900],
    [390, 844],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: largura, height: altura }, locale: "pt-PT", deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    paginaActual = page
    const erros = []
    page.on("pageerror", (e) => erros.push(String(e)))
    await page.goto(casa.app, { waitUntil: "domcontentloaded" })

    // ---- signup
    const campo = page.getByPlaceholder("Como queres aparecer")
    const naoCriar = page.getByRole("button", { name: "Não, criar conta" })
    await campo.or(naoCriar).first().waitFor({ timeout: 60_000 })
    if (await naoCriar.count()) await naoCriar.click()
    await campo.fill(ANTIGO)
    check(`${largura}: registo, colar 30 corta para 12`, (await campo.inputValue()) === "Maria Eduard", await campo.inputValue())
    check(`${largura}: registo, a frase "${AVISO}"`, await page.getByText(AVISO).isVisible())
    const contador = (await page.locator(".contador-do-nome").first().textContent())?.trim()
    check(`${largura}: registo, o contador a 12 de 12`, contador === `${12}/${12}`, contador)
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(CAPTURAS, `nome-12-registo-cortado-${largura}.png`) })
    await campo.fill(DOZE_EMOJIS)
    check(`${largura}: registo, 12 emojis compostos entram inteiros`, (await campo.inputValue()) === DOZE_EMOJIS)
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(CAPTURAS, `nome-12-registo-emojis-${largura}.png`) })
    await campo.fill("")
    await criarConta(page, { nome: `Ana ${largura}`, frase: FRASE, servidor: casa.nome })
    await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })

    // ---- Settings, edit profile
    await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
    await page.getByRole("button", { name: "Conta", exact: true }).first().click()
    await page.getByRole("button", { name: "Editar perfil" }).first().click()
    const folha = page.locator(".sheet").first()
    await folha.waitFor({ timeout: 15_000 })
    const nomeNoPerfil = folha.getByPlaceholder("Como queres aparecer")
    await nomeNoPerfil.fill(`Ana ${largura} da Silva Albuquerque`)
    check(`${largura}: definições, colar longo corta para 12`, (await nomeNoPerfil.inputValue()) === `Ana ${largura} da S`.slice(0, 12), await nomeNoPerfil.inputValue())
    check(`${largura}: definições, a frase "${AVISO}"`, await folha.getByText(AVISO).isVisible())
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(CAPTURAS, `nome-12-definicoes-${largura}.png`) })
    await folha.locator("button.primary").first().click()
    await folha.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {})
    await page.keyboard.press("Escape").catch(() => {})

    // ---- the old name, read
    // The common room, as `abrirCanal` in `fase7-comum.mjs` opens a channel.
    await page.getByRole("button", { name: "Comunidades", exact: true }).first().click()
    const gaveta = page.getByRole("button", { name: "Abrir o painel lateral" })
    const linhaDaSala = page.locator(".channel-name", { hasText: "Orwell" }).first()
    if (!(await linhaDaSala.isVisible().catch(() => false)) && (await gaveta.getAttribute("aria-expanded").catch(() => null)) !== "true") {
      await gaveta.click().catch(() => {})
    }
    await linhaDaSala.click({ timeout: 90_000 })
    if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) === "true") await gaveta.click().catch(() => {})
    const caixa = page.locator('textarea[placeholder="Escreve uma mensagem"]').first()
    await caixa.waitFor({ timeout: 60_000 })
    // Bruno is the room's first member, and admits whoever arrives; then says something.
    const sala = bruno.commonRoom
    for (let i = 0; i < 60 && !(bruno.membersOf?.(sala) ?? []).length; i++) await page.waitForTimeout(500)
    await page.waitForTimeout(1500)
    await bruno.publishProfile([sala], true)
    await bruno.send(sala, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: `olá de ${largura}`, attachments: [], links: [], mentions: [] })
    const autor = page.locator(".message .author", { hasText: ANTIGO_VISIVEL }).first()
    await autor.waitFor({ timeout: 30_000 }).catch(() => {})
    check(`${largura}: mensagem, o autor aparece com 12 e "…"`, (await autor.textContent())?.includes(ANTIGO_VISIVEL))
    check(`${largura}: mensagem, o nome inteiro no title`, (await autor.locator(`[title="${ANTIGO}"]`).count()) > 0)

    if (largura < 600) await page.getByRole("button", { name: "Membros" }).first().click().catch(() => {})
    const linha = page.locator(".members .member-name", { hasText: ANTIGO_VISIVEL }).first()
    await linha.waitFor({ timeout: 30_000 }).catch(() => {})
    check(`${largura}: lista de membros, 12 e "…" com o inteiro no title`, (await linha.locator(`[title="${ANTIGO}"]`).count()) > 0)
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(CAPTURAS, `nome-12-membros-${largura}.png`) })
    if (largura < 600) await page.keyboard.press("Escape").catch(() => {})

    // The mention finds the person by the WHOLE name, and is drawn cut.
    await caixa.click()
    await caixa.pressSequentially("@albuq", { delay: 40 })
    const opcao = page.locator(".mention-picker .mention-option", { hasText: ANTIGO_VISIVEL }).first()
    await opcao.waitFor({ timeout: 10_000 }).catch(() => {})
    check(`${largura}: "@albuq" encontra a pessoa pelo nome inteiro`, (await opcao.count()) > 0)
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(CAPTURAS, `nome-12-mencao-procura-${largura}.png`) })
    await opcao.click().catch(() => {})
    await caixa.press("Enter")
    const mencao = page.locator(".message .mention", { hasText: ANTIGO_VISIVEL }).last()
    await mencao.waitFor({ timeout: 15_000 }).catch(() => {})
    check(`${largura}: a menção enviada aparece "@${ANTIGO_VISIVEL}" com o inteiro no title`, (await mencao.locator(`[title="${ANTIGO}"]`).count()) > 0)
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(CAPTURAS, `nome-12-mencao-enviada-${largura}.png`) })

    check(`${largura}: sem erros na página`, erros.length === 0, erros.join(" | "))
    await ctx.close()
  }
} catch (erro) {
  await paginaActual?.screenshot({ path: join(CAPTURAS, "nome-12-falhou.png") }).catch(() => {})
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}
bruno?.disconnect()
await browser?.close().catch(() => {})
casa.fechar()
console.log(`\n${resultados.filter(Boolean).length}/${resultados.length} verificações passaram (capturas em ${CAPTURAS}/nome-12-*.png)`)
process.exit(resultados.every(Boolean) ? 0 : 1)
