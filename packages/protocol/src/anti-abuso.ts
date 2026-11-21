/**
 * The abuse brake, part 2 (1.3.26): what a new account costs, and what it may
 * do in its first days.
 *
 * Part 1 (1.3.25, `registo.ts`) let the operator close the door or ask for an
 * invite. This part keeps the door open and makes each new account cost a
 * little, and keeps a new account quiet in the common room for a while:
 *
 * 1. **Proof of work at registration.** The server puts a challenge in
 *    `hello.ok` (`provaDeTrabalho`). A client that creates a NEW account finds
 *    a nonce for it before it connects (a Web Worker on the web and in the
 *    desktop app), and sends it in `auth.finish`. About 3 seconds on an
 *    average phone; more during a spike of new accounts. Existing accounts and
 *    new devices of existing accounts never do it.
 * 2. **New accounts per network.** Counted in the server's memory only. Over
 *    the limit the server refuses with `CODIGO_REDE_COM_MUITAS_CONTAS`; a
 *    registration invite code lets the account in.
 * 3. **New-account limits in the common room**, by the age the server knows
 *    (`auth.ok.contaNova`).
 * 4. **A ceiling on joins to the common room**, with a queue
 *    (`channel.rejoin.sent.fila`).
 *
 * The challenge is signed by the server with a key that lives only in its
 * memory, carries its own expiry, and is accepted once. The server keeps no
 * challenge on disk; a restart makes the old ones invalid, and the client asks
 * for a new one.
 */
import { sha256 } from "@noble/hashes/sha2.js"
import { z } from "zod"

/**
 * The capability a client states in `hello` when it can solve the proof of work.
 *
 * The server reads it only for a NEW account without a proof: with it, the
 * refusal is `CODIGO_PROVA_EM_FALTA` (the client gets a challenge and tries
 * again); without it, the client is from before 1.3.26 and the refusal is the
 * "new version" one (`CODIGO_VERSAO_ANTIGA`), the only sentence an old app
 * shows that tells the person what to do.
 */
export const CAPACIDADE_PROVA_DE_TRABALHO = "prova-de-trabalho"

/**
 * The capability a client states in `hello` when it understands the new-account
 * refusals (`channel.rejected` with `contaNova`, `keypackage.claimed` and
 * `channel.claim.result` with `recusa`). The server sends them to anyone (an
 * unknown field is dropped); the capability only chooses between a refusal the
 * client can explain and the old silent one.
 */
export const CAPACIDADE_LIMITES_DE_CONTA_NOVA = "conta-nova"

/** The highest work the server may ask: 2^40 hashes is hours on any phone, so a wrong setting is still bounded. */
export const TRABALHO_MAXIMO = 2 ** 40

/** The challenge as it travels in `hello.ok`: an opaque signed string, and the expected number of hashes. */
export const DesafioDeTrabalho = z.object({
  desafio: z.string().min(1).max(200),
  trabalho: z.number().int().min(1).max(TRABALHO_MAXIMO),
})
export type DesafioDeTrabalho = z.infer<typeof DesafioDeTrabalho>

/** The answer as it travels in `auth.finish`: the challenge, unchanged, and the nonce that meets it. */
export const ProvaDeTrabalho = z.object({
  desafio: z.string().min(1).max(200),
  nonce: z.string().min(1).max(16).regex(/^[0-9a-z]+$/),
})
export type ProvaDeTrabalho = z.infer<typeof ProvaDeTrabalho>

/** A NEW account came without a proof, from a client that can solve one. Fatal; the client gets a new challenge and tries again. */
export const CODIGO_PROVA_EM_FALTA = "registration-proof-required"
/** The proof does not meet its challenge, or the challenge is forged, expired or already used. Fatal; same retry. */
export const CODIGO_PROVA_INVALIDA = "registration-proof-invalid"
/** This network made too many new accounts in the last hour or day. Fatal; a registration invite code gets past it. */
export const CODIGO_REDE_COM_MUITAS_CONTAS = "registration-network-limit"

/** The first 48 bits of the hash are compared against `2^48 / trabalho`. 48 bits stay exact in a double. */
const ESCALA = 2 ** 48

const codificador = new TextEncoder()

/** The 48-bit value of `SHA-256(desafio ":" nonce)`. */
function valor(hash: Uint8Array): number {
  return (
    (hash[0] as number) * 2 ** 40 +
    (hash[1] as number) * 2 ** 32 +
    (hash[2] as number) * 2 ** 24 +
    (hash[3] as number) * 2 ** 16 +
    (hash[4] as number) * 2 ** 8 +
    (hash[5] as number)
  )
}

/**
 * Does this nonce meet the challenge for this amount of work?
 *
 * `trabalho` is the expected number of hashes: a nonce meets it when the first
 * 48 bits of `SHA-256(desafio ":" nonce)` are below `2^48 / trabalho`. A plain
 * number, not a count of zero bits, so the operator can ask for 3 seconds and
 * not only for 1.6 or 3.2.
 */
export function provaCumpre(desafio: string, nonce: string, trabalho: number): boolean {
  if (!/^[0-9a-z]{1,16}$/.test(nonce) || !(trabalho >= 1)) return false
  return valor(sha256(codificador.encode(`${desafio}:${nonce}`))) * trabalho < ESCALA
}

/**
 * Try the nonces `desde` .. `ate - 1` (in base 36). Returns the first that
 * meets the challenge, or `null`. Synchronous: a Web Worker calls it in
 * batches; the main thread calls `resolverProvaDeTrabalho`, which yields.
 */
export function procurarNonce(desafio: string, trabalho: number, desde: number, ate: number): string | null {
  const prefixo = codificador.encode(`${desafio}:`)
  const tampao = new Uint8Array(prefixo.length + 16)
  tampao.set(prefixo)
  const limite = ESCALA / trabalho
  for (let n = desde; n < ate; n++) {
    const nonce = n.toString(36)
    for (let i = 0; i < nonce.length; i++) tampao[prefixo.length + i] = nonce.charCodeAt(i)
    if (valor(sha256(tampao.subarray(0, prefixo.length + nonce.length))) < limite) return nonce
  }
  return null
}

/** How many nonces between two reports of progress. About 50 ms on a phone. */
export const LOTE_DA_PROVA = 10_000

/**
 * How far the search is, from 0 to 0.95, for the progress bar. The search has
 * no end that can be known: after `trabalho` hashes it is done 63 % of the time.
 * The bar follows `1 - e^(-n / trabalho)` and stops short of full until it is.
 */
export function progressoDaProva(tentados: number, trabalho: number): number {
  return Math.min(0.95, 1 - Math.exp(-tentados / trabalho))
}

/**
 * Find a nonce, yielding to the event loop between batches. For hosts without
 * a worker (tests, a page that could not start one). `aoProgresso` gets a
 * fraction from 0 to 0.95, and 1 at the end.
 */
export async function resolverProvaDeTrabalho(
  desafio: DesafioDeTrabalho,
  opcoes: { aoProgresso?: (fraccao: number) => void; sinal?: AbortSignal } = {},
): Promise<ProvaDeTrabalho> {
  for (let desde = 0; ; desde += LOTE_DA_PROVA) {
    if (opcoes.sinal?.aborted) throw new Error("the proof of work was cancelled")
    const nonce = procurarNonce(desafio.desafio, desafio.trabalho, desde, desde + LOTE_DA_PROVA)
    if (nonce !== null) {
      opcoes.aoProgresso?.(1)
      return { desafio: desafio.desafio, nonce }
    }
    opcoes.aoProgresso?.(progressoDaProva(desde + LOTE_DA_PROVA, desafio.trabalho))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

/**
 * What `auth.ok` says to an account in its first 72 hours, when the server
 * applies the new-account limits. Absent: no limits apply (an older account, a
 * server without them).
 *
 * - `ate24h`, `ate72h`: when the first day and the first three days end (ms).
 * - `intervaloAte24hS`, `intervaloAte72hS`: the seconds between two messages in
 *   the common room in each period, after a slack of 3 messages (a token
 *   bucket), so the app can say the number the server uses.
 */
export const ContaNova = z.object({
  ate24h: z.number().int().nonnegative(),
  ate72h: z.number().int().nonnegative(),
  intervaloAte24hS: z.number().int().nonnegative(),
  intervaloAte72hS: z.number().int().nonnegative(),
})
export type ContaNova = z.infer<typeof ContaNova>

/** Where a client is in its first days: the first day, the next two, or past them. */
export function faseDaContaNova(conta: ContaNova | null | undefined, agora: number): "24h" | "72h" | null {
  if (!conta) return null
  if (agora < conta.ate24h) return "24h"
  if (agora < conta.ate72h) return "72h"
  return null
}

/** Why the server refused an invite step from a new account: it reached the people it may add today. */
export const RECUSA_DE_CONTA_NOVA = "conta-nova"

/**
 * The capability a client and a server state when they know the cap on the
 * channels an account may create (1.3.26). The client sends
 * `channel.claim` with `comunidade: true` before it creates a channel, and asks
 * `channel.quota`; the server answers both, and says a refused `invite.create`
 * (`invite.created` with `recusa`) only to a client that states it. An older
 * client gets the old silence there, and its wait for `invite.created` times out.
 */
export const CAPACIDADE_LIMITE_DE_CANAIS = "limite-de-canais"

/** Why the server refused a new channel, or an invite into one: the account created all the channels it may. */
export const RECUSA_DE_LIMITE_DE_CANAIS = "limite-de-canais"

/**
 * The channels this account created and that still exist, and
 * how many it may have now (1.3.26). `contaNova`: the account is in its first
 * 72 hours and `maximo` is the new-account cap, which grows when they end.
 */
export const CriarCanais = z.object({
  criados: z.number().int().nonnegative(),
  maximo: z.number().int().positive(),
  contaNova: z.boolean(),
})
export type CriarCanais = z.infer<typeof CriarCanais>

/**
 * The capability a client and a server state when they know the cap on the
 * rooms (inside a channel) one account creates (1.3.26). The
 * client sends `room.claim` before it publishes a new room and `room.release`
 * when it deletes one; the room itself travels end-to-end encrypted, so this
 * is the only way the server sees it. An older client sends neither, and its
 * rooms are not counted.
 */
export const CAPABILITY_ROOM_LIMIT = "room-limit"

/** Why the server refused a new room: the account created all the rooms it may. */
export const REFUSAL_ROOM_LIMIT = "room-limit"

/** The rooms this account created that still exist, and how many it may have (1.3.26). */
export const RoomQuota = z.object({
  created: z.number().int().nonnegative(),
  max: z.number().int().positive(),
  /** The account is in its first 72 hours and `max` is the new-account cap, which grows when they end. */
  newAccount: z.boolean().optional(),
})
export type RoomQuota = z.infer<typeof RoomQuota>

/** May this account create one more room? Unknown (an older server, no cap) means yes: the server still decides. */
export function canCreateRoom(quota: RoomQuota | null | undefined): boolean {
  return !quota || quota.created < quota.max
}

/** May this account create one more channel? Unknown (an older server) means yes: the server still decides. */
export function podeCriarCanal(quota: CriarCanais | null | undefined): boolean {
  return !quota || quota.criados < quota.maximo
}

/** The place in the common room's queue (`channel.rejoin.sent.fila`). */
export const FilaDaSalaComum = z.object({
  /** 1 is next. */
  posicao: z.number().int().min(1),
  /** When to ask again, in ms. */
  esperaMs: z.number().int().nonnegative(),
})
export type FilaDaSalaComum = z.infer<typeof FilaDaSalaComum>
