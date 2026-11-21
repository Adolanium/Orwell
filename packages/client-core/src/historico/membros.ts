import { sha256 } from "@noble/hashes/sha2.js"
import { abrirBloco, chaveDoHistorico, novoParDoHistorico, selarBloco, selarSinal, type ChaveDoSinal, type ParDoHistorico } from "@enclave/crypto"
import { canonicoTolerante, fromBase64, toBase64, verify, type ItemRelatado } from "@enclave/protocol"
import { entradasDoCanal, type VaultContents } from "../vault.js"
import { TectoPorMinuto, type Folha } from "../sincronia/eleicao.js"
import type { QuemRelata } from "../sincronia/relato.js"
import { comJanela, parDeChaves, type ItemDoResumo } from "../sincronia/resumo.js"
import { comprimir, descomprimir } from "./historico.js"

/**
 * The past of a channel, served by other members (D2, 20/11/2026).
 *
 * The rule: an account that joined yesterday reads the whole channel, except
 * the rooms it may not see. The server keeps thirty days and MLS gives forward
 * secrecy, so the past only lives on members' devices. This module has one
 * member give it to whoever is missing it, device to device.
 *
 * ## The path
 *
 * Ephemeral signals (`channel.sinal`) of the channel itself, which the server
 * passes to whoever is online and does not store. Two layers, as in the
 * history between devices (`historico.ts`): outside, the signal key of the
 * channel's epoch (only members open it); inside, a key for just the two
 * devices talking (ephemeral X25519 on both sides, `chaveDoHistorico`). The
 * other members see that something passes, not what: a room of a restricted
 * category goes only to whoever may see it.
 *
 * The first byte is `MAGIA_DOS_MEMBROS`. Anti-entropy opens the channel signal,
 * sees the byte and hands the opened bytes here. An older client tries to read
 * JSON, fails, and drops it as illegible (it does not count toward deafness).
 *
 * ## The wire
 *
 * - `mi`: the requester opens a session with ONE member (`para`): its
 *   ephemeral key and its place `l`. Never to everyone at once.
 * - `mn`: the inventory, sealed: `[bucket, hash]` per bucket of 256 `seq`
 *   below `l`, over what the requester may read. No counts.
 * - `mp`: a page request, sealed: a bucket and a cursor.
 * - `mr`: the page, sealed: reported items (`ItemRelatado`, with `autoria`),
 *   the new cursor, and whether the bucket ended.
 * - `mx`: "I do not know that session", or "busy" with `r` ms to wait.
 *
 * ## What the responder sends
 *
 * It decides alone, from its own vault: windowed items (messages, edits,
 * tombstones, reactions) with a known `seq` below the requester's place, with
 * authorship, never one its vault holds as deleted, and only in rooms the
 * requester may read by the roles and categories THIS device knows. The
 * requester says nothing about its own roles, and would not be believed.
 *
 * ## What the requester accepts
 *
 * Each item goes through `receberItem` (the anti-entropy rules: authorship,
 * device chain, manifest and revocation, block, tombstone, already held), with
 * the place rule turned around: only below the place. See
 * `AntiEntropia.aplicarDoPassado`.
 *
 * **The server does not change.** It counts the bytes of a signal times the
 * connections in the channel; this module spends from the anti-entropy budget,
 * behind it (`AntiEntropia.gastarSinalDosMembros`).
 */

/** The first byte of a D2 signal, after the channel signal is opened. JSON starts with `{`. */
export const MAGIA_DOS_MEMBROS = 0x4d

/**
 * The lines of a channel the sync on joining brings, and the lines one "Load older"
 * brings after them (history-last-100, 1.3.26). The one number for both, here and in
 * the interface (`MEMORY_PER_CHANNEL`, `HISTORY_PAGE`).
 */
export const HISTORY_PAGE_LINES = 100

/** The numbers. Mutable only for tests to lower them. */
export const TECTOS_DOS_MEMBROS = {
  /** The largest signal that goes out, in characters. The server refuses above 16 KiB. */
  sinalMaxCaracteres: 12 * 1024,
  /**
   * Bytes of each part of a response. Small on purpose: the server delivers a
   * copy to every connection in the channel, and the cost of a part is its size
   * times that number.
   */
  bytesPorParte: 4 * 1024,
  /** Parts of one response, at most. */
  partesMax: 64,
  /** The text of a response, after decompression, at most. */
  descomprimidoMax: 1024 * 1024,
  /** `seq` per bucket of the inventory. */
  seqPorBalde: 256,
  /** Buckets in one inventory, at most (the most recent ones). */
  baldesNoInventario: 2_048,
  /** Items per page, and JSON bytes per page. Items of the same `seq` never split. */
  itensPorPagina: 40,
  bytesPorPagina: 24 * 1024,
  /** Without an inventory in answer to `mi` in this time, ask another member. */
  esperaDoInventarioMs: 20_000,
  /** Without a part of a response in this time, ask again. */
  esperaDaRespostaMs: 30_000,
  /** Times to ask the same page again before leaving the member. */
  tentativasPorPedido: 2,
  /** Members asked in one round of a channel, one after the other. */
  membrosPorVolta: 3,
  /** The first round, after connecting: the server recovery and the account history run first. */
  primeiraVoltaMs: 20_000,
  /** A channel already complete is checked again after this. */
  intervaloMs: 30 * 60_000,
  /** A round where nobody answered: the channel waits this long. */
  semRespostaMs: 5 * 60_000,
  /** The clock step. */
  passoMs: 2_000,
  /** The responder: sessions at the same time, and pages per requesting device per minute. */
  sessoesNoRespondedor: 4,
  paginasPorPedintePorMinuto: 12,
  /** The responder forgets a silent session after this. */
  sessaoCaladaMs: 10 * 60_000,
  /** A requesting device opens at most one session per this time (`mi`). */
  miPorAparelhoMs: 30_000,
  /** The inventory for the same (account, place) is reused for this long. */
  inventarioEmCacheMs: 5 * 60_000,
  /** Signals waiting for the budget, at most, and for how long. */
  filaMax: 128,
  filaEsperaMaxMs: 60_000,
  /**
   * The lines of conversation the sync on joining brings per channel (history-last-100,
   * 1.3.26). The past older than these comes only when the reader asks for it
   * ("Load older", `loadOlder`), one page of `linesPerLoad` at a time.
   */
  linesOnJoin: HISTORY_PAGE_LINES,
  /** The lines one "Load older" asks the members for. */
  linesPerLoad: HISTORY_PAGE_LINES,
}

/** For tests only. */
export const _paraTestes: {
  /** The responder (`quem`, its account) changes a page before it seals it: a dishonest member. */
  adulterarPagina: ((canal: string, itens: ItemRelatado[], quem: string) => ItemRelatado[]) | null
  /** The requester asks this account first, when it is a candidate. */
  primeiro: string | null
} = { adulterarPagina: null, primeiro: null }

/** What the module needs from the session. */
export interface PortaDosMembros {
  eu(): QuemRelata
  conteudo(): VaultContents | null
  /** The channels that can have a past to fetch: not the account channel, not a direct, with a group. */
  canais(): string[]
  /**
   * The `seq` below which this ACCOUNT does not have the channel (its place, or
   * the sibling's when the account history brought it). `null`: nothing is
   * missing, or the place is not known.
   */
  lugar(canal: string): number | null
  folhas(canal: string): Folha[]
  /** The leaf is alive: a recent signal, or the account connected. */
  viva(canal: string, folha: Folha): boolean
  derivarChave(canal: string): Promise<ChaveDoSinal | null>
  podeSinalizar(): boolean
  /** Spend from the shared signal budget (anti-entropy). `false`: not now. */
  gastar(canal: string, caracteres: number): boolean
  /**
   * `para`: the one device it is for. A server with `CAPACIDADE_SINAL_PARA`
   * delivers it only to that device's connections; the session leaves it out
   * for a server without it, which broadcasts.
   */
  enviarSinal(canal: string, sinal: string, ref: string, para: string): void
  /** The history between devices of the account is bringing something: it goes first. */
  arcaACorrer(): boolean
  /** This device answers requests. Off, it is silent, like a client before D2. */
  responde(): boolean
  bloqueado(canal: string, autor: string): boolean
  /** Whether `quem` may read this room, by the roles and categories this device knows. */
  podeLerSala(canal: string, quem: string, sala: string): boolean
  /** The channel has at least one category restricted to roles. */
  salasRestritas(canal: string): boolean
  /**
   * The lines of conversation (`message`) this account holds in the channel, on this
   * device: the vault and the archive past it. The sync on joining stops at
   * `linesOnJoin` of them.
   */
  lines(canal: string): number
  /** This device's items in the channel, deleted ones left out. */
  itens(canal: string): ItemDoResumo[]
  /** The items, ready to send with authorship, in the same order; `null` for one that cannot go. */
  relatar(canal: string, itens: readonly ItemDoResumo[]): Promise<(ItemRelatado | null)[]>
  /**
   * Check and store items of the past (below `lugar`). `rooms`: the lines (`message`)
   * stored, per room (`""` is the default room).
   */
  receber(
    canal: string,
    itens: readonly unknown[],
    lugar: number,
  ): Promise<{ aplicados: number; recusados: Record<string, number>; rooms?: Record<string, number> }>
  /** A change to the vault, in the session's write batch. */
  gravar(mudar: (contents: VaultContents) => void): void
  agora(): number
  /** The set of channels whose past is arriving may have changed (`canaisATrazer`). */
  mudou?(): void
}

/** What the module keeps in the vault, per channel (a loose field, like `sincronia`). */
export interface EstadoDosMembrosNoCanal {
  /** Bucket to the responder's hash it was fetched with: the same hash is not fetched again. */
  trazidos?: Record<string, string>
  /**
   * The buckets still to fetch, the most recent first. `cursor`: an ascending fetch
   * in progress (a responder before history-last-100, or a plan written before it).
   * `under`: a newest-first fetch in progress, everything at or above it came.
   */
  porTrazer?: { b: number; h: string; cursor: number | null; under?: number }[]
  /** A member's inventory left nothing to fetch: the past is complete on this device. */
  complete?: true
  /** The device that served this channel last: the next round asks it last (rotation, MED-01). */
  ultimo?: string
}

export interface CofreDosMembros {
  historicoDosMembros?: Record<string, EstadoDosMembrosNoCanal>
}

// ------------------------------------------------------------- pure parts

export function baldeDe(seq: number): number {
  return Math.floor(seq / TECTOS_DOS_MEMBROS.seqPorBalde)
}

function porSeq(a: ItemDoResumo, b: ItemDoResumo): number {
  const diferenca = (a.fonte?.seq ?? -1) - (b.fonte?.seq ?? -1)
  if (diferenca !== 0) return diferenca
  return a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0
}

/** The room of each conversation entry with an `id`, for edits, reactions and tombstones. */
export function salasPorId(contents: VaultContents, canal: string): Map<string, string> {
  const salas = new Map<string, string>()
  for (const entrada of entradasDoCanal(contents, canal)) {
    const p = entrada.payload as Record<string, unknown>
    if (p["t"] !== "message" || typeof p["id"] !== "string") continue
    salas.set(p["id"], typeof p["room"] === "string" ? p["room"] : "")
  }
  return salas
}

/** The room an item belongs to: its own, or its target's. `null`: not known here. */
export function salaDoItem(item: ItemDoResumo, salas: ReadonlyMap<string, string>): string | null {
  const p = item.fonte?.payload as Record<string, unknown> | undefined
  if (!p) return null
  if (p["t"] === "message") return typeof p["room"] === "string" ? p["room"] : ""
  const alvo = p["target"]
  return typeof alvo === "string" ? (salas.get(alvo) ?? null) : null
}

/** Who is reading: the rooms they may read, by this device's rules. */
export interface Leitor {
  podeLerSala(sala: string): boolean
  /** The channel has a restricted category: an item whose room is not known here does not go. */
  salasRestritas: boolean
}

/**
 * Whether an account may read a room, for the channel's past (the rule the
 * session feeds with what THIS device knows).
 *
 * - A room this device does not know (`categoria` `null`): only the default
 *   room `""`, or any room when the channel has no restricted category
 *   (LOW-02). An unknown room in a channel with restricted categories may be
 *   one of them.
 * - A room outside a category, or in a category without roles: everyone.
 * - Otherwise the founder, an admin, whoever manages the channel, or whoever
 *   holds one of the category's roles.
 */
export function leSala(o: {
  sala: string
  categoria: string | null
  rolesDaCategoria: readonly unknown[] | undefined
  restritas: boolean
  privilegiado: boolean
  papeis: readonly string[]
}): boolean {
  if (o.categoria === null) return o.sala === "" || !o.restritas
  if (!o.categoria || !o.rolesDaCategoria || o.rolesDaCategoria.length === 0) return true
  if (o.privilegiado) return true
  return o.rolesDaCategoria.some((papel) => typeof papel === "string" && o.papeis.includes(papel))
}

/** Everyone reads everything: the requester's view of its own items. */
export const TODOS_LEEM: Leitor = { podeLerSala: () => true, salasRestritas: false }

/**
 * The channel's past that `leitor` may read: windowed items with a known
 * `seq` below `lugar`, with a source, in rooms the reader may read. In `seq`
 * order. `itens` must already leave deleted ones out (`itensDoCanal` does).
 */
export function passadoLegivel(
  itens: readonly ItemDoResumo[],
  contents: VaultContents,
  canal: string,
  lugar: number,
  leitor: Leitor,
): ItemDoResumo[] {
  const salas = salasPorId(contents, canal)
  const saida: ItemDoResumo[] = []
  for (const item of itens) {
    if (!item.fonte || !comJanela(item)) continue
    const seq = item.fonte.seq
    if (seq < 0 || seq >= lugar) continue
    const sala = salaDoItem(item, salas)
    if (sala === null ? leitor.salasRestritas : !leitor.podeLerSala(sala)) continue
    saida.push(item)
  }
  return saida.sort(porSeq)
}

/** The hash of each bucket: the first 8 bytes of SHA-256 over the sorted keys. No counts. */
export function inventarioDosMembros(itens: readonly ItemDoResumo[]): Map<number, string> {
  const chaves = new Map<number, string[]>()
  for (const item of itens) {
    const b = baldeDe(item.fonte?.seq ?? 0)
    const lista = chaves.get(b)
    if (lista) lista.push(item.chave)
    else chaves.set(b, [item.chave])
  }
  const saida = new Map<number, string>()
  for (const [b, lista] of chaves) saida.set(b, parDeChaves(lista).h)
  return saida
}

/**
 * The next page of bucket `b` after the cursor `desde` (a `seq`), from items
 * in `seq` order: at most `max`, but never a `seq` split between two pages.
 */
export function escolherPagina(
  itens: readonly ItemDoResumo[],
  b: number,
  desde: number | null,
  max: number,
): { escolhidos: ItemDoResumo[]; fim: boolean } {
  const doBalde = itens.filter((item) => baldeDe(item.fonte!.seq) === b && (desde === null || item.fonte!.seq > desde))
  let ate = Math.min(max, doBalde.length)
  // Grow to the end of the last `seq`: an item with the same `seq` comes on the same page.
  while (ate > 0 && ate < doBalde.length && doBalde[ate]!.fonte!.seq === doBalde[ate - 1]!.fonte!.seq) ate += 1
  return { escolhidos: doBalde.slice(0, ate), fim: ate >= doBalde.length }
}

/**
 * The next page of bucket `b` below `under` (a `seq`; `null`: the top of the bucket),
 * newest first: the last `max` items, but never a `seq` split between two pages
 * (history-last-100). The items stay in `seq` order. `fim`: nothing older is left.
 */
export function choosePageNewestFirst(
  itens: readonly ItemDoResumo[],
  b: number,
  under: number | null,
  max: number,
): { escolhidos: ItemDoResumo[]; fim: boolean } {
  const inBucket = itens.filter((item) => baldeDe(item.fonte!.seq) === b && (under === null || item.fonte!.seq < under))
  let from = Math.max(0, inBucket.length - max)
  // Grow to the start of the first `seq`: an item with the same `seq` comes on the same page.
  while (from > 0 && from < inBucket.length && inBucket[from - 1]!.fonte!.seq === inBucket[from]!.fonte!.seq) from -= 1
  return { escolhidos: inBucket.slice(from), fim: from === 0 }
}

/**
 * `cortarPorBytes` for a newest-first page: what does not fit is the OLDEST `seq`,
 * and `ate` is the lowest `seq` that went. The newest `seq` always goes.
 */
export function cutByBytesNewestFirst(
  escolhidos: readonly ItemDoResumo[],
  relatados: readonly (ItemRelatado | null)[],
  bytesMax: number,
): { itens: ItemRelatado[]; ate: number | null; cortada: boolean } {
  const itens: ItemRelatado[] = []
  let bytes = 0
  let ate: number | null = null
  for (let i = escolhidos.length - 1; i >= 0; i--) {
    const seq = escolhidos[i]!.fonte!.seq
    const relatado = relatados[i] ?? null
    const tamanho = relatado ? new TextEncoder().encode(JSON.stringify(relatado)).length + 1 : 0
    if (seq !== ate && ate !== null && bytes + tamanho > bytesMax) return { itens: itens.reverse(), ate, cortada: true }
    if (relatado) itens.push(relatado)
    bytes += tamanho
    ate = seq
  }
  return { itens: itens.reverse(), ate, cortada: false }
}

/**
 * Cut the reported page at `bytesMax` of JSON, on a `seq` boundary. The first
 * `seq` always goes, so a large item still moves the cursor.
 */
export function cortarPorBytes(
  escolhidos: readonly ItemDoResumo[],
  relatados: readonly (ItemRelatado | null)[],
  bytesMax: number,
): { itens: ItemRelatado[]; ate: number | null; cortada: boolean } {
  const itens: ItemRelatado[] = []
  let bytes = 0
  let ate: number | null = null
  for (let i = 0; i < escolhidos.length; i++) {
    const seq = escolhidos[i]!.fonte!.seq
    const relatado = relatados[i] ?? null
    const tamanho = relatado ? new TextEncoder().encode(JSON.stringify(relatado)).length + 1 : 0
    const novoSeq = seq !== ate
    if (novoSeq && ate !== null && bytes + tamanho > bytesMax) return { itens, ate, cortada: true }
    if (relatado) itens.push(relatado)
    bytes += tamanho
    ate = seq
  }
  return { itens, ate, cortada: false }
}

// --------------------------------------------------------------- the wire

interface Cabecalho {
  v: 1
  k: "mi" | "mn" | "mp" | "mr" | "mx"
  s: string
  ap: string
  as?: string
  para?: string
  id?: string
  i?: number
  n?: number
  x?: string
  l?: number
  r?: number
}

/**
 * `d: 1` asks the page newest first, below `u` (`null`: the top of the bucket), and
 * `m` asks for at most that many items (history-last-100). A responder before them
 * reads neither, and answers the ascending page after `desde`.
 */
interface PedidoDePagina {
  b: number
  desde: number | null
  d?: 1
  u?: number | null
  m?: number
}

/** `d: 1`: the page is newest first, and `ate` is its lowest `seq`. */
interface Pagina {
  b: number
  e: unknown[]
  ate: number | null
  fim: boolean
  d?: 1
}

/** What one "Load older" from the members ended with (history-last-100). */
export interface LoadOlderResult {
  /**
   * `loaded`: lines came, or members served and more may come. `end`: the past is
   * complete on this device. `no-member`: no member online answered. `offline`: no
   * connection to ask on.
   */
  outcome: "loaded" | "end" | "no-member" | "offline"
  /** The lines of the asked room (or of the channel) that came. */
  lines: number
}

interface Demand {
  room: string | null
  want: number
  got: number
  resolvers: ((result: LoadOlderResult) => void)[]
}

const inteiro = (valor: unknown): valor is number => typeof valor === "number" && Number.isSafeInteger(valor)
const textoCurto = (valor: unknown, max: number): valor is string => typeof valor === "string" && valor.length <= max

function mensagemDoSinal(canal: string, address: string, epoca: bigint, cabecalho: Omit<Cabecalho, "as">, corpo: Uint8Array): Uint8Array {
  const prefixo = new TextEncoder().encode(
    `orwell-historico-membros-sinal-v1\0${canal}\0${address}\0${epoca}\0${canonicoTolerante(cabecalho)}\0`,
  )
  return juntar(prefixo, sha256(corpo))
}

function embrulhar(cabecalho: Cabecalho, corpo: Uint8Array): Uint8Array {
  const texto = new TextEncoder().encode(JSON.stringify(cabecalho))
  const saida = new Uint8Array(3 + texto.length + corpo.length)
  saida[0] = MAGIA_DOS_MEMBROS
  new DataView(saida.buffer).setUint16(1, texto.length, false)
  saida.set(texto, 3)
  saida.set(corpo, 3 + texto.length)
  return saida
}

function desembrulhar(bytes: Uint8Array): { cabecalho: Cabecalho; corpo: Uint8Array } | null {
  if (bytes.length < 3 || bytes[0] !== MAGIA_DOS_MEMBROS) return null
  const comprimento = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(1, false)
  if (3 + comprimento > bytes.length) return null
  let c: Record<string, unknown>
  try {
    c = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3, 3 + comprimento))) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof c !== "object" || c === null || c["v"] !== 1) return null
  if (!["mi", "mn", "mp", "mr", "mx"].includes(c["k"] as string)) return null
  if (!textoCurto(c["s"], 32) || !textoCurto(c["ap"], 64)) return null
  if (c["as"] !== undefined && !textoCurto(c["as"], 128)) return null
  if (c["para"] !== undefined && !textoCurto(c["para"], 64)) return null
  if (c["id"] !== undefined && !textoCurto(c["id"], 32)) return null
  if (c["x"] !== undefined && !textoCurto(c["x"], 64)) return null
  for (const campo of ["i", "n", "l", "r"]) if (c[campo] !== undefined && !(inteiro(c[campo]) && (c[campo] as number) >= 0)) return null
  return { cabecalho: c as unknown as Cabecalho, corpo: bytes.subarray(3 + comprimento) }
}

function juntar(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((soma, parte) => soma + parte.length, 0)
  const saida = new Uint8Array(total)
  let em = 0
  for (const parte of partes) {
    saida.set(parte, em)
    em += parte.length
  }
  return saida
}

function partir(bytes: Uint8Array): Uint8Array[] {
  const passo = TECTOS_DOS_MEMBROS.bytesPorParte
  const partes: Uint8Array[] = []
  for (let em = 0; em < bytes.length; em += passo) partes.push(bytes.subarray(em, em + passo))
  if (partes.length === 0) partes.push(new Uint8Array(0))
  return partes
}

function novoId(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(9)))
}

/** The session salt binds the channel: a block from one channel does not open in another. */
function sessaoNoCanal(canal: string, s: string): string {
  return `membros\0${canal}\0${s}`
}

/**
 * The order of candidates: a hash of a salt drawn for each round and of the
 * device. Each round, and each newcomer, starts with a different member, and
 * no member can place itself first.
 */
function ordemDe(sal: string, aparelho: string): string {
  return toBase64(sha256(new TextEncoder().encode(`${sal}\0${aparelho}`)))
}

// ------------------------------------------------------------ the module

interface Chegada {
  id: string
  n: number
  partes: (Uint8Array | undefined)[]
  recebidas: number
}

interface SessaoDeQuemPede {
  canal: string
  s: string
  par: ParDoHistorico
  aberta: number
  com: Folha
  lugar: number
  chave?: Uint8Array
  inventario?: Chegada | undefined
  pedido?: { id: string; corpo: PedidoDePagina; enviadoEm: number; ultimaParte: number; tentativas: number } | undefined
  chegada?: Chegada | undefined
}

interface SessaoDeQuemResponde {
  canal: string
  chave: Uint8Array
  /** The requesting device, base64url. */
  para: string
  /** Its account: the permissions are computed for it. */
  quem: string
  lugar: number
  ultimo: number
  /** The page ids served in this session. */
  servidos: Set<string>
}

export interface EstatisticasDosMembros {
  enviados: number
  recebidos: number
  ilegiveis: number
  /** Sessions opened by this device as requester, and members that did not answer. */
  sessoes: number
  semResposta: number
  paginasPedidas: number
  paginasRecebidas: number
  aplicados: number
  recusados: Record<string, number>
  /** Bytes of the D2 signals for this device, opened (the past's cost on the wire, about). */
  bytesRecebidos: number
  /** As responder. */
  sessoesServidas: number
  paginasServidas: number
  ocupado: number
}

export class HistoricoDosMembros {
  readonly #porta: PortaDosMembros
  #pedinte: SessaoDeQuemPede | null = null
  readonly #respostas = new Map<string, SessaoDeQuemResponde>()
  /** Per channel, the members already asked in this round. */
  readonly #tentados = new Map<string, Set<string>>()
  /** Per channel, not before this instant. Memory only: a reload checks again, once. */
  readonly #proximaEm = new Map<string, number>()
  /** Per channel, the members that served in this round (MED-01: more than one per round). */
  readonly #serviram = new Map<string, number>()
  /** Per channel, the salt of this round's order. */
  readonly #sal = new Map<string, string>()
  /** Devices that answered a `mi` of ours: they know D2, and are asked first. */
  readonly #conhecem = new Set<string>()
  readonly #paginasPorPedinte = new TectoPorMinuto()
  /** Responder: one `mi` per requesting device per `miPorAparelhoMs`. */
  readonly #misPorAparelho = new TectoPorMinuto(TECTOS_DOS_MEMBROS.miPorAparelhoMs)
  /** Responder: sessions already seen (`aparelho|s`), so a repeated `mi` is ignored. */
  readonly #sessoesVistas = new Set<string>()
  /** Responder: the inventory per `canal|account|place`, for `inventarioEmCacheMs`. */
  readonly #inventarios = new Map<string, { em: number; b: [number, string][] }>()
  readonly #fila: { canal: string; sinal: string; para: string; em: number }[] = []
  #bomba: ReturnType<typeof setTimeout> | undefined
  #relogio: ReturnType<typeof setInterval> | undefined
  #ligadoEm = 0
  #cadeia: Promise<void> = Promise.resolve()
  /** Per channel, a "Load older" waiting for the members (history-last-100). Memory only. */
  readonly #demands = new Map<string, Demand>()
  /**
   * Per channel, the session that stopped because what was asked came (`#pause`). The
   * next "Load older" goes on in it: a member answers one `mi` per device per
   * `miPorAparelhoMs` (MED-03), and a new session right after the sync on joining
   * would wait for nothing.
   */
  readonly #parked = new Map<string, { sessao: SessaoDeQuemPede; em: number }>()
  readonly estatisticas: EstatisticasDosMembros = {
    enviados: 0,
    recebidos: 0,
    ilegiveis: 0,
    sessoes: 0,
    semResposta: 0,
    paginasPedidas: 0,
    paginasRecebidas: 0,
    aplicados: 0,
    recusados: {},
    bytesRecebidos: 0,
    sessoesServidas: 0,
    paginasServidas: 0,
    ocupado: 0,
  }

  constructor(porta: PortaDosMembros) {
    this.#porta = porta
  }

  // ----------------------------------------------------------- connection

  aoLigar(): void {
    this.aoDesligar()
    this.#ligadoEm = this.#porta.agora()
    this.#relogio = setInterval(() => void this.#passo(), TECTOS_DOS_MEMBROS.passoMs)
    ;(this.#relogio as { unref?: () => void }).unref?.()
  }

  /** The connection dropped: sessions die with it. The plan stays in the vault. */
  aoDesligar(): void {
    if (this.#relogio !== undefined) clearInterval(this.#relogio)
    this.#relogio = undefined
    if (this.#bomba !== undefined) clearTimeout(this.#bomba)
    this.#bomba = undefined
    const trazia = this.#pedinte !== null
    this.#pedinte = null
    this.#respostas.clear()
    this.#tentados.clear()
    this.#serviram.clear()
    this.#sal.clear()
    this.#fila.length = 0
    this.#parked.clear()
    for (const canal of [...this.#demands.keys()]) this.#settle(canal, "offline")
    if (trazia) this.#porta.mudou?.()
  }

  /**
   * The channels whose past is arriving now: a session with a member is open
   * and its inventory left buckets to fetch. Empty when nothing is coming.
   */
  canaisATrazer(): string[] {
    const pedinte = this.#pedinte
    const contents = this.#porta.conteudo()
    if (!pedinte?.chave || !contents) return []
    if (!this.#demands.has(pedinte.canal) && !this.#wantsMore(pedinte.canal)) return []
    return (this.#estado(contents, pedinte.canal)?.porTrazer?.length ?? 0) > 0 ? [pedinte.canal] : []
  }

  /**
   * The sync on joining brings the newest `linesOnJoin` lines of a channel, not its
   * whole past (history-last-100): below them, the channel waits for "Load older".
   */
  #wantsMore(canal: string): boolean {
    return this.#porta.lines(canal) < TECTOS_DOS_MEMBROS.linesOnJoin
  }

  /**
   * Whether the members may still have past of this channel for this account: it has
   * a place, and no inventory said the past is complete here. Before any inventory it
   * is not known, and that counts as yes.
   */
  hasOlder(canal: string): boolean {
    const lugar = this.#porta.lugar(canal)
    if (lugar === null || lugar <= 0) return false
    const contents = this.#porta.conteudo()
    const estado = contents ? this.#estado(contents, canal) : undefined
    if (!estado || (estado.porTrazer?.length ?? 0) > 0) return true
    // `trazidos` with nothing left to fetch: a plan from before history-last-100 that ended.
    return estado.complete !== true && estado.trazidos === undefined
  }

  /**
   * "Load older" past what this device holds (history-last-100): the next
   * `linesPerLoad` lines of the channel's past, of `room` when given, from a member
   * online, newest first. It answers when they came, when the past ended, or when the
   * round of members ended. A second call for the same channel joins the first.
   */
  loadOlder(canal: string, room?: string): Promise<LoadOlderResult> {
    if (!this.#porta.podeSinalizar() || !this.#porta.conteudo()) return Promise.resolve({ outcome: "offline", lines: 0 })
    if (!this.#porta.canais().includes(canal) || !this.hasOlder(canal)) return Promise.resolve({ outcome: "end", lines: 0 })
    return new Promise((resolve) => {
      const actual = this.#demands.get(canal)
      if (actual) {
        actual.resolvers.push(resolve)
        return
      }
      this.#demands.set(canal, { room: room ?? null, want: TECTOS_DOS_MEMBROS.linesPerLoad, got: 0, resolvers: [resolve] })
      // A new round for this channel, now: not the one the clock left resting.
      this.#proximaEm.delete(canal)
      this.#tentados.delete(canal)
      this.#serviram.delete(canal)
      this.#sal.delete(canal)
      void this.#passo()
    })
  }

  #settle(canal: string, outcome: LoadOlderResult["outcome"]): void {
    const demand = this.#demands.get(canal)
    if (!demand) return
    this.#demands.delete(canal)
    for (const resolve of demand.resolvers) resolve({ outcome, lines: demand.got })
  }

  /** The session stops with buckets left: what was asked came. The member is not counted as tried. */
  #pause(pedinte: SessaoDeQuemPede): void {
    if (this.#pedinte === pedinte) this.#pedinte = null
    if (pedinte.chave) this.#parked.set(pedinte.canal, { sessao: pedinte, em: this.#porta.agora() })
    this.#tentados.delete(pedinte.canal)
    this.#serviram.delete(pedinte.canal)
    this.#sal.delete(pedinte.canal)
    this.#proximaEm.set(pedinte.canal, this.#porta.agora() + TECTOS_DOS_MEMBROS.intervaloMs)
  }

  /** Check every channel now (tests, and "Sync now"). */
  pedirAgora(): void {
    this.#proximaEm.clear()
    this.#tentados.clear()
    this.#serviram.clear()
    this.#sal.clear()
    this.#ligadoEm = Math.min(this.#ligadoEm, this.#porta.agora() - TECTOS_DOS_MEMBROS.primeiraVoltaMs)
    void this.#passo()
  }

  #emSerie(trabalho: () => Promise<void>): Promise<void> {
    const proximo = this.#cadeia.then(trabalho).catch(() => {
      // A failed step does not stop the next ones.
    })
    this.#cadeia = proximo
    return proximo
  }

  #passo(): Promise<void> {
    return this.#emSerie(async () => {
      await this.#passoAgora()
      this.#porta.mudou?.()
    })
  }

  async #passoAgora(): Promise<void> {
    if (!this.#porta.podeSinalizar() || !this.#porta.conteudo()) return
    const agora = this.#porta.agora()
    for (const [s, sessao] of this.#respostas) if (agora - sessao.ultimo > TECTOS_DOS_MEMBROS.sessaoCaladaMs) this.#respostas.delete(s)
    this.#bombear()
    const pedinte = this.#pedinte
    if (pedinte) return this.#vigiar(pedinte, agora)
    /*
      What the reader asked for goes first, and does not wait for the first round
      nor for the account history: someone is looking at the button.
    */
    const asked = [...this.#demands.keys()]
    // The account's own history first: what a sibling brings is the account's past.
    const automatic = agora - this.#ligadoEm >= TECTOS_DOS_MEMBROS.primeiraVoltaMs && !this.#porta.arcaACorrer()
    const canais = this.#porta.canais()
    for (const canal of [...asked, ...(automatic ? canais.filter((canal) => !this.#demands.has(canal)) : [])]) {
      const demand = this.#demands.get(canal)
      if (!demand && (this.#proximaEm.get(canal) ?? 0) > agora) continue
      const lugar = this.#porta.lugar(canal)
      if (lugar === null || lugar <= 0 || !canais.includes(canal)) {
        if (demand) this.#settle(canal, "end")
        else this.#proximaEm.set(canal, agora + TECTOS_DOS_MEMBROS.intervaloMs)
        continue
      }
      // The newest lines are here: the rest waits for "Load older" (history-last-100).
      if (!demand && !this.#wantsMore(canal)) {
        this.#proximaEm.set(canal, agora + TECTOS_DOS_MEMBROS.intervaloMs)
        continue
      }
      /*
        The session that stopped for this channel goes on, while its member still
        remembers it (half of `sessaoCaladaMs`, to be safe) and is still a live leaf.
      */
      const parked = this.#parked.get(canal)
      this.#parked.delete(canal)
      if (
        demand &&
        parked &&
        agora - parked.em < TECTOS_DOS_MEMBROS.sessaoCaladaMs / 2 &&
        this.#candidatos(canal).some((folha) => folha.aparelho === parked.sessao.com.aparelho)
      ) {
        this.#pedinte = parked.sessao
        return this.#proximoPedido(parked.sessao)
      }
      const tentados = this.#tentados.get(canal) ?? new Set<string>()
      const membro = this.#candidatos(canal).find((folha) => !tentados.has(folha.aparelho))
      if (!membro || tentados.size >= TECTOS_DOS_MEMBROS.membrosPorVolta) {
        this.#acabarVolta(canal, agora)
        continue
      }
      await this.#abrirSessao(canal, membro, lugar, agora)
      return
    }
  }

  /**
   * The round of a channel ends: after `membrosPorVolta` members, or with no
   * one left to ask. With someone serving, the channel rests `intervaloMs`;
   * with nobody, `semRespostaMs`. The next round draws a new salt.
   */
  #acabarVolta(canal: string, agora: number): void {
    const serviram = this.#serviram.get(canal) ?? 0
    const demand = this.#demands.get(canal)
    if (demand) {
      const contents = this.#porta.conteudo()
      const left = (contents ? this.#estado(contents, canal)?.porTrazer?.length : 0) ?? 0
      this.#settle(canal, demand.got > 0 || (serviram > 0 && left > 0) ? "loaded" : serviram > 0 ? "end" : "no-member")
    }
    this.#tentados.delete(canal)
    this.#serviram.delete(canal)
    this.#sal.delete(canal)
    this.#proximaEm.set(canal, agora + (serviram > 0 ? TECTOS_DOS_MEMBROS.intervaloMs : TECTOS_DOS_MEMBROS.semRespostaMs))
  }

  /**
   * The leaves of OTHER accounts that are alive. Those that answered a `mi` of
   * ours first; the one that served this channel last goes last; within that,
   * the order of this round's salt.
   */
  #candidatos(canal: string): Folha[] {
    const eu = this.#porta.eu().address
    const meu = this.#meuAparelho()
    const contents = this.#porta.conteudo()
    const ultimo = contents ? this.#estado(contents, canal)?.ultimo : undefined
    let sal = this.#sal.get(canal)
    if (sal === undefined) {
      sal = novoId()
      this.#sal.set(canal, sal)
    }
    const folhas = this.#porta
      .folhas(canal)
      .filter((folha) => folha.address !== eu && folha.aparelho !== meu && !this.#porta.bloqueado(canal, folha.address) && this.#porta.viva(canal, folha))
    const chave = (folha: Folha): string =>
      `${_paraTestes.primeiro === folha.address ? 0 : 1}${folha.aparelho === ultimo ? 1 : 0}${this.#conhecem.has(folha.aparelho) ? 0 : 1}${ordemDe(sal, folha.aparelho)}`
    return folhas.sort((a, b) => (chave(a) < chave(b) ? -1 : 1))
  }

  /** The member answered all we asked: it counts in this round, and the next member is asked too. */
  #membroServiu(pedinte: SessaoDeQuemPede): void {
    if (this.#pedinte === pedinte) this.#pedinte = null
    const canal = pedinte.canal
    const tentados = this.#tentados.get(canal) ?? new Set<string>()
    tentados.add(pedinte.com.aparelho)
    this.#tentados.set(canal, tentados)
    this.#serviram.set(canal, (this.#serviram.get(canal) ?? 0) + 1)
    const aparelho = pedinte.com.aparelho
    const contents = this.#porta.conteudo()
    if (contents && this.#estado(contents, canal)?.ultimo !== aparelho) {
      this.#porta.gravar((c) => {
        const cofre = c as CofreDosMembros
        const estado = (cofre.historicoDosMembros ??= {})[canal] ?? {}
        estado.ultimo = aparelho
        cofre.historicoDosMembros[canal] = estado
      })
    }
  }

  /** The member did not answer, or said it cannot: the next one, in the next step. */
  #largarMembro(pedinte: SessaoDeQuemPede, contar: boolean): void {
    if (this.#pedinte === pedinte) this.#pedinte = null
    if (!contar) return
    this.estatisticas.semResposta += 1
    const tentados = this.#tentados.get(pedinte.canal) ?? new Set<string>()
    tentados.add(pedinte.com.aparelho)
    this.#tentados.set(pedinte.canal, tentados)
  }

  #vigiar(pedinte: SessaoDeQuemPede, agora: number): Promise<void> | void {
    const t = TECTOS_DOS_MEMBROS
    if (!pedinte.chave) {
      if (agora - pedinte.aberta > t.esperaDoInventarioMs) this.#largarMembro(pedinte, true)
      return
    }
    const pedido = pedinte.pedido
    if (!pedido) return this.#proximoPedido(pedinte)
    if (agora - Math.max(pedido.enviadoEm, pedido.ultimaParte) < t.esperaDaRespostaMs) return
    if (pedido.tentativas >= t.tentativasPorPedido) {
      this.#largarMembro(pedinte, true)
      return
    }
    return this.#pedir(pedinte, pedido.corpo, pedido.tentativas + 1)
  }

  // ------------------------------------------------------------ requester

  async #abrirSessao(canal: string, com: Folha, lugar: number, agora: number): Promise<void> {
    const sessao: SessaoDeQuemPede = { canal, s: novoId(), par: novoParDoHistorico(), aberta: agora, com, lugar }
    this.#pedinte = sessao
    this.estatisticas.sessoes += 1
    await this.#enviar(canal, { v: 1, k: "mi", s: sessao.s, ap: this.#meuAparelho(), para: com.aparelho, x: toBase64(sessao.par.publica), l: lugar }, new Uint8Array(0))
  }

  #estado(contents: VaultContents, canal: string): EstadoDosMembrosNoCanal | undefined {
    return (contents as CofreDosMembros).historicoDosMembros?.[canal]
  }

  /** The inventory of the member: the buckets that differ from ours, the most recent first. */
  #aoInventario(pedinte: SessaoDeQuemPede, bruto: unknown): void {
    const contents = this.#porta.conteudo()
    const lista = (bruto as { b?: unknown } | null)?.b
    if (!contents || !Array.isArray(lista)) {
      this.#largarMembro(pedinte, true)
      return
    }
    const canal = pedinte.canal
    const deles = new Map<number, string>()
    for (const par of lista.slice(0, TECTOS_DOS_MEMBROS.baldesNoInventario)) {
      if (!Array.isArray(par) || !inteiro(par[0]) || par[0] < 0 || !textoCurto(par[1], 32)) continue
      // Only below our place: a bucket above it is the server's and the anti-entropy's.
      if (par[0] * TECTOS_DOS_MEMBROS.seqPorBalde >= pedinte.lugar) continue
      deles.set(par[0], par[1])
    }
    const nossos = inventarioDosMembros(passadoLegivel(this.#porta.itens(canal), contents, canal, pedinte.lugar, TODOS_LEEM))
    const antes = this.#estado(contents, canal)
    const porTrazer: NonNullable<EstadoDosMembrosNoCanal["porTrazer"]> = []
    for (const [b, h] of [...deles].sort((x, y) => y[0] - x[0])) {
      if (nossos.get(b) === h || antes?.trazidos?.[String(b)] === h) continue
      // The same bucket with the same hash resumes from its cursor; another hash starts again.
      const ja = antes?.porTrazer?.find((item) => item.b === b && item.h === h)
      porTrazer.push({ b, h, cursor: ja?.cursor ?? null, ...(ja?.under !== undefined ? { under: ja.under } : {}) })
    }
    const mesmo = JSON.stringify(porTrazer) === JSON.stringify(antes?.porTrazer ?? []) && (porTrazer.length > 0 || antes?.complete === true)
    if (!mesmo) {
      this.#porta.gravar((c) => {
        const cofre = c as CofreDosMembros
        const estado = (cofre.historicoDosMembros ??= {})[canal] ?? {}
        if (porTrazer.length > 0) {
          estado.porTrazer = porTrazer
          delete estado.complete
        } else {
          delete estado.porTrazer
          estado.complete = true
        }
        cofre.historicoDosMembros[canal] = estado
      })
    }
  }

  async #proximoPedido(pedinte: SessaoDeQuemPede): Promise<void> {
    const contents = this.#porta.conteudo()
    const proximo = contents ? this.#estado(contents, pedinte.canal)?.porTrazer?.[0] : undefined
    if (!proximo) {
      // Nothing left from this member. The round goes on with another one
      // (MED-01): one member alone can withhold part of the past for ever.
      this.#membroServiu(pedinte)
      // Lines came for the reader: they do not wait for the silence of the next members.
      const asked = this.#demands.get(pedinte.canal)
      if (asked && asked.got > 0) this.#settle(pedinte.canal, "loaded")
      return
    }
    // What was asked came: the older buckets wait for the next "Load older" (history-last-100).
    const demand = this.#demands.get(pedinte.canal)
    if (demand ? demand.got >= demand.want : !this.#wantsMore(pedinte.canal)) {
      this.#pause(pedinte)
      if (demand) this.#settle(pedinte.canal, "loaded")
      return
    }
    const left = demand ? demand.want - demand.got : TECTOS_DOS_MEMBROS.linesOnJoin - this.#porta.lines(pedinte.canal)
    const m = Math.max(1, Math.min(TECTOS_DOS_MEMBROS.itensPorPagina, left))
    // An ascending fetch in progress goes on as it started; everything else comes newest first.
    const corpo: PedidoDePagina =
      proximo.cursor !== null ? { b: proximo.b, desde: proximo.cursor, m } : { b: proximo.b, desde: null, d: 1, u: proximo.under ?? null, m }
    await this.#pedir(pedinte, corpo, 0)
  }

  async #pedir(pedinte: SessaoDeQuemPede, corpo: PedidoDePagina, tentativas: number): Promise<void> {
    if (!pedinte.chave) return
    const id = novoId()
    const agora = this.#porta.agora()
    pedinte.pedido = { id, corpo, enviadoEm: agora, ultimaParte: agora, tentativas }
    pedinte.chegada = undefined
    const selado = selarBloco(pedinte.chave, sessaoNoCanal(pedinte.canal, pedinte.s), `mp:${id}`, new TextEncoder().encode(JSON.stringify(corpo)))
    this.estatisticas.paginasPedidas += 1
    await this.#enviar(pedinte.canal, { v: 1, k: "mp", s: pedinte.s, ap: this.#meuAparelho(), para: pedinte.com.aparelho, id }, selado)
  }

  async #aoParte(canal: string, cabecalho: Cabecalho, corpo: Uint8Array): Promise<void> {
    const pedinte = this.#pedinte
    if (!pedinte || pedinte.canal !== canal || cabecalho.s !== pedinte.s || cabecalho.ap !== pedinte.com.aparelho) return
    const { n, i, id } = cabecalho
    if (!inteiro(n) || !inteiro(i) || n < 1 || n > TECTOS_DOS_MEMBROS.partesMax || i >= n || typeof id !== "string") return
    const rotulo = sessaoNoCanal(canal, pedinte.s)

    if (cabecalho.k === "mn") {
      if (!pedinte.chave) {
        if (typeof cabecalho.x !== "string") return
        try {
          const publica = fromBase64(cabecalho.x)
          pedinte.chave = chaveDoHistorico(pedinte.par.privada, publica, rotulo, {
            aparelhoQuePede: fromBase64(this.#meuAparelho()),
            aparelhoQueResponde: fromBase64(cabecalho.ap),
            efemeraQuePede: pedinte.par.publica,
            efemeraQueResponde: publica,
          })
        } catch {
          return
        }
      }
      // It answered our `mi`: it knows D2.
      this.#conhecem.add(cabecalho.ap)
      pedinte.inventario ??= { id, n, partes: new Array<Uint8Array | undefined>(n), recebidas: 0 }
      if (!guardarParte(pedinte.inventario, i, n, corpo)) return
      const inventario = await this.#abrir(pedinte.chave, rotulo, `mn:${pedinte.inventario.id}`, pedinte.inventario)
      pedinte.inventario = undefined
      if (inventario === null) {
        this.#largarMembro(pedinte, true)
        return
      }
      this.#aoInventario(pedinte, inventario)
      if (this.#pedinte === pedinte) await this.#proximoPedido(pedinte)
      return
    }

    // `mr`: the page of the current request.
    const pedido = pedinte.pedido
    if (!pedido || !pedinte.chave || id !== pedido.id) return
    pedido.ultimaParte = this.#porta.agora()
    pedinte.chegada ??= { id, n, partes: new Array<Uint8Array | undefined>(n), recebidas: 0 }
    if (!guardarParte(pedinte.chegada, i, n, corpo)) return
    const pagina = await this.#abrir(pedinte.chave, rotulo, `mr:${id}`, pedinte.chegada)
    pedinte.chegada = undefined
    pedinte.pedido = undefined
    if (!lerPagina(pagina, pedido.corpo.b)) {
      this.#largarMembro(pedinte, true)
      return
    }
    await this.#aoPagina(pedinte, pedido.corpo, pagina)
    if (this.#pedinte === pedinte) await this.#proximoPedido(pedinte)
  }

  async #aoPagina(pedinte: SessaoDeQuemPede, pedido: PedidoDePagina, pagina: Pagina): Promise<void> {
    this.estatisticas.paginasRecebidas += 1
    const canal = pedinte.canal
    const { aplicados, recusados, rooms } = await this.#porta.receber(canal, pagina.e.slice(0, TECTOS_DOS_MEMBROS.itensPorPagina * 4), pedinte.lugar)
    this.estatisticas.aplicados += aplicados
    for (const [razao, n] of Object.entries(recusados)) this.estatisticas.recusados[razao] = (this.estatisticas.recusados[razao] ?? 0) + n
    const demand = this.#demands.get(canal)
    if (demand) {
      const lines = rooms ? (demand.room === null ? Object.values(rooms).reduce((soma, n) => soma + n, 0) : (rooms[demand.room] ?? 0)) : aplicados
      demand.got += lines
    }
    // Newest first only when the responder says so: one before history-last-100 answers ascending.
    const newestFirst = pedido.d === 1 && pagina.d === 1
    // A page that does not move the cursor ends the bucket: a member cannot keep us asking the same page.
    const anda =
      pagina.ate !== null &&
      pagina.ate >= 0 &&
      (newestFirst ? pedido.u === null || pedido.u === undefined || pagina.ate < pedido.u : pedido.desde === null || pagina.ate > pedido.desde)
    const acabou = pagina.fim || !anda
    // The bucket counts as fetched only if OUR hash now equals the one declared
    // (MED-02): a member that declares the honest hash and sends empty pages
    // must not close the bucket for the honest members that come after.
    const contents = this.#porta.conteudo()
    const nosso = contents
      ? inventarioDosMembros(passadoLegivel(this.#porta.itens(canal), contents, canal, pedinte.lugar, TODOS_LEEM)).get(pedido.b)
      : undefined
    this.#porta.gravar((c) => {
      const cofre = c as CofreDosMembros
      const estado = cofre.historicoDosMembros?.[canal]
      const lista = estado?.porTrazer
      const indice = lista?.findIndex((item) => item.b === pedido.b) ?? -1
      if (!estado || !lista || indice < 0) return
      const item = lista[indice]!
      if (acabou) {
        lista.splice(indice, 1)
        if (nosso === item.h) estado.trazidos = { ...estado.trazidos, [String(item.b)]: item.h }
        if (lista.length === 0) {
          delete estado.porTrazer
          estado.complete = true
        }
      } else if (newestFirst) {
        item.under = pagina.ate!
      } else {
        // Ascending from here on, also when we asked newest first and the responder does not know it.
        item.cursor = pagina.ate
        delete item.under
      }
    })
  }

  async #abrir(chave: Uint8Array, rotulo: string, ad: string, chegada: Chegada): Promise<unknown> {
    const aberto = abrirBloco(chave, rotulo, ad, juntar(...(chegada.partes as Uint8Array[])))
    if (!aberto) return null
    const texto = await descomprimir(aberto, TECTOS_DOS_MEMBROS.descomprimidoMax)
    if (!texto) return null
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(texto)) as unknown
    } catch {
      return null
    }
  }

  #aoRecusaDoMembro(cabecalho: Cabecalho): void {
    const pedinte = this.#pedinte
    if (!pedinte || pedinte.s !== cabecalho.s || pedinte.com.aparelho !== cabecalho.ap) return
    if (cabecalho.r !== undefined && pedinte.pedido) {
      // Busy with our pages: the same member, after `r`.
      this.estatisticas.ocupado += 1
      pedinte.pedido.ultimaParte = this.#porta.agora() + Math.min(cabecalho.r, 5 * 60_000) - TECTOS_DOS_MEMBROS.esperaDaRespostaMs
      return
    }
    // It does not know the session (restarted), or has no room: another member.
    this.#largarMembro(pedinte, true)
  }

  // ------------------------------------------------------------- responder

  /** What `quem` may read of this channel's past below `lugar`, by this device's rules. */
  #legivelPara(canal: string, quem: string, lugar: number): ItemDoResumo[] {
    const contents = this.#porta.conteudo()
    if (!contents) return []
    const leitor: Leitor = {
      podeLerSala: (sala) => this.#porta.podeLerSala(canal, quem, sala),
      salasRestritas: this.#porta.salasRestritas(canal),
    }
    return passadoLegivel(this.#porta.itens(canal), contents, canal, lugar, leitor)
  }

  async #aoPedidoDeSessao(canal: string, cabecalho: Cabecalho, folha: Folha): Promise<void> {
    if (!this.#porta.responde()) return
    // Only the channels this device would ask in itself (LOW-03): not a direct, not the account channel.
    if (!this.#porta.canais().includes(canal)) return
    // The past of our own account is the account history's (`historico.ts`).
    if (folha.address === this.#porta.eu().address || this.#porta.bloqueado(canal, folha.address)) return
    if (!inteiro(cabecalho.l) || typeof cabecalho.x !== "string") return
    // A session already seen is ignored (LOW-05), and one `mi` per device per window (MED-03).
    const vista = `${cabecalho.ap}|${cabecalho.s}`
    if (this.#sessoesVistas.has(vista)) return
    const agora = this.#porta.agora()
    if (!this.#misPorAparelho.gastar(cabecalho.ap, 1, 1, agora)) return
    this.#sessoesVistas.add(vista)
    if (this.#sessoesVistas.size > 512) this.#sessoesVistas.delete(this.#sessoesVistas.values().next().value as string)
    for (const [s, sessao] of this.#respostas) if (sessao.para === cabecalho.ap) this.#respostas.delete(s)
    const meu = this.#meuAparelho()
    if (this.#respostas.size >= TECTOS_DOS_MEMBROS.sessoesNoRespondedor) {
      await this.#enviar(canal, { v: 1, k: "mx", s: cabecalho.s, ap: meu, para: cabecalho.ap }, new Uint8Array(0))
      return
    }
    const par = novoParDoHistorico()
    let chave: Uint8Array
    try {
      const publica = fromBase64(cabecalho.x)
      chave = chaveDoHistorico(par.privada, publica, sessaoNoCanal(canal, cabecalho.s), {
        aparelhoQuePede: fromBase64(cabecalho.ap),
        aparelhoQueResponde: fromBase64(meu),
        efemeraQuePede: publica,
        efemeraQueResponde: par.publica,
      })
    } catch {
      return
    }
    this.#respostas.set(cabecalho.s, { canal, chave, para: cabecalho.ap, quem: folha.address, lugar: cabecalho.l, ultimo: agora, servidos: new Set() })
    this.estatisticas.sessoesServidas += 1
    const inventario = this.#inventarioPara(canal, folha.address, cabecalho.l, agora)
    await this.#responder(cabecalho.s, "mn", "inv", { b: inventario }, toBase64(par.publica))
  }

  /** The inventory for `quem` at place `lugar`, reused for `inventarioEmCacheMs` (MED-03). */
  #inventarioPara(canal: string, quem: string, lugar: number, agora: number): [number, string][] {
    const chave = `${canal}|${quem}|${lugar}`
    const guardado = this.#inventarios.get(chave)
    if (guardado && agora - guardado.em < TECTOS_DOS_MEMBROS.inventarioEmCacheMs) return guardado.b
    const b = [...inventarioDosMembros(this.#legivelPara(canal, quem, lugar))]
      .sort((x, y) => y[0] - x[0])
      .slice(0, TECTOS_DOS_MEMBROS.baldesNoInventario)
    this.#inventarios.delete(chave)
    this.#inventarios.set(chave, { em: agora, b })
    while (this.#inventarios.size > 64) this.#inventarios.delete(this.#inventarios.keys().next().value as string)
    return b
  }

  async #aoPedidoDePagina(canal: string, cabecalho: Cabecalho, corpo: Uint8Array): Promise<void> {
    if (!this.#porta.responde()) return
    const sessao = this.#respostas.get(cabecalho.s)
    const meu = this.#meuAparelho()
    // An unknown session gets no answer at all (MED-03): an `mx` would be work for anyone who asks.
    if (!sessao || sessao.para !== cabecalho.ap || sessao.canal !== canal || typeof cabecalho.id !== "string") return
    // A page id already served in this session is ignored (LOW-05).
    if (sessao.servidos.has(cabecalho.id)) return
    const agora = this.#porta.agora()
    sessao.ultimo = agora
    const t = TECTOS_DOS_MEMBROS
    if (!this.#paginasPorPedinte.gastar(sessao.para, 1, t.paginasPorPedintePorMinuto, agora)) {
      const r = Math.max(1_000, this.#paginasPorPedinte.liberaEm(sessao.para, agora))
      await this.#enviar(canal, { v: 1, k: "mx", s: cabecalho.s, ap: meu, para: cabecalho.ap, r }, new Uint8Array(0))
      return
    }
    const aberto = abrirBloco(sessao.chave, sessaoNoCanal(canal, cabecalho.s), `mp:${cabecalho.id}`, corpo)
    if (!aberto) return
    let pedido: PedidoDePagina
    try {
      pedido = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(aberto)) as PedidoDePagina
    } catch {
      return
    }
    if (typeof pedido !== "object" || pedido === null || !inteiro(pedido.b) || pedido.b < 0) return
    if (pedido.desde !== null && !inteiro(pedido.desde)) return
    const newestFirst = pedido.d === 1
    if (newestFirst && pedido.u !== null && pedido.u !== undefined && !inteiro(pedido.u)) return
    if (pedido.m !== undefined && !(inteiro(pedido.m) && pedido.m >= 1)) return
    sessao.servidos.add(cabecalho.id)
    const max = Math.min(t.itensPorPagina, pedido.m ?? t.itensPorPagina)
    // Computed again on every page: a role taken away between two pages cuts the next one.
    const legivel = this.#legivelPara(canal, sessao.quem, sessao.lugar)
    const { escolhidos, fim } = newestFirst
      ? choosePageNewestFirst(legivel, pedido.b, pedido.u ?? null, max)
      : escolherPagina(legivel, pedido.b, pedido.desde, max)
    const relatados = await this.#porta.relatar(canal, escolhidos)
    const cortada = (newestFirst ? cutByBytesNewestFirst : cortarPorBytes)(escolhidos, relatados, t.bytesPorPagina)
    const itens = _paraTestes.adulterarPagina ? _paraTestes.adulterarPagina(canal, cortada.itens, this.#porta.eu().address) : cortada.itens
    const pagina: Pagina = newestFirst
      ? { b: pedido.b, e: itens, ate: cortada.ate ?? pedido.u ?? null, fim: fim && !cortada.cortada, d: 1 }
      : { b: pedido.b, e: itens, ate: cortada.ate ?? pedido.desde, fim: fim && !cortada.cortada }
    this.estatisticas.paginasServidas += 1
    await this.#responder(cabecalho.s, "mr", cabecalho.id, pagina)
  }

  async #responder(s: string, k: "mn" | "mr", id: string, resposta: unknown, x?: string): Promise<void> {
    const sessao = this.#respostas.get(s)
    if (!sessao) return
    const texto = await comprimir(new TextEncoder().encode(JSON.stringify(resposta)))
    const selado = selarBloco(sessao.chave, sessaoNoCanal(sessao.canal, s), `${k}:${id}`, texto)
    const partes = partir(selado)
    if (partes.length > TECTOS_DOS_MEMBROS.partesMax) return
    const meu = this.#meuAparelho()
    for (let i = 0; i < partes.length; i++) {
      await this.#enviar(sessao.canal, { v: 1, k, s, ap: meu, para: sessao.para, id, i, n: partes.length, ...(x ? { x } : {}) }, partes[i]!)
    }
  }

  // --------------------------------------------------------------- the wire

  /**
   * A channel signal that anti-entropy opened, with `MAGIA_DOS_MEMBROS` as the
   * first byte. `from` is the account the server says sent it; the device and
   * its signature are checked here, against this channel's tree.
   */
  aoSinalAberto(canal: string, from: string, aberto: Uint8Array, epoca: bigint): Promise<void> {
    return this.#emSerie(async () => {
      await this.#aoSinalAgora(canal, from, aberto, epoca)
      this.#porta.mudou?.()
    })
  }

  async #aoSinalAgora(canal: string, from: string, aberto: Uint8Array, epoca: bigint): Promise<void> {
    const lido = desembrulhar(aberto)
    if (!lido) {
      this.estatisticas.ilegiveis += 1
      return
    }
    const { cabecalho, corpo } = lido
    const meu = this.#meuAparelho()
    // Every D2 signal is for one device (MED-03): without `para`, or for another, it is dropped before any work.
    if (cabecalho.ap === meu || cabecalho.para !== meu) return
    this.estatisticas.bytesRecebidos += aberto.length
    const folha = this.#porta.folhas(canal).find((f) => f.address === from && f.aparelho === cabecalho.ap)
    if (!folha || typeof cabecalho.as !== "string") return
    const { as: assinatura, ...semAssinatura } = cabecalho
    let valida = false
    try {
      valida = verify(fromBase64(cabecalho.ap), mensagemDoSinal(canal, from, epoca, semAssinatura, corpo), fromBase64(assinatura))
    } catch {
      valida = false
    }
    if (!valida) {
      this.estatisticas.ilegiveis += 1
      return
    }
    this.estatisticas.recebidos += 1
    switch (cabecalho.k) {
      case "mi":
        return this.#aoPedidoDeSessao(canal, cabecalho, folha)
      case "mp":
        return this.#aoPedidoDePagina(canal, cabecalho, corpo)
      case "mn":
      case "mr":
        return this.#aoParte(canal, cabecalho, corpo)
      case "mx":
        return this.#aoRecusaDoMembro(cabecalho)
    }
  }

  async #enviar(canal: string, semAssinatura: Omit<Cabecalho, "as">, corpo: Uint8Array): Promise<void> {
    const chave = await this.#porta.derivarChave(canal)
    if (!chave) return
    const eu = this.#porta.eu()
    const cabecalho: Cabecalho = {
      ...semAssinatura,
      as: toBase64(eu.assinar(mensagemDoSinal(canal, eu.address, chave.epoca, semAssinatura, corpo))),
    }
    const sinal = toBase64(selarSinal(chave, canal, embrulhar(cabecalho, corpo)))
    if (sinal.length > TECTOS_DOS_MEMBROS.sinalMaxCaracteres) return
    if (this.#fila.length >= TECTOS_DOS_MEMBROS.filaMax || semAssinatura.para === undefined) return
    this.#fila.push({ canal, sinal, para: semAssinatura.para, em: this.#porta.agora() })
    this.#bombear()
  }

  /** Send what the shared budget allows, in order. What does not fit waits; what waited too long goes. */
  #bombear(): void {
    if (this.#bomba !== undefined) return
    const agora = this.#porta.agora()
    while (this.#fila.length > 0) {
      const item = this.#fila[0]!
      if (agora - item.em > TECTOS_DOS_MEMBROS.filaEsperaMaxMs || !this.#porta.podeSinalizar()) {
        this.#fila.shift()
        continue
      }
      if (!this.#porta.gastar(item.canal, item.sinal.length)) break
      this.#fila.shift()
      try {
        this.#porta.enviarSinal(item.canal, item.sinal, novoId(), item.para)
        this.estatisticas.enviados += 1
      } catch {
        this.#fila.length = 0
        return
      }
    }
    if (this.#fila.length === 0) return
    this.#bomba = setTimeout(() => {
      this.#bomba = undefined
      this.#bombear()
    }, 1_000)
    ;(this.#bomba as { unref?: () => void }).unref?.()
  }

  #meuAparelho(): string {
    return toBase64(this.#porta.eu().aparelho)
  }
}

function guardarParte(chegada: Chegada, i: number, n: number, corpo: Uint8Array): boolean {
  if (chegada.n !== n) return false
  if (!chegada.partes[i]) {
    chegada.partes[i] = corpo.slice()
    chegada.recebidas += 1
  }
  return chegada.recebidas === chegada.n
}

function lerPagina(bruto: unknown, b: number): bruto is Pagina {
  if (typeof bruto !== "object" || bruto === null) return false
  const p = bruto as Record<string, unknown>
  return (
    p["b"] === b &&
    Array.isArray(p["e"]) &&
    (p["ate"] === null || inteiro(p["ate"])) &&
    typeof p["fim"] === "boolean" &&
    (p["d"] === undefined || p["d"] === 1)
  )
}

export const _fioParaTestes = { embrulhar, desembrulhar, mensagemDoSinal }
