/**
 * The Windows splash screen, like Discord: a small frameless window with the
 * banner illustration, the name, a line of text, and a progress bar.
 *
 * No `electron` here. This file only defines what to show (the HTML and the
 * bit of code that updates the text and bar). `index.ts` opens the window.
 * This way text can be measured in a test, without a window.
 *
 * ## Why the page has no script
 *
 * The page policy is `script-src 'none'`. The text and bar change via
 * `webContents.executeJavaScript` with a snippet written here, with text
 * passed through `JSON.stringify`. Nothing from the network enters the screen
 * except the version, and that only arrives here after passing the validator
 * (three dot-separated numbers).
 */
import type { EstadoDoEcra } from "./actualizacao-windows.js"
import { ARTE_DO_ARRANQUE, FONTE_DO_ARRANQUE, TARJAS_DO_ARRANQUE } from "./arte-do-arranque.gen.js"
import { type LinguaDoAnfitriao, textosDoAnfitriao } from "./lingua-do-anfitriao.js"

/** Whole megabytes: the watcher wants to see the number move, not decimals. */
function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

/** The two lines and bar for each phase, in short sentences (STE100), in the app's language. */
export function textoDoArranque(
  estado: EstadoDoEcra,
  lingua: LinguaDoAnfitriao = "en",
): { titulo: string; detalhe: string; progresso: number | null } {
  const texto = textosDoAnfitriao(lingua).arranque
  switch (estado.fase) {
    case "a-procurar":
      return { titulo: texto.aProcurar, detalhe: "", progresso: null }
    case "a-descarregar": {
      const fraccao = estado.total > 0 ? Math.min(1, estado.recebidos / estado.total) : 0
      return {
        titulo: texto.aDescarregar(estado.versao),
        detalhe: texto.recebidos(mb(estado.recebidos), mb(estado.total)),
        progresso: fraccao,
      }
    }
    // Before the UAC window (installation to Program Files). No bar: the title
    // has two lines and takes its place.
    case "a-pedir-autorizacao":
      return { titulo: texto.aPedirAutorizacao(estado.versao), detalhe: texto.carregaEmSim, progresso: null }
    case "a-instalar":
      return { titulo: texto.aInstalar(estado.versao), detalhe: texto.abreDeNovo, progresso: 1 }
  }
}

/** The code that puts a state on screen. Only our text, via `JSON.stringify`. */
export function codigoDoEstado(estado: EstadoDoEcra, lingua: LinguaDoAnfitriao = "en"): string {
  const { titulo, detalhe, progresso } = textoDoArranque(estado, lingua)
  const largura = progresso === null ? "null" : JSON.stringify(`${(progresso * 100).toFixed(1)}%`)
  return `(() => {
    document.getElementById("titulo").textContent = ${JSON.stringify(titulo)};
    document.getElementById("detalhe").textContent = ${JSON.stringify(detalhe)};
    const barra = document.getElementById("barra");
    const largura = ${largura};
    barra.hidden = largura === null;
    if (largura !== null) document.getElementById("cheio").style.width = largura;
  })()`
}

/** The O banner in SVG: the same mark as the window corner. */
const MARCA_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">${TARJAS_DO_ARRANQUE.map((d) => `<path d="${d}"/>`).join("")}</svg>`

/**
 * The splash colours of each theme. Dark is the approved design, with the
 * art fused into its background; light has no light version of that art (the
 * original lives outside the repository), so it shows the banners large in
 * the art's place, in the light theme's colours.
 */
const ARRANQUE_ESCURO = { fundo: "#080c1a", texto: "#e6ecff", detalhe: "#9aa6c8", pista: "#1b2340", marca: "#7a85f5" }
export const CORES_DO_ARRANQUE = {
  escuro: ARRANQUE_ESCURO,
  claro: { fundo: "#f2f3f5", texto: "#2e3338", detalhe: "#5c5e66", pista: "#d4d7dc", marca: "#5865f2" },
  // Aurora is the 1.3.19 skin, and the approved splash is its night.
  aurora: ARRANQUE_ESCURO,
} as const

/**
 * The page as a `data:` URL. Direction B ("Banners"):
 * illustration at the top, wordmark, text and bar below.
 *
 * Art and font are embedded in the page, also as `data:`, and policy only
 * opens this: `img-src data:` and `font-src data:`. Nothing goes to the
 * network. Text and bar remain HTML, because they change per phase. The window
 * is 320×400 (`index.ts`); positions below are from the approved design.
 */
export function htmlDoArranque(tema: keyof typeof CORES_DO_ARRANQUE, lingua: LinguaDoAnfitriao = "en"): string {
  const cor = CORES_DO_ARRANQUE[tema]
  const fundo = tema !== "claro" ? `${cor.fundo} url("${ARTE_DO_ARRANQUE}") top center / 320px 280px no-repeat` : cor.fundo
  const arte = tema === "claro" ? `\n  <div class="arte" aria-hidden="true">${MARCA_SVG}</div>` : ""
  return `<!doctype html>
<html lang="${lingua}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'">
<title>Orwell</title>
<style>
  @font-face { font-family: "Space Grotesk"; font-weight: 300 700; src: url("${FONTE_DO_ARRANQUE}") format("woff2"); }
  html, body { margin: 0; height: 100%; overflow: hidden; color: ${cor.texto};
    background: ${fundo};
    font: 14px/1.4 "Space Grotesk", "Segoe UI", system-ui, sans-serif; -webkit-user-select: none; user-select: none; }
  body { position: relative; -webkit-app-region: drag; }
  .arte { position: absolute; top: 72px; left: 0; right: 0; display: flex; justify-content: center; }
  .arte svg { width: 128px; height: 128px; fill: ${cor.marca}; }
  .marca { position: absolute; top: 264px; left: 0; right: 0; display: flex; justify-content: center;
    align-items: center; gap: 0.06em; font-size: 22px; font-weight: 600; line-height: 1; letter-spacing: 0.01em; }
  .marca svg { width: 1.04em; height: 1.04em; fill: ${cor.marca}; flex: none; }
  #titulo { position: absolute; top: 302px; left: 12px; right: 12px; text-align: center; font-weight: 500; line-height: 20px; }
  #barra { position: absolute; top: 334px; left: 60px; width: 200px; height: 6px; border-radius: 3px;
    background: ${cor.pista}; overflow: hidden; }
  #cheio { width: 0; height: 100%; background: ${cor.marca}; transition: width 120ms linear; }
  #detalhe { position: absolute; top: 350px; left: 12px; right: 12px; text-align: center; color: ${cor.detalhe};
    font-size: 12px; min-height: 17px; }
</style>
</head>
<body>${arte}
  <div class="marca" role="img" aria-label="Orwell">${MARCA_SVG}<span aria-hidden="true">rwell</span></div>
  <div id="titulo">${escaparHtml(textosDoAnfitriao(lingua).arranque.aProcurar)}</div>
  <div id="barra" hidden><div id="cheio"></div></div>
  <div id="detalhe"></div>
</body>
</html>`
}

/** Our own text in the page: no `<`, `&` or quote reaches it raw. */
function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** The approved dark page, as it always was. */
export const HTML_DO_ARRANQUE = htmlDoArranque("escuro")
