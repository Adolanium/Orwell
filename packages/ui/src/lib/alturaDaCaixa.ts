/**
 * How tall the text box is (20/11/2026).
 *
 * The box grows line by line, like Discord, up to a fraction of the
 * conversation area. The area is the real one: the conversation scroller plus
 * the composer, measured in the page. It is not the window. On the phone the
 * virtual keyboard makes the area smaller (`useVisualViewport`), so the cap
 * goes down with it. Past the cap the box scrolls inside.
 */

/** Half of the conversation area, as in Discord. */
export const FRACCAO_DA_AREA = 0.5

export interface MedidasDaCaixa {
  /** The height the text needs (`scrollHeight` plus the borders). */
  conteudo: number
  /** The conversation area: the scroller plus the composer. */
  area: number
  /** One line: the box never goes below this. */
  minima?: number
}

export function alturaDaCaixa({ conteudo, area, minima = 0 }: MedidasDaCaixa): { altura: number; rola: boolean } {
  const tecto = Math.max(minima, Math.floor(area * FRACCAO_DA_AREA))
  if (conteudo > tecto) return { altura: tecto, rola: true }
  return { altura: Math.max(conteudo, minima), rola: false }
}
