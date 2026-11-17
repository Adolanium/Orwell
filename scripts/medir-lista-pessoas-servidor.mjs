/**
 * The "+X people on this server" list, measured in real layout engines.
 *
 *   node scripts/medir-lista-pessoas-servidor.mjs --rotulo antes|depois
 *
 * Defect of 1.3.16: in a big channel (more than 50 members), opening the
 * windowed list of offline people drew the rows stacked on top of each other.
 * jsdom applies no stylesheet, so only a browser can see it. This mounts the
 * real `MemberPanel` with the real stylesheet and 400 offline members (names
 * from 2 to 60 characters, some with a status line, some with a role, photos
 * of different intrinsic sizes), in Chromium and WebKit, at 1440 and 390 px,
 * at 1x, 1.25x and 1.5x, with normal and reduced motion, in both densities,
 * and checks:
 *
 * - no errors on the page;
 * - every drawn row is exactly `ALTURA_DA_LINHA` (44 px) tall and its content
 *   is not clipped (the button fits in the row);
 * - no two rows overlap (`getBoundingClientRect`, no intersection), at the
 *   top, after scrolling to the middle and after scrolling to the end;
 * - the rows sit where the spacers say: row i starts at i * 44 px inside the
 *   scroll box;
 * - the list opens with 400 people in under 150 ms (click to the next frame).
 *
 * Records screenshots in `capturas/lista-pessoas-servidor-<rotulo>-*.png`.
 * All local, no server: the panel is mounted alone from a file:// page.
 */
import { build } from "esbuild"
import { chromium, webkit } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const SAIDA = join(AQUI, ".saida-lista-pessoas-servidor")
const CAPTURAS = join(RAIZ, "capturas")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))
const argumentos = process.argv.slice(2)
const ROTULO = argumentos.includes("--rotulo") ? argumentos[argumentos.indexOf("--rotulo") + 1] : "depois"
const ALTURA_DA_LINHA = 44
const LIMITE_MS = 150

mkdirSync(SAIDA, { recursive: true })
mkdirSync(CAPTURAS, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { MemberPanel } from ${UI("screens/chat/MemberPanel.js")}
import { ToastContext } from ${UI("components/Toast.js")}
import { arrancarLingua } from ${UI("strings.js")}
import ${UI("styles.css")}

// The host does this on startup; with no saved choice the app opens in English.
arrancarLingua()

const p = new URLSearchParams(location.search)
const estreito = p.get("estreito") === "1"
if (p.get("densidade")) document.documentElement.dataset.density = p.get("densidade")
const noop = () => {}

/* Photos of different intrinsic sizes, as SVG data URLs: 16, 64, 300, 1200 px. */
const foto = (lado, cor) =>
  "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + lado + '" height="' + Math.round(lado * 1.4) + '"><rect width="100%" height="100%" fill="' + cor + '"/></svg>')
const LADOS = [16, 64, 300, 1200]
const CORES = ["#c0392b", "#2980b9", "#27ae60", "#8e44ad", "#d35400"]
const silaba = ["ma", "ri", "a", "jo", "se", "fer", "nan", "des", "lu", "ci", "o", "bel", "tra"]
const nomeDe = (i) => {
  const tamanho = 2 + ((i * 37) % 59)
  let s = ""
  for (let k = 0; s.length < tamanho; k++) s += silaba[(i + k * 7) % silaba.length] + (k % 3 === 2 ? " " : "")
  return s.slice(0, tamanho).trim().replace(/^./, (c) => c.toUpperCase())
}
const LIGADOS = 10
const TOTAL = 410
const membros = Array.from({ length: TOTAL }, (_, i) => "@p" + String(i).padStart(3, "0") + ":orwell.test")
const directory = new Map(
  membros.map((a, i) => [a, {
    displayName: nomeDe(i),
    donations: [],
    ...(i % 3 === 0 ? { avatarDataUrl: foto(LADOS[i % LADOS.length], CORES[i % CORES.length]) } : {}),
    ...(i % 5 === 0 ? { statusText: "a status line that is long enough to scroll like a news ticker " + i } : {}),
  }]),
)
const cargos = { 7: { label: "Moderator", tint: "#e67e22" }, 21: { label: "Admin", tint: "#3498db" } }

function Demo() {
  return (
    <ToastContext.Provider value={noop}>
      <div className="app">
        <div className="rail" />
        <main className="main" />
        <MemberPanel
          channel="!geral:orwell.test"
          open={estreito}
          onClose={noop}
          members={membros}
          state="ready"
          onRetry={noop}
          me={null}
          directory={directory}
          nameFor={(a) => directory.get(a)?.displayName ?? a}
          onInvite={noop}
          onUserMenu={noop}
          onOpenProfile={noop}
          presenceFor={(a) => (membros.indexOf(a) < LIGADOS ? "active" : "idle")}
          roleFor={(a) => { const i = membros.indexOf(a); return i % 7 === 0 && cargos[i % 28 === 0 ? 7 : 21] ? { ...cargos[i % 28 === 0 ? 7 : 21], power: 50 } : null }}
        />
      </div>
    </ToastContext.Provider>
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
  // This worktree's own packages, not the dist of whatever checkout owns node_modules.
  alias: Object.fromEntries(
    ["protocol", "client-core", "crypto"].map((p) => [`@enclave/${p}`, join(RAIZ, "packages", p, "src/index.ts")]),
  ),
  format: "iife",
  logLevel: "error",
})
writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="pagina.css"><body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? `: ${detalhe}` : ""}`)
}

/** The drawn rows of the window, measured. */
const medirLinhas = (page) =>
  page.evaluate((altura) => {
    const caixa = document.querySelector(".member-janela")
    if (!caixa) return { erro: "no .member-janela" }
    const c = caixa.getBoundingClientRect()
    const filhos = [...caixa.children]
    const linhas = filhos.filter((li) => !li.hasAttribute("aria-hidden"))
    const primeiroEspaco = filhos[0]?.hasAttribute("aria-hidden") ? filhos[0].getBoundingClientRect().height : 0
    const caixas = linhas.map((li) => {
      const r = li.getBoundingClientRect()
      const botao = li.querySelector(".member-row")?.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, botaoH: botao?.height ?? 0 }
    })
    // Both the rows and what they draw (the button): a squeezed row with
    // overflowing content overlaps its neighbours even when the li boxes do not.
    const botoes = linhas.map((li) => li.querySelector(".member-row")?.getBoundingClientRect()).filter(Boolean)
    const sobrepostas = []
    for (const lista of [caixas, botoes])
      for (let i = 0; i < lista.length; i++)
        for (let j = i + 1; j < lista.length; j++) {
          const a = lista[i], b = lista[j]
          // Shared edges are not overlap; a hundredth of a pixel covers rounding.
          const corta = a.top < b.bottom - 0.01 && b.top < a.bottom - 0.01 && a.left < b.right && b.left < a.right
          if (corta) sobrepostas.push([i, j])
        }
    const alturasErradas = caixas.filter((r) => Math.abs(r.h - altura) > 0.5).map((r) => r.h)
    const cortadas = caixas.filter((r) => r.botaoH > r.h + 0.5).length
    // Row i of the window must start where the spacer above ends, then every 44 px.
    const desvio = caixas.reduce((max, r, i) => {
      const esperado = c.top - caixa.scrollTop + primeiroEspaco + i * altura
      return Math.max(max, Math.abs(r.top - esperado))
    }, 0)
    return {
      n: caixas.length,
      sobrepostas: sobrepostas.length,
      alturasErradas: alturasErradas.slice(0, 5),
      nAlturasErradas: alturasErradas.length,
      cortadas,
      desvio,
      scrollHeight: caixa.scrollHeight,
      clientHeight: caixa.clientHeight,
    }
  }, ALTURA_DA_LINHA)

const MOTORES = { chromium, webkit }
for (const [nomeMotor, motor] of Object.entries(MOTORES)) {
  const browser = await motor.launch()
  try {
    for (const [largura, altura] of [[1440, 900], [390, 844]]) {
      for (const escala of [1, 1.25, 1.5]) {
        for (const movimento of ["normal", "reduzido"]) {
          for (const densidade of ["", "compacta"]) {
            // The full grid in Chromium; WebKit runs the corners that differ.
            if (nomeMotor === "webkit" && (movimento === "reduzido") !== (densidade === "compacta")) continue
            const ctx = await browser.newContext({
              viewport: { width: largura, height: altura },
              deviceScaleFactor: escala,
              reducedMotion: movimento === "reduzido" ? "reduce" : "no-preference",
              locale: "en-US",
            })
            const page = await ctx.newPage()
            const erros = []
            page.on("pageerror", (e) => erros.push(String(e)))
            const estreito = largura < 600
            await page.goto(`file://${join(SAIDA, "index.html")}?estreito=${estreito ? 1 : 0}${densidade ? `&densidade=${densidade}` : ""}`)
            await page.waitForSelector(".member-mais", { timeout: 10_000 })
            await page.waitForTimeout(150)
            const id = `${nomeMotor} ${largura} ${escala}x ${movimento}${densidade ? " compacta" : ""}`

            const texto = await page.textContent(".member-mais")
            check(`${id}: the line reads "+400 people on this server"`, texto?.trim() === "+400 people on this server", texto ?? "")

            // Click to the frame after the commit: what the person waits for.
            const ms = await page.evaluate(
              () =>
                new Promise((fim) => {
                  const botao = document.querySelector(".member-mais")
                  const t0 = performance.now()
                  botao.click()
                  const ver = () => (document.querySelector(".member-janela .member-row") ? requestAnimationFrame(() => fim(performance.now() - t0)) : requestAnimationFrame(ver))
                  ver()
                }),
            )
            check(`${id}: opens in < ${LIMITE_MS} ms`, ms < LIMITE_MS, `${ms.toFixed(1)} ms`)
            await page.waitForTimeout(200)

            for (const onde of ["topo", "meio", "fim"]) {
              await page.evaluate((o) => {
                const caixa = document.querySelector(".member-janela")
                if (!caixa) return
                caixa.scrollTop = o === "topo" ? 0 : o === "meio" ? (caixa.scrollHeight - caixa.clientHeight) / 2 : caixa.scrollHeight
                caixa.dispatchEvent(new Event("scroll"))
              }, onde)
              await page.waitForTimeout(120)
              const m = await medirLinhas(page)
              if (m.erro) {
                check(`${id} ${onde}: window drawn`, false, m.erro)
                continue
              }
              check(
                `${id} ${onde}: ${m.n} rows, none overlap, all ${ALTURA_DA_LINHA} px, none clipped, in place`,
                m.n > 0 && m.sobrepostas === 0 && m.nAlturasErradas === 0 && m.cortadas === 0 && m.desvio < 1,
                `overlaps=${m.sobrepostas} wrongHeights=${m.nAlturasErradas} ${JSON.stringify(m.alturasErradas)} clipped=${m.cortadas} offset=${m.desvio.toFixed(2)} scroll=${m.scrollHeight}/${m.clientHeight}`,
              )
              // One screenshot per engine and width, at 1x, normal motion, normal density.
              if (escala === 1 && movimento === "normal" && !densidade && onde !== "fim") {
                const alvo = page.locator(".members")
                await alvo.screenshot({ path: join(CAPTURAS, `lista-pessoas-servidor-${ROTULO}-${nomeMotor}-${largura}-${onde}.png`) })
              }
            }
            check(`${id}: no errors on the page`, erros.length === 0, erros.join(" | "))
            await ctx.close()
          }
        }
      }
    }
  } finally {
    await browser.close()
  }
}

const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas ? 1 : 0)
