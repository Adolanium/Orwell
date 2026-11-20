import { useLayoutEffect, useRef } from "react"
import { envolver, marcadorDe, type Marcador } from "../lib/atalhosDeFormatacao.js"

type Campo = HTMLInputElement | HTMLTextAreaElement

/**
 * Formatting shortcuts inside a controlled text input.
 *
 * The key table and marker arithmetic live in `lib/atalhosDeFormatacao.ts`,
 * with no React in between. What is left here is the only part that needs the
 * document, and it is the part that takes work: **put the selection back where
 * it was after the text changes.**
 *
 * The problem, stated once: boxes in this product are controlled, the text
 * lives in the component above. Changing the text forces a redraw, and the
 * redraw puts the cursor at the end. Without restoring the selection, the
 * second Cmd+B would never find what the first one had marked, and a shortcut
 * that only works the first time is not a shortcut.
 *
 * So the restoration happens in an effect tied to the VALUE, not right after
 * the call: only after the new value has reached the box is there a place to
 * put the cursor. It is the same dance the emoji picker already did in
 * `Composer`.
 *
 * **The box comes from the event itself**, not passed in by reference from
 * outside. That is what lets this hook go into any field with a single line,
 * no plumbing: `onKeyDown={(e) => { if (aoTeclar(e)) return; … }}`. Where
 * other work is happening at the same time, the smallest possible touch is a
 * feature, not laziness.
 *
 * Returns `true` when it handled the key. Returns `false` for everything else,
 * including unmodified keys, inside a text input, the keyboard belongs to
 * whoever is typing, and the caller stays free to handle Enter, Escape and
 * arrows as always.
 */
export function useAtalhosDeFormatacao(
  valor: string,
  onChange: (texto: string) => void,
): (event: React.KeyboardEvent<Campo>) => boolean {
  return useFormatacao(valor, onChange).aoTeclar
}

export interface Formatacao {
  /** The key handler. See `useAtalhosDeFormatacao`. */
  aoTeclar: (event: React.KeyboardEvent<Campo>) => boolean
  /** Put or remove one marker on the field's selection. The formatting bar calls this. */
  aplicar: (campo: Campo, marcador: Marcador) => void
}

/**
 * The same as `useAtalhosDeFormatacao`, plus `aplicar` for a button.
 *
 * **Undo (Ctrl+Z) keeps working.** The change goes into the field through
 * `document.execCommand("insertText")`, the one path that writes into a text
 * box AND into the browser's undo history. With `onChange` alone, React set
 * the value from outside, the browser lost the history, and Ctrl+Z after a
 * Cmd+B undid nothing, or undid the typing before it. `execCommand` fires the
 * native `input` event, so the controlled value above changes through the
 * field's own `onChange`, as with a key press.
 *
 * Only the part that changed is replaced (`trocaMinima`): the selection covers
 * the changed letters and nothing else, so a single Ctrl+Z puts back exactly
 * what was there.
 *
 * Where `execCommand` does not exist or refuses (old engines, jsdom), the old
 * path stays: `onChange` with the new text. The text is correct, only the
 * undo history is lost.
 */
export function useFormatacao(valor: string, onChange: (texto: string) => void): Formatacao {
  const porDevolver = useRef<{ campo: Campo; inicio: number; fim: number } | null>(null)

  // A layout effect, so the selection is back before paint and before any
  // passive effect reads it (the formatting bar, a child, reads it in one).
  useLayoutEffect(() => {
    const espera = porDevolver.current
    if (!espera) return
    porDevolver.current = null
    // A field that left the document in the meantime, channel switch mid-shortcut, gets no focus: that would steal it from whoever has it now.
    if (!espera.campo.isConnected) return
    espera.campo.focus()
    espera.campo.setSelectionRange(espera.inicio, espera.fim)
  }, [valor])

  const aplicar = (campo: Campo, marcador: Marcador): void => {
    // The field, not `valor`: the bar calls this from a click, and the field is
    // what holds the selection the person sees.
    const antes = campo.value
    const principio = campo.selectionStart ?? antes.length
    const fim = campo.selectionEnd ?? principio
    const feito = envolver(antes, principio, fim, marcador)
    if (escreverComHistorico(campo, antes, feito.texto)) {
      // The field already holds the new text, and React redraws it with the
      // same value, which leaves the selection alone. Nothing to restore later.
      campo.setSelectionRange(feito.inicio, feito.fim)
      return
    }
    porDevolver.current = { campo, inicio: feito.inicio, fim: feito.fim }
    onChange(feito.texto)
  }

  const aoTeclar = (event: React.KeyboardEvent<Campo>): boolean => {
    const marcador = marcadorDe(event)
    if (marcador === null) return false
    // Only after there is an action: `preventDefault` on a combo we will not use
    // takes it from the browser for nothing in return. It is the rule that
    // `useAtalhos` already follows.
    event.preventDefault()
    aplicar(event.currentTarget, marcador)
    return true
  }

  return { aoTeclar, aplicar }
}

/**
 * The smallest replacement that turns `antes` into `depois`: the common start
 * and the common end stay, and only the middle changes.
 */
export function trocaMinima(antes: string, depois: string): { inicio: number; fim: number; texto: string } {
  let inicio = 0
  while (inicio < antes.length && inicio < depois.length && antes[inicio] === depois[inicio]) inicio++
  let fimComum = 0
  while (
    fimComum < antes.length - inicio &&
    fimComum < depois.length - inicio &&
    antes[antes.length - 1 - fimComum] === depois[depois.length - 1 - fimComum]
  ) {
    fimComum++
  }
  return { inicio, fim: antes.length - fimComum, texto: depois.slice(inicio, depois.length - fimComum) }
}

/**
 * Writes the change through the browser's editing command, so it goes into the
 * undo history. Returns `false` when the command is not there or did not give
 * the expected text, and the caller falls back to `onChange`.
 */
function escreverComHistorico(campo: Campo, antes: string, depois: string): boolean {
  if (typeof document.execCommand !== "function") return false
  const troca = trocaMinima(antes, depois)
  // The command writes into the focused field, and only into it.
  if (document.activeElement !== campo) campo.focus()
  campo.setSelectionRange(troca.inicio, troca.fim)
  let feito: boolean
  try {
    feito = troca.texto === "" ? document.execCommand("delete") : document.execCommand("insertText", false, troca.texto)
  } catch {
    feito = false
  }
  return feito && campo.value === depois
}
