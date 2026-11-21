import { useRef } from "react"

/**
 * The width of the strip at the left edge that starts a back swipe.
 *
 * Only the edge, never the whole conversation: inside it, a finger that moves
 * sideways scrolls a code block or an image gallery, or selects text. Those
 * gestures start away from the edge, because the conversation has 16 px of
 * padding on each side (`.timeline`).
 */
export const LARGURA_DA_BORDA = 20

/** How far the finger must go to go back, at most: a third of a 390 px screen. */
const DISTANCIA_PARA_VOLTAR = 120
/** A quick flick goes back with less distance. */
const DISTANCIA_MINIMA_DO_GESTO = 40
const VELOCIDADE_DO_GESTO = 0.4
/** Below this the finger has not chosen a direction yet. */
const DECISAO_PX = 10

/** The motion after the finger lifts. Reduced motion: slower, never stopped. */
const DURACAO_MS = 220
const DURACAO_REDUZIDA_MS = 440

function movimentoReduzido(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

/**
 * Moves the screen to `ate` px and then calls `depois`.
 *
 * Web Animations, not a CSS transition: the universal reduced-motion rule in
 * `base.css` zeroes every transition with `!important`, and this motion must
 * stay, only slower. Without `animate` (jsdom, an old engine) it jumps.
 */
function animar(elemento: HTMLElement, de: number, ate: number, depois: () => void): void {
  if (typeof elemento.animate !== "function") {
    depois()
    return
  }
  const animacao = elemento.animate([{ transform: `translateX(${de}px)` }, { transform: `translateX(${ate}px)` }], {
    duration: movimentoReduzido() ? DURACAO_REDUZIDA_MS : DURACAO_MS,
    easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
  })
  elemento.style.transform = `translateX(${ate}px)`
  animacao.onfinish = depois
  animacao.oncancel = depois
}

interface Gesto {
  x: number
  y: number
  t: number
  dx: number
  /** null: not decided yet; true: a back swipe; false: something else (a scroll). */
  horizontal: boolean | null
}

/**
 * The swipe from the left edge that goes back (option B, 20/11/2026).
 *
 * The screen follows the finger while it is down. When it lifts, a long or
 * quick swipe goes back (`onVoltar`), and a short one puts the screen back in
 * its place. A finger that goes down the edge is a scroll, and the strip has
 * `touch-action: pan-y`, so the browser keeps it.
 *
 * Finger and pen only. A computer has the back arrow and the browser button.
 *
 * Safari has its own edge swipe outside the installed app. That one is the
 * browser's back button, and it reaches the same place by `popstate` (see
 * `definirBase` in `pilhaDaPessoa.ts`).
 */
export function BordaDeVoltar({
  alvo,
  onVoltar,
}: {
  /** The screen that moves under the finger. */
  alvo: React.RefObject<HTMLElement | null>
  onVoltar: () => void
}): React.JSX.Element {
  const gesto = useRef<Gesto | null>(null)

  const largura = (): number => alvo.current?.getBoundingClientRect().width || window.innerWidth

  const repor = (): void => {
    const elemento = alvo.current
    const dx = gesto.current?.dx ?? 0
    gesto.current = null
    if (!elemento) return
    animar(elemento, dx, 0, () => {
      elemento.style.transform = ""
    })
  }

  return (
    <div
      className="borda-de-voltar"
      data-testid="borda-de-voltar"
      aria-hidden="true"
      onPointerDown={(evento) => {
        if (evento.pointerType === "mouse") return
        gesto.current = { x: evento.clientX, y: evento.clientY, t: performance.now(), dx: 0, horizontal: null }
        try {
          evento.currentTarget.setPointerCapture?.(evento.pointerId)
        } catch {
          // A pointer that is already gone: the gesture ends by itself.
        }
      }}
      onPointerMove={(evento) => {
        const agora = gesto.current
        if (!agora || agora.horizontal === false) return
        const dx = evento.clientX - agora.x
        const dy = evento.clientY - agora.y
        if (agora.horizontal === null) {
          if (Math.abs(dx) < DECISAO_PX && Math.abs(dy) < DECISAO_PX) return
          agora.horizontal = dx > Math.abs(dy)
          if (!agora.horizontal) {
            repor()
            return
          }
        }
        agora.dx = Math.max(0, dx)
        if (alvo.current) alvo.current.style.transform = `translateX(${agora.dx}px)`
      }}
      onPointerUp={() => {
        const agora = gesto.current
        const elemento = alvo.current
        if (!agora || !agora.horizontal || !elemento) {
          if (agora) repor()
          return
        }
        const tempo = Math.max(1, performance.now() - agora.t)
        const longe = agora.dx >= Math.min(DISTANCIA_PARA_VOLTAR, largura() * 0.35)
        const rapido = agora.dx >= DISTANCIA_MINIMA_DO_GESTO && agora.dx / tempo >= VELOCIDADE_DO_GESTO
        if (!longe && !rapido) {
          repor()
          return
        }
        gesto.current = null
        animar(elemento, agora.dx, largura(), () => {
          onVoltar()
          elemento.style.transform = ""
        })
      }}
      onPointerCancel={repor}
    />
  )
}
