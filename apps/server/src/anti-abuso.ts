/**
 * The abuse brake, part 2 (1.3.26), on the server side. See `anti-abuso.ts`
 * in the protocol for the whole picture.
 *
 * Four pieces, each in memory only. Nothing here goes to the database, to a
 * file or to a log, and a restart forgets all of it:
 *
 * - `EmissorDeProvas`: the proof-of-work challenges. Signed with a secret drawn
 *   at start, with their own expiry, accepted once.
 * - `LimiteDeRede`: new accounts per network (IPv4 /24, IPv6 /56). The key is an
 *   HMAC of the prefix with a random salt that changes every UTC day and lives
 *   only here. The address itself is never kept.
 * - `VigiaDaContaNova`: what an account may do in its first 72 hours.
 * - `FilaDaSalaComum`: the ceiling on joins to the common room, and the queue.
 */
import { provaCumpre, type DesafioDeTrabalho, type ProvaDeTrabalho } from "@enclave/protocol"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { isIPv4, isIPv6 } from "node:net"

const HORA_MS = 60 * 60_000
const DIA_MS = 24 * HORA_MS

/** Messages a new account may send to the common room at once, before the interval applies (1.3.26). */
export const FOLGA_DA_SALA_COMUM = 3

// ---------------------------------------------------------------- proof of work

/** How the operator tunes the proof of work. See `ENCLAVE_PROVA_*` in `config.ts`. */
export interface ConfigDaProva {
  /** Expected hashes for a new account, normally. About 3 s on an average phone at 600 000. */
  trabalho: number
  /** Expected hashes during a spike of new accounts. About 15 s at 3 000 000. */
  trabalhoNoPico: number
  /** More new accounts than this in the last hour is a spike. */
  picoPorHora: number
}

export class EmissorDeProvas {
  /** How long a challenge stays good. Ten minutes covers the slowest phone at spike work, and a person typing a password. */
  static readonly VALIDADE_MS = 10 * 60_000
  /** How often the spike count reads the database. */
  static readonly CONTAGEM_MS = 30_000

  readonly #segredo = randomBytes(32)
  readonly #config: ConfigDaProva
  readonly #contarUltimaHora: () => number
  readonly #agora: () => number
  /** Challenges already accepted, by their random part, until they expire. */
  readonly #gastos = new Map<string, number>()
  #contagem: { valor: number; em: number } | null = null

  constructor(
    opcoes: ConfigDaProva & {
      /** New accounts in the last hour (`Store.contasCriadasDesde`). */
      contarUltimaHora: () => number
      agora?: () => number
    },
  ) {
    this.#config = { trabalho: opcoes.trabalho, trabalhoNoPico: opcoes.trabalhoNoPico, picoPorHora: opcoes.picoPorHora }
    this.#contarUltimaHora = opcoes.contarUltimaHora
    this.#agora = opcoes.agora ?? Date.now
  }

  /** The work asked now: higher during a spike. */
  #trabalhoAgora(): number {
    const agora = this.#agora()
    if (this.#contagem === null || agora - this.#contagem.em >= EmissorDeProvas.CONTAGEM_MS) {
      this.#contagem = { valor: this.#contarUltimaHora(), em: agora }
    }
    return this.#contagem.valor > this.#config.picoPorHora ? this.#config.trabalhoNoPico : this.#config.trabalho
  }

  #assinar(corpo: string): string {
    return createHmac("sha256", this.#segredo).update(`orwell:prova-de-trabalho:${corpo}`).digest().subarray(0, 16).toString("base64url")
  }

  /** A new challenge: `v1.<work>.<expiry s>.<random>.<mac>`. The work is inside the signed part, so a client cannot lower it. */
  emitir(): DesafioDeTrabalho {
    const trabalho = this.#trabalhoAgora()
    const expira = Math.ceil((this.#agora() + EmissorDeProvas.VALIDADE_MS) / 1000)
    const corpo = `v1.${trabalho}.${expira}.${randomBytes(12).toString("base64url")}`
    return { desafio: `${corpo}.${this.#assinar(corpo)}`, trabalho }
  }

  /**
   * Check a proof and, when it is good, spend its challenge. `em-falta`: no
   * proof at all. `invalida`: forged, altered, expired, already used, or a
   * nonce that does not meet the work.
   */
  verificar(prova: ProvaDeTrabalho | undefined): "ok" | "em-falta" | "invalida" {
    if (prova === undefined) return "em-falta"
    const partes = prova.desafio.split(".")
    if (partes.length !== 5 || partes[0] !== "v1") return "invalida"
    const [versao, trabalhoTexto, expiraTexto, aleatorio, mac] = partes as [string, string, string, string, string]
    const corpo = `${versao}.${trabalhoTexto}.${expiraTexto}.${aleatorio}`
    const esperado = Buffer.from(this.#assinar(corpo))
    const recebido = Buffer.from(mac)
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return "invalida"
    const trabalho = Number(trabalhoTexto)
    const expiraMs = Number(expiraTexto) * 1000
    const agora = this.#agora()
    if (!Number.isSafeInteger(trabalho) || trabalho < 1 || !(expiraMs > agora)) return "invalida"
    this.#limpar(agora)
    if (this.#gastos.has(aleatorio)) return "invalida"
    if (!provaCumpre(prova.desafio, prova.nonce, trabalho)) return "invalida"
    this.#gastos.set(aleatorio, expiraMs)
    return "ok"
  }

  /** Spent challenges leave when they would have expired anyway: the map holds at most ten minutes of new accounts. */
  #limpar(agora: number): void {
    for (const [aleatorio, expira] of this.#gastos) if (expira <= agora) this.#gastos.delete(aleatorio)
  }
}

// ---------------------------------------------------------------- per network

/**
 * The network of an address: IPv4 by /24, IPv6 by /56, as text. An IPv4 inside
 * IPv6 (`::ffff:1.2.3.4`, what a dual-stack socket shows) counts as IPv4.
 * `null` for anything else.
 *
 * A /24 and a /56 are what one home or one small office usually gets, so one
 * person cannot step around the limit by changing the last part of the address.
 */
export function prefixoDaRede(ip: string | undefined): string | null {
  if (!ip) return null
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1]
  const v4 = mapeado ?? (isIPv4(ip) ? ip : null)
  if (v4 !== null) {
    /*
      A private, loopback or link-local address is never a client's network on
      this server: every client comes from the internet, through nginx and Caddy
      (`ip-do-cliente.test.ts`). Seeing one means the proxy chain lost the
      client's address (nginx not setting X-Forwarded-For, a Caddy that does not
      trust the compose gateway), and then EVERY client has the same one. Counting
      it would put the whole server in one /24, 3 accounts an hour for everyone.
      Not counted: the limit fails open, the other brakes stay.
    */
    const [a, b] = v4.split(".").map(Number) as [number, number]
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return null
    return `4:${v4.split(".").slice(0, 3).join(".")}`
  }
  if (!isIPv6(ip)) return null
  const semZona = ip.split("%")[0] as string
  const [esquerda = "", direita] = semZona.split("::") as [string, string | undefined]
  const partes = (texto: string): string[] => (texto === "" ? [] : texto.split(":"))
  const a = partes(esquerda)
  const b = direita === undefined ? [] : partes(direita)
  const grupos = direita === undefined ? a : [...a, ...Array<string>(8 - a.length - b.length).fill("0"), ...b]
  if (grupos.length !== 8) return null
  const hex = grupos.map((g) => g.padStart(4, "0").toLowerCase()).join("")
  // Loopback, unique local (fc00::/7) and link-local (fe80::/10): never a client's network. See above.
  if (hex === "0".repeat(31) + "1" || /^f[cd]/.test(hex) || /^fe[89ab]/.test(hex)) return null
  // 56 bits are 14 hex digits.
  return `6:${hex.slice(0, 14)}`
}

/** A network as the limit sees it: an HMAC key per salt day, never the address. */
export interface RedeIdentificada {
  readonly chaves: ReadonlyMap<number, string>
}

/**
 * New accounts per network, in memory: `porHora` in the last hour and `porDia`
 * in the last 24 hours (3 and 10 by default).
 *
 * The key is `HMAC(salt of the day, prefix)`. The salt is random, drawn when the
 * day is first used, and kept for two days, so a network can be followed
 * across midnight for the 24-hour window and no longer. Nothing leaves memory:
 * a restart starts from zero, and whoever reads the memory finds keys that
 * nobody, the operator included, can turn back into addresses.
 */
export class LimiteDeRede {
  readonly #porHora: number
  readonly #porDia: number
  readonly #agora: () => number
  /** The salt of each UTC day still in use (today and yesterday). */
  readonly #sais = new Map<number, Buffer>()
  /** Creation instants, by day of the salt and key. */
  readonly #criadas = new Map<number, Map<string, number[]>>()

  constructor(opcoes: { porHora: number; porDia: number; agora?: () => number }) {
    this.#porHora = opcoes.porHora
    this.#porDia = opcoes.porDia
    this.#agora = opcoes.agora ?? Date.now
  }

  #dias(): number[] {
    const hoje = Math.floor(this.#agora() / DIA_MS)
    for (const dia of this.#sais.keys()) if (dia < hoje - 1) this.#sais.delete(dia)
    for (const dia of this.#criadas.keys()) if (dia < hoje - 1) this.#criadas.delete(dia)
    return [hoje - 1, hoje]
  }

  /** The keys of this address's network, for today and yesterday. Computed and the address dropped. */
  identificar(ip: string | undefined): RedeIdentificada {
    const prefixo = prefixoDaRede(ip)
    const chaves = new Map<number, string>()
    if (prefixo === null) return { chaves }
    for (const dia of this.#dias()) {
      let sal = this.#sais.get(dia)
      if (!sal) {
        sal = randomBytes(32)
        this.#sais.set(dia, sal)
      }
      chaves.set(dia, createHmac("sha256", sal).update(prefixo).digest("base64url"))
    }
    return { chaves }
  }

  #instantes(rede: RedeIdentificada): number[] {
    const todos: number[] = []
    for (const [dia, chave] of rede.chaves) todos.push(...(this.#criadas.get(dia)?.get(chave) ?? []))
    return todos
  }

  /** May one more account be created from this network now? An unknown network is not limited. */
  podeCriar(rede: RedeIdentificada): boolean {
    if (rede.chaves.size === 0) return true
    const agora = this.#agora()
    const instantes = this.#instantes(rede)
    const naHora = instantes.filter((t) => agora - t < HORA_MS).length
    const noDia = instantes.filter((t) => agora - t < DIA_MS).length
    return (this.#porHora <= 0 || naHora < this.#porHora) && (this.#porDia <= 0 || noDia < this.#porDia)
  }

  /** Count one new account for this network, under the newest salt it has. */
  registar(rede: RedeIdentificada): void {
    this.#dias()
    const dias = [...rede.chaves.keys()]
    if (dias.length === 0) return
    const dia = Math.max(...dias)
    const chave = rede.chaves.get(dia) as string
    let porChave = this.#criadas.get(dia)
    if (!porChave) {
      porChave = new Map()
      this.#criadas.set(dia, porChave)
    }
    const agora = this.#agora()
    porChave.set(chave, [...(porChave.get(chave) ?? []).filter((t) => agora - t < DIA_MS), agora])
  }

  /** What the limit holds, for the test that proves no address is in it. */
  estadoParaTestes(): unknown {
    return [...this.#criadas].map(([dia, porChave]) => [dia, [...porChave]])
  }
}

/**
 * New accounts that a community invite let past the network limit, in memory:
 * the same `porHora` and `porDia` as a network (1.3.26), on each key the pass
 * is counted under. The gateway counts every pass under two keys: the channel
 * (`canal:` + its opaque address), so one community can bring its people in on
 * a busy network but cannot become a door for a stream of accounts; and the
 * account that made the invite (`quem:` + its address), so ALL the invites of
 * one account together let in no more than one network does. Without the
 * second, an account with many channels had one door per channel. A pass needs
 * room under every key; a restart forgets all of it.
 */
export class PassesDoConvite {
  readonly #porHora: number
  readonly #porDia: number
  readonly #agora: () => number
  readonly #passes = new Map<string, number[]>()

  constructor(opcoes: { porHora: number; porDia: number; agora?: () => number }) {
    this.#porHora = opcoes.porHora
    this.#porDia = opcoes.porDia
    this.#agora = opcoes.agora ?? Date.now
  }

  #recentes(chave: string, agora: number): number[] {
    const recentes = (this.#passes.get(chave) ?? []).filter((t) => agora - t < DIA_MS)
    if (recentes.length === 0) this.#passes.delete(chave)
    else this.#passes.set(chave, recentes)
    return recentes
  }

  /** May one more new account come in by an invite counted under all these keys now? */
  pode(chaves: readonly string[]): boolean {
    const agora = this.#agora()
    return chaves.every((chave) => {
      const recentes = this.#recentes(chave, agora)
      const naHora = recentes.filter((t) => agora - t < HORA_MS).length
      return (this.#porHora <= 0 || naHora < this.#porHora) && (this.#porDia <= 0 || recentes.length < this.#porDia)
    })
  }

  registar(chaves: readonly string[]): void {
    const agora = this.#agora()
    for (const chave of new Set(chaves)) this.#passes.set(chave, [...this.#recentes(chave, agora), agora])
  }
}

/**
 * Who made each community invite, in memory only (1.3.26), for the cap of
 * `PassesDoConvite` per account. The `invites` table does not keep the creator
 * and this does not add it to disk. Bounded: past `maximo` entries the oldest
 * goes; an invite with no creator here (made before a restart, or pushed out)
 * counts under its channel's founder instead (`channel_claims`, already on disk).
 */
export class CriadoresDosConvites {
  static readonly MAXIMO = 50_000
  readonly #maximo: number
  readonly #criadores = new Map<string, string>()

  constructor(maximo = CriadoresDosConvites.MAXIMO) {
    this.#maximo = maximo
  }

  anotar(codeHash: string, quem: string): void {
    // First maker wins, as in the table (`ON CONFLICT DO NOTHING`).
    if (this.#criadores.has(codeHash)) return
    this.#criadores.set(codeHash, quem)
    if (this.#criadores.size > this.#maximo) {
      const maisAntigo = this.#criadores.keys().next().value
      if (maisAntigo !== undefined) this.#criadores.delete(maisAntigo)
    }
  }

  de(codeHash: string): string | undefined {
    return this.#criadores.get(codeHash)
  }

  esquecer(codeHash: string): void {
    this.#criadores.delete(codeHash)
  }
}

// ---------------------------------------------------------------- new accounts

/** The new-account limits. See `ENCLAVE_CONTA_NOVA_*` in `config.ts`. */
export interface LimitesDeContaNova {
  /** Seconds between two messages in the common room, in the first 24 hours. */
  intervaloAte24hS: number
  /** The same, from 24 to 72 hours. */
  intervaloAte72hS: number
  /**
   * The largest message (ciphertext bytes) a first-day account may send to the
   * common room. Images, files and GIFs travel inside the message, so this is
   * the only sign of them the server can see. Above an avatar profile, below a
   * photo.
   */
  maxBytesAte24h: number
  /** Other accounts this account may add to channels in 24 hours (friend requests, direct messages, invites), first day. */
  pessoasAte24h: number
  /** The same, from 24 to 72 hours. */
  pessoasAte72h: number
  /**
   * Channels (communities) the account may have created in its whole first 72
   * hours, counted on `channel.claim` with `comunidade` (1.3.26). After 72 hours
   * the cap is `ServerConfig.comunidadesPorConta`.
   */
  comunidades: number
  /**
   * Rooms (inside channels) the account may have created in
   * its first 72 hours (1.3.26, `ENCLAVE_NEW_ACCOUNT_ROOMS`). After 72 hours
   * the cap is `ServerConfig.channelsPerAccount`. 0: no new-account room cap.
   */
  rooms?: number
  /** New channels (communities, direct messages, its own channels) this account may open in 24 hours, first day. */
  canaisAte24h: number
  /** The same, from 24 to 72 hours. */
  canaisAte72h: number
}

export type FaseDaContaNova = "24h" | "72h" | null

/**
 * What an account may do in its first 72 hours, counted in memory per account.
 * A restart gives everyone a fresh count, which is a gap of one interval, not a
 * way around the rule.
 */
export class VigiaDaContaNova {
  readonly #limites: LimitesDeContaNova
  readonly #agora: () => number
  /** The common-room bucket of each account: tokens left, and when they were counted. */
  readonly #baldes = new Map<string, { fichas: number; em: number }>()
  readonly #pessoas = new Map<string, Map<string, number>>()
  readonly #estreias = new Map<string, number[]>()

  constructor(limites: LimitesDeContaNova, agora: () => number = Date.now) {
    this.#limites = limites
    this.#agora = agora
  }

  get limites(): LimitesDeContaNova {
    return this.#limites
  }

  /** The phase of an account created at `criadaEm` (ms), or `null` past 72 hours or when unknown. */
  fase(criadaEm: number | null): FaseDaContaNova {
    if (criadaEm === null) return null
    const idade = this.#agora() - criadaEm
    if (idade < DIA_MS) return "24h"
    if (idade < 3 * DIA_MS) return "72h"
    return null
  }

  /**
   * One message to the common room: allowed now, or how long to wait.
   *
   * A token bucket: `FOLGA_DA_SALA_COMUM` messages at once, then one new token
   * every interval (30 s in the first day, 10 s up to 72 h). The average is the
   * same as one message per interval, but the first messages of an account that
   * just joined do not wait: the profile the app publishes when it enters, and
   * the request for profiles, are `application` messages too and used to take
   * the only slot.
   */
  enviar(quem: string, fase: FaseDaContaNova): { ok: true } | { ok: false; retryAfterMs: number } {
    if (fase === null) return { ok: true }
    const intervalo = (fase === "24h" ? this.#limites.intervaloAte24hS : this.#limites.intervaloAte72hS) * 1000
    if (intervalo <= 0) return { ok: true }
    const agora = this.#agora()
    const balde = this.#baldes.get(quem)
    const fichas = balde === undefined ? FOLGA_DA_SALA_COMUM : Math.min(FOLGA_DA_SALA_COMUM, balde.fichas + (agora - balde.em) / intervalo)
    if (fichas < 1) {
      this.#baldes.set(quem, { fichas, em: agora })
      return { ok: false, retryAfterMs: Math.ceil((1 - fichas) * intervalo) }
    }
    this.#baldes.set(quem, { fichas: fichas - 1, em: agora })
    this.#varrer(agora)
    return { ok: true }
  }

  /** May a first-day account send a message of this size to the common room? */
  tamanhoPermitido(bytes: number, fase: FaseDaContaNova): boolean {
    return fase !== "24h" || this.#limites.maxBytesAte24h <= 0 || bytes <= this.#limites.maxBytesAte24h
  }

  /** May `quem` add `outro` to a channel? Each other account counts once in 24 hours. */
  adicionar(quem: string, outro: string, fase: FaseDaContaNova): boolean {
    if (fase === null) return true
    const tecto = fase === "24h" ? this.#limites.pessoasAte24h : this.#limites.pessoasAte72h
    if (tecto <= 0) return true
    const agora = this.#agora()
    const vistas = this.#pessoas.get(quem) ?? new Map<string, number>()
    for (const [pessoa, em] of vistas) if (agora - em >= DIA_MS) vistas.delete(pessoa)
    if (!vistas.has(outro) && vistas.size >= tecto) return false
    if (!vistas.has(outro)) vistas.set(outro, agora)
    this.#pessoas.set(quem, vistas)
    return true
  }

  /** May `quem` open one more new channel? */
  estrear(quem: string, fase: FaseDaContaNova): boolean {
    if (fase === null) return true
    const tecto = fase === "24h" ? this.#limites.canaisAte24h : this.#limites.canaisAte72h
    if (tecto <= 0) return true
    const agora = this.#agora()
    const recentes = (this.#estreias.get(quem) ?? []).filter((em) => agora - em < DIA_MS)
    if (recentes.length >= tecto) {
      this.#estreias.set(quem, recentes)
      return false
    }
    recentes.push(agora)
    this.#estreias.set(quem, recentes)
    return true
  }

  /** The maps only hold accounts seen in the last day: one pass when they grow. */
  #varrer(agora: number): void {
    if (this.#baldes.size < 4096) return
    // A bucket left alone this long is full again: the same as never seen.
    const cheio = Math.max(HORA_MS, FOLGA_DA_SALA_COMUM * Math.max(this.#limites.intervaloAte24hS, this.#limites.intervaloAte72hS) * 1000)
    for (const [quem, balde] of this.#baldes) if (agora - balde.em >= cheio) this.#baldes.delete(quem)
    for (const [quem, vistas] of this.#pessoas) if ([...vistas.values()].every((em) => agora - em >= DIA_MS)) this.#pessoas.delete(quem)
    for (const [quem, em] of this.#estreias) if (em.every((t) => agora - t >= DIA_MS)) this.#estreias.delete(quem)
  }
}

// ---------------------------------------------------------------- common room queue

/**
 * The ceiling on joins to the common room: `porHora` accounts that were never
 * in it, in any hour. The others wait in a queue, by order of arrival, and go
 * in when a slot frees. Members who come back (seat repair, a new device, a
 * Welcome resync) never count: the gateway asks only for accounts with no
 * subscription in the room.
 *
 * Why: each join
 * is a commit that every member applies, and a new card that a member
 * publishes. A burst of joins is a burst of work on every device in the room.
 */
export class FilaDaSalaComum {
  /** A place in the queue is kept this long after the account last asked. */
  static readonly LUGAR_MS = 10 * 60_000
  /** The longest the server tells a waiting client to wait before asking again: it keeps the place alive. */
  static readonly ESPERA_MAXIMA_MS = 2 * 60_000

  readonly #porHora: number
  readonly #agora: () => number
  /** Accounts let in during the last hour, with when. */
  readonly #admitidas = new Map<string, number>()
  /** The queue, oldest first, with when each one last asked. */
  #fila: { quem: string; vistoEm: number }[] = []

  constructor(opcoes: { porHora: number; agora?: () => number }) {
    this.#porHora = opcoes.porHora
    this.#agora = opcoes.agora ?? Date.now
  }

  /** May this account join now? If not, its place and when to ask again. */
  pedir(quem: string): { ok: true } | { ok: false; posicao: number; esperaMs: number } {
    if (this.#porHora <= 0) return { ok: true }
    const agora = this.#agora()
    for (const [conta, em] of this.#admitidas) if (agora - em >= HORA_MS) this.#admitidas.delete(conta)
    if (this.#admitidas.has(quem)) return { ok: true }
    this.#fila = this.#fila.filter((lugar) => lugar.quem === quem || agora - lugar.vistoEm < FilaDaSalaComum.LUGAR_MS)
    let indice = this.#fila.findIndex((lugar) => lugar.quem === quem)
    if (indice < 0) {
      this.#fila.push({ quem, vistoEm: agora })
      indice = this.#fila.length - 1
    } else {
      ;(this.#fila[indice] as { vistoEm: number }).vistoEm = agora
    }
    const livres = this.#porHora - this.#admitidas.size
    if (indice < livres) {
      this.#fila.splice(indice, 1)
      this.#admitidas.set(quem, agora)
      return { ok: true }
    }
    // When the slot this place needs frees: the (indice - livres + 1)-th oldest admission ends its hour.
    const entradas = [...this.#admitidas.values()].sort((a, b) => a - b)
    const liberta = (entradas[indice - livres] ?? agora) + HORA_MS - agora
    return { ok: false, posicao: indice + 1, esperaMs: Math.max(1_000, Math.min(FilaDaSalaComum.ESPERA_MAXIMA_MS, liberta)) }
  }
}
