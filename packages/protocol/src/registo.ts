/**
 * Who may create an account on a server (1.3.25, abuse brake C2).
 *
 * An account costs nothing: the key is made on the device and the server
 * registers the account at its first login. On 18/11/2026 a server took 319
 * new accounts in 24 hours, and the common room got bursts of spam. The
 * operator now chooses, with `ENCLAVE_REGISTO`:
 *
 * - `aberto` (the default): any new account gets in, as before.
 * - `convite`: a new account gets in only with a registration invite code that
 *   the operator made (`scripts/convites-de-registo.mjs`). It goes in
 *   `auth.finish` as `conviteDeRegisto`.
 * - `fechado`: only accounts that already exist get in.
 *
 * Existing accounts always get in, and so do new devices of existing accounts
 * (pairing): the rule is about new ACCOUNTS, never about new devices.
 *
 * The server says its mode in `hello.ok` (`registo`), so the gate can ask for
 * the code, or say "no new accounts here", before it makes the vault.
 */
import { z } from "zod"

export const MODOS_DE_REGISTO = ["aberto", "convite", "fechado"] as const
export const ModoDeRegisto = z.enum(MODOS_DE_REGISTO)
export type ModoDeRegisto = z.infer<typeof ModoDeRegisto>

/** The server refuses a new account: it takes no new accounts. Fatal. */
export const CODIGO_REGISTO_FECHADO = "registration-closed"
/** The server refuses a new account: it takes new accounts only with an invite, and none came. Fatal. */
export const CODIGO_CONVITE_DE_REGISTO_EM_FALTA = "registration-invite-required"
/** The server refuses a new account: the invite is unknown, used up or expired. Fatal. */
export const CODIGO_CONVITE_DE_REGISTO_INVALIDO = "registration-invite-invalid"

export const CODIGOS_DE_RECUSA_DO_REGISTO: readonly string[] = [
  CODIGO_REGISTO_FECHADO,
  CODIGO_CONVITE_DE_REGISTO_EM_FALTA,
  CODIGO_CONVITE_DE_REGISTO_INVALIDO,
]

/** The code as it travels in `auth.finish`: what the person typed, with room for spaces and dashes. */
export const ConviteDeRegisto = z.string().min(1).max(64)

/**
 * The code in one canonical form: capitals, without spaces or dashes.
 *
 * The operator gives `K7QM-2XRA-9DTB-W4HE`; a person may type
 * `k7qm 2xra 9dtb w4he`. Both are the same code. The server hashes this form,
 * and `scripts/convites-de-registo.mjs` writes the hash of the same form
 * (the script has no TypeScript imports, so it repeats these two lines; the
 * test `convites-de-registo.test.ts` makes a code with the script and
 * redeems it on the server).
 */
export function normalizarConviteDeRegisto(texto: string): string {
  return texto.toUpperCase().replace(/[\s-]+/g, "")
}
