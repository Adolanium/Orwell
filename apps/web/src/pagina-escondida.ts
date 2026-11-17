/**
 * What `pagehide` does to the account ownership of this tab.
 *
 *  - Closing (`persisted` false): close the ownership, as always.
 *  - Into the navigation cache (`persisted` true): release it, so another tab
 *    can take over; the page that comes back reloads (`main.tsx`).
 *  - Into the cache WITH A CALL open: keep it. iOS can fire `pagehide` with
 *    `persisted` on a page that never really left, and the reload on return
 *    ended the call of a phone that only had its screen locked. A page with a
 *    live capture is expected not to be eligible for the cache, so keeping
 *    the ownership should cost nothing when the page truly goes.
 */
export function aoEsconderAPagina(opcoes: { persisted: boolean; emChamada: boolean }): "largar" | "fechar" | "manter" {
  if (!opcoes.persisted) return "fechar"
  return opcoes.emChamada ? "manter" : "largar"
}

/**
 * What `pageshow` does: a page back from the navigation cache reloads, so the
 * ownership question is asked again from the start. Not with a call open: the
 * `pagehide` above kept the ownership, and a locked iPhone that fires the pair
 * on unlock would lose the call to the reload.
 */
export function aoMostrarAPagina(opcoes: { persisted: boolean; emChamada: boolean }): "recarregar" | "nada" {
  return opcoes.persisted && !opcoes.emChamada ? "recarregar" : "nada"
}
