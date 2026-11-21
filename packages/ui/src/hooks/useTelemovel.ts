import { useEffect, useState } from "react"

/**
 * The phone layout (option B, 20/11/2026): four tabs at the bottom, and each
 * conversation pushed full screen on top of its list.
 *
 * Same breakpoint as the sheets in `screens.css` (`max-width: 840px`): above
 * it, the desktop and tablet layout stays exactly as it was.
 *
 * Without `matchMedia` (jsdom, an old engine) the answer is "no". That is the
 * desktop layout, which is what every older test reads. A phone test stubs
 * `matchMedia` and gets this layout.
 *
 * It is not `!useEcraLargo()`: that one answers "narrow" without
 * `matchMedia`, which is right for the call dock and wrong here.
 */
export const CONSULTA_DO_TELEMOVEL = "(max-width: 840px)"

function ler(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(CONSULTA_DO_TELEMOVEL).matches
  } catch {
    return false
  }
}

export function useTelemovel(): boolean {
  const [telemovel, setTelemovel] = useState(ler)
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setTelemovel(false)
      return
    }
    const consulta = window.matchMedia(CONSULTA_DO_TELEMOVEL)
    const mudou = (): void => setTelemovel(consulta.matches)
    mudou()
    consulta.addEventListener("change", mudou)
    return () => consulta.removeEventListener("change", mudou)
  }, [])
  return telemovel
}
