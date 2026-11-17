/**
 * iPhone and iPad, including the iPad that presents itself as Mac.
 *
 * Only for what is really iOS: the gate's note about Safari's seven days
 * (`gate.memorizarNotaIos`) and the web bridge's `navigator.storage.persist()`.
 */
export function ehIos(
  nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> | undefined = globalThis.navigator,
): boolean {
  if (!nav) return false
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)
}

/**
 * The installed web app on iPhone or iPad: opened from the Home Screen, not in
 * Safari.
 *
 * iOS turns off the microphone of an installed web app when the screen locks
 * or the app goes to the background; Safari keeps it (WebKit bug 239602). The
 * call says so on this platform only, until there is a native app.
 *
 * `navigator.standalone` is iOS's own flag; the display mode is the standard
 * one. `standalone` defaults to reading the page.
 */
export function ehPwaDoIos(
  nav: (Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> & { standalone?: boolean }) | undefined = globalThis.navigator,
  standalone: boolean = typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(display-mode: standalone)").matches,
): boolean {
  if (!nav || !ehIos(nav)) return false
  return nav.standalone === true || standalone
}
