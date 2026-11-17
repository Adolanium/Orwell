/**
 * Which language to show: the whole rule, without catalogs.
 *
 * It lived inside `strings.ts` until November 3, 2026. It moved here so the
 * web can run BEFORE the first draw: the splash in `apps/web/index.html` says
 * "Opening..." in the language of who opens it, and who sets it in `<html lang>`
 * is a small classic script (`apps/web/src/lingua-cedo.ts`). That script is
 * synchronous and blocks the first draw; with the catalogs and the `client-core`
 * that `strings.ts` pulls in, it would stop being small.
 *
 * This module imports nothing, and it has to stay that way. `strings.ts`
 * reexports everything, and that is how the rest of the interface uses it.
 */

/** The languages that really exist, not the ones that could be asked for from a machine. */
export type Lingua = "pt" | "en"

/**
 * The base language. It is the only one required to be complete, and it is
 * where missing text falls back.
 *
 * It is also what the module shows before anyone starts the language: tests
 * and environments without `window`. A real startup (`detectarLingua`) never
 * lands here without a choice: it lands on `LINGUA_SEM_ESCOLHA`.
 */
export const LINGUA_BASE: Lingua = "pt"

/**
 * The language for someone who has not chosen one (12/11/2026, 1.3.9).
 *
 * The interface opens in English until the person chooses another language.
 * The browser and the system no longer count: up to 1.3.8 a browser in
 * Portuguese opened in Portuguese without anyone choosing it. What counts is
 * the address (`?lingua=`) and the saved choice.
 */
export const LINGUA_SEM_ESCOLHA: Lingua = "en"

/**
 * What can be saved: a language, or "auto".
 *
 * "auto" used to mean "follow the system". Since 1.3.9 nothing follows the
 * system, so "auto" is read as "no choice": English. It stays a valid value
 * because older versions and sibling devices (through the account) write it.
 */
export type PreferenciaDeLingua = Lingua | "auto"

/** Where the choice lives. `enclave.` like the rest: see the note in `linguas/pt.ts`. */
export const CHAVE_DA_LINGUA = "enclave.lingua"

/** The URL parameter that forces the language. Scripts ask through here. */
export const PARAMETRO_DA_LINGUA = "lingua"

/**
 * The languages, with the name written in the language itself.
 *
 * In its own language on purpose: someone who opens the app in Portuguese by
 * mistake needs to be able to find "English" without reading Portuguese, and
 * "Inglês" does not do that.
 */
export const LINGUAS: readonly { readonly codigo: Lingua; readonly nome: string }[] = [
  { codigo: "pt", nome: "Português" },
  { codigo: "en", nome: "English" },
]

/** Is it a language that exists? Narrows the string, and is used at all boundaries. */
export function eLingua(valor: unknown): valor is Lingua {
  return valor === "pt" || valor === "en"
}

/** Is it a saveable choice? A language, or follow the system. */
export function ePreferencia(valor: unknown): valor is PreferenciaDeLingua {
  return valor === "auto" || eLingua(valor)
}

/**
 * The choice saved on this device. Nothing written means "auto".
 *
 * Lenient reading like the rest of what lives in `localStorage`: garbage reads
 * as absence. A broken key cannot be the reason the app does not open, much less
 * to open in a language no one asked for.
 */
export function lerPreferencia(armazem: Pick<Storage, "getItem"> | undefined = armazemPadrao()): PreferenciaDeLingua {
  try {
    const cru = armazem?.getItem(CHAVE_DA_LINGUA)
    return ePreferencia(cru) ? cru : "auto"
  } catch {
    return "auto"
  }
}

/** Save a choice. Only those who choose call this, never on startup. */
export function guardarPreferencia(
  preferencia: PreferenciaDeLingua,
  armazem: Pick<Storage, "setItem"> | undefined = armazemPadrao(),
): void {
  try {
    armazem?.setItem(CHAVE_DA_LINGUA, preferencia)
  } catch {
    // Storage full or blocked. The choice still works for this session.
  }
}

function armazemPadrao(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    // A browser with blocked storage throws only when you touch the object.
    return undefined
  }
}

/** Where the language can come from, in order of authority. */
export interface FontesDaLingua {
  /**
   * What the URL asks for: `?lingua=en`. Beats everything.
   *
   * It is the gate for scripts, and it is also a URL you can send to someone with
   * the language already chosen. It does not save on purpose: a link is not a
   * decision about the device of whoever opens it.
   */
  doEndereco?: string | null | undefined
  /** What this person chose, on this device. "auto" means no choice. */
  guardada?: PreferenciaDeLingua | undefined
}

/**
 * Which language to show, decided without touching anything.
 *
 * Pure function, and that is what makes it the place where the rule is tested:
 * the whole order fits in assertions, no browser and no storage.
 *
 * The order: the address, then the saved choice, then English
 * (`LINGUA_SEM_ESCOLHA`). The browser and the system are not asked (1.3.9).
 */
export function escolherLingua(fontes: FontesDaLingua = {}): Lingua {
  const pedida = normalizar(fontes.doEndereco ?? undefined)
  if (pedida) return pedida
  if (fontes.guardada && fontes.guardada !== "auto") return fontes.guardada
  return LINGUA_SEM_ESCOLHA
}

/**
 * A BCP 47 tag narrowed to a language that exists here, or nothing.
 *
 * Only the primary subtag counts: "pt-BR" and "pt-PT" both give "pt". The
 * Brazilian speaker gets European Portuguese, which is not their language but is
 * their language much more than English; and "en-GB", "en-US" and "en" all give "en".
 */
function normalizar(etiqueta: string | undefined): Lingua | undefined {
  if (typeof etiqueta !== "string") return undefined
  const base = etiqueta.trim().toLowerCase().split(/[-_]/)[0]
  return eLingua(base) ? base : undefined
}

/** What the host can tell at startup. */
export interface ArranqueDaLingua {
  /** The address, for those who have it on hand. Defaults to the window's address. */
  endereco?: string | undefined
}

/** The `?lingua=` from an address, if present. */
export function linguaNoEndereco(endereco?: string): string | undefined {
  const cru = endereco ?? (typeof window === "undefined" ? undefined : window.location.href)
  if (!cru) return undefined
  try {
    return new URL(cru, "http://local").searchParams.get(PARAMETRO_DA_LINGUA) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * The language chosen at startup, without applying it.
 *
 * This is what `arrancarLingua` applies, and what `lingua-cedo.ts` marks in the
 * `<html lang>` before the first render: both decide by the same rule.
 */
export function detectarLingua(opcoes: ArranqueDaLingua = {}): Lingua {
  return escolherLingua({
    doEndereco: linguaNoEndereco(opcoes.endereco),
    guardada: lerPreferencia(),
  })
}
