import { fireEvent } from "@testing-library/react"

/**
 * A pointer event with coordinates and kind, for jsdom.
 *
 * jsdom has no `PointerEvent`: `fireEvent.pointerDown` falls back to a plain
 * `Event` and loses `clientX` and `pointerType`. A `MouseEvent` with the
 * pointer event's name carries the coordinates, and the kind goes on top.
 * Same trick as `hooks/useToqueLongo.test.tsx`.
 */
export function ponteiro(
  alvo: Element,
  tipo: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  ponto: { clientX: number; clientY: number },
  pointerType = "touch",
): void {
  const evento = new MouseEvent(tipo, { bubbles: true, cancelable: true, ...ponto })
  Object.defineProperty(evento, "pointerType", { value: pointerType })
  Object.defineProperty(evento, "pointerId", { value: 1 })
  fireEvent(alvo, evento)
}

/** A finger that lands, moves in steps, and lifts. */
export function arrastar(
  alvo: Element,
  de: { x: number; y: number },
  ate: { x: number; y: number },
  passos = 5,
  pointerType = "touch",
): void {
  ponteiro(alvo, "pointerdown", { clientX: de.x, clientY: de.y }, pointerType)
  for (let passo = 1; passo <= passos; passo++) {
    ponteiro(
      alvo,
      "pointermove",
      { clientX: de.x + ((ate.x - de.x) * passo) / passos, clientY: de.y + ((ate.y - de.y) * passo) / passos },
      pointerType,
    )
  }
  ponteiro(alvo, "pointerup", { clientX: ate.x, clientY: ate.y }, pointerType)
}
