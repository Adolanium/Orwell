import { useEffect, useState } from "react"

/** A timer longer than this overflows `setTimeout` (about 24.8 days), so long waits are done in slices. */
const FATIA_MAX_MS = 6 * 3_600_000

/**
 * The current time, re-read when the next of `momentos` passes.
 *
 * It exists for the polls: a poll closes by itself at its deadline, and the card
 * and the page must change at that instant without anyone touching anything. It
 * does not tick every second: it sleeps until the nearest future moment (in slices,
 * for far ones) and stops when there is none. The value is read at render, so a
 * render for any other reason never sees a stale clock.
 */
export function useAgora(momentos: readonly (number | null | undefined)[]): number {
  const [vez, desperta] = useState(0)
  const chave = momentos.join(",")
  useEffect(() => {
    const ja = Date.now()
    const proximo = momentos
      .filter((momento): momento is number => typeof momento === "number" && momento > ja)
      .reduce<number | null>((menor, momento) => (menor === null || momento < menor ? momento : menor), null)
    if (proximo === null) return
    const relogio = setTimeout(() => desperta((n) => n + 1), Math.min(proximo - ja + 50, FATIA_MAX_MS))
    return () => clearTimeout(relogio)
    // `chave` stands for the list; the array itself changes identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, vez])
  return Date.now()
}
