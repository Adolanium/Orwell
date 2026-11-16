import { CABECALHO_DO_COFRE, envelopeDeContaValido, fonteDeBlob, formaDoFicheiroDeConta, versaoDoTexto } from "@enclave/client-core"

/**
 * The shape of an account file (`.enclave`), read before asking for anything.
 *
 * Why here and not just in the core: `importVault` already refuses a non-account
 * file, but it only runs AFTER the user types the password and the word "delete".
 * Someone who accidentally picks a photo or a file cut mid-stream deserves to know
 * immediately, not after agreeing to wipe this device's account. This reads only
 * the plaintext wrapper: it opens nothing, derives no key, and saves nothing.
 *
 * The rules are the same as `importVault` (`packages/client-core/src/vault.ts`)
 * and in the same order: the `enclave-vault` envelope in version 1, and inside it
 * a vault protected by password with salt, nonce, and ciphertext. The vault's version
 * inside stays for the core (`versaoLegivel`), which knows what versions it reads;
 * we don't repeat that list here, so we don't have two aging separately.
 *
 * What this DOESN'T prove is the password. That takes key derivation and decryption,
 * and the bridge has no path to do it without saving. Until then, what guarantees
 * a wrong password doesn't wipe anything is `importVault` itself, which decrypts
 * before writing a single byte.
 */
export function pareceFicheiroDeConta(texto: string): boolean {
  // The 1.0 plaintext header comes before the JSON (`cabecalhoDoCofre.ts`).
  // Without it, the file is from the beta or not an account at all: see `eFicheiroDoBeta`.
  if (versaoDoTexto(texto) !== "orwv2") return false
  return envelopeDeConta(texto.slice(CABECALHO_DO_COFRE.length))
}

/**
 * An account file exported by 0.9.x: the usual envelope, without the `orwv2`
 * header. Version 1.0 won't import it (the core refuses it before deriving the
 * passphrase), and whoever picks it knows right away, before the password and
 * delete screen. The message is from the core: "this account file is from the beta".
 */
export function eFicheiroDoBeta(texto: string): boolean {
  return versaoDoTexto(texto) === "beta" && envelopeDeConta(texto)
}

/**
 * The shape of a chosen file, read in slices (Task 11b): the container with
 * the images can be hundreds of MB, and never enters a string whole. The rules
 * are the core's (`formaDoFicheiroDeConta`), the same the desktop main process
 * applies to the file it chose.
 */
export function formaDoFicheiro(ficheiro: Blob): Promise<"conta" | "beta" | "outro"> {
  return formaDoFicheiroDeConta(fonteDeBlob(ficheiro))
}

/** The `enclave-vault` envelope, by the core rules (`envelopeDeContaValido`). */
function envelopeDeConta(json: string): boolean {
  return envelopeDeContaValido(json)
}
