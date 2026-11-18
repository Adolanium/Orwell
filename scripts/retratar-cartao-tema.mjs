/**
 * The account card (`CartaoDaConta`) in both themes, out of a call and in one,
 * in a real layout engine.
 *
 * Built like `retratar-painel-de-controlo.mjs`: the true card in a true
 * `aside.sidebar`, with the true stylesheet, at 1280 px. It can draw any copy
 * of `packages/ui/src` (a `git archive` of another version, say), so two
 * versions can be put side by side:
 *
 *   node scripts/retratar-cartao-tema.mjs --ui <dir with styles.css> --saida <dir> --nome <prefix> [--temas escuro,claro]
 *
 * Saves `<prefix>-<tema>-<fora|chamada>.png` and `<prefix>-estilos.json` (the
 * computed colours of every element in the card, for diffing two versions).
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")

const arg = (nome, omissao) => {
  const i = process.argv.indexOf(`--${nome}`)
  return i > 0 ? process.argv[i + 1] : omissao
}
const UI_DIR = resolve(arg("ui", join(RAIZ, "packages/ui/src")))
const SAIDA = resolve(arg("saida", join(RAIZ, "capturas/tema-claro/cartao")))
const NOME = arg("nome", "cartao")
const TEMAS = arg("temas", "escuro,claro").split(",")
const TRABALHO = join(AQUI, `.saida-cartao-tema-${NOME}`)
const UI = (caminho) => JSON.stringify(join(UI_DIR, caminho))

mkdirSync(SAIDA, { recursive: true })
mkdirSync(TRABALHO, { recursive: true })

const ENTRADA = join(TRABALHO, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { CartaoDaConta } from ${UI("screens/profile/CartaoDaConta.js")}
import { CallDock } from ${UI("screens/call/CallDock.js")}
import ${UI("styles.css")}

const emChamada = new URLSearchParams(location.search).get("chamada") === "1"
const pessoas = [
  { address: "@ana:s", connected: true, stream: null },
  { address: "@rui:s", connected: true, stream: null },
]

function Demo() {
  const caixa = (
    <CallDock
      variante="lateral"
      comAudio={false}
      channel="!nexo:s"
      channelLabel="nexo"
      roomLabel="Sala das reuniões"
      latencia={{ ms: 12, ate: "servidor" }}
      participants={pessoas}
      localStream={null}
      nameFor={(quem) => quem}
      onBack={() => {}}
      onLeave={() => {}}
    />
  )
  return (
    <div className="app">
      <nav className="rail" />
      <aside className="sidebar open">
        <div className="sidebar-header">Comunidades</div>
        <div className="sidebar-body" />
        <CartaoDaConta
          profile={{ displayName: "Vesna", statusText: "Em reunião até às 18h", donations: [] }}
          address="@vesna:s"
          activity="online"
          ligacao="online"
          onActivityMenu={() => {}}
          onEditProfile={() => {}}
          onNotifications={() => {}}
          unreadNotifications={3}
          micMuted={false}
          soundOff={false}
          onToggleMic={() => {}}
          onToggleSound={() => {}}
          onMicMenu={() => {}}
          onSoundMenu={() => {}}
          onAbrirDefinicoes={() => {}}
          latencia={{ ms: 12, ate: "servidor" }}
          onLatenciaHover={() => {}}
          onSaveStatus={() => {}}
          emChamada={emChamada}
          chamada={emChamada ? { caixa, onSair: () => {} } : null}
        />
      </aside>
      <main className="main" />
    </div>
  )
}

createRoot(document.getElementById("raiz")).render(<Demo />)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(TRABALHO, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".json": "json", ".woff2": "file" },
  external: ["@sapphi-red/*"],
  nodePaths: [join(RAIZ, "node_modules")],
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(TRABALHO, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="pagina.css"><body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const estilos = {}
for (const tema of TEMAS) {
  for (const chamada of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const erros = []
    page.on("pageerror", (e) => erros.push(String(e)))
    await page.goto(`file://${join(TRABALHO, "index.html")}?chamada=${chamada ? 1 : 0}`)
    await page.waitForSelector(".me-faixa", { timeout: 10_000 })
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t
    }, tema)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(400)
    if (erros.length) console.log(`ERROS ${tema}/${chamada}: ${erros.join(" | ")}`)
    const chave = `${tema}-${chamada ? "chamada" : "fora"}`
    estilos[chave] = await page.evaluate(() => {
      const fora = {}
      const raiz = document.querySelector(".me-faixa")
      for (const [i, el] of [raiz, ...raiz.querySelectorAll("*")].entries()) {
        const s = getComputedStyle(el)
        const nome = `${i}:${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`
        fora[nome] = {
          color: s.color,
          background: `${s.backgroundColor} ${s.backgroundImage}`,
          border: `${s.borderTopColor} ${s.borderTopWidth} / ${s.borderRightColor} ${s.borderBottomColor}`,
          shadow: s.boxShadow,
          fill: s.fill,
          filter: s.filter,
        }
      }
      return fora
    })
    const caixa = await page.locator(".me-faixa").boundingBox()
    const coluna = await page.locator(".sidebar").boundingBox()
    // The card with some of the column above it, for the surface it sits on.
    await page.screenshot({
      path: join(SAIDA, `${NOME}-${chave}.png`),
      clip: { x: coluna.x, y: Math.max(0, caixa.y - 60), width: coluna.width, height: caixa.height + 60 },
    })
    await ctx.close()
  }
}
await browser.close()
writeFileSync(join(SAIDA, `${NOME}-estilos.json`), JSON.stringify(estilos, null, 1))
console.log(`capturas em ${SAIDA}`)
