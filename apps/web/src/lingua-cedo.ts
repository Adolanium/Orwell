/**
 * The language in the `<html lang>`, before the first frame.
 *
 * The `index.html` brings the splash already written, with "Opening..." in all languages,
 * each one in a `<span lang>`; the stylesheet the plugin writes next to it shows only the
 * one for the page language. This script is classic and synchronous, in the `<head>`, so the
 * page knows its language when the browser reaches the `<body>`. Without it the
 * `<html lang>` would only change in `main.tsx`, two megabytes later, and anyone with the
 * browser set to English would see "A abrir..." change to "Opening..." halfway through startup.
 *
 * The rule is the same as `arrancarLingua` in `main.tsx`, the same function: the two
 * cannot disagree. It stays small because `escolha-da-lingua.ts` and `tema-cedo.ts` import nothing. Built
 * separately, in an IIFE, by `apps/web/abertura-no-html.ts`.
 */
import { detectarLingua } from "../../../packages/ui/src/escolha-da-lingua.js"
import { aplicarTemaCedo } from "../../../packages/ui/src/tema-cedo.js"

document.documentElement.lang = detectarLingua()
// And the colour theme, for the same reason: the splash is drawn with the main
// sheet before the bundle arrives, and must come out in the right theme.
// `tema-cedo.ts` imports nothing either.
aplicarTemaCedo()

/*
  And on Aurora, its sheet, before the first frame (1.3.20). The Aurora skin is
  its own file, in the document only for whoever chose it (`folha-da-aurora.ts`).
  This script is classic and synchronous, right after the main sheet's `<link>`:
  a link written here is parser-inserted, so it blocks the first paint like the
  main one and comes after it in the cascade. The build puts the hashed address
  on this script's tag (`data-folha-aurora`, `abertura-no-html.ts`).
*/
const urlDaAurora = (document.currentScript as HTMLScriptElement | null)?.dataset.folhaAurora
if (document.documentElement.dataset.theme === "aurora" && urlDaAurora) {
  document.write(`<link rel="stylesheet" id="folha-aurora" media="all" href="${urlDaAurora}">`)
}
