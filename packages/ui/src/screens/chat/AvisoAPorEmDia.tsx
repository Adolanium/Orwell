import { useEffect, useRef, useState } from "react"
import { strings } from "../../strings.js"

/**
 * How long the channel must stay catching up before the notice shows (1.3.26).
 * A catch-up shorter than this shows nothing: most of them end in a few hundred
 * ms, and a line that comes and goes in that time reads as a flicker.
 */
export const A_POR_EM_DIA_ATRASO_MS = 400
/** Once shown, the notice stays at least this long, even when the catch-up ended sooner. */
export const A_POR_EM_DIA_MINIMO_MS = 1_500
/**
 * And it leaves only when the catch-up has been over this long: a catch-up that
 * ends and starts again at once (the next window of the same history) keeps the
 * notice up, instead of hiding it and showing it again 400 ms later.
 */
export const A_POR_EM_DIA_FIM_MS = 400
/**
 * The fade out, as in `screens.css` (`.chat-a-recuperar`): the text stays in the
 * line until the fade ends, and only then leaves the live region. With reduced
 * motion the fade is slower, never cut.
 */
export const A_POR_EM_DIA_SAIDA_MS = 200
export const A_POR_EM_DIA_SAIDA_REDUZIDA_MS = 600

const movimentoReduzido = (): boolean =>
  typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)

/**
 * Whether the notice is on screen, from whether the channel is catching up: on
 * only after `A_POR_EM_DIA_ATRASO_MS` of catch-up, and off only when the
 * catch-up has been over for `A_POR_EM_DIA_FIM_MS` and no sooner than
 * `A_POR_EM_DIA_MINIMO_MS` after it came on. A catch-up that starts again while
 * the notice is still up keeps it up.
 */
export function useAvisoSemPiscar(ativo: boolean): boolean {
  const [visivel, setVisivel] = useState(false)
  const desde = useRef(0)
  useEffect(() => {
    if (ativo) {
      if (visivel) return
      const temporizador = setTimeout(() => {
        desde.current = Date.now()
        setVisivel(true)
      }, A_POR_EM_DIA_ATRASO_MS)
      return () => clearTimeout(temporizador)
    }
    if (!visivel) return
    const falta = Math.max(A_POR_EM_DIA_FIM_MS, A_POR_EM_DIA_MINIMO_MS - (Date.now() - desde.current))
    const temporizador = setTimeout(() => setVisivel(false), falta)
    return () => clearTimeout(temporizador)
  }, [ativo, visivel])
  return visivel
}

/**
 * "Catching up on this conversation…", the line UNDER the box (1.3.26).
 *
 * It was a paragraph above the composer that entered and left the grid with
 * the catch-up: each time the conversation and the box jumped, and short
 * catch-ups made it blink. Now the line is always there while the composer is,
 * with a fixed height, so only its opacity changes and nothing moves. It sits
 * inside the form, so on the phone it goes wherever the form goes: above the
 * keyboard and the tab bar.
 *
 * The live region is always built (one that starts with its text is not read
 * by every screen reader), and the text enters it once per appearance. The
 * appearance itself is held by `useAvisoSemPiscar`, so a catch-up that blinks
 * is never announced twice.
 */
export function AvisoAPorEmDia({ ativo }: { ativo: boolean }): React.JSX.Element {
  const visivel = useAvisoSemPiscar(ativo)
  const [comTexto, setComTexto] = useState(false)
  useEffect(() => {
    if (visivel) {
      setComTexto(true)
      return
    }
    const temporizador = setTimeout(
      () => setComTexto(false),
      movimentoReduzido() ? A_POR_EM_DIA_SAIDA_REDUZIDA_MS : A_POR_EM_DIA_SAIDA_MS,
    )
    return () => clearTimeout(temporizador)
  }, [visivel])
  return (
    <p className="chat-a-recuperar" role="status" data-visivel={visivel ? "" : undefined} aria-hidden={visivel ? undefined : true}>
      {visivel || comTexto ? strings.chat.aPorEmDia : null}
    </p>
  )
}
