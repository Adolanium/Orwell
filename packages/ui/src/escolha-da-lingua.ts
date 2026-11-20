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
 * The language before anyone starts the language: tests and environments
 * without `window`, and the static `<html lang>` of the pages (20/11/2026).
 *
 * English, because English is the default. It is not where missing text falls
 * back: both catalogs are complete, and `linguas/catalogo.test.ts` measures it.
 */
export const LINGUA_BASE: Lingua = "en"

/**
 * The language for someone who has not chosen one and whose system is not in
 * Portuguese (20/11/2026).
 *
 * The rule: English is the default. The app opens in Portuguese only when the
 * first language of the system or browser is Portuguese (`pt`, `pt-PT`,
 * `pt-BR`...). Any other language (German, French...) opens in English. The
 * explicit choice of the person always wins.
 *
 * From 1.3.9 to 1.3.24 the system did not count at all, and the app opened in
 * English for everyone without a choice.
 */
export const LINGUA_SEM_ESCOLHA: Lingua = "en"

/**
 * What can be saved: a language, or "auto".
 *
 * "auto" means "no choice": the system decides, by the rule in
 * `LINGUA_SEM_ESCOLHA`. Older versions and sibling devices (through the
 * account) also write it.
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
  /**
   * The languages of the system or browser, most preferred first
   * (`navigator.languages`, or `app.getPreferredSystemLanguages()` in Electron).
   * Only the first one counts.
   */
  doSistema?: readonly string[] | undefined
}

/**
 * Which language to show, decided without touching anything.
 *
 * Pure function, and that is what makes it the place where the rule is tested:
 * the whole order fits in assertions, no browser and no storage.
 *
 * The order: the address, then the saved choice, then the system (Portuguese
 * only when its first language is Portuguese), then English.
 */
export function escolherLingua(fontes: FontesDaLingua = {}): Lingua {
  const pedida = normalizar(fontes.doEndereco ?? undefined)
  if (pedida) return pedida
  if (fontes.guardada && fontes.guardada !== "auto") return fontes.guardada
  return linguaDoSistema(fontes.doSistema)
}

/**
 * The language a system list gives: Portuguese when the FIRST language is
 * Portuguese, English for everything else.
 *
 * Only the first one, on purpose. A German system with Portuguese in third
 * place is a German system, and a German reader understands English better
 * than Portuguese. An empty list (or none) is English.
 */
export function linguaDoSistema(linguas: readonly string[] | undefined): Lingua {
  const primeira = linguas?.find((lingua) => typeof lingua === "string" && lingua.trim() !== "")
  return normalizar(primeira) === "pt" ? "pt" : LINGUA_SEM_ESCOLHA
}

/**
 * The browser languages, most preferred first. Empty outside a browser.
 *
 * `navigator.languages` is the user's list; `navigator.language` is the
 * fallback for engines that do not have the list.
 */
export function linguasDoNavegador(): readonly string[] {
  try {
    if (typeof navigator === "undefined") return []
    const lista = navigator.languages
    if (Array.isArray(lista) && lista.length > 0) return lista
    return typeof navigator.language === "string" && navigator.language !== "" ? [navigator.language] : []
  } catch {
    return []
  }
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
  /**
   * The system languages, when the host knows them better than the browser
   * (Electron: `app.getPreferredSystemLanguages()`). Defaults to `navigator.languages`.
   */
  sistema?: readonly string[] | undefined
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
    doSistema: opcoes.sistema && opcoes.sistema.length > 0 ? opcoes.sistema : linguasDoNavegador(),
  })
}
