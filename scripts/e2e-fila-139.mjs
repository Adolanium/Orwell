/**
 * The 1.3.9 queue on this branch, live in one run (12/11/2026): three accounts,
 * two engines.
 *
 *   npm run build && node scripts/e2e-fila-139.mjs
 *
 * Ana founds the channel (Chromium). Bruno gets the role "Transmissão" with
 * `transmitir` (another Chromium context). Carla is a plain member (Firefox).
 *  1. `transmitir`: in the call, Carla's screen button is grey (`aria-disabled`),
 *     the tip shows on focus and on tap (also at 390 px), a tap does not share;
 *     giving her the role frees the button without reload.
 *  2. Role notice: Bruno's bell says "Tens agora o cargo Transmissão em …".
 *  3. Bruno shares: he sees the thumbnail with "Parar", never the stage.
 *  4. Ana watches: the stage has the names in the top-left corner (capture 1280).
 *  5. Carla mutes: Ana's sidebar shows the mark next to Carla in under a second.
 *
 * Everything local and disposable, ports 8699 and 8700. Captures in
 * `.verify-data/prova-fila-139/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, entrarNaVoz, espera, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "estudio"
const CARGO = "Transmissão"
const DICA = "Neste canal, só alguns cargos podem partilhar o ecrã. Pede a um administrador do canal que te dê esta permissão."
const CAPTURAS = join(RAIZ, ".verify-data/prova-fila-139", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8699, servidor: 8700, sfu: 0, etiqueta: "fila-139" })
const browsers = []
const abertos = []
const registo = []
const ARGS_CHROMIUM = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--auto-select-desktop-capture-source=Entire screen",
  "--autoplay-policy=no-user-gesture-required",
]

async function abrir(motor, nome, browser = null) {
  const b =
    browser ??
    (await motor.launch(
      motor === firefox
        ? { headless: true, firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true } }
        : { headless: true, args: ARGS_CHROMIUM },
    ))
  if (!browser) browsers.push(b)
  const ctx = await b.newContext({
    locale: "pt-PT",
    viewport: { width: 1280, height: 860 },
    ...(motor === chromium ? { permissions: ["microphone", "camera"] } : {}),
  })
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser: b, ctx, page }
  abertos.push(aparelho)
  return aparelho
}

const botaoDeEcra = (page) => page.locator('.call-controls [data-ecra="1"]').first()

/** Close the toasts (the "no relay server" one sits over the call bar at 390 px). */
async function fecharAvisos(page) {
  for (const botao of await page.locator(".toast-dismiss").all()) await botao.click().catch(() => {})
}

async function semRolagem(page, rotulo) {
  const rola = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check(`${rotulo}: sem rolagem horizontal`, !rola)
}

/** The opacity of the tip (`::after`) of the grey button. */
const opacidadeDaDica = (page) =>
  page.evaluate(() => {
    const botao = document.querySelector('.call-controls [data-ecra="1"]')
    return botao ? Number(getComputedStyle(botao, "::after").opacity) : -1
  })

/** Where the tip box lands, measured by a clone with the same text and the same rules. */
const caixaDaDica = (page) =>
  page.evaluate(() => {
    const botao = document.querySelector('.call-controls [data-ecra="1"]')
    if (!botao) return null
    const estilo = getComputedStyle(botao, "::after")
    const sonda = document.createElement("div")
    sonda.textContent = botao.getAttribute("data-tip")
    for (const p of ["font-size", "padding", "max-width", "white-space", "width", "border"]) sonda.style.setProperty(p, estilo.getPropertyValue(p))
    sonda.style.position = "fixed"
    sonda.style.visibility = "hidden"
    document.body.append(sonda)
    const r = botao.getBoundingClientRect()
    const largura = sonda.getBoundingClientRect().width
    sonda.remove()
    const centro = r.left + r.width / 2
    return { esquerda: centro - largura / 2, direita: centro + largura / 2, janela: window.innerWidth }
  })

async function abaCargos(page) {
  await page.locator(".channel-list .channel-row").filter({ has: page.locator(".channel-name", { hasText: CANAL }) }).first().click({ button: "right" })
  await page.getByRole("menuitem", { name: /propriedades/i }).first().click()
  const folha = page.getByRole("dialog").first()
  await folha.getByRole("tab", { name: "Cargos", exact: true }).click()
  const painel = folha.getByRole("tabpanel", { name: "Cargos" })
  await painel.waitFor({ timeout: 15_000 })
  return { folha, painel }
}

async function darCargo(page, nome) {
  // The member list belongs to a text room: the voice room shows the stage instead.
  const linha = page.locator(".member-row").filter({ hasText: nome }).first()
  if (!(await linha.isVisible().catch(() => false))) await page.getByText("geral", { exact: true }).first().click()
  await linha.click()
  const interruptor = page.getByRole("switch", { name: CARGO }).first()
  await interruptor.waitFor({ timeout: 15_000 })
  if ((await interruptor.getAttribute("aria-checked")) !== "true") await interruptor.click()
  await ate(async () => (await interruptor.getAttribute("aria-checked")) === "true", 15_000)
  const ok = (await interruptor.getAttribute("aria-checked")) === "true"
  await page.getByRole("button", { name: "Voltar" }).first().click().catch(() => {})
  await page.keyboard.press("Escape").catch(() => {})
  return ok
}

try {
  // 0. Accounts, friendships, channel, invites.
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME, canalOficial: false })
  await dentro(ana.page)
  const bruno = await abrir(chromium, "bruno", ana.browser)
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME, canalOficial: false })
  await dentro(bruno.page)
  const carla = await abrir(firefox, "carla")
  await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME, canalOficial: false })
  await dentro(carla.page)
  const [enderecoAna, enderecoBruno, enderecoCarla] = contasDoServidor(srv.base)
  await pedirAmizade(bruno.page, enderecoAna)
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await pedirAmizade(carla.page, enderecoAna)
  check("a Ana aceita a amizade da Carla", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("a Ana convida a Carla", await convidar(ana.page, CANAL, enderecoCarla))
  check("o Bruno entra", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  check("a Carla entra", await aceitarConvite(carla.page, CANAL, { espera: 60_000 }))

  // The role, with `transmitir` ("partilhar o ecrã" in the permissions).
  await abrirCanal(ana.page, CANAL)
  {
    const { folha, painel } = await abaCargos(ana.page)
    await painel.getByRole("button", { name: "Novo cargo" }).click()
    await folha.getByLabel("Nome do cargo", { exact: true }).fill(CARGO)
    await folha.getByRole("tab", { name: "Permissões" }).click()
    await folha.getByRole("switch", { name: "partilhar o ecrã", exact: true }).click()
    await folha.getByRole("button", { name: "Criar cargo" }).click()
    await painel.getByText(CARGO).first().waitFor({ timeout: 15_000 })
    await ana.page.getByRole("button", { name: "Cancelar" }).first().click().catch(() => ana.page.keyboard.press("Escape"))
    await ana.page.keyboard.press("Escape").catch(() => {})
  }

  // 2. The role notice in Bruno's bell.
  await abrirCanal(bruno.page, CANAL)
  check("a Ana dá o cargo ao Bruno", await darCargo(ana.page, "Bruno"))
  {
    let texto = ""
    const viu = await ate(async () => {
      await bruno.page.locator(".me-bell").first().click()
      await bruno.page.locator(".notif-list").first().waitFor({ timeout: 5_000 }).catch(() => {})
      texto = await bruno.page.locator(".notif-list").first().innerText().catch(() => "")
      await bruno.page.keyboard.press("Escape")
      return /Tens agora o cargo Transmissão em/.test(texto)
    }, 60_000, 1500)
    check("item 2: o sino do Bruno diz que tem agora o cargo", viu >= 0, texto.replace(/\s+/g, " ").slice(0, 140))
  }

  // Everyone in the voice room.
  for (const p of [ana, bruno, carla]) {
    await abrirCanal(p.page, CANAL)
    check(`${p.nome} entra na voz`, await entrarNaVoz(p.page))
  }
  await espera(4000)

  // 1. Carla: the grey button, the tip on focus and on tap, no share.
  {
    const botao = botaoDeEcra(carla.page)
    await botao.waitFor({ timeout: 30_000 })
    check("item 1: o botão da Carla está cinzento (aria-disabled)", (await botao.getAttribute("aria-disabled")) === "true")
    check("item 1: e não está disabled", (await botao.getAttribute("disabled")) === null)
    check("item 1: a dica tem a frase", (await botao.getAttribute("data-tip")) === DICA)
    await botao.focus()
    await carla.page.keyboard.press("Tab").catch(() => {})
    await carla.page.keyboard.press("Shift+Tab").catch(() => {})
    await espera(600)
    check("item 1: a dica aparece ao focar com o teclado", (await opacidadeDaDica(carla.page)) > 0.9)
    await carla.page.setViewportSize({ width: 390, height: 844 })
    await espera(400)
    await fecharAvisos(carla.page)
    await carla.page.screenshot({ path: join(CAPTURAS, "carla-cinzento-390.png") })
    // Firefox headless never calls the aria-disabled button "stable" with the tip open
    // over it: a real mouse click at its place, without the actionability wait.
    // The bar shows on pointer movement: hover it first, then a real click at the button.
    await botaoDeEcra(carla.page).hover({ force: true }).catch(() => {})
    await espera(300)
    const caixaDoBotao = await botaoDeEcra(carla.page).boundingBox()
    if (caixaDoBotao) await carla.page.mouse.click(caixaDoBotao.x + caixaDoBotao.width / 2, caixaDoBotao.y + caixaDoBotao.height / 2)
    const aberta = await botaoDeEcra(carla.page).evaluate((b) => b.classList.contains("dica-aberta")).catch(() => false)
    console.log(`   dica-aberta depois do toque: ${aberta}`)
    await espera(300)
    check("item 1: tocar abre a dica", (await opacidadeDaDica(carla.page)) > 0.9)
    const caixa = await caixaDaDica(carla.page)
    check(
      "item 1: a 390 px a dica cabe no ecrã",
      caixa !== null && caixa.esquerda >= 0 && caixa.direita <= caixa.janela,
      JSON.stringify(caixa),
    )
    await semRolagem(carla.page, "item 1: a 390 px com a dica aberta")
    await carla.page.screenshot({ path: join(CAPTURAS, "carla-dica-390.png") })
    check("item 1: tocar não partilha", (await carla.page.locator(".call-minha-partilha").count()) === 0)
    await carla.page.setViewportSize({ width: 1280, height: 860 })
  }

  // 3. Bruno shares: thumbnail with "Parar", no stage.
  {
    const botao = botaoDeEcra(bruno.page)
    await fecharAvisos(bruno.page)
    await botao.waitFor({ timeout: 30_000 })
    check("item 1: o botão do Bruno (com o cargo) não está cinzento", (await botao.getAttribute("aria-disabled")) === null)
    await botao.click()
    const miniatura = await ate(() => bruno.page.locator(".call-minha-partilha").isVisible().catch(() => false), 30_000)
    check("item 3: o Bruno vê a miniatura da partilha", miniatura >= 0)
    check("item 3: com a frase e o Parar", (await bruno.page.getByText("Estás a partilhar o ecrã").count()) > 0 && (await bruno.page.getByRole("button", { name: "Parar", exact: true }).count()) > 0)
    check("item 3: e sem palco nem ecrã inteiro", (await bruno.page.locator(".call-palco").count()) === 0)
    await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-miniatura-1280.png") })
  }

  // 4. Ana watches: names in the top-left corner of the stage.
  {
    await fecharAvisos(ana.page)
    const ver = ana.page.getByRole("button", { name: /^Ver (o ecrã|a transmissão) de/ }).first()
    const temVer = await ver.isVisible({ timeout: 30_000 }).catch(() => false)
    check("item 4: a Ana tem o Ver do ecrã do Bruno", temVer)
    // The "Watch" card is not what is under test here: dispatched, without the actionability wait.
    if (temVer) await ver.dispatchEvent("click")
    const palco = ana.page.locator(".call-palco").first()
    const temPalco = await palco.waitFor({ timeout: 30_000 }).then(() => true, () => false)
    check("item 4: o palco abre para a Ana", temPalco)
    if (temPalco) {
      await palco.hover()
      await espera(500)
      const medida = await ana.page.evaluate(() => {
        const p = document.querySelector(".call-palco")?.getBoundingClientRect()
        const lista = document.querySelector(".call-palco-presentes")
        const l = lista?.getBoundingClientRect()
        const nomes = [...(lista?.querySelectorAll(".call-presente-nome") ?? [])].map((n) => n.textContent)
        const imagens = lista?.querySelectorAll("img, .avatar").length ?? -1
        return p && l ? { nomes, imagens, dx: l.left - p.left, dy: l.top - p.top, metade: l.bottom < p.top + p.height / 2 } : null
      })
      check("item 4: só nomes, sem avatares", medida !== null && medida.imagens === 0 && medida.nomes.includes("Bruno"), JSON.stringify(medida))
      check("item 4: no canto superior esquerdo, longe dos controlos de baixo", medida !== null && medida.dx < 20 && medida.dy < 20 && medida.metade)
      await ana.page.screenshot({ path: join(CAPTURAS, "ana-palco-nomes-1280.png") })
      await ana.page.mouse.move(5, 5)
      await espera(3600)
      const opacidade = await ana.page.evaluate(() => Number(getComputedStyle(document.querySelector(".call-palco-presentes")).opacity))
      check("item 4: esconde-se com o rato parado", opacidade < 0.1, String(opacidade))
    }
  }

  // 5. Carla mutes: the mark in Ana's sidebar within a second.
  {
    await fecharAvisos(carla.page)
    await carla.page.getByRole("button", { name: "Microfone ligado. Desligar microfone." }).first().click()
    const inicio = Date.now()
    // The name is built by `micOffOf(name)`: search the fixed part (a substring
    // match, so `strings.guioes.test.ts` can still watch it). Only Carla is muted.
    const marca = ana.page.getByRole("img", { name: "calou o próprio microfone" }).first()
    const viu = await marca.waitFor({ timeout: 10_000 }).then(() => true, () => false)
    const ms = Date.now() - inicio
    check("item 5: a marca de calado da Carla aparece na barra da Ana", viu, `${ms} ms`)
    check("item 5: em menos de 1 s", viu && ms < 1000, `${ms} ms`)
    await ana.page.screenshot({ path: join(CAPTURAS, "ana-barra-marcas-1280.png") })
  }

  // 1. Giving Carla the role frees her button without reload.
  check("a Ana dá o cargo à Carla", await darCargo(ana.page, "Carla"))
  const livre = await ate(async () => (await botaoDeEcra(carla.page).getAttribute("aria-disabled")) === null, 30_000)
  check("item 1: o botão da Carla fica livre sem recarregar", livre >= 0)
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of abertos) {
    const texto = await a.page.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
    console.log(`--- ${a.nome} mostra: "${texto.replace(/\s+/g, " ").slice(0, 500)}"`)
    await a.page.screenshot({ path: join(CAPTURAS, `falha-${a.nome}.png`) }).catch(() => {})
  }
}
for (const linha of registo.slice(-30)) console.log(linha)

for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
console.log(`\nCapturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
