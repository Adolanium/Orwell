import { strings } from "../../strings.js"

/**
 * The settings sections, and where they live.
 *
 * In its own file because they are needed in two places: the sidebar draws them,
 * the screen shows the chosen one. Declared in one of them, the other would have
 * to import it, and the sidebar importing from the settings screen is a
 * backwards dependency.
 *
 * Each option lives in one place: language and "Sign out" in Account, window and
 * theme in Appearance, voice handling in Microphone and camera, blocked users in Privacy, export and the button that destroys the
 * account at the end of Devices. Help is at the end: it is where people with a
 * problem go, not in the way of someone changing an option.
 *
 * ## Why this is a FUNCTION
 *
 * It was a constant, and the constant was wrong from the day the interface had
 * more than one language: `strings.settings.appearance` read at the top of a
 * module is read ONCE, when the module loads, and stays with the language at that
 * instant. Changing language redraws the whole app and left the labels in
 * Portuguese, forever, with nothing to explain it.
 *
 * The rule that comes from here applies to this whole package and is backed by a
 * test: nothing stores a piece of `strings` outside a function. See
 * `strings.captura.test.ts`.
 */
export const IDS_DAS_SECCOES = ["conta", "aparencia", "avisos", "media", "privacidade", "aparelhos", "ajuda"] as const

export type Seccao = (typeof IDS_DAS_SECCOES)[number]

export interface EntradaDeSeccao {
  id: Seccao
  label: string
}

/** The sections, with labels in the language now being shown. */
export function seccoes(): readonly EntradaDeSeccao[] {
  return [
    { id: "conta", label: strings.settings.account },
    { id: "aparencia", label: strings.settings.appearance },
    { id: "avisos", label: strings.settings.notifications },
    { id: "media", label: strings.settings.media },
    // Blocked users, with "Unblock", and what the app stores.
    { id: "privacidade", label: strings.settings.privacidade },
    // Account and security (21/11/2026): password, file, devices, add a device; below, delete.
    { id: "aparelhos", label: strings.contaESeguranca.titulo },
    { id: "ajuda", label: strings.settings.ajuda },
  ]
}

/**
 * A section requested by id, or Account.
 *
 * Old ids (`voice`, `diagnostics`...) may still arrive from outside:
 * a script, a saved state, an old test. An id that no longer exists showed an
 * empty panel with no explanation. Falls back to Account, which is the first.
 */
export function seccaoValida(id: string | undefined): Seccao {
  if (id === "appearance") return "aparencia"
  return (IDS_DAS_SECCOES as readonly string[]).includes(id ?? "") ? (id as Seccao) : "conta"
}
