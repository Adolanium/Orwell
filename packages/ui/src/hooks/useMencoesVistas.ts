import { useEffect, useRef, useState, type RefObject } from "react"
import { janelaAFrente } from "../lib/scroll.js"

/** How long a lit line must stay in view, with the window in front, to count as seen. */
export const MENCAO_VISTA_MS = 4000

const NENHUMA: ReadonlySet<string> = new Set()

/**
 * The lit lines (a mention of me) seen in this visit to the conversation
 * (17/11/2026, the owner: "it is a reply, but it stays marked forever").
 *
 * A lit line counts as seen after `MENCAO_VISTA_MS` with at least half of it in
 * the scroller (or half the scroller, for a line taller than that), the page
 * showing, and the window focused. Then its light fades out in place, and the
 * next visit does not light it at all: by then the read mark passed it.
 *
 * The clock of each line is kept by message id across re-renders: a message
 * that arrives does not restart the others. It stops when the line leaves the
 * view or the window goes behind, and starts again from zero when both are back.
 *
 * `acesas` is the ids of the lit lines not yet seen, joined: the effect watches
 * them again only when that list changes. No `IntersectionObserver` (jsdom, an
 * old engine): nothing fades, and the line goes dark on the next visit.
 */
export function useMencoesVistas(
  container: RefObject<HTMLElement | null>,
  conversa: string,
  acesas: string,
): ReadonlySet<string> {
  const [vistas, setVistas] = useState<{ conversa: string; ids: ReadonlySet<string> }>(() => ({ conversa, ids: NENHUMA }))
  if (vistas.conversa !== conversa) setVistas({ conversa, ids: NENHUMA })

  /** Running clocks, by message id. Cleared when the conversation changes. */
  const relogios = useRef(new Map<string, number>())
  useEffect(() => {
    const emCurso = relogios.current
    return () => {
      for (const relogio of emCurso.values()) window.clearTimeout(relogio)
      emCurso.clear()
    }
  }, [conversa])

  useEffect(() => {
    const raiz = container.current
    if (!raiz || acesas === "" || typeof IntersectionObserver === "undefined") return
    const emCurso = relogios.current
    const aVista = new Set<string>()
    const vigiadas = new Set(acesas.split("\u0000"))

    const arrancar = (id: string): void => {
      if (emCurso.has(id) || !janelaAFrente()) return
      emCurso.set(
        id,
        window.setTimeout(() => {
          emCurso.delete(id)
          setVistas((antes) =>
            antes.conversa !== conversa || antes.ids.has(id) ? antes : { conversa, ids: new Set([...antes.ids, id]) },
          )
        }, MENCAO_VISTA_MS),
      )
    }
    const parar = (id: string): void => {
      const relogio = emCurso.get(id)
      if (relogio !== undefined) window.clearTimeout(relogio)
      emCurso.delete(id)
    }
    // A line no longer watched (out of the window) loses its clock; the others keep theirs.
    for (const id of [...emCurso.keys()]) if (!vigiadas.has(id)) parar(id)

    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          const id = (entrada.target as HTMLElement).dataset["mensagem"]
          if (!id) continue
          const alturaDaRaiz = entrada.rootBounds?.height ?? Number.POSITIVE_INFINITY
          const metade = Math.min(entrada.boundingClientRect.height, alturaDaRaiz) / 2
          if (entrada.isIntersecting && entrada.intersectionRect.height >= metade) {
            aVista.add(id)
            arrancar(id)
          } else {
            aVista.delete(id)
            parar(id)
          }
        }
      },
      { root: raiz, threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    for (const linha of raiz.querySelectorAll<HTMLElement>(".message.menciona-me")) {
      const id = linha.dataset["mensagem"]
      if (id && vigiadas.has(id)) observador.observe(linha)
    }

    const aoMudarDeFrente = (): void => {
      if (janelaAFrente()) for (const id of aVista) arrancar(id)
      else for (const id of [...emCurso.keys()]) parar(id)
    }
    document.addEventListener("visibilitychange", aoMudarDeFrente)
    window.addEventListener("focus", aoMudarDeFrente)
    window.addEventListener("blur", aoMudarDeFrente)
    return () => {
      observador.disconnect()
      document.removeEventListener("visibilitychange", aoMudarDeFrente)
      window.removeEventListener("focus", aoMudarDeFrente)
      window.removeEventListener("blur", aoMudarDeFrente)
    }
  }, [container, conversa, acesas])

  return vistas.conversa === conversa ? vistas.ids : NENHUMA
}
