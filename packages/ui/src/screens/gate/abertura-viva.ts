/**
 * The opening from start to finish: one lap only, and a fade-out.
 *
 * The splash mounts several times in a row: the one from `index.html`, the one from `main.tsx`, the one from `Unlock` opening and the one from `App`. Each mount is a new element, and a new element starts its animations from zero. Until November 3, 2026 the phase was tuned by a negative delay in the stylesheet (`--abertura-fase`), and the reduced motion block, with its `animation: … !important`, reset that delay to zero: on Windows with animation effects off the ring jumped each time.
 *
 * Now the phase is tuned by Web Animations: on mount, each `abertura-*` animation gets the `startTime` of the first opening on this page. The clock is the same for all, in any motion mode, and each banner's delay (`--linha`) stays in the stylesheet, over it.
 *
 * And the exit is no longer a cut: when the last splash leaves, a copy of it stays on top of the next screen, fading in `SAIDA_MS`. If the app is ready before the opening is seen for `MINIMO_VISIVEL_MS`, the copy stays until then and the next screen waits below, hidden: a two-frame splash reads as a flicker.
 *
 * None of this runs per frame: one tune on mount, two timers on exit.
 *
 * And the exit does not depend on those timers alone (21/11/2026). A tab that freezes between the copy going up and the first timer (Edge sleeping tabs, Chrome Memory Saver, a throttled background tab) left the copy over a live app: audio played and only the background showed. Now the stylesheet gives the hold its own end (`VEIL_DEADLINE_MS`, `pele.css`), and the page cleans up when it comes back (`visibilitychange`, `pageshow`, `focus`).
 */

import { recordDiagnostic } from "../../lib/diagnostics.js"

/** The fade-out of the exit. */
export const SAIDA_MS = 200

/** The fade-out with reduced motion: the same, slower (nothing stops). */
export const SAIDA_REDUZIDA_MS = 360

/** The minimum time the opening stays on screen, counted from the first time it was seen. */
export const MINIMO_VISIVEL_MS = 600

/**
 * The longest the exit copy and the hold may cover the app, kept by CSS and not by timers: after this the stylesheet fades the copy out and the app in on its own (`veil-deadline` in `pele.css`, delay `3s`; a test keeps the two equal). Also the threshold of the diagnostic line: a hold longer than this is a symptom worth a line.
 */
export const VEIL_DEADLINE_MS = 3000

/** The margin past the normal exit after which a page that comes back cleans up at once. */
const VEIL_SLACK_MS = 500

/** The page events after which a frozen or hidden tab is back. */
const PAGE_BACK_EVENTS = ["pageshow", "focus"] as const

let montados = 0
let origem: number | null = null
let veu: HTMLElement | null = null
let temporizadores: ReturnType<typeof setTimeout>[] = []
/** When the copy went up (`Date.now()`), when the hold ended, and when the exit should have ended at the latest. */
let veilUpAt: number | null = null
let holdEndedAt: number | null = null
let exitDueAt: number | null = null

/** The clock for animations: the document's, or the page's where the document does not exist. */
function agora(): number {
  const t = typeof document === "undefined" ? null : document.timeline?.currentTime
  return typeof t === "number" ? t : performance.now()
}

/** The opening animations inside an element, pseudo-element animations included. */
function animacoesDe(raiz: Element): Animation[] {
  if (typeof raiz.getAnimations !== "function") return []
  return raiz
    .getAnimations({ subtree: true })
    .filter((a) => typeof CSSAnimation !== "undefined" && a instanceof CSSAnimation && a.animationName.startsWith("abertura-"))
}

/**
 * When the opening on this page started, on the animation clock.
 *
 * The first time it is asked, it looks for it in the document: on the web it is the splash from `index.html`, which has been running since the first draw. It must be asked before React removes it, and that is why `Splash` asks on draw not on mount. No splash in the document (the desktop app, tests), the opening starts now.
 */
export function origemDaAbertura(): number {
  if (origem !== null) return origem
  const existente = typeof document === "undefined" ? null : document.querySelector(".abertura")
  const inicio = existente ? animacoesDe(existente).find((a) => typeof a.startTime === "number")?.startTime : null
  origem = typeof inicio === "number" ? inicio : agora()
  return origem
}

/** Puts the opening animations of an element on the clock of the first one. */
function acertarFase(raiz: Element): void {
  const inicio = origemDaAbertura()
  for (const animacao of animacoesDe(raiz)) animacao.startTime = inicio
}

function movimentoReduzido(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** A tab that comes back after the exit should have ended cleans up at once. */
function onPageBack(): void {
  if (document.visibilityState !== "visible") return
  if (exitDueAt !== null && Date.now() > exitDueAt) arrumarSaida("page-back")
}

function listenForPageBack(on: boolean): void {
  if (on) {
    document.addEventListener("visibilitychange", onPageBack)
    for (const event of PAGE_BACK_EVENTS) window.addEventListener(event, onPageBack)
  } else {
    document.removeEventListener("visibilitychange", onPageBack)
    for (const event of PAGE_BACK_EVENTS) window.removeEventListener(event, onPageBack)
  }
}

/**
 * The field evidence for a stuck exit: one line in the diagnostic log when the copy or the hold lasted longer than `VEIL_DEADLINE_MS`, with how it ended and whether the page was visible. Mechanics only, like every line there.
 */
function reportLongVeil(endedBy: string): void {
  if (veilUpAt === null) return
  const now = Date.now()
  const veilMs = now - veilUpAt
  const holdMs = (holdEndedAt ?? now) - veilUpAt
  if (veilMs <= VEIL_DEADLINE_MS && holdMs <= VEIL_DEADLINE_MS) return
  recordDiagnostic({
    kind: "status",
    code: "opening-veil-long",
    detail: `veil ${veilMs} ms, hold ${holdMs} ms, ${document.visibilityState}`,
    outcome: endedBy,
  })
}

function arrumarSaida(endedBy = "timer"): void {
  for (const t of temporizadores) clearTimeout(t)
  temporizadores = []
  veu?.remove()
  veu = null
  if (typeof document === "undefined") return
  if (veilUpAt !== null) {
    reportLongVeil(endedBy)
    listenForPageBack(false)
  }
  veilUpAt = holdEndedAt = exitDueAt = null
  document.documentElement.classList.remove("abertura-a-segurar", "abertura-a-sair")
  document.documentElement.style.removeProperty("--abertura-saida")
}

/**
 * A splash mounted: it enters the common clock, and cancels a mid-exit.
 *
 * Called in a `useLayoutEffect`, before the draw: the first frame of the new element already comes out in the right phase.
 */
export function aberturaMontou(raiz: Element): void {
  montados += 1
  arrumarSaida("new-splash")
  acertarFase(raiz)
}

/**
 * A splash screen unmounted. If no other splash takes its place in the same commit,
 * the gate closes.
 *
 * "In the same commit" is the microtask: React unmounts the splash from the gate and
 * mounts the one from `App` in the same pass, and only after that the queue runs.
 */
export function aberturaDesmontou(raiz: Element): void {
  montados -= 1
  // Where Web Animations don't exist (the jsdom in tests), there's no animation to
  // keep going, and a copy of the text left in `body` only confused anyone looking for it.
  if (typeof raiz.getAnimations !== "function") return
  const copia = raiz.cloneNode(true) as HTMLElement
  queueMicrotask(() => {
    if (montados === 0) sair(copia)
  })
}

function sair(copia: HTMLElement): void {
  arrumarSaida("replaced")
  copia.classList.add("abertura-veu")
  copia.setAttribute("aria-hidden", "true")
  copia.inert = true
  document.body.append(copia)
  acertarFase(copia)
  veu = copia
  /*
    The next screen is hidden right away, not just when waiting: the copy has no
    background (the background is the body's default; `pele.css` takes the gate's
    off it), and without this the gate's card would show through until the first
    timer runs.
  */
  const html = document.documentElement
  html.classList.add("abertura-a-segurar")
  const espera = Math.max(0, origemDaAbertura() + MINIMO_VISIVEL_MS - agora())
  const esbate = movimentoReduzido() ? SAIDA_REDUZIDA_MS : SAIDA_MS
  veilUpAt = Date.now()
  exitDueAt = veilUpAt + espera + esbate + VEIL_SLACK_MS
  listenForPageBack(true)
  temporizadores.push(
    setTimeout(() => {
      holdEndedAt = Date.now()
      // Late past the CSS deadline (a tab that froze and woke): the stylesheet has
      // already faded the copy out and the app in. Fading again would hide the app
      // and bring it back.
      if (veilUpAt !== null && holdEndedAt - veilUpAt >= VEIL_DEADLINE_MS) {
        arrumarSaida("late-timer")
        return
      }
      html.style.setProperty("--abertura-saida", `${esbate}ms`)
      html.classList.remove("abertura-a-segurar")
      html.classList.add("abertura-a-sair")
      temporizadores.push(setTimeout(arrumarSaida, esbate))
    }, espera),
  )
}

/** Tests only: the module state resets to a fresh page. */
export function esquecerAbertura(): void {
  arrumarSaida("reset")
  montados = 0
  origem = null
}
