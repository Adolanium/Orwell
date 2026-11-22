import { sha256 } from "@noble/hashes/sha2.js"
import {
  abrirBloco,
  abrirSinal,
  chaveDoHistorico,
  epocaDoSinal,
  novoParDoHistorico,
  selarBloco,
  selarSinal,
  type ChaveDoSinal,
  type ParDoHistorico,
} from "@enclave/crypto"
import { canonicoTolerante, fromBase64, toBase64, verify } from "@enclave/protocol"
import { soInlineOuEvicted } from "../armazem/referencias.js"
import { chaveDoEvento } from "../dobras.js"
import {
  base64ParaBytes,
  fundirEntradasDoIrmao,
  juntarMediaDoIrmao,
  type EstadoDoHistorico,
  type ItemDeMediaDoIrmao,
  type PageFailureReason,
  type RazaoDoHistorico,
  type StoredChatMessage,
  type StoredPayload,
  type VaultContents,
} from "../vault.js"
import {
  chaveDoItem,
  entradaValida,
  faltaAqui,
  faltamDaConversa,
  fichaDoIrmao,
  fundirRegistosDoIrmao,
  inventarioDe,
  mediaDe,
  mediaInteiraDe,
  paginaDe,
  pedidoDe,
  registosSemRefs,
  resumoDoHistorico,
  TECTOS_DO_HISTORICO,
  type ContextoDoIrmao,
  type InflarParaOIrmao,
  type Inventario,
  type MediaInteira,
  type MediaNoIrmao,
  type PaginaDoHistorico,
} from "./conteudo.js"

/**
 * The history between devices of the same account (1.0 "Arca").
 *
 * All history and all media move to the new device
 * during pairing, without prompts or questions. And what one
 * device has and another device in the account lost (by being offline) passes
 * between them through the account channel.
 *
 * ## The path
 *
 * Ephemeral signals (`channel.sinal`) from the ACCOUNT CHANNEL, which the
 * server passes to whoever is online and does not store. Why these, and not MLS
 * messages:
 *
 * - an MLS message costs a ratchet generation for the sender, and an offline
 *   sibling must skip them (capped at 512): a thousand pages would deafen it;
 * - an MLS message stays on the server for thirty days: the entire account
 *   history would sit there encrypted for a month;
 * - a new `t` in a channel is rejected by an old sibling, and five rejections
 *   make it deaf to the channel (rule 1i (c)). A 1.0.4 sibling does not read
 *   account channel signals (anti-entropy does not run there: `elegivel`), and
 *   drops them without counting toward deafness.
 *
 * **The server does not change.** Its caps enforce (`TECTOS_DO_SINAL`: 120
 * signals per connection per minute, 16 KiB each, 4 MiB per channel per
 * minute). This module uses at most `sinaisPorMinuto` (40): anti-entropy uses up
 * to 60 of the same 120.
 *
 * ## The cipher
 *
 * Two layers. Outside, the signal key for the account channel's epoch: only
 * devices of the account can open it. Inside, a key for just the two devices
 * talking (ephemeral X25519, `historico.ts` in `@enclave/crypto`). Each signal
 * carries the signature of the device that sends it, and the receiver checks it
 * against the leaves of the account channel: only a device of the account
 * speaks here.
 *
 * ## The wire
 *
 * - `hi`: the caller opens a session (the ephemeral public key).
 * - `hn`: the responder sends the inventory (the channels, how many entries and
 *   the summary of each one), with its public key. The session key derives from
 *   here.
 * - `hp`: a request (a page from a channel, the media list, some media).
 * - `hr`: the response, split into signals.
 * - `hx`: "I do not know that session" (the responder restarted): request another.
 *
 * ## Resumable
 *
 * The plan (which channels, how far, which media are missing) lives in the vault
 * (`EstadoDoHistorico`). A connection that drops, or the app that closes, leaves
 * the plan where it was; the next connection opens another session and continues
 * from the cursor. A repeated page does not duplicate anything (`fundirEntradasDoIrmao`).
 */

/** The wire numbers. Mutable only for tests to lower them. */
export const TECTOS_DO_FIO_DO_HISTORICO = {
  /** Signals per minute, from the caller and the responder. The server caps at 120; anti-entropy uses up to 60. */
  sinaisPorMinuto: 40,
  /** The largest signal that goes out, in characters. The server rejects above 16 KiB. */
  sinalMaxCaracteres: 12 * 1024,
  /** Bytes of each part of a response. With the header and the two ciphers, it stays below `sinalMaxCaracteres`. */
  bytesPorParte: 8 * 1024,
  /** Without a new part of a response during this time, request what is missing. */
  esperaDaRespostaMs: 30_000,
  /** Times to request the same thing again before dropping the session. */
  tentativasPorPedido: 3,
  /**
   * Real failures of a media request led by the same item before that item
   * counts as lost (1.3.27): the sibling's `hx`, a request given up after
   * `tentativasPorPedido` silences, a response that did not open. A reload, a
   * suspension or closing the app do not count (`#falhouOPedido`).
   *
   * The same number for a page of history at one cursor (22/11/2026): after it,
   * the rest of that channel counts as not received and the sync goes on.
   */
  tentativasPorItem: 3,
  /** Without an inventory in response to a `hi` during this time, another `hi` can go out. */
  esperaDoInventarioMs: 20_000,
  /** A newly paired device requests history every `esperaDoInventarioMs`; after that, only every ten minutes. */
  inicialRapidoMs: 10 * 60_000,
  intervaloLentoMs: 10 * 60_000,
  /** The "initial" stops being requested after a week: the sibling never answered (it is old). */
  inicialDuraMs: 7 * 24 * 3_600_000,
  /**
   * Between already paired siblings: one request per connection, `primeiraReposicaoMs`
   * after connecting (server recovery runs first), and never two less than
   * `intervaloDaReposicaoMs` apart (a connection that goes and comes on a phone
   * does not request every time).
   */
  primeiraReposicaoMs: 15_000,
  intervaloDaReposicaoMs: 2 * 60_000,
  /** The clock step. */
  passoMs: 2_000,
  /** The responder forgets a silent session during this time. */
  sessaoCaladaMs: 30 * 60_000,
  /**
   * The notice's deadline (12/11/2026). With a plan (or a fresh device) and no
   * progress for this long, the transfer gives up FOR NOW: the notice closes
   * with the reason (`RazaoDoHistorico`), and what is missing counts as lost on
   * screen. Before this, "402 of 420" could stand still forever.
   */
  desistirAposMs: 3 * 60_000,
  /** A freshly paired device that asks nothing for this long is no longer getting history from here: "Keep this device on" closes. */
  envioCaladoMs: 2 * 60_000,
  /** After giving up, a new try this often, quiet (the first progress brings the notice back). */
  retomarParadoMs: 5 * 60_000,
  /** Stored responses to request missing parts: up to this many bytes, for this long. */
  guardadasBytes: 16 * 1024 * 1024,
  guardadasMs: 5 * 60_000,
  /** Parts of a response, at most. 4096 parts of 8 KiB are 32 MiB. */
  partesMax: 4_096,
  /**
   * Layer C (21/11/2026): a response longer than this goes one window at a time. The
   * responder sends the first window, and each next one only when the requester asks
   * for it (`hp` with `f`). A device that went away (an iPhone locked mid-photo) then
   * costs at most one window, under a minute of the budget, instead of the whole response.
   * Below `sinaisPorMinuto`, so a window fits in one minute's budget.
   */
  partesPorJanela: 32,
  /** A windowed response waits this long without a part before asking again: one minute of the budget, and some. */
  esperaEntreJanelasMs: 65_000,
  /** The text of a response, after decompression, at most. */
  descomprimidoMax: 64 * 1024 * 1024,
  /** `trazerUm` gives up after this, if no sibling has just answered. */
  trazerUmMs: 60_000,
  /**
   * `progressAt` moves at most this often (1.3.27): a part-level mark for the
   * interface, which holds the auto-lock while the history moves. Two extra
   * events a minute at most, however fast the parts come.
   */
  progressStepMs: 30_000,
}

/** What the module needs from the session. */
export interface PortaDoHistorico {
  eu(): { address: string; aparelho: Uint8Array; assinar: (mensagem: Uint8Array) => Uint8Array }
  conteudo(): VaultContents | null
  /** The account channel, or empty. */
  canalDaConta(): string
  /** The account channel group exists and is actually for the account. */
  contaPronta(): Promise<boolean>
  /** The device keys (base64url) of the leaves of this account in the account channel. */
  folhasDaConta(): string[]
  derivarChave(): Promise<ChaveDoSinal | null>
  /** Connected, and the server forwards signals. */
  podeSinalizar(): boolean
  enviarSinal(sinal: string, ref: string): void
  /** A change to the vault, in the session's write batch. */
  gravar(mudar: (contents: VaultContents) => void): void
  temGrupo(canal: string): boolean
  bloqueado(canal: string, autor: string): boolean
  lugar(canal: string): { seq: number; em: number } | null | undefined
  emitir(evento: EventoDoHistorico): void
  agora(): number
  /** The media store, through the session: the wire between siblings carries `inline` or `evicted`, and the vault keeps references. */
  armazem: PortaDoArmazemDoHistorico
  /**
   * A signal of the account channel that opened but is not of this module (another
   * first byte): the account key passing (`chaveDaConta.ts`, 1.3.16). Given the
   * opened bytes, so the signal is not decrypted twice. `true` if it was taken.
   */
  outroSinal?(aberto: Uint8Array, remetente: string, epoca: bigint): Promise<boolean>
}

/** What the history between siblings needs from the media store. */
export interface PortaDoArmazemDoHistorico {
  /** The blob for this `sha` is on this device. */
  presente(sha: string): boolean
  /** The output: references turn back into text. */
  inflar: InflarParaOIrmao
  /**
   * The input, synchronous, inside `gravar`: a payload's bytes move to the
   * store, and the payload comes back with `{ ref }` (the same, if it had no
   * bytes).
   */
  absorver(contents: VaultContents, payload: StoredPayload): StoredPayload
  /** The bytes of a video a sibling sent (already checked against the `sha`), inside `gravar`. */
  guardarVideo(contents: VaultContents, sha: string, bytes: Uint8Array, at: number): void
}

/** The outcome of `trazerUm`. */
export type DesfechoDoIrmao = "chegou" | "sem-irmao" | "nao-tem"

/** What the interface listens to: the progress, and the channels whose history changed. */
export interface EventoDoHistorico {
  /**
   * What did not come, and why (12/11/2026). Present when the transfer gave up
   * (`aTrazer` false, plan stopped), or ended with entries the sibling could not
   * send. The interface says it in one line, and the progress notice closes.
   */
  perdidas?: number
  razao?: RazaoDoHistorico
  /**
   * A stopped plan (`razao` "sem-irmao" or "irmao-calado"), 20/11/2026: how many
   * conversation messages are missing on THIS device and will come when the
   * transfer resumes. Never the state log, never an entry already here, never
   * one the vault cap would drop (`faltamDaConversa`). Absent when it is not
   * known exactly (a sibling before 1.3.26 sends no `q`): the interface then
   * gives no number. A stopped plan only exists while a source exists (`#haFonte`).
   */
  faltam?: number
  /** History is arriving from a sibling. */
  aTrazer: boolean
  /** Fetched entries and count of remaining entries. */
  feitas: number
  total: number
  /**
   * Media items after the text. `null` until the count is known. `perdidas`
   * (1.3.27): items that failed `tentativasPorItem` times and left; they count
   * in `feitas` too, so the bar reaches the end.
   */
  media: { feitas: number; total: number; perdidas?: number } | null
  /** The transfer ended with files that did not come (1.3.27), with `razao` "ilegiveis". */
  ficheirosPerdidos?: number
  /**
   * Entries this device gave up on (22/11/2026): the rest of a channel whose page
   * failed `tentativasPorItem` times. Out of `total` already, so the bar reaches
   * the end; during the transfer and at its end (then with `razao` "ilegiveis").
   */
  notReceived?: number
  /**
   * Once per real failure of a page, for the diagnostic log: the reason and the
   * attempt; on the last one, `notReceived` says how many entries left with it.
   */
  pageFailure?: { reason: PageFailureReason; attempt: number; notReceived?: number }
  /**
   * When the history last moved on this device (1.3.27): a part received, or a
   * part of a response sent. Updated at most every `progressStepMs`. Only while
   * a sync runs (`aTrazer` or `envio`). One large media item keeps `feitas`
   * still for minutes: this mark is what says the sync still moves.
   */
  progressAt?: number
  /** Channels whose history changed in this step: the interface reloads them. */
  canais: string[]
  /** This is the history of a device that just paired (not a sync between siblings). */
  inicial: boolean
  /** Profiles arrived with avatars: the interface reloads the directory. */
  perfis?: true
  /**
   * THIS device is sending the history to a device that just paired (16/11/2026).
   * The interface shows "Keep this device on" with these counts until the new
   * device has everything, or stops asking. `fotografias` is `null` until the
   * new device asks for the media list (after the text).
   */
  envio?: EnvioDoHistorico
}

/** What this device sent to a freshly paired one: entries of conversation, and media items. */
export interface EnvioDoHistorico {
  mensagens: { feitas: number; total: number }
  fotografias: { feitas: number; total: number } | null
}

interface Cabecalho {
  v: 1
  k: "hi" | "hn" | "hp" | "hr" | "hx"
  s: string
  ap: string
  as?: string
  para?: string
  id?: string
  i?: number
  n?: number
  x?: string
  f?: number[]
  /** On `hi` (16/11/2026): the requester is a freshly paired device. The responder then shows "Keep this device on". */
  ini?: 1
  /**
   * On `hr` (layer C, 21/11/2026): this response goes in windows of `w` parts; ask for
   * the next window with `f`. A requester that ignores it gets the rest when it asks for
   * the missing parts, as before.
   */
  w?: number
}

type Pedido =
  | { t: "pagina"; c: string; desde: number | null }
  | { t: "media?"; canais?: string[] }
  | { t: "media"; itens: ItemDeMediaDoIrmao[] }

interface PedidoEmCurso {
  id: string
  corpo: Pedido
  enviadoEm: number
  ultimaParte: number
  tentativas: number
}

interface Chegada {
  id: string
  n: number
  partes: (Uint8Array | undefined)[]
  recebidas: number
  /** Windowed (`w`): the window size, and the parts asked for so far (`[0, pedidoAte)`). */
  janela?: number
  pedidoAte?: number
}

interface SessaoDeQuemPede {
  s: string
  par: ParDoHistorico
  aberta: number
  chave?: Uint8Array
  /** The device that responded, in base64url. */
  com?: string
  inventario?: Chegada | undefined
  pedido?: PedidoEmCurso | undefined
  chegada?: Chegada | undefined
}

/** A response sent, kept to resend missing parts, or to split again smaller. */
interface Guardada {
  partes: Uint8Array[]
  cabecalhos: Cabecalho[]
  em: number
  bytes: number
  selado: Uint8Array
  passo: number
}

interface SessaoDeQuemResponde {
  chave: Uint8Array
  para: string
  ultimo: number
  /** Only for a freshly paired requester (`ini` on `hi`): what went, against the inventory. */
  envio?: EnvioDoHistorico
}

const MAGIA = 0x48

/** The smallest part a response splits into when a signal does not fit. */
const PARTE_MINIMA = 256

/** Which header a signal in the queue carries: a server refusal is answered by what it was. */
interface DeQuem {
  k: Cabecalho["k"]
  s: string
  id?: string | undefined
}

interface SinalNaFila {
  sinal: string
  ref: string
  de: DeQuem
}

function novoId(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(9)))
}

/** The text being signed: the domain, channel, account, epoch, header, and body summary. */
function mensagemDoSinal(canal: string, address: string, epoca: bigint, cabecalho: Omit<Cabecalho, "as">, corpo: Uint8Array): Uint8Array {
  const prefixo = new TextEncoder().encode(
    `orwell-historico-sinal-v1\0${canal}\0${address}\0${epoca}\0${canonicoTolerante(cabecalho)}\0`,
  )
  const resumo = sha256(corpo)
  const saida = new Uint8Array(prefixo.length + resumo.length)
  saida.set(prefixo, 0)
  saida.set(resumo, prefixo.length)
  return saida
}

function embrulhar(cabecalho: Cabecalho, corpo: Uint8Array): Uint8Array {
  const texto = new TextEncoder().encode(JSON.stringify(cabecalho))
  const saida = new Uint8Array(3 + texto.length + corpo.length)
  saida[0] = MAGIA
  new DataView(saida.buffer).setUint16(1, texto.length, false)
  saida.set(texto, 3)
  saida.set(corpo, 3 + texto.length)
  return saida
}

function desembrulhar(bytes: Uint8Array): { cabecalho: Cabecalho; corpo: Uint8Array } | null {
  if (bytes.length < 3 || bytes[0] !== MAGIA) return null
  const comprimento = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(1, false)
  if (3 + comprimento > bytes.length) return null
  try {
    const cabecalho = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3, 3 + comprimento))) as Cabecalho
    if (typeof cabecalho !== "object" || cabecalho === null || cabecalho.v !== 1) return null
    if (typeof cabecalho.k !== "string" || typeof cabecalho.s !== "string" || typeof cabecalho.ap !== "string") return null
    if (cabecalho.s.length > 32 || (cabecalho.id !== undefined && (typeof cabecalho.id !== "string" || cabecalho.id.length > 32))) return null
    return { cabecalho, corpo: bytes.subarray(3 + comprimento) }
  } catch {
    return null
  }
}

/** Compress (deflate) when the platform supports it. First byte indicates: 1 compressed, 0 raw. */
export async function comprimir(texto: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return juntar(new Uint8Array([0]), texto)
  const fluxo = new Blob([texto as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate-raw"))
  return juntar(new Uint8Array([1]), new Uint8Array(await new Response(fluxo).arrayBuffer()))
}

/** The reverse of `comprimir`. `null` past `max` bytes of text, or on bad input. */
export async function descomprimir(bytes: Uint8Array, max = TECTOS_DO_FIO_DO_HISTORICO.descomprimidoMax): Promise<Uint8Array | null> {
  if (bytes.length === 0) return null
  if (bytes[0] === 0) return bytes.subarray(1)
  if (bytes[0] !== 1 || typeof DecompressionStream === "undefined") return null
  try {
    const fluxo = new Blob([bytes.subarray(1) as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
    const leitor = fluxo.getReader()
    const pedacos: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      total += value.length
      // Compression pump does not fill memory: it stops at the limit.
      if (total > max) {
        await leitor.cancel()
        return null
      }
      pedacos.push(value)
    }
    return juntar(...pedacos)
  } catch {
    return null
  }
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

function partir(bytes: Uint8Array, passo: number): Uint8Array[] {
  const partes: Uint8Array[] = []
  for (let em = 0; em < bytes.length; em += passo) partes.push(bytes.subarray(em, em + passo))
  if (partes.length === 0) partes.push(new Uint8Array(0))
  return partes
}

export class HistoricoEntreAparelhos {
  readonly #porta: PortaDoHistorico
  #pedinte: SessaoDeQuemPede | null = null
  readonly #respostas = new Map<string, SessaoDeQuemResponde>()
  /** Responses sent, by `s|id`, for any missing parts. */
  readonly #guardadas = new Map<string, Guardada>()
  /** Signal queue and signals in flight awaiting possible rejection. */
  readonly #fila: SinalNaFila[] = []
  readonly #noAr = new Map<string, { sinal: string; em: number; de: DeQuem }>()
  readonly #gastos: number[] = []
  #recuoAte = 0
  #bomba: ReturnType<typeof setTimeout> | undefined
  #relogio: ReturnType<typeof setInterval> | undefined
  #ligadoEm = 0
  #ultimoHi = 0
  #ultimaReposicao = 0
  #reposicaoNestaLigacao = false
  /** Everything touching sessions runs serially: the clock and incoming signals. */
  #cadeia: Promise<void> = Promise.resolve()
  /** The last message sent to the interface, to avoid repeating it. */
  #ultimoEvento = ""
  /** When the transfer last moved (inventory, page, media). The deadline counts from here. */
  #progressoEm = 0
  /** A sibling answered on this connection: tells `irmao-calado` from `sem-irmao`. */
  #irmaoRespondeu = false
  /** The "Keep this device on" counts last told to the interface, to tell only changes. */
  #envioDito = "null"
  /** See `EventoDoHistorico.progressAt`. */
  #progressAt = 0
  /** Entries lost on the way in the plan that just finished, for the last event. */
  #perdidasNoFim = 0
  /** The same for files (1.3.27): media items that left as lost (`media.perdidas`). */
  #ficheirosPerdidosNoFim = 0
  /** The same for entries this device gave up on (22/11/2026): `notReceived`. */
  #notReceivedAtEnd = 0
  /**
   * A media request given up after `tentativasPorPedido` silences (1.3.27). It
   * counts as a failure only if the sibling answers the next `hi` before
   * `ate`: then it is there and did not deliver. A sibling that closed or
   * slept does not answer it, and a reload or a dropped connection here clears
   * this, so none of those count. In memory only.
   */
  #suspeita: { pedido: PedidoEmCurso; ate: number } | null = null
  /** For tests: signal count sent and received. */
  /** Who is waiting for a `trazerUm` item, by item key. */
  readonly #aEspera = new Map<string, ((desfecho: DesfechoDoIrmao) => void)[]>()
  /** The `trazerUm` items that arrived while a plan had no media list yet: they join it when it comes. */
  readonly #avulsos: ItemDeMediaDoIrmao[] = []
  /** For tests: how many signals went out and came in. */
  readonly estatisticas = { enviados: 0, recebidos: 0, recusados: 0, ilegiveis: 0, pedidos: 0, respostas: 0, descartados: 0, sessoes: 0, mediaPerdida: 0, pagesLost: 0 }

  constructor(porta: PortaDoHistorico) {
    this.#porta = porta
  }

  // ----------------------------------------------------------- connection

  /** The account changes or logs out: the kept session goes too. */
  esquecerSessao(): void {
    this.#pedinte = null
  }

  aoLigar(): void {
    this.aoDesligar()
    // A kept session asks again at the first step, for what is missing (see `aoDesligar`).
    const pedido = this.#pedinte?.pedido
    if (pedido) {
      pedido.enviadoEm = 0
      pedido.ultimaParte = 0
    }
    this.#ligadoEm = this.#porta.agora()
    this.#progressoEm = this.#ligadoEm
    this.#irmaoRespondeu = false
    this.#reposicaoNestaLigacao = false
    this.#relogio = setInterval(() => void this.#passo(), TECTOS_DO_FIO_DO_HISTORICO.passoMs)
    ;(this.#relogio as { unref?: () => void }).unref?.()
    queueMicrotask(() => void this.#passo())
  }

  /**
   * Connection dropped. The state stays in the vault, and the next connection continues.
   *
   * A session that a sibling already answered stays (layer C, 21/11/2026): the parts of the
   * response that came are kept, and on the next connection the same session asks only for
   * what is missing. Before, a phone that dropped its connection mid-photo threw away what had
   * come and asked for the whole response again. A responder that forgot the session answers
   * `hx`, and a new session opens, as before.
   */
  aoDesligar(): void {
    // Our own connection dropped: a silence before it says nothing about the item.
    this.#suspeita = null
    if (this.#relogio !== undefined) clearInterval(this.#relogio)
    this.#relogio = undefined
    if (this.#bomba !== undefined) clearTimeout(this.#bomba)
    this.#bomba = undefined
    if (!this.#pedinte?.chave) this.#pedinte = null
    const enviava = this.#envioEmCurso() !== undefined
    this.#respostas.clear()
    this.#guardadas.clear()
    // "Keep this device on" closes with the connection: the new device cannot ask here now.
    if (enviava || this.#envioDito !== "null") this.#dizer([])
    this.#fila.length = 0
    this.#noAr.clear()
  }

  /** For the interface: the current state. */
  estado(): EventoDoHistorico {
    return this.#evento([])
  }

  // ------------------------------------------------------------- clock

  /**
   * A single media item, requested from a connected sibling (the "Fetch"
   * gesture, design §8): opens a one-item plan, or puts the item at the front
   * of the current plan.
   *
   * - "chegou": a sibling sent it, and it entered the vault and the store;
   * - "nao-tem": a sibling answered without it;
   * - "sem-irmao": there is no sibling on this account, or none answered in time.
   *
   * Never throws.
   */
  async trazerUm(item: ItemDeMediaDoIrmao): Promise<DesfechoDoIrmao> {
    if (!this.#porta.conteudo() || !this.#porta.canalDaConta() || !this.#porta.podeSinalizar()) return "sem-irmao"
    if (!this.#haFonte()) return "sem-irmao"
    const chave = chaveDoItem(item)
    const desfecho = new Promise<DesfechoDoIrmao>((resolve) => {
      const lista = this.#aEspera.get(chave) ?? []
      lista.push(resolve)
      this.#aEspera.set(chave, lista)
    })
    const agora = this.#porta.agora()
    this.#porta.gravar((contents) => {
      const h = (contents.historico ??= {})
      if (!h.plano) {
        h.plano = { comecou: agora, canais: {}, media: { total: 1, feitas: 0, porTrazer: [item] } }
      } else if (h.plano.media) {
        const media = h.plano.media
        const ja = media.porTrazer.findIndex((x) => chaveDoItem(x) === chave)
        if (ja >= 0) media.porTrazer.splice(ja, 1)
        else media.total += 1
        media.porTrazer.unshift(item)
      } else if (!this.#avulsos.some((x) => chaveDoItem(x) === chave)) {
        // The plan does not have the media list yet: the item joins it when it comes.
        this.#avulsos.push(item)
      }
    })
    if (!this.#porta.conteudo()?.historico?.plano) {
      // The vault did not write (it locked meanwhile).
      this.#resolver(chave, "sem-irmao")
      return desfecho
    }
    if (!this.#pedinte) this.#ultimoHi = 0
    void this.#passo()
    const prazo = setTimeout(() => this.#largarAvulsos("sem-irmao", [chave]), TECTOS_DO_FIO_DO_HISTORICO.trazerUmMs)
    ;(prazo as { unref?: () => void }).unref?.()
    try {
      return await desfecho
    } finally {
      clearTimeout(prazo)
    }
  }

  #resolver(chave: string, desfecho: DesfechoDoIrmao): void {
    const lista = this.#aEspera.get(chave)
    if (!lista) return
    this.#aEspera.delete(chave)
    for (const resolve of lista) resolve(desfecho)
  }

  /**
   * The waiting `trazerUm` requests end with `desfecho`. On "sem-irmao", the
   * items leave the plan, and a plan left empty leaves: it does not stay asking
   * nobody.
   */
  #largarAvulsos(desfecho: DesfechoDoIrmao, chaves: string[] = [...this.#aEspera.keys()]): void {
    if (chaves.length === 0) return
    const largar = new Set(chaves)
    for (let i = this.#avulsos.length - 1; i >= 0; i--) if (largar.has(chaveDoItem(this.#avulsos[i] as ItemDeMediaDoIrmao))) this.#avulsos.splice(i, 1)
    if (desfecho === "sem-irmao") {
      this.#porta.gravar((contents) => {
        const plano = contents.historico?.plano
        const media = plano?.media
        if (!plano || !media) return
        const antes = media.porTrazer.length
        media.porTrazer = media.porTrazer.filter((x) => !largar.has(chaveDoItem(x)))
        media.total = Math.max(media.feitas, media.total - (antes - media.porTrazer.length))
        if (Object.keys(plano.canais).length === 0 && media.porTrazer.length === 0) delete contents.historico!.plano
      })
    }
    for (const chave of chaves) this.#resolver(chave, desfecho)
  }

  #emSerie(trabalho: () => Promise<void>): Promise<void> {
    const proximo = this.#cadeia.then(trabalho).catch(() => {
      // A failed step does not halt the following ones.
    })
    this.#cadeia = proximo
    return proximo
  }

  #passo(): Promise<void> {
    return this.#emSerie(() => this.#passoAgora())
  }

  async #passoAgora(): Promise<void> {
    // "Keep this device on" closes by itself when the new device goes quiet: the
    // event repeats only when something changed (`#dizer`).
    if (JSON.stringify(this.#envioEmCurso() ?? null) !== this.#envioDito) this.#dizer([])
    if (!this.#porta.podeSinalizar()) return
    const contents = this.#porta.conteudo()
    if (!contents || !this.#porta.canalDaConta()) return
    if (!(await this.#porta.contaPronta())) return
    const agora = this.#porta.agora()
    this.#esquecerVelhas(agora)
    this.#talvezDesistir(contents, agora)
    const pedinte = this.#pedinte
    if (!pedinte) {
      if (this.#querPedir(contents.historico, agora)) await this.#abrirSessao(agora)
      return
    }
    if (!pedinte.chave) {
      // Nobody answered the `hi` (an old sibling, or none connected): another can go out.
      if (agora - pedinte.aberta > TECTOS_DO_FIO_DO_HISTORICO.esperaDoInventarioMs) {
        this.#pedinte = null
        // This attempt found no sibling: a stopped plan says so from the next step (`#talvezDesistir`).
        this.#irmaoRespondeu = false
        this.#largarAvulsos("sem-irmao")
      }
      return
    }
    if (pedinte.pedido) await this.#talvezRepetir(pedinte, agora)
    else await this.#proximoPedido(pedinte)
  }

  /**
   * The deadline: with something to bring and no progress for `desistirAposMs`,
   * give up for now, with the reason. Written to the vault, so a reload does
   * not bring back a notice that already gave up.
   *
   * Once stopped, the reason is judged again at every step (20/11/2026): it
   * stood as "irmao-calado" forever before, even with no sibling left. And with
   * no source at all (no other device in the account), nothing can ever come:
   * the plan and the "initial" mark leave, and so does the notice.
   */
  #talvezDesistir(contents: VaultContents, agora: number): void {
    const h = contents.historico
    if (!h) return
    const parado = h.plano?.parado !== undefined || (!h.plano && h.inicial !== undefined && h.semIrmaoDesde !== undefined)
    if (!parado) {
      if (!h.plano && !h.inicial) return
      if (agora - this.#progressoEm < TECTOS_DO_FIO_DO_HISTORICO.desistirAposMs) return
    }
    if (!this.#haFonte()) {
      this.#semFonte()
      return
    }
    if (h.plano) {
      const razao: RazaoDoHistorico = this.#irmaoRespondeu ? "irmao-calado" : "sem-irmao"
      if (h.plano.parado?.razao === razao) return
      const desde = h.plano.parado?.em ?? agora
      this.#porta.gravar((c) => {
        if (c.historico?.plano) c.historico.plano.parado = { em: desde, razao }
      })
      // Only when it first stops: a quiet retry in flight is not cut by a new reason.
      if (!parado) this.#pedinte = null
      this.#dizer([])
    } else if (h.inicial && h.semIrmaoDesde === undefined) {
      this.#porta.gravar((c) => {
        if (c.historico?.inicial && !c.historico.plano) c.historico.semIrmaoDesde = agora
      })
      this.#dizer([])
    }
  }

  /**
   * Where history can come from. Today only the other devices of the account
   * (the leaves of the account channel); history from other members of a
   * channel is a different source, and plugs in HERE: a stopped plan, the
   * notice and `trazerUm` all ask this, and nothing else, whether a resume is
   * possible.
   */
  #haFonte(): boolean {
    const eu = this.#meuAparelho()
    return this.#porta.folhasDaConta().some((aparelho) => aparelho !== eu)
  }

  /** No source at all: the plan, the "initial" mark and the stopped state leave. What came, stays. */
  #semFonte(): void {
    this.#porta.gravar((c) => {
      const h = c.historico
      if (!h) return
      delete h.plano
      delete h.inicial
      delete h.semIrmaoDesde
    })
    this.#largarAvulsos("sem-irmao")
    this.#pedinte = null
    this.#dizer([])
  }

  /** The transfer moved: the deadline starts again, and a stopped plan is no longer stopped. */
  #progrediu(): void {
    this.#progressoEm = this.#porta.agora()
    this.#irmaoRespondeu = true
    const h = this.#porta.conteudo()?.historico
    if (h?.plano?.parado || h?.semIrmaoDesde !== undefined) {
      this.#porta.gravar((c) => {
        if (c.historico?.plano) delete c.historico.plano.parado
        if (c.historico) delete c.historico.semIrmaoDesde
      })
    }
  }

  /**
   * A real failure of a media request (1.3.27): the sibling answered `hx` for
   * this request, the request was given up after `tentativasPorPedido`
   * silences with the sibling still there (`#suspeita`), or the response did
   * not open. Charged, in the vault, to the item that led the request; at
   * `tentativasPorItem` that item leaves as lost (`#proximoPedido`). A reload,
   * a suspension or closing the app drop the session without coming here, so
   * they never count: on a phone that sleeps every minute, a large video is
   * not lost for that.
   *
   * A page of history follows the same rule since 22/11/2026 (`#pageFailed`), with
   * the reason for the diagnostic log.
   */
  #falhouOPedido(pedido: PedidoEmCurso | undefined, reason: PageFailureReason): void {
    if (pedido?.corpo.t === "pagina") return this.#pageFailed(pedido.corpo.c, pedido.corpo.desde, reason)
    if (pedido?.corpo.t !== "media") return
    const primeiro = pedido.corpo.itens[0]
    if (!primeiro) return
    const chave = chaveDoItem(primeiro)
    this.#porta.gravar((c) => {
      const m = c.historico?.plano?.media
      if (!m || !m.porTrazer.some((x) => chaveDoItem(x) === chave)) return
      m.tentativas = { ...m.tentativas, [chave]: (m.tentativas?.[chave] ?? 0) + 1 }
    })
  }

  /**
   * A real failure of the page at `desde` of channel `c` (22/11/2026), the same
   * rule as a media item: charged in the vault, and at `tentativasPorItem` the
   * channel ends (`#proximoPedido`). Only while the plan still waits for that page.
   * Before, the requester asked the same page forever: a 1.3.25 sibling answers
   * nothing when a response needs more than `partesMax` parts, each new session's
   * inventory counted as progress, the deadline never came, and the channels
   * after that page never came either.
   */
  #pageFailed(c: string, desde: number | null, reason: PageFailureReason): void {
    let attempt = 0
    this.#porta.gravar((contents) => {
      const canal = contents.historico?.plano?.canais[c]
      if (!canal || canal.fim || canal.cursor !== desde) return
      canal.failures = (canal.failures ?? 0) + 1
      canal.failureReason = reason
      attempt = canal.failures
    })
    if (attempt > 0) this.#dizer([], false, { reason, attempt })
  }

  #querPedir(estado: EstadoDoHistorico | undefined, agora: number): boolean {
    const t = TECTOS_DO_FIO_DO_HISTORICO
    // Nobody to ask: no `hi` into the void (the deadline then drops the plan, `#talvezDesistir`).
    if (!this.#haFonte()) return false
    const desdeOUltimo = agora - this.#ultimoHi
    // Stopped: quiet retries, slower. A sibling that connects brings it forward (`#irmaoLigado`).
    if (estado?.plano?.parado || (!estado?.plano && estado?.semIrmaoDesde !== undefined)) return desdeOUltimo >= t.retomarParadoMs
    if (estado?.plano) return desdeOUltimo >= t.esperaDoInventarioMs
    const inicial = estado?.inicial
    if (inicial && agora - inicial.desde < t.inicialDuraMs) {
      const rapido = agora - inicial.desde < t.inicialRapidoMs
      return desdeOUltimo >= (rapido ? t.esperaDoInventarioMs : t.intervaloLentoMs)
    }
    if (this.#reposicaoNestaLigacao) return false
    if (agora - this.#ligadoEm < t.primeiraReposicaoMs) return false
    if (this.#ultimaReposicao > 0 && agora - this.#ultimaReposicao < t.intervaloDaReposicaoMs) return false
    this.#reposicaoNestaLigacao = true
    this.#ultimaReposicao = agora
    return true
  }

  /**
   * The page came back to the foreground (1.3.7): asks the siblings again, if
   * the replay interval has already passed. Without this, a long connection on
   * the phone asked once and never again.
   */
  aoVoltar(): void {
    this.#irmaoLigado()
  }

  /** A sibling said it is connected (requested history): this one also asks it, once per interval. */
  #irmaoLigado(): void {
    const agora = this.#porta.agora()
    // A stopped transfer asks at once: the sibling it was waiting for is here.
    this.#ultimoHi = 0
    if (this.#ultimaReposicao > 0 && agora - this.#ultimaReposicao < TECTOS_DO_FIO_DO_HISTORICO.intervaloDaReposicaoMs) return
    this.#reposicaoNestaLigacao = false
    this.#ligadoEm = Math.min(this.#ligadoEm, agora - TECTOS_DO_FIO_DO_HISTORICO.primeiraReposicaoMs + 2_000)
  }

  async #abrirSessao(agora: number): Promise<void> {
    const sessao: SessaoDeQuemPede = { s: novoId(), par: novoParDoHistorico(), aberta: agora }
    this.#pedinte = sessao
    this.estatisticas.sessoes += 1
    this.#ultimoHi = agora
    const inicial = this.#porta.conteudo()?.historico?.inicial !== undefined
    await this.#enviar(
      { v: 1, k: "hi", s: sessao.s, ap: this.#meuAparelho(), x: toBase64(sessao.par.publica), ...(inicial ? { ini: 1 as const } : {}) },
      new Uint8Array(0),
    )
  }

  async #talvezRepetir(pedinte: SessaoDeQuemPede, agora: number): Promise<void> {
    const pedido = pedinte.pedido as PedidoEmCurso
    const t = TECTOS_DO_FIO_DO_HISTORICO
    /*
      A windowed response is paced by the responder's budget: between two windows the
      wait can reach a minute with nothing lost. Asking again at 30 s queued copies of
      parts already on their way, and spent the tries (21/11/2026, layer C).
    */
    const espera = pedinte.chegada?.janela !== undefined ? Math.max(t.esperaDaRespostaMs, t.esperaEntreJanelasMs) : t.esperaDaRespostaMs
    if (agora - Math.max(pedido.enviadoEm, pedido.ultimaParte) < espera) return
    if (pedido.tentativas >= t.tentativasPorPedido) {
      // The responder went silent: another session in the next step (maybe with a different sibling).
      // A failure only if the sibling answers that next `hi` (`#suspeita`): one that closed or slept never counts.
      if (pedido.corpo.t !== "media?") this.#suspeita = { pedido, ate: agora + t.esperaDoInventarioMs }
      this.#pedinte = null
      this.#ultimoHi = 0
      return
    }
    pedido.tentativas += 1
    pedido.ultimaParte = agora
    const chegada = pedinte.chegada
    if (chegada && chegada.id === pedido.id && chegada.recebidas > 0) {
      // Windowed: only what was asked so far, or the next window if all of that came.
      const ate = chegada.pedidoAte ?? chegada.n
      const faltam: number[] = []
      for (let i = 0; i < Math.min(ate, chegada.n) && faltam.length < 512; i++) if (!chegada.partes[i]) faltam.push(i)
      if (faltam.length === 0 && chegada.janela !== undefined && ate < chegada.n) {
        for (let i = ate; i < Math.min(ate + chegada.janela, chegada.n); i++) faltam.push(i)
        chegada.pedidoAte = ate + chegada.janela
      }
      await this.#enviar({ v: 1, k: "hp", s: pedinte.s, ap: this.#meuAparelho(), para: pedinte.com as string, id: pedido.id, f: faltam }, new Uint8Array(0))
      return
    }
    await this.#pedir(pedinte, pedido.corpo, pedido.tentativas)
  }

  // ------------------------------------------------------------ requester

  async #proximoPedido(pedinte: SessaoDeQuemPede): Promise<void> {
    const plano = this.#porta.conteudo()?.historico?.plano
    if (!plano) {
      this.#pedinte = null
      return
    }
    for (const [c, canal] of Object.entries(plano.canais)) {
      if (canal.fim) continue
      if ((canal.failures ?? 0) >= TECTOS_DO_FIO_DO_HISTORICO.tentativasPorItem) {
        this.#giveUpChannel(c)
        continue
      }
      await this.#pedir(pedinte, { t: "pagina", c, desde: canal.cursor })
      return
    }
    if (!plano.media) {
      const inicial = this.#porta.conteudo()?.historico?.inicial !== undefined
      await this.#pedir(pedinte, inicial ? { t: "media?" } : { t: "media?", canais: Object.keys(plano.canais) })
      return
    }
    if (plano.media.porTrazer.length > 0) {
      const primeiro = plano.media.porTrazer[0] as ItemDeMediaDoIrmao
      const chave = chaveDoItem(primeiro)
      const falhas = plano.media.tentativas?.[chave] ?? 0
      if (falhas >= TECTOS_DO_FIO_DO_HISTORICO.tentativasPorItem) {
        // A unit that never completes: counted as done and lost, so the sync ends (diagnostic: `mediaPerdida`).
        this.#porta.gravar((c) => {
          const m = c.historico?.plano?.media
          if (!m) return
          m.porTrazer = m.porTrazer.filter((x) => chaveDoItem(x) !== chave)
          m.feitas = Math.min(m.total, m.feitas + 1)
          m.perdidas = (m.perdidas ?? 0) + 1
          if (m.tentativas) delete m.tentativas[chave]
        })
        this.estatisticas.mediaPerdida += 1
        this.#resolver(chave, "nao-tem")
        this.#dizer([])
        return this.#proximoPedido(pedinte)
      }
      // An item that failed before goes alone: it does not take the seven behind it down with it.
      const itens = falhas > 0 ? [primeiro] : plano.media.porTrazer.slice(0, TECTOS_DO_HISTORICO.itensPorPedidoDeMedia)
      await this.#pedir(pedinte, { t: "media", itens })
      return
    }
    this.#acabar()
  }

  /**
   * A page that failed `tentativasPorItem` real times: the rest of the channel
   * counts as not received (`notReceived`, and out of the total through
   * `perdidas`), and the channel ends here, so the sync goes on to the next one.
   */
  #giveUpChannel(c: string): void {
    let skipped = 0
    let reason: PageFailureReason = "silent"
    let attempt = 0
    this.#porta.gravar((contents) => {
      const canal = contents.historico?.plano?.canais[c]
      if (!canal || canal.fim) return
      skipped = Math.max(0, canal.total - (canal.perdidas ?? 0) - canal.feitas)
      reason = canal.failureReason ?? reason
      attempt = canal.failures ?? 0
      canal.perdidas = (canal.perdidas ?? 0) + skipped
      canal.notReceived = (canal.notReceived ?? 0) + skipped
      canal.fim = true
      delete canal.failures
      delete canal.failureReason
    })
    this.estatisticas.pagesLost += 1
    this.#dizer([], false, { reason, attempt, notReceived: skipped })
  }

  async #pedir(pedinte: SessaoDeQuemPede, corpo: Pedido, tentativas = 0): Promise<void> {
    if (!pedinte.chave || !pedinte.com) return
    const id = novoId()
    const agora = this.#porta.agora()
    pedinte.pedido = { id, corpo, enviadoEm: agora, ultimaParte: agora, tentativas }
    pedinte.chegada = undefined
    const selado = selarBloco(pedinte.chave, pedinte.s, `p:${id}`, new TextEncoder().encode(JSON.stringify(corpo)))
    this.estatisticas.pedidos += 1
    await this.#enviar({ v: 1, k: "hp", s: pedinte.s, ap: this.#meuAparelho(), para: pedinte.com, id }, selado)
  }

  /** Part of inventory or response for the requester's session. */
  async #aoParte(cabecalho: Cabecalho, corpo: Uint8Array): Promise<void> {
    const pedinte = this.#pedinte
    if (!pedinte || cabecalho.s !== pedinte.s) return
    const n = cabecalho.n
    const i = cabecalho.i
    if (typeof n !== "number" || typeof i !== "number" || !Number.isSafeInteger(n) || n < 1 || n > TECTOS_DO_FIO_DO_HISTORICO.partesMax) return
    if (!Number.isSafeInteger(i) || i < 0 || i >= n || typeof cabecalho.id !== "string") return

    if (cabecalho.k === "hn") {
      // The first sibling to respond keeps the session; the others go silent.
      if (pedinte.com && pedinte.com !== cabecalho.ap) return
      if (!pedinte.chave) {
        if (typeof cabecalho.x !== "string") return
        let publica: Uint8Array
        try {
          publica = fromBase64(cabecalho.x)
          pedinte.chave = chaveDoHistorico(pedinte.par.privada, publica, pedinte.s, {
            aparelhoQuePede: fromBase64(this.#meuAparelho()),
            aparelhoQueResponde: fromBase64(cabecalho.ap),
            efemeraQuePede: pedinte.par.publica,
            efemeraQueResponde: publica,
          })
        } catch {
          return
        }
        pedinte.com = cabecalho.ap
      }
      // A responder that split again smaller (a part refused as too large) sends a larger `n`: start over with it.
      if (pedinte.inventario && pedinte.inventario.n < n) pedinte.inventario = undefined
      pedinte.inventario ??= { id: cabecalho.id, n, partes: new Array<Uint8Array | undefined>(n), recebidas: 0 }
      const completo = this.#guardarParte(pedinte.inventario, i, n, corpo)
      if (!completo) return
      const inventario = await this.#abrirResposta<Inventario>(pedinte, pedinte.inventario)
      pedinte.inventario = undefined
      if (!inventario || !Array.isArray(inventario.canais)) {
        this.#pedinte = null
        return
      }
      this.#progrediu()
      // The sibling that went silent on a media request answers at once: it is there, and the request failed.
      const suspeita = this.#suspeita
      this.#suspeita = null
      if (suspeita && this.#porta.agora() <= suspeita.ate) this.#falhouOPedido(suspeita.pedido, "silent")
      this.#aoInventario(inventario)
      await this.#proximoPedido(pedinte)
      return
    }

    // `hr`: a response to the current request.
    const pedido = pedinte.pedido
    if (!pedido || cabecalho.id !== pedido.id || cabecalho.ap !== pedinte.com) return
    if (pedinte.chegada && pedinte.chegada.n < n) pedinte.chegada = undefined
    pedinte.chegada ??= { id: pedido.id, n, partes: new Array<Uint8Array | undefined>(n), recebidas: 0 }
    // Only a part that was missing counts. A late copy of a part already held (a resend
    // crossing the original) is not the responder answering: it must not reset the tries
    // or the deadline, or a part that never comes is never asked for again.
    if (pedinte.chegada.n === n && !pedinte.chegada.partes[i]) {
      pedido.ultimaParte = this.#porta.agora()
      // A part that came: the responder is there. The tries count silences in a row, not silences ever.
      pedido.tentativas = 0
      // Each part is progress: a 2 MiB media response takes minutes at 40 signals a minute, and must not hit the deadline.
      this.#progrediu()
    }
    if (!this.#guardarParte(pedinte.chegada, i, n, corpo)) {
      await this.#pedirJanelaSeguinte(pedinte, pedinte.chegada, cabecalho.w)
      return
    }
    const resposta = await this.#abrirResposta<unknown>(pedinte, pedinte.chegada)
    pedinte.chegada = undefined
    pedinte.pedido = undefined
    if (resposta === null) {
      this.#falhouOPedido(pedido, "unreadable")
      return
    }
    this.estatisticas.respostas += 1
    try {
      this.#aoResposta(pedido.corpo, resposta)
    } catch (error) {
      // A page this device cannot merge is a failure of that page, not a silent retry forever.
      if (pedido.corpo.t !== "pagina") throw error
      this.#falhouOPedido(pedido, "merge-failed")
    }
    await this.#proximoPedido(pedinte)
  }

  /**
   * A windowed response (`w`, layer C): when every part asked so far came, ask for the next
   * window. Without `w` (an older responder) the whole response comes on its own.
   */
  async #pedirJanelaSeguinte(pedinte: SessaoDeQuemPede, chegada: Chegada, w: number | undefined): Promise<void> {
    if (typeof w !== "number" || !Number.isSafeInteger(w) || w < 1 || w >= chegada.n) return
    chegada.janela ??= w
    chegada.pedidoAte ??= w
    const ate = chegada.pedidoAte
    if (ate >= chegada.n) return
    for (let i = 0; i < ate; i++) if (!chegada.partes[i]) return
    const f: number[] = []
    for (let i = ate; i < Math.min(ate + chegada.janela, chegada.n); i++) f.push(i)
    chegada.pedidoAte = ate + chegada.janela
    await this.#enviar({ v: 1, k: "hp", s: pedinte.s, ap: this.#meuAparelho(), para: pedinte.com as string, id: chegada.id, f }, new Uint8Array(0))
  }

  #guardarParte(chegada: Chegada, i: number, n: number, corpo: Uint8Array): boolean {
    if (chegada.n !== n) return false
    if (!chegada.partes[i]) {
      chegada.partes[i] = corpo.slice()
      chegada.recebidas += 1
      this.#moved()
    }
    return chegada.recebidas === chegada.n
  }

  async #abrirResposta<T>(pedinte: SessaoDeQuemPede, chegada: Chegada): Promise<T | null> {
    if (!pedinte.chave) return null
    const selado = juntar(...(chegada.partes as Uint8Array[]))
    const aberto = abrirBloco(pedinte.chave, pedinte.s, `r:${chegada.id}`, selado)
    if (!aberto) return null
    const texto = await descomprimir(aberto)
    if (!texto) return null
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(texto)) as T
    } catch {
      return null
    }
  }

  /** The sibling's inventory: the state, or the existing state with new counts. */
  #aoInventario(inventario: Inventario): void {
    const canalDaConta = this.#porta.canalDaConta()
    const agora = this.#porta.agora()
    const mudaram: string[] = []
    this.#porta.gravar((contents) => {
      const h = (contents.historico ??= {})
      const inicial = h.inicial !== undefined
      const canais = inventario.canais.filter(
        (canal) =>
          typeof canal?.c === "string" &&
          canal.c !== canalDaConta &&
          typeof canal.n === "number" &&
          typeof canal.h === "string" &&
          canal.c.length <= 255,
      )
      if (h.plano) {
        // Resume: only channels the state already had. A channel the user deleted elsewhere dropped from the state and does not come back here.
        for (const canal of canais) {
          const noPlano = h.plano.canais[canal.c]
          if (!noPlano) continue
          /*
            A channel already finished is not asked again in this plan: what the sibling
            gained there since comes in the next sync. Grown, its total stood above what
            could ever come, and the bar showed "1437 of 1503 messages" to the end of the plan.
          */
          if (!noPlano.fim) noPlano.total = Math.max(noPlano.total, canal.n, noPlano.feitas)
          noPlano.resumo = canal.h
          if (typeof canal.q === "object" && canal.q !== null) noPlano.conversa = canal.q
          else delete noPlano.conversa
        }
      } else {
        const plano: NonNullable<EstadoDoHistorico["plano"]> = { comecou: agora, canais: {} }
        for (const canal of canais) {
          // Between already-paired siblings, only channels this device is in (or was removed from with history): a channel the user deleted here does not come back through sync.
          if (!inicial && !this.#porta.temGrupo(canal.c) && contents.canaisArquivados?.[canal.c] === undefined) continue
          if (canal.h === resumoDoHistorico(contents, canal.c)) {
            ;(h.trazidos ??= {})[canal.c] = canal.h
            continue
          }
          if (!inicial && h.trazidos?.[canal.c] === canal.h) continue
          plano.canais[canal.c] = { total: canal.n, feitas: 0, cursor: null, resumo: canal.h, ...(typeof canal.q === "object" && canal.q !== null ? { conversa: canal.q } : {}) }
        }
        // No channels and not the initial device: nothing to fetch. The initial device still fetches media.
        if (inicial || Object.keys(plano.canais).length > 0) h.plano = plano
      }
      for (const canal of canais) {
        if (!h.plano?.canais[canal.c]) continue
        fichaDoIrmao(contents, canal.c, canal.f)
        if (typeof canal.a === "number" && !this.#porta.temGrupo(canal.c) && contents.canaisArquivados?.[canal.c] === undefined) {
          contents.canaisArquivados = { ...contents.canaisArquivados, [canal.c]: canal.a }
          mudaram.push(canal.c)
        }
        if (canal.l === null || (typeof canal.l?.seq === "number" && typeof canal.l.em === "number")) {
          h.lugares = { ...h.lugares, [canal.c]: canal.l }
        }
      }
    })
    if (!this.#porta.conteudo()?.historico?.plano) {
      // Nothing to fetch from this sibling.
      this.#pedinte = null
      this.#ultimaReposicao = agora
    }
    this.#dizer(mudaram)
  }

  #aoResposta(corpo: Pedido, resposta: unknown): void {
    if (corpo.t === "pagina") return this.#aoPagina(corpo.c, corpo.desde, resposta as PaginaDoHistorico)
    if (corpo.t === "media?") return this.#aoListaDeMedia(resposta as { itens?: MediaNoIrmao[] })
    return this.#aoMedia(corpo.itens, resposta as { itens?: MediaInteira[]; resto?: number })
  }

  #aoPagina(c: string, desde: number | null, pagina: PaginaDoHistorico): void {
    if (typeof pagina !== "object" || pagina === null || pagina.c !== c || !Array.isArray(pagina.e)) {
      this.#pageFailed(c, desde, "unreadable")
      return
    }
    // A page that is not the end and does not move the cursor would be asked again forever.
    const empty = pagina.e.length === 0 && !pagina.p
    if (!pagina.fim && !empty && (typeof pagina.ate !== "number" || (desde !== null && pagina.ate <= desde))) {
      this.#pageFailed(c, desde, "no-progress")
      return
    }
    let mudou = false
    this.#porta.gravar((contents) => {
      const canal = contents.historico?.plano?.canais[c]
      if (!canal) return
      delete canal.failures
      delete canal.failureReason
      const entradas = pagina.e.filter(entradaValida).filter((entrada) => !this.#porta.bloqueado(c, entrada.sender))
      // What comes in with bytes (a sibling always sends `inline`) moves to the store, in the same mutation.
      if (fundirEntradasDoIrmao(contents, c, this.#absorverNovas(contents, c, entradas)) > 0) mudou = true
      if (pagina.r && typeof pagina.r === "object") {
        fundirRegistosDoIrmao(contents, c, registosSemRefs(pagina.r))
        this.#absorverRegistos(contents, c)
        mudou = true
      }
      const perdidas = typeof pagina.p === "number" && Number.isSafeInteger(pagina.p) && pagina.p > 0 ? pagina.p : 0
      if (perdidas > 0) canal.perdidas = Math.min(canal.total, (canal.perdidas ?? 0) + perdidas)
      const possivel = canal.total - (canal.perdidas ?? 0)
      canal.feitas = Math.min(possivel, canal.feitas + pagina.e.length)
      if (typeof pagina.ate === "number") canal.cursor = pagina.ate
      if (pagina.fim || (pagina.e.length === 0 && perdidas === 0)) {
        canal.fim = true
        canal.feitas = possivel
      }
    })
    this.#progrediu()
    this.#dizer(mudou ? [c] : [])
  }

  #aoListaDeMedia(resposta: { itens?: MediaNoIrmao[] }): void {
    const itens = Array.isArray(resposta?.itens) ? resposta.itens : []
    this.#porta.gravar((contents) => {
      const plano = contents.historico?.plano
      if (!plano) return
      const porTrazer: ItemDeMediaDoIrmao[] = []
      const vistos = new Set<string>()
      for (const item of itens) {
        if (typeof item !== "object" || item === null || typeof item.b !== "number") continue
        if ("c" in item && (typeof item.c !== "string" || typeof item.e !== "string")) continue
        if ("v" in item && typeof item.v !== "string") continue
        if ("a" in item && (typeof item.a !== "string" || typeof item.at !== "number")) continue
        if (!("c" in item) && !("v" in item) && !("a" in item)) continue
        if ("c" in item && this.#porta.bloqueado(item.c, item.e.split("|")[1] ?? "")) continue
        if (!faltaAqui(contents, item, (sha) => this.#porta.armazem.presente(sha))) continue
        const pedido = pedidoDe(item)
        const chave = chaveDoItem(pedido)
        if (vistos.has(chave)) continue
        vistos.add(chave)
        porTrazer.push(pedido)
      }
      // Conversation thumbnails before videos and avatars: these show up first.
      porTrazer.sort((a, b) => ordemDoItem(a) - ordemDoItem(b))
      // The `trazerUm` requests ahead of everything: someone is looking at them.
      for (const item of this.#avulsos.splice(0).reverse()) {
        if (vistos.has(chaveDoItem(item))) porTrazer.splice(porTrazer.findIndex((x) => chaveDoItem(x) === chaveDoItem(item)), 1)
        porTrazer.unshift(item)
      }
      plano.media = { total: porTrazer.length, feitas: 0, porTrazer }
    })
    this.#progrediu()
    this.#dizer([])
  }

  #aoMedia(pedidos: ItemDeMediaDoIrmao[], resposta: { itens?: MediaInteira[]; resto?: number }): void {
    const itens = Array.isArray(resposta?.itens) ? resposta.itens : []
    const resto = typeof resposta?.resto === "number" && resposta.resto >= 0 ? Math.min(resposta.resto, pedidos.length) : 0
    const tratados = new Set(pedidos.slice(0, pedidos.length - resto).map(chaveDoItem))
    const canais = new Set<string>()
    const chegaram = new Set<string>()
    let perfis = false
    this.#porta.gravar((contents) => {
      const media = contents.historico?.plano?.media
      if (!media) return
      for (const item of itens) {
        if (typeof item !== "object" || item === null) continue
        if ("c" in item && typeof item.c === "string" && typeof item.e === "string" && typeof item.p === "object" && item.p !== null) {
          if (this.#porta.bloqueado(item.c, item.e.split("|")[1] ?? "")) continue
          if (juntarMediaDoIrmao(contents, item.c, item.e, soInlineOuEvicted(item.p), (sha) => this.#porta.armazem.presente(sha))) {
            this.#absorverEntrada(contents, item.c, item.e)
            canais.add(item.c)
          }
          chegaram.add(chaveDoItem({ c: item.c, e: item.e }))
        } else if ("v" in item && typeof item.v === "string" && typeof item.b64 === "string") {
          // Video verified by its hash, which is its key: a mismatched video is rejected.
          try {
            const resumo = toBase64(sha256(base64ParaBytes(item.b64)))
            if (resumo === item.v) {
              this.#porta.armazem.guardarVideo(contents, item.v, base64ParaBytes(item.b64), typeof item.at === "number" ? item.at : this.#porta.agora())
              chegaram.add(chaveDoItem({ v: item.v }))
            }
          } catch {
            // Corrupted bytes: rejected, not requested again.
          }
        } else if ("a" in item && typeof item.a === "string" && typeof item.perfil === "object" && item.perfil !== null) {
          const perfil = item.perfil
          if (typeof perfil.at !== "number" || typeof perfil.payload !== "object" || perfil.payload === null) continue
          const aqui = contents.directory[item.a]
          if (aqui && !aqui.parcial && aqui.at > perfil.at) continue
          const { parcial: _parcial, ...inteiro } = structuredClone(perfil)
          contents.directory[item.a] = { ...inteiro, payload: this.#porta.armazem.absorver(contents, soInlineOuEvicted(inteiro.payload)) }
          perfis = true
          chegaram.add(chaveDoItem({ a: item.a }))
        }
      }
      const antes = media.porTrazer.length
      media.porTrazer = media.porTrazer.filter((item) => !tratados.has(chaveDoItem(item)))
      if (media.tentativas) for (const chave of tratados) delete media.tentativas[chave]
      media.feitas = Math.min(media.total, media.feitas + (antes - media.porTrazer.length))
    })
    this.#progrediu()
    for (const chave of tratados) this.#resolver(chave, chegaram.has(chave) ? "chegou" : "nao-tem")
    this.#dizer([...canais], perfis)
  }

  /**
   * A sibling page's entries ready to merge: without foreign references
   * (Ruling R14: a `{ ref }` from the wire would point to a `sha` in this
   * vault), and those not here yet with their bytes in the store. Repeated ones
   * are not absorbed: `fundirEntradasDoIrmao` throws them away, and the blob
   * would be orphaned. Runs inside `gravar`.
   */
  #absorverNovas(contents: VaultContents, canal: string, entradas: StoredChatMessage[]): StoredChatMessage[] {
    const aqui = [...(contents.history[canal] ?? []), ...(contents.estadoDoCanal?.[canal] ?? [])]
    // An act inherited from pairing gives way to the full event: it counts as new.
    const seqs = new Set(aqui.filter((e) => e.seq >= 0 && !e.herdado).map((e) => e.seq))
    const chaves = new Set(aqui.map(chaveDoEvento).filter((chave): chave is string => chave !== null))
    return entradas.map((entrada) => {
      const limpo = soInlineOuEvicted(entrada.payload)
      const chave = chaveDoEvento(entrada)
      // The `fundirEntradasDoIrmao` rules: without identity, or already here (in the vault or earlier in this page), it does not enter.
      const fora = (chave === null && entrada.seq < 0) || (entrada.seq >= 0 && seqs.has(entrada.seq)) || (chave !== null && chaves.has(chave))
      if (entrada.seq >= 0) seqs.add(entrada.seq)
      if (chave !== null) chaves.add(chave)
      const payload = fora ? limpo : this.#porta.armazem.absorver(contents, limpo)
      return payload === entrada.payload ? entrada : { ...entrada, payload }
    })
  }

  /** The entry with this key, with its bytes moved to the store. Inside `gravar`. */
  #absorverEntrada(contents: VaultContents, canal: string, chave: string): void {
    for (const lista of [contents.history[canal], contents.estadoDoCanal?.[canal]]) {
      const entrada = lista?.find((e) => chaveDoEvento(e) === chave)
      if (!entrada) continue
      const payload = this.#porta.armazem.absorver(contents, entrada.payload)
      if (payload !== entrada.payload) entrada.payload = payload
      return
    }
  }

  /** The channel records that can have media (the presentation and the rooms), with the bytes in the store. Inside `gravar`. */
  #absorverRegistos(contents: VaultContents, canal: string): void {
    const meta = contents.spaceMeta[canal]
    if (meta) {
      const payload = this.#porta.armazem.absorver(contents, meta.payload)
      if (payload !== meta.payload) contents.spaceMeta[canal] = { ...meta, payload }
    }
    const salas = contents.channelRooms[canal]
    for (const [id, sala] of Object.entries(salas ?? {})) {
      const payload = this.#porta.armazem.absorver(contents, sala.payload)
      if (payload !== sala.payload) salas![id] = { ...sala, payload }
    }
  }

  #acabar(): void {
    const agora = this.#porta.agora()
    this.#perdidasNoFim = 0
    this.#ficheirosPerdidosNoFim = 0
    this.#notReceivedAtEnd = 0
    this.#porta.gravar((contents) => {
      const h = contents.historico
      if (!h?.plano) return
      for (const canal of Object.values(h.plano.canais)) {
        this.#perdidasNoFim += (canal.perdidas ?? 0) - (canal.notReceived ?? 0)
        this.#notReceivedAtEnd += canal.notReceived ?? 0
      }
      this.#ficheirosPerdidosNoFim = h.plano.media?.perdidas ?? 0
      for (const [c, canal] of Object.entries(h.plano.canais)) (h.trazidos ??= {})[c] = canal.resumo
      delete h.plano
      delete h.inicial
    })
    // An item left out of the plan (the sibling did not list it): it does not have it.
    this.#largarAvulsos("nao-tem")
    this.#pedinte = null
    this.#ultimaReposicao = agora
    this.#dizer([])
    this.#perdidasNoFim = 0
    this.#ficheirosPerdidosNoFim = 0
    this.#notReceivedAtEnd = 0
  }

  // -------------------------------------------------------- responder

  async #aoHi(cabecalho: Cabecalho): Promise<void> {
    if (typeof cabecalho.x !== "string") return
    const contents = this.#porta.conteudo()
    if (!contents) return
    this.#irmaoLigado()
    // One session per device: a new `hi` from the same device replaces the previous one.
    let envioAnterior: EnvioDoHistorico | undefined
    const substituidas = new Set<string>()
    for (const [s, sessao] of this.#respostas) {
      if (sessao.para !== cabecalho.ap) continue
      envioAnterior ??= sessao.envio
      this.#respostas.delete(s)
      substituidas.add(s)
    }
    /*
      And what was still queued for the replaced session goes too (21/11/2026). A phone
      that locks mid-media leaves a large response here, drained at the signal budget
      (40 a minute): its new session's inventory and pages waited behind minutes of parts
      no one would read, the phone saw no progress, gave up ("irmao-calado"), and on the
      next lock left another one. Only the device that asked can open those parts.
    */
    if (substituidas.size > 0) {
      const antes = this.#fila.length
      for (let i = this.#fila.length - 1; i >= 0; i--) {
        const s = this.#fila[i]?.de.s
        if (s !== undefined && substituidas.has(s)) this.#fila.splice(i, 1)
      }
      this.estatisticas.descartados += antes - this.#fila.length
      for (const chave of [...this.#guardadas.keys()]) if (substituidas.has(chave.slice(0, chave.indexOf("|")))) this.#guardadas.delete(chave)
    }
    const par = novoParDoHistorico()
    let chave: Uint8Array
    try {
      const publica = fromBase64(cabecalho.x)
      chave = chaveDoHistorico(par.privada, publica, cabecalho.s, {
        aparelhoQuePede: fromBase64(cabecalho.ap),
        aparelhoQueResponde: fromBase64(this.#meuAparelho()),
        efemeraQuePede: publica,
        efemeraQueResponde: par.publica,
      })
    } catch {
      return
    }
    const agora = this.#porta.agora()
    const inventario = inventarioDe(contents, this.#contexto())
    // A freshly paired device: count what goes, for "Keep this device on" here.
    // The same device opening another session (it resumes from its cursor) keeps the counts.
    const total = inventario.canais.reduce((soma, canal) => soma + canal.n, 0)
    const envio: EnvioDoHistorico | undefined =
      cabecalho.ini !== 1
        ? undefined
        : envioAnterior
          ? { ...envioAnterior, mensagens: { ...envioAnterior.mensagens, total: Math.max(total, envioAnterior.mensagens.feitas) } }
          : { mensagens: { feitas: 0, total }, fotografias: null }
    this.#respostas.set(cabecalho.s, { chave, para: cabecalho.ap, ultimo: agora, ...(envio ? { envio } : {}) })
    if (envio) this.#dizer([])
    const x = toBase64(par.publica)
    // An inventory too large for the wire goes again without the conversation bitsets (`q`): the count is then not exact, but the history comes.
    if (!(await this.#responder(cabecalho.s, "hn", cabecalho.ap, "inv", inventario, x))) {
      await this.#responder(cabecalho.s, "hn", cabecalho.ap, "inv", inventarioDe(contents, this.#contexto(), { semConversa: true }), x)
    }
  }

  async #aoPedido(cabecalho: Cabecalho, corpo: Uint8Array): Promise<void> {
    const sessao = this.#respostas.get(cabecalho.s)
    if (!sessao || sessao.para !== cabecalho.ap || typeof cabecalho.id !== "string") {
      await this.#enviar({ v: 1, k: "hx", s: cabecalho.s, ap: this.#meuAparelho(), para: cabecalho.ap }, new Uint8Array(0))
      return
    }
    sessao.ultimo = this.#porta.agora()
    if (Array.isArray(cabecalho.f)) {
      const guardada = this.#guardadas.get(`${cabecalho.s}|${cabecalho.id}`)
      if (!guardada) {
        await this.#enviar({ v: 1, k: "hx", s: cabecalho.s, ap: this.#meuAparelho(), para: cabecalho.ap, id: cabecalho.id }, new Uint8Array(0))
        return
      }
      // A windowed response lives as long as it is being asked for (layer C).
      guardada.em = this.#porta.agora()
      for (const i of cabecalho.f.slice(0, 512)) {
        const parte = guardada.partes[i]
        const cab = guardada.cabecalhos[i]
        if (parte && cab) await this.#enviar(cab, parte)
      }
      return
    }
    const aberto = abrirBloco(sessao.chave, cabecalho.s, `p:${cabecalho.id}`, corpo)
    if (!aberto) return
    let pedido: Pedido
    try {
      pedido = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(aberto)) as Pedido
    } catch {
      return
    }
    const contents = this.#porta.conteudo()
    if (!contents || typeof pedido !== "object" || pedido === null) return
    let resposta: unknown
    const eu = this.#porta.eu().address
    if (pedido.t === "pagina" && typeof pedido.c === "string") {
      if (pedido.c === this.#porta.canalDaConta()) return
      const desde = typeof pedido.desde === "number" ? pedido.desde : null
      try {
        resposta = await paginaDe(contents, pedido.c, desde, this.#porta.armazem.inflar)
      } catch {
        // A channel that cannot be paged at all: say it ended, never stay silent (the requester would ask forever).
        resposta = { c: pedido.c, e: [], ate: desde, fim: true } satisfies PaginaDoHistorico
      }
    } else if (pedido.t === "media?") {
      const canais = Array.isArray(pedido.canais) ? pedido.canais.filter((c) => typeof c === "string") : undefined
      resposta = { itens: mediaDe(contents, eu, (sha) => this.#porta.armazem.presente(sha), canais) }
    } else if (pedido.t === "media" && Array.isArray(pedido.itens)) {
      const pedidos = pedido.itens.slice(0, TECTOS_DO_HISTORICO.itensPorPedidoDeMedia)
      resposta = await mediaInteiraDe(contents, eu, pedidos, this.#porta.armazem.inflar)
    } else {
      return
    }
    // A response that does not fit the wire is cut smaller, and at the end says what could not go: never silence (20/11/2026).
    while (!(await this.#responder(cabecalho.s, "hr", cabecalho.ap, cabecalho.id, resposta))) {
      const menor = await this.#respostaMenor(contents, pedido, resposta)
      if (menor === null) return
      resposta = menor
    }
    if (sessao.envio) {
      this.#contarEnvio(sessao.envio, pedido.t, resposta)
      this.#dizer([])
    }
  }

  /**
   * A smaller response for the same request, when the last one did not fit the
   * wire (more than `partesMax` parts). Before, the responder went silent and
   * the requester asked the same thing again, forever.
   *
   * - a page: half the entries; one entry that still does not fit goes as lost
   *   (`p`), and the cursor moves past it;
   * - media: half the items, the rest asked again (`resto`); one item that
   *   still does not fit is answered without it ("nao-tem" on the other side).
   *
   * `null`: nothing smaller to send (the media list, an already empty answer).
   */
  async #respostaMenor(contents: VaultContents, pedido: Pedido, anterior: unknown): Promise<unknown> {
    if (pedido.t === "pagina") {
      const pagina = anterior as PaginaDoHistorico
      if (pagina.e.length > 1) {
        const desde = typeof pedido.desde === "number" ? pedido.desde : null
        return paginaDe(contents, pedido.c, desde, this.#porta.armazem.inflar, { maxEntradas: Math.floor(pagina.e.length / 2) })
      }
      if (pagina.e.length === 0 && pagina.r === undefined) return null
      return { c: pagina.c, e: [], ate: pagina.ate, fim: pagina.fim, p: pagina.e.length + (pagina.p ?? 0) } satisfies PaginaDoHistorico
    }
    if (pedido.t === "media") {
      const pedidos = pedido.itens.slice(0, TECTOS_DO_HISTORICO.itensPorPedidoDeMedia)
      const media = anterior as { itens: unknown[]; resto: number }
      const tratados = pedidos.length - media.resto
      if (tratados > 1) {
        const metade = pedidos.slice(0, Math.floor(tratados / 2))
        const r = await mediaInteiraDe(contents, this.#porta.eu().address, metade, this.#porta.armazem.inflar)
        return { itens: r.itens, resto: pedidos.length - metade.length + r.resto }
      }
      if (media.itens.length === 0) return null
      return { itens: [], resto: pedidos.length - 1 }
    }
    return null
  }

  /** What one response carried, into the counts of "Keep this device on". */
  #contarEnvio(envio: EnvioDoHistorico, tipo: Pedido["t"], resposta: unknown): void {
    if (tipo === "pagina") {
      const pagina = resposta as PaginaDoHistorico
      const m = envio.mensagens
      m.feitas = Math.min(m.total, m.feitas + pagina.e.length + (pagina.p ?? 0))
    } else if (tipo === "media?") {
      envio.fotografias = { feitas: 0, total: (resposta as { itens: unknown[] }).itens.length }
    } else if (envio.fotografias) {
      const f = envio.fotografias
      f.feitas = Math.min(f.total, f.feitas + ((resposta as { itens?: unknown[] }).itens?.length ?? 0))
    }
  }

  /**
   * The transfer this device is sending to a freshly paired one, while it runs.
   * Ends when the new device has every entry and every media item, or when it has
   * not asked for anything in `envioCaladoMs` (closed, gone to the background).
   */
  #envioEmCurso(): EnvioDoHistorico | undefined {
    const agora = this.#porta.agora()
    let escolhido: SessaoDeQuemResponde | undefined
    for (const sessao of this.#respostas.values()) {
      const envio = sessao.envio
      if (!envio || agora - sessao.ultimo > TECTOS_DO_FIO_DO_HISTORICO.envioCaladoMs) continue
      const acabou = envio.mensagens.feitas >= envio.mensagens.total && envio.fotografias !== null && envio.fotografias.feitas >= envio.fotografias.total
      if (acabou) continue
      if (!escolhido || sessao.ultimo > escolhido.ultimo) escolhido = sessao
    }
    return escolhido?.envio ? structuredClone(escolhido.envio) : undefined
  }

  /** `false`: the response does not fit the wire (more than `partesMax` parts); the caller sends a smaller one. */
  async #responder(s: string, k: "hn" | "hr", para: string, id: string, resposta: unknown, x?: string): Promise<boolean> {
    const sessao = this.#respostas.get(s)
    if (!sessao) return true
    const texto = await comprimir(new TextEncoder().encode(JSON.stringify(resposta)))
    const selado = selarBloco(sessao.chave, s, `r:${id}`, texto)
    return this.#mandarPartes(s, k, para, id, selado, x, TECTOS_DO_FIO_DO_HISTORICO.bytesPorParte)
  }

  /**
   * A sealed response, in parts of `passo` bytes. A part whose signal passes
   * `sinalMaxCaracteres` makes the whole response split again, smaller (it
   * was dropped in silence before, and the requester waited forever). `false`
   * only when it needs more than `partesMax` parts.
   */
  async #mandarPartes(s: string, k: "hn" | "hr", para: string, id: string, selado: Uint8Array, x: string | undefined, passo: number): Promise<boolean> {
    for (; passo >= PARTE_MINIMA; passo = Math.floor(passo / 2)) {
      const partes = partir(selado, passo)
      if (partes.length > TECTOS_DO_FIO_DO_HISTORICO.partesMax) return false
      /*
        Windowed past one window, always (1.3.27). Before, only a response that fit
        `guardadasBytes`: a larger one (a 25 MiB video) went whole, the cap dropped it
        from `#guardadas`, and every ask for a lost part was answered `hx`, forever.
        The newest response is now kept whatever its size (`#esquecerVelhas`).
      */
      const w = TECTOS_DO_FIO_DO_HISTORICO.partesPorJanela
      const janela = k === "hr" && partes.length > w ? w : 0
      const cabecalhos = partes.map(
        (_, i): Cabecalho => ({ v: 1, k, s, ap: this.#meuAparelho(), para, id, i, n: partes.length, ...(x ? { x } : {}), ...(janela ? { w: janela } : {}) }),
      )
      const sinais: string[] = []
      for (let i = 0; i < partes.length; i++) {
        const sinal = await this.#selar(cabecalhos[i] as Cabecalho, partes[i] as Uint8Array)
        if (sinal === null) return true
        if (sinal === "grande") break
        sinais.push(sinal)
      }
      if (sinais.length < partes.length) continue
      this.#guardadas.set(`${s}|${id}`, { partes, cabecalhos, em: this.#porta.agora(), bytes: selado.length, selado, passo })
      for (const sinal of janela ? sinais.slice(0, janela) : sinais) this.#fila.push({ sinal, ref: novoId(), de: { k, s, id } })
      this.#bombear()
      return true
    }
    return false
  }

  #contexto(): ContextoDoIrmao {
    return {
      canalDaConta: this.#porta.canalDaConta(),
      temGrupo: (canal) => this.#porta.temGrupo(canal),
      lugar: (canal) => this.#porta.lugar(canal),
    }
  }

  #esquecerVelhas(agora: number): void {
    for (const [s, sessao] of this.#respostas) {
      if (agora - sessao.ultimo > TECTOS_DO_FIO_DO_HISTORICO.sessaoCaladaMs) this.#respostas.delete(s)
    }
    let bytes = 0
    // The newest response is never dropped for its bytes (1.3.27): it is the one being asked for, even when it alone is above the cap.
    let maisNova = true
    for (const [chave, guardada] of [...this.#guardadas].reverse()) {
      bytes += guardada.bytes
      if (agora - guardada.em > TECTOS_DO_FIO_DO_HISTORICO.guardadasMs || (!maisNova && bytes > TECTOS_DO_FIO_DO_HISTORICO.guardadasBytes)) {
        this.#guardadas.delete(chave)
      }
      maisNova = false
    }
    for (const [ref, item] of this.#noAr) if (agora - item.em > 30_000) this.#noAr.delete(ref)
  }

  // ------------------------------------------------------------- the wire

  /** A `channel.sinal` from the account's channel. Runs serially with the clock. */
  aoSinal(frame: { channel: string; from: string; sinal: string }): Promise<void> {
    return this.#emSerie(() => this.#aoSinalAgora(frame))
  }

  async #aoSinalAgora(frame: { channel: string; from: string; sinal: string }): Promise<void> {
    const canal = this.#porta.canalDaConta()
    if (!canal || frame.channel !== canal) return
    const eu = this.#porta.eu()
    if (frame.from !== eu.address) return
    let bytes: Uint8Array
    try {
      bytes = fromBase64(frame.sinal)
    } catch {
      this.estatisticas.ilegiveis += 1
      return
    }
    const chave = await this.#porta.derivarChave()
    if (!chave || epocaDoSinal(bytes) !== chave.epoca) {
      this.estatisticas.ilegiveis += 1
      return
    }
    const aberto = abrirSinal(chave, canal, bytes)
    const lido = aberto ? desembrulhar(aberto) : null
    if (!lido) {
      // The account key passing (1.3.16) rides the same signals with its own first byte.
      if (aberto && (await this.#porta.outroSinal?.(aberto, frame.from, chave.epoca))) return
      // A signal not from this module (future version, something else): dropped silently.
      this.estatisticas.ilegiveis += 1
      return
    }
    const { cabecalho, corpo } = lido
    const meu = this.#meuAparelho()
    if (cabecalho.ap === meu) return
    if (cabecalho.para !== undefined && cabecalho.para !== meu) return
    // The device must be a leaf of this account in the account channel, and the signature must be its own.
    if (!this.#porta.folhasDaConta().includes(cabecalho.ap) || typeof cabecalho.as !== "string") return
    const { as: assinatura, ...semAssinatura } = cabecalho
    let valida = false
    try {
      valida = verify(fromBase64(cabecalho.ap), mensagemDoSinal(canal, frame.from, chave.epoca, semAssinatura, corpo), fromBase64(assinatura))
    } catch {
      valida = false
    }
    if (!valida) {
      this.estatisticas.ilegiveis += 1
      return
    }
    this.estatisticas.recebidos += 1
    switch (cabecalho.k) {
      case "hi":
        return this.#aoHi(cabecalho)
      case "hp":
        return this.#aoPedido(cabecalho, corpo)
      case "hn":
      case "hr":
        return this.#aoParte(cabecalho, corpo)
      case "hx":
        if (this.#pedinte?.s === cabecalho.s && this.#pedinte.com === cabecalho.ap) {
          // The responder no longer knows the session (reopened): another in the next step.
          // With the id of the request in flight, it knows the session but not the response: a
          // real failure of that request (1.3.27). Without it, the responder restarted or slept,
          // which never counts against an item.
          const pedido = this.#pedinte.pedido
          if (pedido && cabecalho.id === pedido.id) this.#falhouOPedido(pedido, "hx")
          this.#pedinte = null
          this.#ultimoHi = 0
        }
        return
      default:
        return
    }
  }

  /** Server refused our signal: back off and put the signal back in the queue. */
  aoRecusa(frame: { channel: string; code: string; ref?: string | undefined; retryAfterMs?: number | undefined }): void {
    if (frame.channel !== this.#porta.canalDaConta()) return
    this.estatisticas.recusados += 1
    const agora = this.#porta.agora()
    const item = frame.ref !== undefined ? this.#noAr.get(frame.ref) : undefined
    if (frame.ref !== undefined) this.#noAr.delete(frame.ref)
    if (frame.code === "sinal-rate-limited" || frame.code === "sinal-channel-busy") {
      this.#recuoAte = Math.max(this.#recuoAte, agora + Math.max(1_000, frame.retryAfterMs ?? 2_000))
      if (item) this.#fila.unshift({ sinal: item.sinal, ref: frame.ref as string, de: item.de })
      this.#bombear()
      return
    }
    const de = item?.de
    if (frame.code === "sinal-too-large" && de && (de.k === "hr" || de.k === "hn") && de.id !== undefined) {
      /*
        A part of a response this device sends (20/11/2026): split it again,
        smaller, under the same id. The requester takes the larger `n` and
        starts that response over. Before, the queue emptied, the part was
        asked again, refused again, and the requester waited for nothing.
      */
      const chave = `${de.s}|${de.id}`
      const guardada = this.#guardadas.get(chave)
      for (let i = this.#fila.length - 1; i >= 0; i--) {
        const naFila = this.#fila[i] as SinalNaFila
        if (naFila.de.s === de.s && naFila.de.id === de.id) this.#fila.splice(i, 1)
      }
      const passo = guardada ? Math.floor(guardada.passo / 2) : 0
      if (!guardada || passo < PARTE_MINIMA) return
      const primeiro = guardada.cabecalhos[0] as Cabecalho
      guardada.passo = passo
      void this.#emSerie(async () => {
        await this.#mandarPartes(de.s, de.k as "hn" | "hr", primeiro.para as string, de.id as string, guardada.selado, primeiro.x, passo)
      })
      return
    }
    // No seat in the channel, or anything else waiting won't help: back off. The session starts again later.
    this.#recuoAte = agora + 30_000
    this.#fila.length = 0
    // Only a signal of our own request ends our session: a refused part of a response to a sibling says nothing about it.
    if (!de || de.k === "hi" || de.k === "hp") this.#pedinte = null
  }

  /** Signs and seals one signal. `"grande"`: over `sinalMaxCaracteres`. `null`: no account channel or key now. */
  async #selar(semAssinatura: Omit<Cabecalho, "as">, corpo: Uint8Array): Promise<string | "grande" | null> {
    const canal = this.#porta.canalDaConta()
    const chave = await this.#porta.derivarChave()
    if (!canal || !chave) return null
    const eu = this.#porta.eu()
    const cabecalho: Cabecalho = {
      ...semAssinatura,
      as: toBase64(eu.assinar(mensagemDoSinal(canal, eu.address, chave.epoca, semAssinatura, corpo))),
    }
    const sinal = toBase64(selarSinal(chave, canal, embrulhar(cabecalho, corpo)))
    return sinal.length > TECTOS_DO_FIO_DO_HISTORICO.sinalMaxCaracteres ? "grande" : sinal
  }

  async #enviar(semAssinatura: Omit<Cabecalho, "as">, corpo: Uint8Array): Promise<void> {
    const sinal = await this.#selar(semAssinatura, corpo)
    // A header-only signal never passes the cap; a resent part is the size it already went at.
    if (sinal === null || sinal === "grande") return
    this.#fila.push({ sinal, ref: novoId(), de: { k: semAssinatura.k, s: semAssinatura.s, id: semAssinatura.id } })
    this.#bombear()
  }

  /** Drain the queue within the per-minute cap. Whatever doesn't fit waits for the next minute. */
  #bombear(): void {
    if (this.#bomba !== undefined) return
    const agora = this.#porta.agora()
    while (this.#gastos.length > 0 && agora - (this.#gastos[0] as number) >= 60_000) this.#gastos.shift()
    while (this.#fila.length > 0 && agora >= this.#recuoAte && this.#gastos.length < TECTOS_DO_FIO_DO_HISTORICO.sinaisPorMinuto) {
      if (!this.#porta.podeSinalizar()) {
        this.#fila.length = 0
        return
      }
      const item = this.#fila.shift() as SinalNaFila
      try {
        this.#porta.enviarSinal(item.sinal, item.ref)
      } catch {
        this.#fila.length = 0
        return
      }
      this.#gastos.push(agora)
      this.#noAr.set(item.ref, { sinal: item.sinal, em: agora, de: item.de })
      this.estatisticas.enviados += 1
      // A part of a response going out is the sender's progress; a request is not.
      if (item.de.k === "hr" || item.de.k === "hn") this.#moved()
    }
    if (this.#fila.length === 0) return
    const proximo = Math.max(
      this.#recuoAte - agora,
      this.#gastos.length >= TECTOS_DO_FIO_DO_HISTORICO.sinaisPorMinuto ? 60_000 - (agora - (this.#gastos[0] as number)) : 0,
      50,
    )
    this.#bomba = setTimeout(() => {
      this.#bomba = undefined
      this.#bombear()
    }, proximo)
    ;(this.#bomba as { unref?: () => void }).unref?.()
  }

  #meuAparelho(): string {
    return toBase64(this.#porta.eu().aparelho)
  }

  // ------------------------------------------------------------ a interface

  #evento(canais: string[]): EventoDoHistorico {
    const evento = this.#eventoDeQuemPede(canais)
    const envio = this.#envioEmCurso()
    const comEnvio = envio ? { ...evento, envio } : evento
    return (comEnvio.aTrazer || envio) && this.#progressAt > 0 ? { ...comEnvio, progressAt: this.#progressAt } : comEnvio
  }

  /** The history moved here: mark it, at most every `progressStepMs`, and say it. */
  #moved(): void {
    const agora = this.#porta.agora()
    if (this.#progressAt > 0 && agora - this.#progressAt < TECTOS_DO_FIO_DO_HISTORICO.progressStepMs) return
    this.#progressAt = agora
    this.#dizer([])
  }

  #eventoDeQuemPede(canais: string[]): EventoDoHistorico {
    const h = this.#porta.conteudo()?.historico
    const plano = h?.plano
    const inicial = h?.inicial !== undefined
    if (!plano) {
      if (h?.inicial && h.semIrmaoDesde !== undefined) return { aTrazer: false, feitas: 0, total: 0, media: null, canais, inicial, razao: "sem-irmao" }
      if (this.#perdidasNoFim > 0 || this.#ficheirosPerdidosNoFim > 0 || this.#notReceivedAtEnd > 0) {
        return {
          aTrazer: false,
          feitas: 0,
          total: 0,
          media: null,
          canais,
          inicial,
          ...(this.#perdidasNoFim > 0 ? { perdidas: this.#perdidasNoFim } : {}),
          ...(this.#ficheirosPerdidosNoFim > 0 ? { ficheirosPerdidos: this.#ficheirosPerdidosNoFim } : {}),
          ...(this.#notReceivedAtEnd > 0 ? { notReceived: this.#notReceivedAtEnd } : {}),
          razao: "ilegiveis",
        }
      }
      return { aTrazer: false, feitas: 0, total: 0, media: null, canais, inicial }
    }
    let feitas = 0
    let total = 0
    let skipped = 0
    for (const canal of Object.values(plano.canais)) {
      feitas += canal.feitas
      // The total counts only what can be got: what the sibling could not send leaves it.
      total += canal.total - (canal.perdidas ?? 0)
      skipped += canal.notReceived ?? 0
    }
    if (plano.parado) {
      const faltam = this.#faltam(plano)
      return { aTrazer: false, feitas, total, media: null, canais, inicial, razao: plano.parado.razao, ...(faltam !== null ? { faltam } : {}) }
    }
    return {
      aTrazer: true,
      feitas,
      total,
      media: plano.media
        ? { feitas: plano.media.feitas, total: plano.media.total, ...(plano.media.perdidas ? { perdidas: plano.media.perdidas } : {}) }
        : null,
      canais,
      inicial,
      ...(skipped > 0 ? { notReceived: skipped } : {}),
    }
  }

  /**
   * The conversation messages missing on this device, over the plan's channels
   * (20/11/2026). It was `total - feitas` before: the sibling's count of ALL its
   * entries (the state log too) less the entries that came, repeated ones
   * included, which is not what is missing. A finished channel has nothing
   * missing that will still come. `null` when a channel has no `q` (an older
   * sibling): the exact number is then unknown.
   */
  #faltam(plano: NonNullable<EstadoDoHistorico["plano"]>): number | null {
    const contents = this.#porta.conteudo()
    if (!contents) return null
    let faltam = 0
    for (const [c, canal] of Object.entries(plano.canais)) {
      if (canal.fim) continue
      if (!canal.conversa) return null
      const aqui = faltamDaConversa(contents, c, canal.conversa)
      if (aqui === null) return null
      faltam += aqui
    }
    return faltam
  }

  #dizer(canais: string[], perfis = false, pageFailure?: EventoDoHistorico["pageFailure"]): void {
    const evento = this.#evento(canais)
    this.#envioDito = JSON.stringify(evento.envio ?? null)
    const assinatura = JSON.stringify({ ...evento, perfis })
    // A page failure always goes out, once: the diagnostic log writes each one.
    if (canais.length === 0 && !perfis && !pageFailure && assinatura === this.#ultimoEvento) return
    this.#ultimoEvento = assinatura
    this.#porta.emitir({ ...evento, ...(perfis ? { perfis: true as const } : {}), ...(pageFailure ? { pageFailure } : {}) })
  }
}

/** Conversation photos first, then videos, then portraits. */
function ordemDoItem(item: ItemDeMediaDoIrmao): number {
  if ("c" in item) return 0
  if ("v" in item) return 1
  return 2
}
