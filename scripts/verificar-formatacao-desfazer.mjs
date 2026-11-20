// The formatting keys and bar of the text box, in real browsers (20/11/2026).
//
// jsdom has no `execCommand`, no undo history, no layout and no selection on
// screen. What this measures needs all four:
//   - Ctrl/Cmd+B, I, E, Shift+X and Shift+H wrap the selection, and Ctrl/Cmd+Z
//     undoes the change in ONE step, back to the text and selection before it,
//     and redo puts it back. In Chromium, Firefox and WebKit.
//   - A button of the bar does the same, and is undone the same way.
//   - The bar shows over the selected line, inside the window, and goes when the
//     selection collapses. In Escuro, Claro and Aurora, at 1280 and 390 px.
//   - With a finger (a touch context, `hover: none` and `pointer: coarse`), there
//     is no bar.
//
// It renders the real `Composer` with a fake bridge, bundled with esbuild into
// `scripts/.saida-formatacao-desfazer/` (ignored by git). No server, no build.
//
//   node scripts/verificar-formatacao-desfazer.mjs
import { build } from "esbuild"
import { chromium, firefox, webkit } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-formatacao-desfazer")
const RAIZ = join(AQUI, "..")
mkdirSync(SAIDA, { recursive: true })

const ui = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

writeFileSync(
  join(SAIDA, "entrada.tsx"),
  `
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { Composer } from ${ui("screens/chat/Composer.js")}
import { BridgeContext } from ${ui("App.js")}
import ${ui("styles.css")}

const bridge = { social: { linkPreview: () => Promise.reject(new Error("não")) } }

function Conversa() {
  const [valor, setValor] = useState("")
  return (
    <BridgeContext.Provider value={bridge}>
      <div className="chat" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <div className="timeline" style={{ flex: 1, overflow: "auto" }} />
        <Composer connection="online" value={valor} onChange={setValor} onSend={() => setValor("")} />
      </div>
    </BridgeContext.Provider>
  )
}

createRoot(document.getElementById("raiz")).render(<Conversa />)
`,
  "utf8",
)

for (const [entrada, saida] of [
  ["entrada.tsx", "pagina.js"],
  [join(RAIZ, "packages/ui/src/styles-aurora.css"), "aurora.css"],
]) {
  await build({
    entryPoints: [entrada.startsWith("/") ? entrada : join(SAIDA, entrada)],
    bundle: true,
    outfile: join(SAIDA, saida),
    jsx: "automatic",
    loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".woff2": "file", ".png": "file", ".svg": "file", ".mp3": "file", ".ogg": "file" },
    format: "iife",
    define: { "process.env.NODE_ENV": '"development"' },
    // Vite's `?url` and `?worker` imports (audio, workers) are not used by the text box.
    plugins: [
      {
        name: "sem-vite",
        setup(construcao) {
          construcao.onResolve({ filter: /\?(url|worker|raw)$/ }, (pedido) => ({ path: pedido.path, namespace: "vazio" }))
          construcao.onLoad({ filter: /.*/, namespace: "vazio" }, () => ({ contents: 'export default ""', loader: "js" }))
        },
      },
    ],
    logLevel: "error",
  })
}

const pagina = (tema) =>
  `<!doctype html><html${tema === "escuro" ? "" : ` data-theme="${tema}"`}><meta charset="utf-8">` +
  `<link rel="stylesheet" href="pagina.css">${tema === "aurora" ? '<link rel="stylesheet" href="aurora.css">' : ""}` +
  `<body><div id="raiz"></div><script src="pagina.js"></script></body></html>`
for (const tema of ["escuro", "claro", "aurora"]) writeFileSync(join(SAIDA, `${tema}.html`), pagina(tema), "utf8")

const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? `: ${detalhe}` : ""}`)
}

/**
 * WebKit groups an `insertText` with the typing before it, in one undo step,
 * also with no React on the page (measured on a bare `<textarea>`, 20/11/2026).
 * One undo there takes the shortcut AND the typing, and redo puts both back.
 * That is the engine, not this code, so on WebKit an undo check is a note, not
 * a pass or a fail. Chromium (and so Electron) and Firefox keep the steps apart.
 */
let motorActual = ""
const checkDoDesfazer = (etiqueta, ok, detalhe = "") => {
  if (motorActual === "WebKit") console.log(`NOTA  ${etiqueta} (WebKit junta com a escrita)${detalhe ? `: ${detalhe}` : ""}`)
  else check(etiqueta, ok, detalhe)
}

const caixa = "form.chat-composer textarea"
const estado = (page) =>
  page.$eval(caixa, (c) => ({ texto: c.value, inicio: c.selectionStart, fim: c.selectionEnd }))
const marcar = (page, inicio, fim) =>
  page.$eval(
    caixa,
    (c, [i, f]) => {
      c.focus()
      c.setSelectionRange(i, f)
      c.dispatchEvent(new Event("select"))
    },
    [inicio, fim],
  )

// ------------------------------------------------------------- 1. undo, three engines
for (const [nome, motor] of [
  ["Chromium", chromium],
  ["Firefox", firefox],
  ["WebKit", webkit],
]) {
  motorActual = nome
  const browser = await motor.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const erros = []
  page.on("pageerror", (e) => erros.push(e.message))
  // A fresh page and typed text for each case: the undo history then holds the
  // typing and the shortcut, nothing else (`fill` would add its own entries).
  const comecar = async (texto) => {
    await page.goto(pathToFileURL(join(SAIDA, "escuro.html")).href)
    await page.waitForSelector(caixa)
    await page.click(caixa)
    await page.keyboard.type(texto)
  }
  // The app takes Ctrl and Cmd. Undo is the system's: Cmd on macOS, Ctrl elsewhere.
  const desfazer = "ControlOrMeta+z"
  const refazer = "ControlOrMeta+Shift+z"

  for (const [tecla, esperado] of [
    ["ControlOrMeta+b", "isto e **urgente** hoje"],
    ["ControlOrMeta+i", "isto e *urgente* hoje"],
    ["ControlOrMeta+e", "isto e `urgente` hoje"],
    ["ControlOrMeta+Shift+X", "isto e ~~urgente~~ hoje"],
    ["ControlOrMeta+Shift+H", "isto e ||urgente|| hoje"],
  ]) {
    await comecar("isto e urgente hoje")
    await marcar(page, 7, 14)
    await page.keyboard.press(tecla)
    const depois = await estado(page)
    check(`${nome}: ${tecla} envolve`, depois.texto === esperado && depois.texto.slice(depois.inicio, depois.fim) === "urgente", JSON.stringify(depois))
    await page.keyboard.press(desfazer)
    const desfeito = await estado(page)
    // One undo: the text before the shortcut, and the typing is still there.
    checkDoDesfazer(`${nome}: ${tecla}, depois um desfazer volta ao texto escrito`, desfeito.texto === "isto e urgente hoje", JSON.stringify(desfeito))
    await page.keyboard.press(refazer)
    const refeito = await estado(page)
    check(`${nome}: ${tecla}, e refazer põe o marcador de volta`, refeito.texto === esperado, JSON.stringify(refeito))
  }

  // Two shortcuts in a row: two undos, one at a time.
  await comecar("bom dia")
  await marcar(page, 4, 7)
  await page.keyboard.press("ControlOrMeta+b")
  await page.keyboard.press("ControlOrMeta+i")
  await page.keyboard.press(desfazer)
  const umPasso = await estado(page)
  checkDoDesfazer(`${nome}: dois atalhos, um desfazer tira só o último`, umPasso.texto === "bom **dia**", JSON.stringify(umPasso))
  await page.keyboard.press(desfazer)
  checkDoDesfazer(`${nome}: e o segundo desfazer tira o primeiro`, (await estado(page)).texto === "bom dia", (await estado(page)).texto)

  // Without a selection: the pair, and the cursor inside.
  await comecar("ola ")
  await page.keyboard.press("ControlOrMeta+b")
  await page.keyboard.type("x")
  check(`${nome}: sem selecção, o par abre e escreve-se lá dentro`, (await estado(page)).texto === "ola **x**", (await estado(page)).texto)

  // The bar's button, and undo after it.
  await comecar("isto e urgente hoje")
  await marcar(page, 7, 14)
  await page.waitForSelector('[role="toolbar"]')
  await page.click('[role="toolbar"] button[aria-label="Código"]')
  const botao = await estado(page)
  check(`${nome}: o botão Código envolve`, botao.texto === "isto e `urgente` hoje", JSON.stringify(botao))
  await page.keyboard.press(desfazer)
  checkDoDesfazer(`${nome}: e um desfazer tira-o`, (await estado(page)).texto === "isto e urgente hoje", (await estado(page)).texto)
  check(`${nome}: sem erros na página`, erros.length === 0, erros.join(" | "))
  await browser.close()
}

// ------------------------------------------------------------- 2. the bar, three themes, two widths
const browser = await chromium.launch()
for (const tema of ["escuro", "claro", "aurora"]) {
  for (const largura of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width: largura, height: 800 } })
    await page.goto(pathToFileURL(join(SAIDA, `${tema}.html`)).href)
    await page.waitForSelector(caixa)
    await page.fill(caixa, "primeira linha\nsegunda linha com a palavra urgente no meio\nterceira")
    // A double click on a word: the real gesture, with the mouse.
    const alvo = await page.$eval(caixa, (c) => {
      const r = c.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    })
    await page.focus(caixa)
    const inicio = "primeira linha\nsegunda linha com a palavra ".length
    await marcar(page, inicio, inicio + "urgente".length)
    const barra = await page.waitForSelector('[role="toolbar"]', { timeout: 3000 }).catch(() => null)
    check(`${tema} ${largura}: a barra aparece com texto marcado`, barra !== null)
    if (barra) {
      const m = await page.evaluate(() => {
        const b = document.querySelector('[role="toolbar"]').getBoundingClientRect()
        const c = document.querySelector("form.chat-composer textarea").getBoundingClientRect()
        const estilo = getComputedStyle(document.querySelector('[role="toolbar"] button'))
        return {
          esquerda: b.left,
          direita: b.right,
          topo: b.top,
          fundo: b.bottom,
          caixaTopo: c.top,
          caixaFundo: c.bottom,
          botoes: document.querySelectorAll('[role="toolbar"] button').length,
          botaoLargura: Math.round(parseFloat(estilo.width)),
          fundoDaBarra: getComputedStyle(document.querySelector('[role="toolbar"]')).backgroundColor,
          transborda: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })
      check(`${tema} ${largura}: dentro da janela`, m.esquerda >= 0 && m.direita <= largura && m.topo >= 0, JSON.stringify(m))
      // Over the second line, so its bottom is above the box's bottom and the bar does not cover the selected word.
      check(`${tema} ${largura}: por cima da linha marcada, não por cima da caixa toda`, m.fundo <= m.caixaFundo && m.fundo > m.caixaTopo - 60, JSON.stringify(m))
      check(`${tema} ${largura}: cinco botões de 30 px e fundo pintado`, m.botoes === 5 && m.botaoLargura === 30 && m.fundoDaBarra !== "rgba(0, 0, 0, 0)", JSON.stringify(m))
      check(`${tema} ${largura}: a página não ganha scroll de lado`, m.transborda <= 0, String(m.transborda))
      await page.screenshot({ path: join(SAIDA, `barra-${tema}-${largura}.png`), clip: { x: 0, y: Math.max(0, alvo.y - 80), width: largura, height: Math.min(800 - Math.max(0, alvo.y - 80), alvo.h + 120) } })
      // A click inside the text collapses the selection: the bar goes.
      // At the end of the last line: away from the bar, which sits over the first lines.
      await page.mouse.click(alvo.x + alvo.w - 12, alvo.y + alvo.h - 10)
      const foi = await page.waitForSelector('[role="toolbar"]', { state: "detached", timeout: 2000 }).then(() => true).catch(() => false)
      check(`${tema} ${largura}: some quando a selecção acaba`, foi)
    }
    await page.close()
  }
}

// ------------------------------------------------------------- 3. a finger: no bar
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.goto(pathToFileURL(join(SAIDA, "escuro.html")).href)
  await page.waitForSelector(caixa)
  await page.fill(caixa, "isto e urgente")
  await marcar(page, 7, 14)
  await page.waitForTimeout(300)
  check("com o dedo: não há barra", (await page.$('[role="toolbar"]')) === null)
  await ctx.close()
}
await browser.close()

const falhou = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhou}/${resultados.length} verificações passaram. Capturas em ${SAIDA}`)
process.exit(falhou === 0 ? 0 : 1)
