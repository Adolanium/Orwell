/**
 * The call screen in both themes, in a real layout engine: the panel with its
 * chips (one speaking, one muted, one with camera), the minimal bar, and the
 * floating dock. Built like `medir-voz-visivel.mjs`, with a fake call engine.
 * It can draw any copy of `packages/ui/src`, to put two versions side by side.
 *
 *   node scripts/retratar-chamada-tema.mjs [--ui <dir>] [--saida <dir>] [--nome <prefix>] [--temas escuro,claro] [--larguras 1440,390] [--movimento reduce]
 *
 * Saves `<prefix>-<tema>-<largura>.png`.
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
const SAIDA = resolve(arg("saida", join(RAIZ, "capturas/tema-claro/chamada")))
const NOME = arg("nome", "chamada")
const TEMAS = arg("temas", "escuro,claro").split(",")
const LARGURAS = arg("larguras", "1440,390").split(",").map(Number)
const MOVIMENTO = arg("movimento", "no-preference")
const TRABALHO = join(AQUI, `.saida-chamada-tema-${NOME}`)
const UI = (caminho) => JSON.stringify(join(UI_DIR, caminho))

mkdirSync(SAIDA, { recursive: true })
mkdirSync(TRABALHO, { recursive: true })

const ENTRADA = join(TRABALHO, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { CallPanel } from ${UI("screens/call/CallPanel.js")}
import { CallDock } from ${UI("screens/call/CallDock.js")}
import ${UI("styles.css")}

const NOMES = { "@ana:s": "Ana", "@rui:s": "Rui", "@maria:s": "Maria", "@joao:s": "João" }
const motor = {
  setMuted() {}, setCameraOff() {}, active: false, tectoDePartilha: 6, podePartilharEcra: true,
  medirLimiteDeVideo: () => Promise.resolve(null),
  startScreenShare: () => Promise.resolve(false), stopScreenShare: () => Promise.resolve(),
}
const participantes = [
  { address: "@ana:s", connected: true, stream: null, video: false, encrypted: true, micMuted: false, screen: null },
  { address: "@rui:s", connected: true, stream: null, video: false, encrypted: true, micMuted: true, screen: null },
  { address: "@maria:s", connected: true, stream: null, video: false, encrypted: true, micMuted: false, screen: null },
  { address: "@joao:s", connected: false, stream: null, video: false, encrypted: true, micMuted: false, screen: null },
]

function Demo() {
  return (
    <div className="app sem-barra">
      <nav className="rail" />
      <main className="main">
        <CallPanel
          call={motor}
          channel="!lagar:s"
          participants={participantes}
          localStream={null}
          selfLabel="Eu"
          selfProfile={{ displayName: "Eu", donations: [] }}
          nameFor={(quem) => NOMES[quem] ?? quem}
          directory={new Map()}
          onToggleMic={() => {}}
          onToggleSound={() => {}}
          onLeave={() => {}}
        />
      </main>
      <CallDock
        channel="!lagar:s"
        channelLabel="Lagar do Zé"
        roomLabel="pátio"
        latencia={{ ms: 18, ate: "servidor" }}
        participants={participantes}
        localStream={null}
        nameFor={(quem) => NOMES[quem] ?? quem}
        onBack={() => {}}
        onLeave={() => {}}
      />
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
for (const tema of TEMAS) {
  for (const largura of LARGURAS) {
    const ctx = await browser.newContext({
      viewport: { width: largura, height: largura > 600 ? 860 : 844 },
      deviceScaleFactor: largura > 600 ? 1 : 2,
      reducedMotion: MOVIMENTO,
    })
    const page = await ctx.newPage()
    const erros = []
    page.on("pageerror", (e) => erros.push(String(e)))
    await page.goto(`file://${join(TRABALHO, "index.html")}`)
    await page.waitForSelector(".call-chip", { timeout: 10_000 })
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t
      // Ana speaks: the voice level the meter would write.
      const ana = [...document.querySelectorAll(".call-chip")].find((c) => c.textContent?.includes("Ana"))
      ana?.style.setProperty("--voz", "0.6")
    }, tema)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(500)
    if (erros.length) console.log(`ERROS ${tema}/${largura}: ${erros.join(" | ")}`)
    await page.screenshot({ path: join(SAIDA, `${NOME}-${tema}-${largura}.png`) })
    await ctx.close()
  }
}
await browser.close()
console.log(`capturas em ${SAIDA}`)
