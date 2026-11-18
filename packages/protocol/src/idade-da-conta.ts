/**
 * The age of an account, attested by its homeserver (17/11/2026).
 *
 * The rule it serves: only accounts created 5 days ago or more vote. A vote is
 * an encrypted, padded MLS event, so the server cannot tell it from a message
 * and cannot enforce anything. The rule lives in each client, and each client
 * needs a creation date it can trust without trusting the voter.
 *
 * **The voter's own word does not count.** A date in the profile or in the vote
 * is written by the account it describes. The homeserver saw the first login,
 * so it signs that instant with its federation key (`server.key.json`, the one
 * peers already check at `/_orwell/federation/v1/keys`). Any client verifies the
 * signature with the key of the server named in the address.
 *
 * **What it does not prove.** A homeserver can lie about its own accounts: an
 * operator who wants a vote bloc signs old dates for new accounts. That is the
 * same trust a member already gives the server that hosts the account (it holds
 * the key packages), and the attestation is per server, so the lie is signed
 * and stays on record. It stops the cheap attack: an account made this minute,
 * on an honest server, voting in a poll it was invited to.
 *
 * **Accounts from before the attestation** get the earliest date the server has
 * for them, and if it has none, the 1.0 cut-off (`CORTE_DA_1_0`), which is
 * already more than 5 days ago.
 */
import { z } from "zod"
import { canonicalBytes, fromBase64 } from "./canonical.js"
import { verify } from "./identity.js"

/** The capability in `hello.ok`: this server answers `account.age.get`. Without it, votes count as before. */
export const CAPACIDADE_IDADE_ATESTADA = "account-age"

/** Five days, the age an account needs at the instant it votes. */
export const IDADE_PARA_VOTAR_MS = 5 * 24 * 60 * 60 * 1000

/** 28/10/2026 00:00 UTC, the 1.0 cut-off: the date of accounts the server has no record for. */
export const CORTE_DA_1_0 = Date.UTC(2026, 9, 28)

export const AtestacaoDeIdade = z.object({
  /** The account, `@…:server`. */
  address: z.string().min(3).max(320),
  /** The first registration, in milliseconds since the epoch. */
  criadaEm: z.number().int().nonnegative(),
  /** The server that signs, the one in the address. */
  servidor: z.string().min(1).max(255),
  /** Which of the server's keys signed (`ed25519:…`). */
  keyId: z.string().min(1).max(64),
  /** Ed25519 over `mensagemDaAtestacao`, base64. */
  assinatura: z.string().min(1).max(200),
})
export type AtestacaoDeIdade = z.infer<typeof AtestacaoDeIdade>

/** What the server signs. Its own context, so no other signature of this key reads as one. */
export function mensagemDaAtestacao(a: Omit<AtestacaoDeIdade, "assinatura">): Uint8Array {
  const contexto = new TextEncoder().encode("orwell:account-age:v1\0")
  const corpo = canonicalBytes({ address: a.address, criadaEm: a.criadaEm, servidor: a.servidor, keyId: a.keyId })
  const mensagem = new Uint8Array(contexto.length + corpo.length)
  mensagem.set(contexto, 0)
  mensagem.set(corpo, contexto.length)
  return mensagem
}

/**
 * The creation instant, if the attestation is genuine; `null` otherwise.
 *
 * Genuine means: well formed, signed by `chaves[keyId]`, and signed by the
 * server the address names. An attestation for `@x:a` signed by server `b` is
 * refused even with a valid signature: `b` has no say on `a`'s accounts.
 */
export function criadaEmAtestada(
  bruta: unknown,
  address: string,
  chaves: Readonly<Record<string, Uint8Array>>,
): number | null {
  const lida = AtestacaoDeIdade.safeParse(bruta)
  if (!lida.success) return null
  const a = lida.data
  if (a.address !== address) return null
  const servidor = address.slice(address.indexOf(":") + 1)
  if (a.servidor !== servidor) return null
  const chave = chaves[a.keyId]
  if (!chave) return null
  let assinatura: Uint8Array
  try {
    assinatura = fromBase64(a.assinatura)
  } catch {
    return null
  }
  return verify(chave, mensagemDaAtestacao(a), assinatura) ? a.criadaEm : null
}

/** May an account created at `criadaEm` vote at `instante`? Unknown age never votes. */
export function podeVotar(criadaEm: number | null, instante: number): boolean {
  return criadaEm !== null && instante - criadaEm >= IDADE_PARA_VOTAR_MS
}
