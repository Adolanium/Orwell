/**
 * What `pagehide` does to the account ownership of this tab.
 *
 *  - Closing (`persisted` false): close the ownership, as always.
 *  - Into the navigation cache (`persisted` true): suspend it (save, stop
 *    writing, release the lock), so another tab can take over; the page that
 *    comes back resumes it without reloading (`main.tsx`), and reloads only if
 *    another tab owned the vault in the meantime. Until 21/11/2026 it reloaded
 *    every time, and iOS fires this pair on every screen lock and app switch:
 *    the installed app restarted each time, and long work (history between
 *    devices) never finished.
 *  - Into the cache WITH A CALL open: keep it. iOS can fire `pagehide` with
 *    `persisted` on a page that never really left, and the reload on return
 *    ended the call of a phone that only had its screen locked. A page with a
 *    live capture is expected not to be eligible for the cache, so keeping
 *    the ownership should cost nothing when the page truly goes.
 */
export function aoEsconderAPagina(opcoes: { persisted: boolean; emChamada: boolean }): "suspender" | "fechar" | "manter" {
  if (!opcoes.persisted) return "fechar"
  return opcoes.emChamada ? "manter" : "suspender"
}

/**
 * What `pageshow` does: a page back from the navigation cache resumes, so the
 * ownership question is asked again without a reload. Not with a call open: the
 * `pagehide` above kept the ownership, and a locked iPhone that fires the pair
 * on unlock would lose the call to the reload.
 */
export function aoMostrarAPagina(opcoes: { persisted: boolean; emChamada: boolean }): "retomar" | "nada" {
  return opcoes.persisted && !opcoes.emChamada ? "retomar" : "nada"
}
