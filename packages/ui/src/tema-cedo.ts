/**
 * The colour theme, readable before anything else loads.
 *
 * This module imports nothing, on purpose: the web builds it into the tiny
 * script that runs in the `<head>` before the first frame (`apps/web/src/
 * lingua-cedo.ts`), next to the language, and that script must stay small.
 * `usePrefs.ts` re-exports everything here, so the rest of the app has one
 * place to import from.
 */

/** Where the device preferences live. Re-exported by `usePrefs.ts`. */
export const PREFS_KEY = "enclave.prefs"

/**
 * The colour theme of this device: dark, light, whatever the system says, or
 * Aurora.
 *
 * Dark is the default, for everyone, including whoever updates: nobody wakes
 * up to a white screen. "sistema" follows `prefers-color-scheme` live, in CSS,
 * with no JavaScript listener (`tokens.css`), between dark and light. "aurora"
 * is the 1.3.19 skin (aurora, rain, tinted glass), kept as a theme to choose
 * (`styles/aurora.gen.css`). A choice about this device only: it is not sent
 * to the account, like the language.
 */
export type Tema = "escuro" | "claro" | "sistema" | "aurora"
export const TEMAS: readonly Tema[] = ["escuro", "claro", "sistema", "aurora"]
export const TEMA_POR_OMISSAO: Tema = "escuro"

/** Anything that is not a known theme reads as the default. */
export function temaValido(valor: unknown): Tema {
  return valor === "claro" || valor === "sistema" || valor === "aurora" ? valor : TEMA_POR_OMISSAO
}

/**
 * Put the stored theme on the root before the first paint.
 *
 * The web calls it from `lingua-cedo.ts`; the desktop app at the top of the
 * renderer entry. Without it, someone on the light theme would see the dark
 * one for a frame, until `applyPrefs` runs after mount. Never throws: blocked
 * storage or junk means the default.
 */
export function aplicarTemaCedo(storage?: Pick<Storage, "getItem">): void {
  let tema = TEMA_POR_OMISSAO
  try {
    const raw = (storage ?? localStorage).getItem(PREFS_KEY)
    if (raw) tema = temaValido((JSON.parse(raw) as { tema?: unknown } | null)?.tema)
  } catch {
    // Storage blocked or junk: the default theme.
  }
  document.documentElement.dataset.theme = tema
}
