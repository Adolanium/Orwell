/**
 * Quit again after the store queue drains, but never in the same task.
 *
 * `before-quit` stops the first quit (`preventDefault`), waits for the store
 * queue, and calls `app.quit()` again. With an empty queue the wait ends at
 * once, and a `.then(() => app.quit())` ran as a microtask, still inside the
 * Electron call that emitted the first `before-quit`. That call then finished
 * and wrote "not quitting" over the second quit (measured on Electron 43.8.10,
 * macOS, 21/11/2026, with a 20-line app and with the built client).
 *
 * The result: the window closed, but Electron emitted `window-all-closed`
 * instead of `will-quit`. On macOS that does not quit the app, so the process
 * stayed alive with no window and the vault locked, until `kill -KILL`. The
 * dry run of 1.3.26 saw it after `kill -TERM` (more than 70 s). Cmd-Q and
 * the tray took another Electron path and quit in under 1 s, but nothing
 * guaranteed that.
 *
 * A timer puts the second `app.quit()` in a new task, after the first
 * Electron call has returned. The same 20-line app quits with a delay of 0,
 * 5 or 200 ms, from SIGTERM and from the quit event.
 *
 * No Electron import: `index.ts` gives the real functions, the test gives fakes.
 */
export function quitAfterDrain(
  drain: () => Promise<void>,
  quit: () => void,
  schedule: (task: () => void) => void = (task) => {
    setTimeout(task, 0)
  },
): Promise<void> {
  return drain()
    .catch(() => {})
    .then(() => schedule(quit))
}
