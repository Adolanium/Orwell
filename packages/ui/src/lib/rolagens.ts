/**
 * The scroll positions of a screen, kept while another tab is on screen
 * (option B, 20/11/2026: "each tab keeps its own stack and scroll position").
 *
 * A tab's list leaves the DOM when another tab comes in, and a list that comes
 * back starts at the top. This keeps every scrolled box of the tab, by a key
 * made of its classes and its place among boxes with the same classes, and
 * puts the numbers back when the tab returns.
 *
 * Only boxes that scrolled are kept. A key that does not exist any more (the
 * list changed) is left alone.
 */
function chaves(raiz: Element): Map<string, HTMLElement> {
  const contadas = new Map<string, number>()
  const resultado = new Map<string, HTMLElement>()
  for (const elemento of raiz.querySelectorAll<HTMLElement>("*")) {
    const classe = elemento.getAttribute("class")
    if (!classe) continue
    const vez = contadas.get(classe) ?? 0
    contadas.set(classe, vez + 1)
    resultado.set(`${classe}#${vez}`, elemento)
  }
  return resultado
}

export function lerRolagens(raiz: Element): Map<string, number> {
  const lidas = new Map<string, number>()
  for (const [chave, elemento] of chaves(raiz)) {
    if (elemento.scrollTop > 0) lidas.set(chave, elemento.scrollTop)
  }
  return lidas
}

export function reporRolagens(raiz: Element, lidas: ReadonlyMap<string, number>): void {
  if (lidas.size === 0) return
  const agora = chaves(raiz)
  for (const [chave, topo] of lidas) {
    const elemento = agora.get(chave)
    if (elemento) elemento.scrollTop = topo
  }
}
