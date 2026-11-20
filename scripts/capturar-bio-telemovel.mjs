/**
 * The profile bio on a phone, measured and photographed.
 *
 *   node scripts/capturar-bio-telemovel.mjs [--rotulo antes|depois]     (needs `npm run build` first)
 *
 * Reported (12/11/2026): "the bio on the phone is badly formatted: on my iPhone
 * 13 it shows in a column with a lot of empty space on the left". This opens,
 * in Playwright's WebKit with the "iPhone 13" device (390x844, DPR 3) and at
 * 1280 px, two screens with a bio: the person's page (someone else, a core
 * account in Node) and the own profile ("Eu"). Four bios: short, long, with
 * line breaks, and with one very long word or URL.
 *
 * Measured, not just photographed: the bio's left edge against the left edge
 * of the name, its width against the width the column has, and whether
 * anything overflows. Screenshots in `capturas/bio-<rotulo>-*.png`.
 *
 * ALL LOCAL AND ALL DISPOSABLE: `frente-lenta.mjs` (link left fast), ports
 * 8502/8503 or E2E_PORTA_DA_FRENTE / E2E_PORTA_DO_SERVIDOR.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { Session, Vault } from "@enclave/client-core"
import { devices, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { levantarServidor } from "./frente-lenta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const CAPTURAS = join(RAIZ, "capturas")
const i = process.argv.indexOf("--rotulo")
const ROTULO = i >= 0 ? process.argv[i + 1] : "agora"
const FRASE = "frase-de-verificacao-2026"
const BIOS = {
  curta: "Fotografo a planície.",
  longa:
    "Fotografo a planície há vinte anos, sobretudo os campos e o montado ao fim da tarde, quando a luz baixa e as sombras dos sobreiros se alongam sobre a terra. Escrevo sobre o que vejo e guardo tudo em papel.",
  quebras: "Fotografia.\nEscrita.\n\nNo interior, junto ao rio.\nResposta em dois dias.",
  palavra: "https://exemplo.pt/um/caminho/muito/comprido/sem/espacos/nenhuns/que/nao/cabe/numa/linha/de/telemovel e Supercalifragilisticexpialidociousmentequenãocabe",
}

const resultados = []
function check(nome, ok, detalhe = "") {
  resultados.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

const casa = await levantarServidor({
  dist: join(RAIZ, "apps/web/dist"),
  portaDaFrente: Number(process.env.E2E_PORTA_DA_FRENTE ?? 8502),
  portaDoServidor: Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8503),
  prefixo: "orwell-capturar-bio-",
})

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

/** Where the bio sits, against the name above it and the column around it. */
async function medir(page, seletorDoNome) {
  return page.evaluate((seletor) => {
    const bio = document.querySelector(".profile-bio")
    const nome = document.querySelector(seletor)
    if (!bio || !nome) return null
    const b = bio.getBoundingClientRect()
    const n = nome.getBoundingClientRect()
    const coluna = bio.parentElement.getBoundingClientRect()
    const cabeca = bio.closest(".profile-head, .pessoa-cabeca")
    const estilo = getComputedStyle(bio)
    return {
      esquerdaBio: Math.round(b.left),
      esquerdaNome: Math.round(n.left),
      larguraBio: Math.round(b.width),
      larguraColuna: Math.round(coluna.width),
      larguraCabeca: cabeca ? Math.round(cabeca.getBoundingClientRect().width) : 0,
      ecra: window.innerWidth,
      transborda: bio.scrollWidth > bio.clientWidth + 1 || b.right > window.innerWidth + 1,
      quebras: estilo.whiteSpace,
      alinhamento: estilo.textAlign,
    }
  }, seletorDoNome)
}

let browser
const contas = []
try {
  const base = () => new DatabaseSync(casa.base, { readOnly: true })
  browser = await webkit.launch({ headless: true })
  mkdirSync(CAPTURAS, { recursive: true })

  // The other person: a Node account whose bio changes per case.
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-de-teste-do-no")
  const bruno = new Session(vault)
  const idBruno = await bruno.createIdentity(casa.nome)
  await bruno.connect()
  contas.push(bruno)

  for (const [largura, perfil] of [
    ["390", devices["iPhone 13"]],
    ["1280", { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }],
  ]) {
    const ctx = await browser.newContext({ ...perfil, locale: "pt-PT" })
    const page = await ctx.newPage()
    await page.goto(casa.app, { waitUntil: "domcontentloaded" })
    await criarConta(page, { nome: `Ana ${largura}`, frase: FRASE, servidor: casa.nome })
    await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })
    for (const [caso, bio] of Object.entries(BIOS)) {
      await bruno.updateProfile({ displayName: "Bruno", donations: [], bio })
      // The person's page: Friends, Find, the address, Open profile.
      await page.getByRole("button", { name: "Amigos", exact: true }).first().click()
      await page.locator(".people-tabs").getByRole("button", { name: "Encontrar" }).click()
      await page.getByLabel("Cola um link ou endereço").fill(idBruno.address)
      await page.getByRole("button", { name: "Abrir perfil" }).click()
      await page.locator(".profile-bio").first().waitFor({ timeout: 30_000 }).catch(() => {})
      await page.waitForTimeout(300)
      const naPessoa = await medir(page, ".pessoa-factos h1, .person-profile h1, .person-profile h2")
      await page.screenshot({ path: join(CAPTURAS, `bio-${ROTULO}-pessoa-${caso}-${largura}.png`), fullPage: false })
      if (naPessoa) {
        const larguraOk = naPessoa.larguraBio >= naPessoa.larguraColuna - 2
        check(`pessoa, bio ${caso}, ${largura} px: ocupa a coluna, não transborda`, larguraOk && !naPessoa.transborda && naPessoa.quebras === "pre-wrap", JSON.stringify(naPessoa))
      } else check(`pessoa, bio ${caso}, ${largura} px: a bio aparece`, false)
      await page.keyboard.press("Escape").catch(() => {})
    }

    // The own profile ("Eu"), with each bio set in the editor.
    for (const [caso, bio] of Object.entries(BIOS)) {
      await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
      await page.getByRole("button", { name: "Conta", exact: true }).first().click()
      await page.getByRole("button", { name: "Editar perfil" }).first().click()
      const folha = page.locator(".sheet").first()
      await folha.waitFor({ timeout: 15_000 })
      await folha.getByLabel("Biografia").fill(bio)
      await folha.locator("button.primary").first().click()
      await folha.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {})
      await page.keyboard.press("Escape").catch(() => {})
      await page.getByRole("button", { name: "Eu", exact: true }).first().click()
      await page.locator(".profile-bio").first().waitFor({ timeout: 15_000 })
      await page.waitForTimeout(300)
      const meu = await medir(page, ".profile-name-row h2, .profile-facts h1, .profile-facts h2")
      await page.screenshot({ path: join(CAPTURAS, `bio-${ROTULO}-eu-${caso}-${largura}.png`), fullPage: false })
      if (meu) {
        const encostada = meu.esquerdaBio <= meu.esquerdaNome + 1
        // On the phone the bio spans the whole profile head (the rail takes the left of the screen).
        const estreita = largura === "390" ? meu.larguraBio >= meu.larguraCabeca - 1 : true
        check(`eu, bio ${caso}, ${largura} px: alinhada com o nome, com a largura do ecrã, sem transbordar`, encostada && estreita && !meu.transborda && meu.quebras === "pre-wrap", JSON.stringify(meu))
      } else check(`eu, bio ${caso}, ${largura} px: a bio aparece`, false)
    }
    await ctx.close()
  }
  void base
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}
for (const s of contas) s.disconnect()
await browser?.close().catch(() => {})
casa.fechar()
console.log(`\n${resultados.filter(Boolean).length}/${resultados.length} verificações passaram (capturas em ${CAPTURAS}/bio-${ROTULO}-*.png)`)
process.exit(resultados.every(Boolean) ? 0 : 1)
