/// <reference path="./folha-url.d.ts" />
import urlDaFolha from "./styles-aurora.css?url"

/**
 * The Aurora sheet is in the document only for whoever chose Aurora.
 *
 * Until 1.3.20 `aurora.gen.css` (1.3.19's whole skin, 577 KB with
 * `aurora.css`) sat in the main sheet for everyone. Every one of its rules is
 * scoped to `:root[data-theme="aurora"]`, so it never matched on Dark or
 * Light, but Blink still tried it: each element met twice the rules in each
 * style recalc, and the `:is()`/`:where()` lists of the scoped skin landed in
 * the universal bucket and were tried on every element. Measured with
 * `medir-fluidez --rastreio --seletores`: more than half of the selector time
 * of a recalc, on Dark (fluidity report of 1.3.20).
 *
 * Now the sheet is its own file, behind one `<link id="folha-aurora">`:
 *
 * - on Aurora at start-up, the web's head script (`lingua-cedo.ts`) writes the
 *   link right after the main sheet, parser-inserted, so it blocks the first
 *   paint like the main sheet does: the first frame is already Aurora. The
 *   desktop (and the web without that script, in dev) waits for it in the
 *   entry, before React draws (`folhaDaAuroraPronta`);
 * - on Dark or Light it is not in the document at all, or it is there with
 *   `media="not all"`, which takes it out of the cascade: Blink does not
 *   collect the rules of a sheet whose media does not match;
 * - the switch is this module, watching `data-theme` on the root: whoever sets
 *   the attribute (the head script, `applyPrefs`) does not need to know.
 */
export const ID_DA_FOLHA_DA_AURORA = "folha-aurora"
const LIGADA = "all"
const DESLIGADA = "not all"

function folha(doc: Document): HTMLLinkElement | null {
  const el = doc.getElementById(ID_DA_FOLHA_DA_AURORA)
  return el instanceof HTMLLinkElement ? el : null
}

function criar(doc: Document, media: string): HTMLLinkElement {
  const el = doc.createElement("link")
  el.id = ID_DA_FOLHA_DA_AURORA
  el.rel = "stylesheet"
  el.media = media
  el.href = urlDaFolha
  // After every other sheet: the Aurora rules come last in the cascade, as
  // they did inside `styles.css`.
  doc.head.appendChild(el)
  return el
}

/** Resolves when the link's sheet is parsed (or failed: the app runs anyway). */
function carregada(el: HTMLLinkElement): Promise<void> {
  if (el.sheet) return Promise.resolve()
  return new Promise((resolve) => {
    el.addEventListener("load", () => resolve(), { once: true })
    el.addEventListener("error", () => resolve(), { once: true })
  })
}

/**
 * Put the sheet in or out of the cascade, by the root's `data-theme`. Resolves
 * when what the theme needs is ready to draw.
 */
export function sincronizarFolhaDaAurora(doc: Document = document): Promise<void> {
  const aurora = doc.documentElement.dataset.theme === "aurora"
  let el = folha(doc)
  if (!aurora) {
    if (el && el.media !== DESLIGADA) el.media = DESLIGADA
    return Promise.resolve()
  }
  if (!el) el = criar(doc, LIGADA)
  else if (el.media !== LIGADA) el.media = LIGADA
  return carregada(el)
}

/**
 * Download the sheet without applying it, so that choosing Aurora later swaps
 * in the same frame. Settings calls it when the theme choice is on screen.
 */
export function prepararFolhaDaAurora(doc: Document = document): void {
  if (!folha(doc)) criar(doc, doc.documentElement.dataset.theme === "aurora" ? LIGADA : DESLIGADA)
}

let vigiado: Document | null = null

/**
 * Follow `data-theme` for the life of the page, and resolve when the first
 * frame can be drawn: the entries `await` this before React's first render.
 */
export function folhaDaAuroraPronta(doc: Document = document): Promise<void> {
  if (vigiado !== doc) {
    vigiado = doc
    new MutationObserver(() => void sincronizarFolhaDaAurora(doc)).observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    })
  }
  // Never hold the first frame forever: a sheet whose `load` and `error` never
  // arrive would leave an empty window for whoever chose Aurora (N3, 1.3.20 review).
  return Promise.race([sincronizarFolhaDaAurora(doc), new Promise<void>((pronto) => setTimeout(pronto, PRAZO_DA_FOLHA_MS))])
}

/** How long the first frame waits for the Aurora sheet before drawing without it. */
export const PRAZO_DA_FOLHA_MS = 3_000
