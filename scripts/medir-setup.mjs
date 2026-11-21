/**
 * The Setup, measured in a real browser (October 27, 2026).
 *
 * The `Setup` tests run in jsdom, which does not apply CSS. This mounts the
 * real `Setup`, with the real stylesheet and a fake bridge, no server at all,
 * at 1280px and 390px, and walks the way in of 21/11/2026:
 *
 * - "Bem-vindo ao Orwell", then "Criar conta" (name and password in one form,
 *   no profile picture), then "Guarda o ficheiro da conta" and "Fazer mais tarde";
 * - no page scrolls horizontally, and every button, link and field is 44 px or more;
 * - the profile is saved with the name and no picture;
 * - no errors on the page.
 *
 * Saves a screenshot of each page to `scripts/.saida-setup/`.
 *
 *   node scripts/medir-setup.mjs
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-setup")
const RAIZ = join(AQUI, "..")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { BridgeContext } from ${UI("App.js")}
import { ToastProvider } from ${UI("components/Toast.js")}
import { Setup } from ${UI("screens/gate/Setup.js")}
import { definirLingua } from ${UI("strings.js")}
import ${UI("styles.css")}

// The interface speaks English until someone chooses (1.3.9): this measures the Portuguese.
definirLingua("pt")
window.perfisGuardados = []
const ponte = {
  vault: {
    status: async () => ({ exists: false, supportsOsProtection: false, protection: "passphrase" }),
    create: async () => ({ ok: true }),
    export: async () => ({ data: "{}" }),
  },
  identity: { create: async () => ({ address: "@abc:localhost:8448", accountId: "abc" }) },
  session: { connect: async () => ({ ok: true }) },
  profile: { set: async (perfil) => { window.perfisGuardados.push(perfil); return { ok: true } } },
}

function Demo() {
  return (
    <BridgeContext.Provider value={ponte}>
      <ToastProvider>
        <Setup onDone={(a) => { window.contaCriada = a }} onUnlockInstead={() => {}} onJoinInstead={() => {}} />
      </ToastProvider>
    </BridgeContext.Provider>
  )
}
createRoot(document.getElementById("raiz")).render(<Demo />)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".json": "json", ".woff2": "file" },
  external: ["@sapphi-red/*"],
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="pagina.css"><body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}

for (const [largura, altura] of [
  [1280, 860],
  [390, 844],
]) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}`)

  const semRolarDeLado = async (passo) => {
    const { doc, janela } = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      janela: window.innerWidth,
    }))
    check(`${largura} ${passo}: não rola na horizontal`, doc <= janela, `${doc} em ${janela}`)
    await page.screenshot({ path: join(SAIDA, `${passo}-${largura}.png`), fullPage: true })
  }

  /** Every button and link on screen is a 44 px target or more. */
  const alvos = async (passo) => {
    const pequenos = await page.evaluate(() =>
      [...document.querySelectorAll(".gate button, .gate a, .gate input:not([type=checkbox]):not(.sr-only)")]
        .filter((el) => el.getClientRects().length > 0 && !el.classList.contains("sr-only"))
        .map((el) => ({ texto: (el.textContent || el.getAttribute("name") || "").trim().slice(0, 30), altura: Math.round(el.getBoundingClientRect().height) }))
        .filter((a) => a.altura < 44),
    )
    check(`${largura} ${passo}: alvos de 44 px ou mais`, pequenos.length === 0, JSON.stringify(pequenos))
  }

  // 21/11/2026: the first screen has the three ways in, and "Criar conta" is one form.
  await page.getByRole("heading", { name: "Bem-vindo ao Orwell" }).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400) // the card fades in: capture it stopped
  await semRolarDeLado("1-entrada")
  await alvos("1-entrada")
  await page.getByRole("button", { name: "Criar conta", exact: true }).click()
  await page.locator('.gate input[autocomplete="nickname"]').fill("Vesna")
  await page.locator('input[name="new-password"]').fill("frase-comprida-o-suficiente")
  await page.locator('input[name="confirm-password"]').fill("frase-comprida-o-suficiente")
  await page.waitForTimeout(400)
  await semRolarDeLado("2-criar-conta")
  await alvos("2-criar-conta")
  check(`${largura} criar conta: sem pergunta de imagem de perfil`, (await page.locator('.gate input[type="file"]').count()) === 0)
  await page.locator(".gate form").getByRole("button", { name: "Criar conta", exact: true }).click()
  await page.getByRole("heading", { name: "Guarda o ficheiro da conta" }).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)
  await semRolarDeLado("3-guardar-o-ficheiro")
  await alvos("3-guardar-o-ficheiro")
  await page.getByRole("button", { name: "Fazer mais tarde" }).click()
  await page.waitForFunction(() => window.contaCriada, null, { timeout: 10_000 })
  const perfis = await page.evaluate(() => window.perfisGuardados)
  check(
    `${largura} conta: o perfil inicial leva o nome e nenhuma imagem`,
    perfis.length === 1 && perfis[0].displayName === "Vesna" && perfis[0].avatarDataUrl === undefined,
    JSON.stringify(perfis),
  )
  check(`${largura}: sem erros na página`, erros.length === 0, erros.join(" | "))
  await ctx.close()
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
