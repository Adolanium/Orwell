import { sha256 } from "@noble/hashes/sha2.js"
import { toBase64 } from "@enclave/protocol"
import { registarApelido, type RegistoDeApelido } from "../apelidos.js"
import { chavesDeOrdem, chaveDoEvento, venceCarimbo } from "../dobras.js"
import { soInlineOuEvicted } from "../armazem/referencias.js"
import { caracteresDaRef } from "../medidaDeMedia.js"
import { registarFicha, type FichaDoCanal } from "../tipoDoCanal.js"
import { resumosDosVideos } from "../videos.js"
import {
  aplicarAtribuicao,
  bytesParaBase64,
  canaisComEntradas,
  entradasDoCanal,
  entryMediaBytes,
  faltaMediaDaEntrada,
  videoNoCofre,
  type EvictedMedia,
  type ItemDeMediaDoIrmao,
  type Presente,
  type StoredChatMessage,
  type StoredPayload,
  type StoredPeerProfile,
  type VaultContents,
} from "../vault.js"

/**
 * What moves from one device to another on the same account in the device history
 * (1.0 "Arca", 29/10/2026), without network: the inventory, the pages, the
 * media list, and what merges into the receiver's vault.
 *
 * Network and times come from `historico.ts`. This reads and writes `VaultContents`,
 * and nothing else, to prove it without a session.
 */

/** A channel, as the sibling has it. */
export interface CanalNoInventario {
  c: string
  /** How many entries it holds (the conversation and the state log). */
  n: number
  /** The summary of entries (`resumoDoHistorico`). */
  h: string
  /** The timestamp of the newest entry: channels with newer conversation come first. */
  u: number
  /** The channel record (what it is), for whoever doesn't have it yet. */
  f?: FichaDoCanal
  /** The sibling was removed from this channel, and it stores the history: the time it happened. */
  a?: number
  /** The account's first position in this channel (the marker "You joined here"). `null`: from the start. */
  l?: { seq: number; em: number } | null
}

export interface Inventario {
  v: 1
  canais: CanalNoInventario[]
}

/** Channel records that are not entries: rooms and pinned, categories, roles, foundation, description, nicknames. */
export interface RegistosDoCanal {
  salas?: Record<string, StoredPeerProfile>
  categorias?: Record<string, StoredPeerProfile>
  cargos?: Record<string, StoredPeerProfile>
  atribuicoes?: Record<string, string[]>
  atribuicoesAt?: Record<string, { at: number; seq?: number; por?: string }>
  fundador?: { address: string; seq: number; payload?: StoredPayload }
  admins?: string[]
  apresentacao?: StoredPeerProfile
  apelidos?: Record<string, RegistoDeApelido>
}

/** A page of entries from a channel, by sort key, after `since`. */
export interface PaginaDoHistorico {
  c: string
  e: StoredChatMessage[]
  /** The sort key of the page's last entry. `null` if the page is empty. */
  ate: number | null
  /** No more entries exist after this page. */
  fim: boolean
  /** Channel records, only on the first page. */
  r?: RegistosDoCanal
  /** Entries in this stretch that could not be sent (they do not serialize). Absent: none. */
  p?: number
}

/** What heavy media the sibling has. */
export type MediaNoIrmao = { c: string; e: string; b: number } | { v: string; b: number } | { a: string; at: number; b: number }

/** A complete media item, as it goes in the response. */
export type MediaInteira =
  | { c: string; e: string; p: StoredPayload }
  | { v: string; b64: string; at: number }
  | { a: string; perfil: StoredPeerProfile }

/**
 * The numbers. Mutable only for tests to lower them.
 */
export const TECTOS_DO_HISTORICO = {
  /**
   * An attachment up to this size (in base64 characters) goes with the text. Larger
   * ones go at the end, in the background. 48 KB is a small photo or a card
   * thumbnail: the text doesn't wait for them.
   */
  mediaComOTexto: 48 * 1024,
  /** The JSON of a page stays below this before compression (about 3 bytes after compression). */
  bytesPorPagina: 96 * 1024,
  /** And never more than this many entries. */
  entradasPorPagina: 400,
  /** The JSON of a media response stays below this, except the first item (which always goes). */
  bytesPorRespostaDeMedia: 2 * 1024 * 1024,
  /** Items per media request. */
  itensPorPedidoDeMedia: 8,
}

/**
 * The output to a sibling (design §5): the vault keeps `{ ref }`, and the wire
 * between siblings always carries `inline` or `evicted`, as in 1.3 (a 1.1.x to
 * 1.3.x sibling would draw a `ref` as an empty `img src`). The session provides
 * it through the store.
 */
export interface InflarParaOIrmao {
  /**
   * The payload with each reference inflated. Above `maxCaracteres` (in
   * `inline` units), or without the blob, an attachment goes `evicted` and a
   * card thumbnail leaves. A payload without references comes back the same.
   */
  payload(payload: StoredPayload, opcoes?: { maxCaracteres?: number }): Promise<StoredPayload>
  /** The bytes of a media item in the store (a video), or null. */
  bytes(sha: string): Promise<Uint8Array | null>
}

// ------------------------------------------------------------------ o resumo

/**
 * The summary of a channel: SHA-256 of the sorted list of entry identities
 * (the server's `seq`, or `tipo|autor|id` in a send without echo), truncated
 * to 12 bytes. Two devices with the same entries give the same summary,
 * regardless of the order they received them in.
 */
export function resumoDoHistorico(contents: VaultContents, canal: string): string {
  const ids: string[] = []
  for (const entrada of entradasDoCanal(contents, canal)) {
    if (entrada.seq >= 0) ids.push(`s${entrada.seq}`)
    else {
      const chave = chaveDoEvento(entrada)
      if (chave !== null) ids.push(`k${chave}`)
    }
  }
  ids.sort()
  return toBase64(sha256(new TextEncoder().encode(ids.join("\n"))).subarray(0, 12))
}

// ------------------------------------------------------------ who responds

export interface ContextoDoIrmao {
  /** The account's channel: never joins. */
  canalDaConta: string
  /** Whether this device has the channel's group (is a member). */
  temGrupo: (canal: string) => boolean
  /** The account's first position in the channel, as this device knows it. `undefined`: unknown. */
  lugar: (canal: string) => { seq: number; em: number } | null | undefined
}

/** The inventory of this vault: channels with entries, newest conversation first. */
export function inventarioDe(contents: VaultContents, contexto: ContextoDoIrmao): Inventario {
  const canais: CanalNoInventario[] = []
  for (const c of canaisComEntradas(contents)) {
    if (c === contexto.canalDaConta) continue
    const entradas = entradasDoCanal(contents, c)
    if (entradas.length === 0) continue
    const u = entradas.reduce((maior, entrada) => (entrada.at > maior ? entrada.at : maior), 0)
    const ficha = contents.fichasDosCanais?.[c]
    const arquivado = contents.canaisArquivados?.[c]
    const lugar = contexto.lugar(c)
    canais.push({
      c,
      n: entradas.length,
      h: resumoDoHistorico(contents, c),
      u,
      ...(ficha ? { f: ficha } : {}),
      ...(arquivado !== undefined && !contexto.temGrupo(c) ? { a: arquivado } : {}),
      ...(lugar !== undefined ? { l: lugar } : {}),
    })
  }
  canais.sort((a, b) => b.u - a.u)
  return { v: 1, canais }
}

/**
 * A page of the channel after `since` (the sort key of the last entry the
 * requester already has; `null` is the start). Heavy media is dropped (see
 * `TECTOS_DO_HISTORICO.mediaComOTexto`); the first page carries the records.
 *
 * A page never splits a group of entries with the same sort key: the
 * next cursor is "after this key", and the rest of the group would be lost.
 */
export async function paginaDe(
  contents: VaultContents,
  canal: string,
  desde: number | null,
  inflar: InflarParaOIrmao,
): Promise<PaginaDoHistorico> {
  const todas = entradasDoCanal(contents, canal)
  const chaves = chavesDeOrdem(todas)
  /*
    By key, not by position: the vault's two lists are not always
    sorted (a report enters at the end with an old `seq`). An entry out
    of order after a page cut had a key below the next cursor,
    and would be lost. Keys are taken before sorting: one from an
    old unsent message without `apos` depends on where it sits.
  */
  const ordenadas = todas
    .map((entrada, indice) => ({ entrada, chave: chaves[indice] ?? -1, indice }))
    .filter(({ chave }) => desde === null || chave > desde)
    .sort((a, b) => a.chave - b.chave || a.indice - b.indice)
  // The records are taken before the first `await`, together with the entries.
  const r = desde === null ? registosDe(contents, canal) : undefined
  const e: StoredChatMessage[] = []
  let bytes = 0
  let ate: number | null = null
  let corte = 0
  let perdidas = 0
  for (; corte < ordenadas.length; corte++) {
    const { entrada, chave } = ordenadas[corte] as (typeof ordenadas)[number]
    const cheia = bytes >= TECTOS_DO_HISTORICO.bytesPorPagina || e.length >= TECTOS_DO_HISTORICO.entradasPorPagina
    if (cheia && chave !== ate) break
    /*
      Inflated, then cut by the 1.3.2 rule (Ruling R11): an older sibling gets
      the same `inline` or `evicted` as always, never a `ref`. What is over the
      cut is not even read from the store.

      An entry that does not serialize is skipped and counted, never thrown
      (12/11/2026). Thrown, it took the whole page with it: the response never
      went out, the requester asked again, and the notice stood at "402 of 420"
      for good. The cursor still moves past it.
    */
    const limite = TECTOS_DO_HISTORICO.mediaComOTexto
    let copia: StoredChatMessage
    let tamanho: number
    try {
      const { payload } = semMediaPesada(await inflar.payload(entrada.payload, { maxCaracteres: limite }), limite)
      // An unsent message carries the sort key as `apos`: the other side doesn't have
      // the entries ahead of it to deduce it.
      copia = { ...entrada, payload, ...(entrada.seq < 0 ? { apos: entrada.apos ?? chave } : {}) }
      tamanho = JSON.stringify(copia).length
    } catch {
      perdidas += 1
      ate = chave
      continue
    }
    e.push(copia)
    bytes += tamanho
    ate = chave
  }
  return {
    c: canal,
    e,
    ate,
    fim: corte >= ordenadas.length,
    ...(r ? { r: await registosInflados(r, inflar) } : {}),
    ...(perdidas > 0 ? { p: perdidas } : {}),
  }
}

/** The records with their media inflated (the presentation icon, the rooms). 1.3.2 sent them whole. */
async function registosInflados(r: RegistosDoCanal, inflar: InflarParaOIrmao): Promise<RegistosDoCanal> {
  const registo = async (guardado: StoredPeerProfile): Promise<StoredPeerProfile> => {
    const payload = await inflar.payload(guardado.payload)
    return payload === guardado.payload ? guardado : { ...guardado, payload }
  }
  const mapa = async (registos: Record<string, StoredPeerProfile> | undefined) => {
    if (!registos) return undefined
    const saida: Record<string, StoredPeerProfile> = {}
    for (const [id, guardado] of Object.entries(registos)) saida[id] = await registo(guardado)
    return saida
  }
  const copia: RegistosDoCanal = { ...r }
  if (r.salas) copia.salas = (await mapa(r.salas)) as Record<string, StoredPeerProfile>
  if (r.categorias) copia.categorias = (await mapa(r.categorias)) as Record<string, StoredPeerProfile>
  if (r.cargos) copia.cargos = (await mapa(r.cargos)) as Record<string, StoredPeerProfile>
  if (r.apresentacao) copia.apresentacao = await registo(r.apresentacao)
  if (r.fundador?.payload) copia.fundador = { ...r.fundador, payload: await inflar.payload(r.fundador.payload) }
  return copia
}

function registosDe(contents: VaultContents, canal: string): RegistosDoCanal {
  const r: RegistosDoCanal = {}
  const salas = contents.channelRooms[canal]
  if (salas && Object.keys(salas).length > 0) r.salas = salas
  const categorias = contents.channelCategories?.[canal]
  if (categorias && Object.keys(categorias).length > 0) r.categorias = categorias
  const cargos = contents.channelRoles[canal]
  if (cargos && Object.keys(cargos).length > 0) r.cargos = cargos
  const atribuicoes = contents.channelMemberRoles[canal]
  if (atribuicoes && Object.keys(atribuicoes).length > 0) r.atribuicoes = atribuicoes
  const atribuicoesAt = contents.channelMemberRolesAt?.[canal]
  if (atribuicoesAt && Object.keys(atribuicoesAt).length > 0) r.atribuicoesAt = atribuicoesAt
  const fundador = contents.channelFounder[canal]
  if (fundador) r.fundador = fundador
  const admins = contents.channelAdmins[canal]
  if (admins && admins.length > 0) r.admins = admins
  const apresentacao = contents.spaceMeta[canal]
  if (apresentacao) r.apresentacao = apresentacao
  const apelidos = (contents as VaultContents & { apelidosDoCanal?: Record<string, Record<string, RegistoDeApelido>> })
    .apelidosDoCanal?.[canal]
  if (apelidos && Object.keys(apelidos).length > 0) r.apelidos = apelidos
  return r
}

/**
 * A copy of the payload without the media above `limite` characters per item,
 * for the page that goes to a sibling: large attachments become an `evicted`
 * marker (which a 1.1.x to 1.3.x client already reads), and large thumbnails
 * leave. Small ones go now with the text; large ones go later, in the
 * background (`juntarMediaDoIrmao`). Says whether it removed anything.
 *
 * It left the vault in version 3 (the vault no longer evicts): it is a rule of
 * the wire between siblings, not of what is stored.
 */
export function semMediaPesada(payload: StoredPayload, limite: number): { payload: StoredPayload; tirou: boolean } {
  const copia = structuredClone(payload)
  let tirou = false
  const texto = (valor: unknown): number => (typeof valor === "string" ? valor.length : 0)
  for (const key of ["attachments", "media"] as const) {
    const list = copia[key]
    if (!Array.isArray(list)) continue
    copia[key] = list.map((item): unknown => {
      if (typeof item !== "object" || item === null || (item as Record<string, unknown>)["evicted"] === true) return item
      const anexo = item as Record<string, unknown>
      const url = anexo["url"]
      const bytes = texto(anexo["inline"]) + (typeof url === "string" && url.startsWith("data:") ? url.length : 0)
      if (bytes === 0 || bytes <= limite) return item
      tirou = true
      return {
        evicted: true,
        name: typeof anexo["name"] === "string" ? anexo["name"] : "",
        mediaType: typeof anexo["mediaType"] === "string" ? anexo["mediaType"] : "",
      } satisfies EvictedMedia
    })
  }
  const links = copia["links"]
  if (Array.isArray(links)) {
    copia["links"] = links.map((item): unknown => {
      if (typeof item !== "object" || item === null || texto((item as Record<string, unknown>)["thumbnail"]) <= limite) return item
      tirou = true
      const card = { ...(item as Record<string, unknown>) }
      delete card["thumbnail"]
      return card
    })
  }
  return { payload: copia, tirou }
}

/**
 * The heavy media in this vault: the entries with bytes (only those with an
 * `id`, which is how the receiver finds them), the stored videos, and the
 * profiles with a portrait. `canais` limits it to those channels' entries (the
 * top-up between siblings already paired); without it, everything.
 *
 * It only counts what `presente` says is on this device, thumbnails included
 * (Ruling R3): a reference whose blob left is not offered.
 */
export function mediaDe(contents: VaultContents, eu: string, presente: Presente, canais?: readonly string[]): MediaNoIrmao[] {
  const itens: MediaNoIrmao[] = []
  const so = canais ? new Set(canais) : null
  for (const c of canaisComEntradas(contents)) {
    if (so && !so.has(c)) continue
    for (const entrada of entradasDoCanal(contents, c)) {
      const b = entryMediaBytes(entrada, presente, contents.media)
      const e = chaveDoEvento(entrada)
      if (b > 0 && e !== null) itens.push({ c, e, b })
    }
  }
  if (!so) {
    for (const [v, video] of Object.entries(contents.videos ?? {})) itens.push({ v, b: video.b64.length })
    // The videos in the store (through the post parts), under the same `sha` and in the same unit (base64url).
    const vistos = new Set(Object.keys(contents.videos ?? {}))
    for (const c of canaisComEntradas(contents)) {
      for (const entrada of entradasDoCanal(contents, c)) {
        for (const v of resumosDosVideos(entrada.payload["media"])) {
          const ref = contents.media?.[v]
          if (vistos.has(v) || !ref || !presente(v)) continue
          vistos.add(v)
          itens.push({ v, b: Math.ceil((ref.b * 4) / 3) })
        }
      }
    }
    for (const [a, perfil] of Object.entries(contents.directory)) {
      if (a === eu || perfil.parcial) continue
      const retrato = retratoDe(perfil.payload, contents, presente)
      if (retrato > 0) itens.push({ a, at: perfil.at, b: retrato })
    }
  }
  return itens
}

/**
 * The characters of a stored profile's portrait. The profile carries it in
 * `avatar.inline`, in `avatarDataUrl`, or (version 3) in a store reference
 * (`avatar.ref`), which counts if `presente` says the blob is there (Ruling
 * R15), with the length of the `inline` it rebuilds.
 */
export function retratoDe(payload: StoredPayload, contents?: VaultContents, presente: (sha: string) => boolean = () => true): number {
  const avatar = payload["avatar"]
  if (typeof avatar === "object" && avatar !== null && typeof (avatar as Record<string, unknown>)["inline"] === "string") {
    return ((avatar as Record<string, unknown>)["inline"] as string).length
  }
  const ref = typeof avatar === "object" && avatar !== null ? (avatar as Record<string, unknown>)["ref"] : undefined
  if (typeof ref === "string") return presente(ref) ? caracteresDaRef(contents?.media?.[ref]) : 0
  const url = payload["avatarDataUrl"]
  if (typeof url === "string") return url.length
  // The own profile shape (`StoredProfile.avatarRef`), by the same rule.
  const proprio = payload["avatarRef"]
  return typeof proprio === "string" && presente(proprio) ? caracteresDaRef(contents?.media?.[proprio]) : 0
}

/**
 * The requested items, whole, up to the response byte ceiling (the first always
 * goes). An item no longer here is left out. It goes out inflated, uncut: a
 * sibling receives everything this device has in the store, and never a `ref`.
 */
export async function mediaInteiraDe(
  contents: VaultContents,
  eu: string,
  pedidos: readonly ItemDeMediaDoIrmao[],
  inflar: InflarParaOIrmao,
): Promise<{ itens: MediaInteira[]; resto: number }> {
  const itens: MediaInteira[] = []
  let bytes = 0
  for (let indice = 0; indice < pedidos.length; indice++) {
    const pedido = pedidos[indice] as ItemDeMediaDoIrmao
    let item: MediaInteira | null = null
    if ("c" in pedido) {
      const entrada = entradasDoCanal(contents, pedido.c).find((e) => chaveDoEvento(e) === pedido.e)
      if (entrada) {
        // Inflated: whatever is not in the store goes `evicted`, and does not count.
        const p = await inflar.payload(entrada.payload)
        if (entryMediaBytes({ payload: p }) > 0) item = { c: pedido.c, e: pedido.e, p }
      }
    } else if ("v" in pedido) {
      let b64 = videoNoCofre(contents, pedido.v)
      if (b64 === null && contents.media?.[pedido.v]) {
        const bytes = await inflar.bytes(pedido.v)
        if (bytes) b64 = bytesParaBase64(bytes)
      }
      const at = contents.videos?.[pedido.v]?.at ?? contents.media?.[pedido.v]?.at ?? 0
      if (b64 !== null) item = { v: pedido.v, b64, at }
    } else if (pedido.a !== eu) {
      const perfil = contents.directory[pedido.a]
      if (perfil && !perfil.parcial) {
        const payload = await inflar.payload(perfil.payload)
        // Without the portrait here, the profile does not go: an old sibling would get the marker over the portrait it has.
        if (retratoDe(payload) > 0) item = { a: pedido.a, perfil: payload === perfil.payload ? perfil : { ...perfil, payload } }
      }
    }
    if (!item) continue
    const tamanho = JSON.stringify(item).length
    // `rest`: requests not served because of the limit, and the requester asks again.
    if (itens.length > 0 && bytes + tamanho > TECTOS_DO_HISTORICO.bytesPorRespostaDeMedia) return { itens, resto: pedidos.length - indice }
    itens.push(item)
    bytes += tamanho
  }
  return { itens, resto: 0 }
}

// ---------------------------------------------------------------- who requests

/**
 * Whether this vault lacks the media item the sibling has, and whether it is
 * worth asking for. A reference in the vault whose blob is not there
 * (`presente`) is missing.
 */
export function faltaAqui(contents: VaultContents, item: MediaNoIrmao, presente: Presente): boolean {
  if ("c" in item) return faltaMediaDaEntrada(contents, item.c, item.e, item.b, presente)
  if ("v" in item) return videoNoCofre(contents, item.v) === null && !(contents.media?.[item.v] && presente(item.v))
  const aqui = contents.directory[item.a]
  if (!aqui || aqui.parcial || aqui.at < item.at) return true
  return aqui.at === item.at && retratoDe(aqui.payload, contents, presente) === 0
}

/** The caller's request for an item from the sibling's list, without the size. */
export function pedidoDe(item: MediaNoIrmao): ItemDeMediaDoIrmao {
  if ("c" in item) return { c: item.c, e: item.e }
  if ("v" in item) return { v: item.v }
  return { a: item.a }
}

/** The key of an item to find it in the plan's list. */
export function chaveDoItem(item: ItemDeMediaDoIrmao): string {
  if ("c" in item) return `e|${item.c}|${item.e}`
  if ("v" in item) return `v|${item.v}`
  return `a|${item.a}`
}

/**
 * The records of the channel that the sibling had, stored in this vault. Each
 * one follows its record rule (`venceCarimbo`, with the foundation first), as
 * if the events had arrived here. The sibling has already validated the records
 * (the sibling decides what goes where), and the sibling is the account itself.
 */
export function fundirRegistosDoIrmao(contents: VaultContents, canal: string, r: RegistosDoCanal): void {
  const porCarimbo = (
    guardados: Record<string, StoredPeerProfile> | undefined,
    vindos: Record<string, StoredPeerProfile> | undefined,
  ): Record<string, StoredPeerProfile> | undefined => {
    if (!vindos) return guardados
    const juntos = { ...guardados }
    for (const [id, registo] of Object.entries(vindos)) {
      if (!registoValido(registo)) continue
      if (venceCarimbo(juntos[id], registo)) juntos[id] = structuredClone(registo)
    }
    return juntos
  }
  const salas = porCarimbo(contents.channelRooms[canal], r.salas)
  if (salas) contents.channelRooms[canal] = salas
  const categorias = porCarimbo(contents.channelCategories?.[canal], r.categorias)
  if (categorias) contents.channelCategories = { ...contents.channelCategories, [canal]: categorias }
  const cargos = porCarimbo(contents.channelRoles[canal], r.cargos)
  if (cargos) contents.channelRoles[canal] = cargos
  for (const [address, roles] of Object.entries(r.atribuicoes ?? {})) {
    if (!Array.isArray(roles) || !roles.every((role) => typeof role === "string")) continue
    const carimbo = r.atribuicoesAt?.[address]
    aplicarAtribuicao(contents, canal, address, roles, {
      at: typeof carimbo?.at === "number" ? carimbo.at : 0,
      seq: typeof carimbo?.seq === "number" ? carimbo.seq : -1,
      por: typeof carimbo?.por === "string" ? carimbo.por : "",
    })
  }
  if (r.fundador && typeof r.fundador.address === "string" && !contents.channelFounder[canal]) {
    contents.channelFounder[canal] = structuredClone(r.fundador)
  }
  if (Array.isArray(r.admins) && !contents.channelAdmins[canal]) {
    contents.channelAdmins[canal] = r.admins.filter((admin) => typeof admin === "string")
  }
  if (r.apresentacao && registoValido(r.apresentacao) && venceCarimbo(contents.spaceMeta[canal], r.apresentacao)) {
    contents.spaceMeta[canal] = structuredClone(r.apresentacao)
  }
  for (const [subject, apelido] of Object.entries(r.apelidos ?? {})) {
    if (typeof apelido?.valor !== "string" || typeof apelido.at !== "number") continue
    registarApelido(contents, canal, subject, apelido)
  }
}

function registoValido(registo: unknown): registo is StoredPeerProfile {
  if (typeof registo !== "object" || registo === null) return false
  const { at, payload } = registo as Record<string, unknown>
  return typeof at === "number" && typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>)["t"] === "string"
}

/**
 * A sibling's records without foreign references (Ruling R14, `soInlineOuEvicted`),
 * before `fundirRegistosDoIrmao`. A record without the right shape stays as it is:
 * `fundirRegistosDoIrmao` throws it away.
 */
export function registosSemRefs(r: RegistosDoCanal): RegistosDoCanal {
  const limpo = <T>(registo: T): T => {
    if (typeof registo !== "object" || registo === null) return registo
    const payload = (registo as { payload?: unknown }).payload
    if (typeof payload !== "object" || payload === null) return registo
    return { ...registo, payload: soInlineOuEvicted(payload as StoredPayload) }
  }
  const mapa = (registos: Record<string, StoredPeerProfile>): Record<string, StoredPeerProfile> =>
    typeof registos === "object" ? Object.fromEntries(Object.entries(registos).map(([id, registo]) => [id, limpo(registo)])) : registos
  return {
    ...r,
    ...(r.salas ? { salas: mapa(r.salas) } : {}),
    ...(r.categorias ? { categorias: mapa(r.categorias) } : {}),
    ...(r.cargos ? { cargos: mapa(r.cargos) } : {}),
    ...(r.apresentacao ? { apresentacao: limpo(r.apresentacao) } : {}),
    ...(r.fundador ? { fundador: limpo(r.fundador) } : {}),
  }
}

/** The channel record the sibling announced, if this vault does not have it yet. */
export function fichaDoIrmao(contents: VaultContents, canal: string, ficha: FichaDoCanal | undefined): void {
  if (!ficha || !["directa", "mural", "sala"].includes(ficha.tipo)) return
  registarFicha(contents, canal, ficha)
}

/**
 * An entry as it came from the wire, if it has the shape of a vault entry. The
 * sibling is the account itself, but a faulty vault does not reject the transfer.
 */
export function entradaValida(valor: unknown): valor is StoredChatMessage {
  if (typeof valor !== "object" || valor === null) return false
  const e = valor as Record<string, unknown>
  return (
    typeof e["seq"] === "number" &&
    Number.isSafeInteger(e["seq"]) &&
    typeof e["sender"] === "string" &&
    typeof e["at"] === "number" &&
    typeof e["payload"] === "object" &&
    e["payload"] !== null &&
    typeof (e["payload"] as Record<string, unknown>)["t"] === "string"
  )
}
