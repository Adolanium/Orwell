import {
  ItemRelatado,
  PINNED_ATTACHMENTS_MAX,
  PINNED_THUMBNAIL_MAX,
  PinnedAttachment,
  verificarAutoria,
  type PinnedMessage,
} from "@enclave/protocol"
import { venceCarimbo } from "./dobras.js"
import { normalizar } from "./sincronia/relato.js"
import type { StoredPayload, StoredPeerProfile, VaultContents } from "./vault.js"

/**
 * Pinned messages that outlive retention and the people who pinned them (12/11/2026).
 *
 * A pinned message stays until someone deletes it or unpins it, retention or not.
 * The list lives in the `channel.meta` of the room and in every member's vault.
 * This module holds the pure parts: the list's own stamp, the signed list a member
 * without `fixar` can pass on, the attachments of the copy, and the deleted ones.
 */

/** A pin list someone proposes, with the stamp it competes with. */
export interface PropostaDeFixadas {
  lista: PinnedMessage[]
  at: number
  seq: number
  /** The original `channel.meta` with its authorship, when there is one. */
  original?: { por: string; payload: StoredPayload }
}

/**
 * How old the stored pin list is.
 *
 * Its own stamp when the vault has one; otherwise the room's, which is never
 * younger than the list it carries (a pin always republishes the room). Absent
 * when the room says nothing about pins: any proposal wins.
 */
export function carimboDasFixadas(guardada: StoredPeerProfile | undefined): { at: number; seq?: number } | undefined {
  if (!guardada) return undefined
  if (guardada.fixadas) return { at: guardada.fixadas.at, ...(guardada.fixadas.seq !== undefined ? { seq: guardada.fixadas.seq } : {}) }
  const pinned = (guardada.payload as { pinned?: unknown }).pinned
  return Array.isArray(pinned) ? { at: guardada.at, ...(guardada.seq !== undefined ? { seq: guardada.seq } : {}) } : undefined
}

/** Whether this proposal replaces the stored list. */
export function fixadasVencem(guardada: StoredPeerProfile | undefined, proposta: PropostaDeFixadas): boolean {
  return venceCarimbo(carimboDasFixadas(guardada), { at: proposta.at, seq: proposta.seq })
}

/** What the receiver needs to know to trust a signed list. From the session. */
export interface JuizDaProva {
  /** This device is a leaf of this account in the channel tree, and not revoked. */
  aparelhoDe: (autor: string, aparelho: string) => boolean
  /** This account has `fixar` in the channel, now. */
  fixa: (autor: string) => boolean
}

/**
 * A signed pin list (`pinnedProof`), checked. `null` if anything fails.
 *
 * Synchronous on purpose: it runs where the `channel.meta` is received, which
 * decides on the spot. The device must be in the tree of THIS channel, the same
 * first test as `#aparelhoConfiavel`; an author who left, or a device that is no
 * longer a leaf, does not pass, and the next republish by someone with `fixar`
 * signs the list again under that person's own name.
 */
export function provaAceite(
  canal: string,
  sala: string,
  prova: unknown,
  juiz: JuizDaProva,
): { autor: string; payload: StoredPayload; at: number; lista: PinnedMessage[] } | null {
  const item = ItemRelatado.safeParse(prova)
  if (!item.success) return null
  const normal = normalizar(item.data.p)
  if (!normal || normal["t"] !== "channel.meta" || normal["room"] !== sala) return null
  const lista = fixadasDe(normal)
  if (!lista) return null
  const veredicto = verificarAutoria(canal, item.data.a, normal)
  if (!veredicto.ok) return null
  if (!juiz.aparelhoDe(item.data.a, veredicto.aparelho)) return null
  if (!juiz.fixa(item.data.a)) return null
  const at = typeof normal["updatedAt"] === "number" ? normal["updatedAt"] : 0
  return { autor: item.data.a, payload: { ...normal, autoria: item.data.p["autoria"] } as unknown as StoredPayload, at, lista }
}

/** The pin list of a payload, field by field. The same reading as `fixadasDe` in the session. */
function fixadasDe(payload: Record<string, unknown>): PinnedMessage[] | undefined {
  const bruto = payload["pinned"]
  return Array.isArray(bruto) ? (bruto as PinnedMessage[]) : undefined
}

/**
 * The signed declaration of the stored list, ready to pass on, or `null`.
 *
 * The stored original first (`fixadas.payload`); a vault from before it, the
 * room itself, when it was the pin and nothing merged into it. Either must verify
 * as is: an original that no longer verifies is not passed on.
 */
export function originalDasFixadas(canal: string, guardada: StoredPeerProfile | undefined): ItemRelatado | null {
  if (!guardada) return null
  const candidatos: { por: string | undefined; payload: StoredPayload | undefined; seq: number | undefined }[] = [
    { por: guardada.fixadas?.por, payload: guardada.fixadas?.payload, seq: guardada.fixadas?.seq },
    { por: guardada.por, payload: guardada.payload, seq: guardada.seq },
  ]
  for (const { por, payload, seq } of candidatos) {
    if (!por || !payload || payload["autoria"] === undefined || !Array.isArray(payload["pinned"])) continue
    const normal = normalizar(payload)
    if (!normal || !verificarAutoria(canal, por, normal).ok) continue
    return { s: seq !== undefined && seq >= 0 ? seq : -1, a: por, p: { ...normal, autoria: payload["autoria"] } }
  }
  return null
}

// ------------------------------------------------------------------ deleted

/** How many deleted pins a channel remembers. The oldest leave first. */
export const TECTO_DE_APAGADAS = 256

/** The deleted pins of a channel, as a set. */
export function apagadasDe(conteudo: VaultContents, canal: string): ReadonlySet<string> {
  return new Set(Object.keys(conteudo.fixadasApagadas?.[canal] ?? {}))
}

/** The list without the deleted ones. A copy only when something leaves. */
export function semApagadas(lista: readonly PinnedMessage[], apagadas: ReadonlySet<string>): PinnedMessage[] {
  return apagadas.size === 0 ? [...lista] : lista.filter((fixada) => !apagadas.has(fixada.id))
}

/** Remember a deleted pin, within the cap. */
export function guardarApagada(conteudo: VaultContents, canal: string, id: string, at: number): void {
  const todas = (conteudo.fixadasApagadas ??= {})
  const doCanal = (todas[canal] ??= {})
  doCanal[id] = Math.max(doCanal[id] ?? 0, at)
  const ids = Object.keys(doCanal)
  if (ids.length <= TECTO_DE_APAGADAS) return
  ids.sort((a, b) => (doCanal[a] ?? 0) - (doCanal[b] ?? 0))
  for (const velha of ids.slice(0, ids.length - TECTO_DE_APAGADAS)) delete doCanal[velha]
}

// ------------------------------------------------------------------- held

/**
 * How many pinned messages a channel holds in the vault, the newest pins.
 * Twenty per room is the protocol cap; this bounds a channel with many rooms.
 */
export const FIXADAS_PRESAS_MAX = 100

/**
 * The pinned messages the vault cap does not move to the archive, as `sender|id`
 * (fixadas-topo, 20/11/2026). The same rule as an open poll (`votacoesAbertasPresas`).
 *
 * The pin list is a copy and never needed the history. The jump from the bar at the
 * top of the room does: without the original in the vault, a pin from a busy room
 * had nowhere to go after a restart. Every room of the channel counts, because the
 * vault history is per channel. A deleted pin is not held. By author and id, never
 * by id alone: the id comes from the sender, and another member could reuse it.
 * Read raw, without the schema: this is the hot path of the cap, and a malformed
 * entry costs only the hold.
 */
export function fixadasPresas(conteudo: VaultContents, canal: string): Set<string> {
  const salas = conteudo.channelRooms[canal]
  if (!salas) return new Set()
  const apagadas = apagadasDe(conteudo, canal)
  const todas: { chave: string; em: number }[] = []
  for (const guardada of Object.values(salas)) {
    const lista = (guardada.payload as { pinned?: unknown }).pinned
    if (!Array.isArray(lista)) continue
    for (const bruta of lista) {
      const fixada = bruta as { id?: unknown; sender?: unknown; pinnedAt?: unknown } | null
      if (typeof fixada?.id !== "string" || typeof fixada.sender !== "string" || apagadas.has(fixada.id)) continue
      todas.push({ chave: `${fixada.sender}|${fixada.id}`, em: typeof fixada.pinnedAt === "number" ? fixada.pinnedAt : 0 })
    }
  }
  if (todas.length > FIXADAS_PRESAS_MAX) todas.sort((a, b) => b.em - a.em)
  return new Set(todas.slice(0, FIXADAS_PRESAS_MAX).map((f) => f.chave))
}

// ------------------------------------------------------------- attachments

/** The data URL types a thumbnail may have. The same list as the schema. */
const MINIATURA = /^data:image\/(?:webp|jpeg|png|gif);base64,[A-Za-z0-9+/=]+$/

/**
 * The attachments of a message, as the copy of a pin keeps them.
 *
 * Name, kind, type, size and duration, never the bytes or the blob key. The
 * thumbnail goes only on the FIRST attachment that has an image: the one the
 * interface made (`miniatura`), or, without it, the inline image or video poster
 * itself when it already fits. A thumbnail that does not fit is left out, and
 * the name still says what it was. `undefined` when there is nothing: see
 * `attachments` in `PinnedMessage`.
 */
export function anexosParaFixar(anexos: readonly unknown[] | undefined, miniatura?: string): PinnedAttachment[] | undefined {
  if (!anexos || anexos.length === 0) return undefined
  const saida: PinnedAttachment[] = []
  let comMiniatura = false
  for (const bruto of anexos.slice(0, PINNED_ATTACHMENTS_MAX)) {
    if (typeof bruto !== "object" || bruto === null) continue
    const anexo = bruto as Record<string, unknown>
    let imagem: string | undefined
    const tipo = typeof anexo["mediaType"] === "string" ? anexo["mediaType"] : ""
    const visual = anexo["kind"] === "image" || anexo["kind"] === "video" || tipo.startsWith("image/") || tipo.startsWith("video/")
    if (!comMiniatura && visual) {
      const candidatas = [miniatura, anexo["inline"], anexo["poster"]]
      imagem = candidatas.find((c): c is string => typeof c === "string" && c.length <= PINNED_THUMBNAIL_MAX && MINIATURA.test(c))
    }
    const lido = PinnedAttachment.safeParse({
      name: anexo["name"],
      kind: anexo["kind"],
      mediaType: anexo["mediaType"],
      byteLength: anexo["byteLength"],
      ...(typeof anexo["duration"] === "number" ? { duration: anexo["duration"] } : {}),
      ...(imagem ? { thumbnail: imagem } : {}),
    })
    if (!lido.success) continue
    if (lido.data.thumbnail) comMiniatura = true
    saida.push(lido.data)
  }
  return saida.length > 0 ? saida : undefined
}
