/**
 * Format with the keyboard over the selection. This is everyone's Cmd+B.
 *
 * **This is NOT an editor.** The text box stays an `input` with text inside,
 * and what these functions do is write the markers for you at both ends of the
 * selection. That is the difference between a shortcut and a rich text field,
 * and the choice is deliberate: a rich field would store styles apart from the
 * text, and then would have to serialize them back to text anyway, because
 * **what goes out on the wire is text and nothing else**. See `formatacao.ts`:
 * formatting lives in markup, not in new protocol fields, and that is how an
 * old client shows asterisks instead of throwing the message away.
 *
 * **The key table and why these:**
 *
 *   `Cmd/Ctrl+B` bold · `Cmd/Ctrl+I` italic · `Cmd/Ctrl+E` code
 *   `Cmd/Ctrl+Shift+X` strikethrough · `Cmd/Ctrl+Shift+H` spoiler
 *
 * Bold and italic are the only ones Discord actually has; for strikethrough,
 * code and spoiler it publishes no shortcut, so there is no habit to respect.
 * `Cmd/Ctrl+E` for code is the key Notion uses for inline code. The two with Shift were chosen by elimination from the
 * combinations the browser sends us: `Ctrl+Shift+B` is Chrome's bookmarks bar,
 * `Ctrl+Shift+I` and `Ctrl+Shift+J` are the developer tools, `Ctrl+Shift+O` is
 * the bookmarks manager, `Ctrl+Shift+N` is the private window, and the voice
 * commands already hold `Ctrl+Shift+M`, `D`, `V`, `E` and `L`
 * (`ATALHOS_POR_OMISSAO` in `atalhosDeVoz.ts`). X strikes and H hides.
 *
 * **Why the spoiler left `Cmd/Ctrl+Shift+E` (20/11/2026).** That is the default
 * key to share the screen, and `useAtalhos` listens on the whole document: in a
 * call, the same key put `||` in the box AND started or stopped the screen
 * share. A test now crosses this table with the voice defaults.
 *
 * **Discord's `Cmd/Ctrl+U` does not exist here** because underline is not
 * syntax in this product, it is written why in `formatacao.ts`, and it has to
 * do with URLs that carry underscores in the path. A shortcut that put markers
 * the reader does not recognize would promise formatting and deliver
 * punctuation.
 *
 * **The known cost:** on Firefox, `Ctrl+Shift+H` opens the history sidebar and
 * `Ctrl+E` goes to the search bar; in Chrome, `Ctrl+E` goes to the address bar.
 * In a text box the shortcut takes the key first (`preventDefault`), so these
 * browser keys do not work while the box has the focus. In Electron the
 * combinations are free.
 */

import { combinacaoDeEvento } from "./atalhosDeVoz.js"

/** The five markers that a shortcut or the formatting bar can write. */
export type Marcador = "**" | "*" | "~~" | "`" | "||"

/**
 * The key table, in the same notation as the voice shortcuts ("Mod" is Ctrl or
 * Cmd). One table for the keyboard and for the tooltips of the formatting bar,
 * so the tooltip can never name a key that does something else.
 */
export const ATALHOS_DE_FORMATACAO: Readonly<Record<Marcador, string>> = {
  "**": "Mod+B",
  "*": "Mod+I",
  "~~": "Mod+Shift+X",
  "`": "Mod+E",
  "||": "Mod+Shift+H",
}

const MARCADOR_DA_COMBINACAO = new Map<string, Marcador>(
  Object.entries(ATALHOS_DE_FORMATACAO).map(([marcador, combinacao]) => [combinacao, marcador as Marcador]),
)

/**
 * What marker this combination asks for, if any.
 *
 * Separated from the effect so it can be tested without a document, the same
 * split that `accaoDe` in `hooks/useAtalhos.ts` does, and for the same reason:
 * what matters to lock is the table.
 *
 * The event is read by `combinacaoDeEvento`, the voice shortcuts' reader:
 * `Ctrl` or `Cmd` both count as "Mod" (on macOS Cmd is what the hand does
 * without thinking), the letter is compared in uppercase (with Shift the
 * browser sends "X", not "x"), and a combination with `Alt` matches nothing
 * here, because `Alt` is the gate to accents on several keyboards and to menus
 * on Windows.
 */
export function marcadorDe(event: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}): Marcador | null {
  const combinacao = combinacaoDeEvento(event)
  if (combinacao === null) return null
  return MARCADOR_DA_COMBINACAO.get(combinacao) ?? null
}

/** The text after the shortcut, and where the selection lands. */
export interface Envolvido {
  texto: string
  inicio: number
  fim: number
}

/**
 * Puts, or removes, markers around the selection.
 *
 * **The selection ends on the SAME letters**, and that is not a detail: it is
 * what makes the second Cmd+B undo the first without touching the mouse. A shortcut
 * that moved the selection would force you to reselect it with every gesture, and at that point
 * it was faster to type the asterisks by hand.
 *
 * **Removal is recognized two ways**, because there are two ways a person
 * can get here: with markers outside the selection (the shortcut put them there)
 * or with them inside it (marked with the mouse and caught them). Both mean
 * the same thing, remove this, and treating them differently gave a
 * `****urgente****` to someone who just wanted to undo.
 */
export function envolver(texto: string, inicioBruto: number, fimBruto: number, marcador: Marcador): Envolvido {
  // Dragging the mouse right to left puts the start after the end on some paths.
  // Without this, the `slice` came out empty and the text got cut.
  const inicio = Math.min(inicioBruto, fimBruto)
  const fim = Math.max(inicioBruto, fimBruto)
  const largura = marcador.length
  const onde = ondeEstaoOsMarcadores(texto, inicio, fim, marcador)

  // ------------------------------------------------------------- remove
  //
  // Markers are outside the selection: `isto é **[urgente]**`.
  if (onde === "fora") {
    return {
      texto: texto.slice(0, inicio - largura) + texto.slice(inicio, fim) + texto.slice(fim + largura),
      inicio: inicio - largura,
      fim: fim - largura,
    }
  }

  // And inside it: `isto é [**urgente**]`.
  if (onde === "dentro") {
    const dentro = texto.slice(inicio, fim)
    const limpo = dentro.slice(largura, dentro.length - largura)
    return {
      texto: texto.slice(0, inicio) + limpo + texto.slice(fim),
      inicio,
      fim: inicio + limpo.length,
    }
  }

  // ------------------------------------------------------------- add
  //
  // Without selection, the pair stays open and the cursor inside: it is the
  // gesture of someone who presses Cmd+B BEFORE typing, and types already in
  // bold.
  return {
    texto: texto.slice(0, inicio) + marcador + texto.slice(inicio, fim) + marcador + texto.slice(fim),
    inicio: inicio + largura,
    fim: fim + largura,
  }
}

/**
 * Does the selection already carry this marker? Then the next press removes it.
 *
 * The formatting bar uses it to show the button as pressed (`aria-pressed`), so
 * the button says the same thing that a press will do.
 */
export function estaEnvolvido(texto: string, inicioBruto: number, fimBruto: number, marcador: Marcador): boolean {
  const inicio = Math.min(inicioBruto, fimBruto)
  const fim = Math.max(inicioBruto, fimBruto)
  return ondeEstaoOsMarcadores(texto, inicio, fim, marcador) !== null
}

/** The two ways a selection can already be wrapped. See `envolver`. */
function ondeEstaoOsMarcadores(texto: string, inicio: number, fim: number, marcador: Marcador): "fora" | "dentro" | null {
  const largura = marcador.length
  if (
    texto.slice(inicio - largura, inicio) === marcador &&
    texto.slice(fim, fim + largura) === marcador &&
    !metadeDeOutro(texto, inicio - largura, fim + largura, marcador)
  ) {
    return "fora"
  }
  const dentro = texto.slice(inicio, fim)
  if (
    dentro.length > largura * 2 &&
    dentro.startsWith(marcador) &&
    dentro.endsWith(marcador) &&
    !metadeDeOutro(texto, inicio, fim, marcador)
  ) {
    return "dentro"
  }
  return null
}

/**
 * Is this asterisk part of a bold marker?
 *
 * Only italic has this problem, and it is a real one: in `**a**` with "a"
 * selected, the `*` touching each side is half of the bold marker. Removing it
 * left `*a*`, bold undone by a request for italic, which no one asked for.
 */
function metadeDeOutro(texto: string, inicio: number, fim: number, marcador: Marcador): boolean {
  if (marcador !== "*") return false
  return texto[inicio - 1] === "*" || texto[fim] === "*"
}
