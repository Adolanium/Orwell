/**
 * A fingerprint of an account address: sixteen hex characters of SHA-256.
 *
 * For marks kept outside the vault (`localStorage` is not encrypted, and an
 * address is a person's identifier): enough to tell the accounts of one browser
 * apart, without writing the address in the clear. See `ficheiroDaConta.ts`.
 *
 * It lived in `usePrimeirosPassos` until 1.3.26, when the first-steps card left.
 * That card's mark (`enclave.primeirosPassos`) may still sit in old browsers:
 * nothing reads it any more, and it is left as it is.
 */
export async function impressaoDoEndereco(address: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16)
}
