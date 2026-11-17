/**
 * The account's choice about the shared room (the "Orwell" channel).
 *
 * In sign-up, each person decides whether
 * to enter the shared channel. Until now one entered always, alone, at each connection.
 *
 * A preference, not a new vault field, for the reason in `PREFERENCIA_CONTAS_JUNTADAS`:
 * the choice belongs to the ACCOUNT and must reach all its devices. It travels on the
 * account channel and goes in the pairing snapshot, so a paired device is born with the
 * choice the account already made, before the first `connect()`.
 *
 * **Absent means do not enter (12/11/2026: joining is opt-in).** Only an
 * explicit "entrar" joins: the sign-up checkbox, unchecked by default, or the Settings
 * button. An account that already exists has no mark: if it is already in the room it
 * stays, and the session writes "entrar" for it the first time it sees itself inside
 * (`ensureCommonRoom`), so it keeps returning if it loses the room. If it is not in the
 * room, it does not join by itself any more.
 */
export const PREFERENCIA_SALA_COMUM = "sala-comum"

/** The value for someone who does not want the shared room. */
export const SALA_COMUM_FORA = "fora"
/** The value for someone who chose to enter. Written when entering later, to override an old "out". */
export const SALA_COMUM_ENTRAR = "entrar"

/** Does the account want to be in the shared room? Read from preferences; no mark means no. */
export function querSalaComum(preferencias: Readonly<Record<string, string>>): boolean {
  return preferencias[PREFERENCIA_SALA_COMUM] === SALA_COMUM_ENTRAR
}
