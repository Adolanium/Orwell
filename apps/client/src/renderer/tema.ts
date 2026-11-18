/**
 * Report an attribute of `<html>` to the main process: once now, and on every
 * change. Used for the colour theme (`data-theme`) and the language (`lang`).
 *
 * The main process opens windows and asks questions before any page runs, so
 * it keeps what the page last said for the next start. Watching the attribute
 * keeps `@enclave/ui` out of it: the UI knows nothing about windows. Returns
 * the stop function (for tests).
 */
export function relatarAtributoAoAnfitriao(
  raiz: HTMLElement,
  atributo: string,
  anfitriao: { definir: (valor: string) => void } | undefined,
): () => void {
  if (!anfitriao) return () => {}
  let ultimo: string | null = null
  const relatar = (): void => {
    const valor = raiz.getAttribute(atributo)
    if (!valor || valor === ultimo) return
    ultimo = valor
    anfitriao.definir(valor)
  }
  relatar()
  const observador = new MutationObserver(relatar)
  observador.observe(raiz, { attributes: true, attributeFilter: [atributo] })
  return () => observador.disconnect()
}

/**
 * The colour theme (`data-theme`, set early by `aplicarTemaCedo` and later by
 * `applyPrefs`), so the windows open in it (`main/tema-da-janela.ts`).
 */
export function relatarTemaAoAnfitriao(
  raiz: HTMLElement,
  anfitriao: { definir: (tema: string) => void } | undefined,
): () => void {
  return relatarAtributoAoAnfitriao(raiz, "data-theme", anfitriao)
}
