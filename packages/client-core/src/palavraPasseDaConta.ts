import type { PalavraPasseDaConta } from "@enclave/protocol"

/**
 * The same password on every device of the account (1.3.26). Pure rules; the
 * vault seals, the session carries. See `PalavraPasseDaConta` in the protocol.
 *
 * The mechanism, and why:
 *
 * - The record carries the DERIVED key (Argon2id of the password with the
 *   record's salt), never the password. A device adopts it by sealing its own
 *   vault with that key and salt: the password then opens it, because it
 *   derives the same key. Nothing needs the password itself to travel.
 * - It travels in the account channel (MLS, only the account's leaves read it)
 *   and in the pairing box: the paths that already carry the account private
 *   key, which is worth more than this key. Whoever reads either path already
 *   holds the whole account, so nobody new learns a secret.
 * - The server keeps the account channel event for its retention, so a device
 *   that was off adopts the change when it comes back. It cannot open it.
 * - The check of a typed password is the derivation itself: Argon2id(typed,
 *   salt) equals the record's key. There is no separate, weaker verifier.
 */

/** Does `novo` replace `actual`? Higher version wins; at the same version, the lower key, so every device ends on the same record. */
export function venceAPalavraPasse(novo: PalavraPasseDaConta, actual: PalavraPasseDaConta | null): boolean {
  if (actual === null) return true
  if (novo.versao !== actual.versao) return novo.versao > actual.versao
  return novo.chave < actual.chave
}

/** The error a wrong account password gives after pairing. A key of the interface's catalog. */
export const ERRO_NAO_E_A_PALAVRA_PASSE_DA_CONTA = "this is not the account password"
/**
 * This device saw a newer account password record than the one that seals it,
 * and has not adopted it yet (S1, 21/11/2026). A change from here would lose to
 * that record, so it is refused. A key of the interface's catalog.
 */
export const ERRO_APARELHO_ATRASADO = "sync this device before you change the password"
/** The desktop asked the system who is there (Touch ID) before a change without the current password, and the person did not confirm. */
export const ERRO_SISTEMA_NAO_CONFIRMOU = "the system did not confirm that it is you"
/** A provisional vault confirmed before it has the account password. Internal: the interface never gets there. */
export const ERRO_COFRE_POR_SELAR = "the account password is missing"
