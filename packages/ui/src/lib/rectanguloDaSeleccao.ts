/**
 * Where the selected text of a text area is on screen, in window coordinates.
 *
 * A text area does not give the position of its selection: there is no
 * `Range` over its text, only two indices. The known way is a mirror: a hidden
 * `div` with the same box, font and wrapping as the field, the text up to the
 * selection, and the selected text in a `span`. The `span`'s boxes are where
 * the selection is drawn. The mirror lives for one measurement and goes.
 *
 * `topo` and `fundo` are the top of the first selected line and the bottom of
 * the last one; `centro` is the middle of the first line, where the formatting
 * bar points. The field's own scroll is taken out, so a long text scrolled
 * inside the box gives the line that the person sees.
 *
 * Returns `null` with nothing selected, or where nothing can be measured
 * (jsdom has no layout); the caller then uses the field's own box.
 */

/** What decides where each letter falls. The rest of the style does not move text. */
const COPIAR = [
  "direction",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontFamily",
  "fontFeatureSettings",
  "fontVariationSettings",
  "lineHeight",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "overflowWrap",
  "wordBreak",
] as const

export interface RectanguloDaSeleccao {
  topo: number
  fundo: number
  centro: number
}

export function rectanguloDaSeleccao(campo: HTMLTextAreaElement | HTMLInputElement): RectanguloDaSeleccao | null {
  const a = campo.selectionStart ?? 0
  const b = campo.selectionEnd ?? a
  const inicio = Math.min(a, b)
  const fim = Math.max(a, b)
  if (inicio === fim) return null

  const estilo = getComputedStyle(campo)
  const caixa = campo.getBoundingClientRect()
  const espelho = document.createElement("div")
  for (const propriedade of COPIAR) espelho.style[propriedade] = estilo[propriedade]
  const bordas = (parseFloat(estilo.borderLeftWidth) || 0) + (parseFloat(estilo.borderRightWidth) || 0)
  Object.assign(espelho.style, {
    position: "fixed",
    left: `${caixa.left}px`,
    top: `${caixa.top}px`,
    boxSizing: "border-box",
    // `clientWidth` leaves out the scroll bar, which also narrows the text.
    width: `${campo.clientWidth + bordas}px`,
    height: "auto",
    overflow: "hidden",
    // An `<input>` keeps one line; a text area wraps.
    whiteSpace: campo instanceof HTMLTextAreaElement ? "pre-wrap" : "pre",
    visibility: "hidden",
    pointerEvents: "none",
  })
  const texto = campo.value
  espelho.textContent = texto.slice(0, inicio)
  const marca = document.createElement("span")
  marca.textContent = texto.slice(inicio, fim)
  espelho.append(marca, document.createTextNode(texto.slice(fim) || " "))
  document.body.append(espelho)
  try {
    const linhas = marca.getClientRects()
    const primeira = linhas[0]
    const ultima = linhas[linhas.length - 1]
    if (!primeira || !ultima || (primeira.width === 0 && primeira.height === 0)) return null
    return {
      topo: primeira.top - campo.scrollTop,
      fundo: ultima.bottom - campo.scrollTop,
      centro: (primeira.left + primeira.right) / 2 - campo.scrollLeft,
    }
  } finally {
    espelho.remove()
  }
}
