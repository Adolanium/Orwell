/**
 * Startup marks: `performance.mark("orwell:<phase>")`, once per page.
 *
 * The phone start was slow and nobody could say where the time went
 * (12/11/2026). These marks split it: vault open, socket open, logged in,
 * channels restored, catch-up done, connect done. `scripts/medir-arranque-telemovel.mjs`
 * reads them with `performance.getEntriesByType("mark")`.
 *
 * Only the FIRST time each phase happens in the page: reconnections would add
 * one entry per phase per reconnect, forever, to a buffer nobody empties. They
 * carry no content, only a name and a time, so they are safe to leave in
 * production builds.
 */
const vistas = new Set<string>()

export function marcarArranque(fase: string): void {
  if (vistas.has(fase)) return
  vistas.add(fase)
  try {
    globalThis.performance?.mark?.(`orwell:${fase}`)
  } catch {
    // A runtime without User Timing: the mark is a measurement aid, never a reason to fail.
  }
}
