import { z } from "zod"

/**
 * "Report a bug" (12/11/2026): what the app sends and what the server keeps.
 *
 * A signed HTTP request, like the reports (`denuncia.ts`): the device signs, the
 * server checks the chain, and the address is never just claimed. What travels is
 * what the person wrote and, if they leave the box checked, a short list of
 * technical facts the form shows word for word before sending.
 *
 * **What never travels:** message content, channel names, other people's
 * addresses, keys, or anything from the vault. The schema is the guard: every
 * field is a short string or number with a cap, and there is no free list where
 * such things could ride. The reporter's address is stored only when they check
 * "Let us contact you" (`contacto`); without it, the server uses the address to
 * count and forgets it.
 */

export const ROTA_DOS_BUGS = "/_enclave/bug" as const
export type RotaDosBugs = typeof ROTA_DOS_BUGS

/** The capability in `hello.ok`. A server without it does not get the button. */
export const CAPACIDADE_BUGS = "bug-report"

/** The cap of the description, in characters. */
export const DESCRICAO_DO_BUG_MAX = 4_000
/** How many "Erro NNN" codes go with the technical details. */
export const ERROS_NO_BUG_MAX = 20
/** Bug reports per day, per account. */
export const BUGS_POR_DIA = 5

/** One "Erro NNN" the app showed, and when. */
export const ErroMostrado = z.object({
  codigo: z.number().int().min(100).max(999),
  /** Milliseconds since the Unix epoch. */
  em: z.number().int().nonnegative(),
})
export type ErroMostrado = z.infer<typeof ErroMostrado>

/** The technical details, exactly as the form lists them. */
export const DetalhesDoBug = z.object({
  /** The app version, `1.3.8`. */
  versao: z.string().max(32),
  /** `web`, `pwa` or `electron`. */
  plataforma: z.enum(["web", "pwa", "electron"]),
  /** Operating system and browser, from the user agent, reduced to names and versions. */
  sistema: z.string().max(64),
  browser: z.string().max(64),
  /** The interface language, `pt` or `en`. */
  lingua: z.string().max(16),
  erros: z.array(ErroMostrado).max(ERROS_NO_BUG_MAX),
  /** `online`, `connecting`, `offline`. */
  ligacao: z.string().max(32),
  /** A short word for the sync state: `em-dia`, `a-sincronizar`, `com-falhas`. */
  sincronia: z.string().max(32),
})
export type DetalhesDoBug = z.infer<typeof DetalhesDoBug>

/** The body of the signed request. `.strict()`: a field we do not know is refused, not stored. */
export const CorpoDoBug = z
  .object({
    v: z.literal(1),
    descricao: z.string().min(1).max(DESCRICAO_DO_BUG_MAX),
    detalhes: DetalhesDoBug.strict().optional(),
    /** "Let us contact you": only then is the address stored. */
    contacto: z.boolean(),
  })
  .strict()
export type CorpoDoBug = z.infer<typeof CorpoDoBug>
