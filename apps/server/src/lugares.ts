/**
 * What the server sees of seat repairs, as numbers (1.3.25, P8).
 *
 * The diagnosis of 20/11/2026 had a blind spot: the server did not record
 * `channel.rejoin`, refusals or failed reseats, and `docker logs` had nothing
 * to read. These counters fill it. They are in memory only (a restart starts
 * them at zero), per minute for the last 24 hours, and they hold no address,
 * no channel and no device: only how many times each thing happened.
 *
 * `GET /_interno/canais` answers them. The same two locks as
 * `GET /_interno/registo`, each enough alone:
 *  - the path is outside `/_enclave/`, which is the only prefix Caddy forwards
 *    to this process; anything else gets Caddy's 404;
 *  - the route checks the SOCKET's address, never `request.ip`: `request.ip`
 *    reads X-Forwarded-For from the trusted proxies, Caddy among them, so a
 *    forged header would turn into "127.0.0.1".
 * Anyone not on loopback gets the same 404 as a path that does not exist.
 *
 * The events:
 *  - `pedidos`: `channel.rejoin.request` that the server carried to the channel.
 *  - `pedidosSemOuvintes`: of those, the ones no connected member heard (`ouviram: 0`).
 *  - `respondidos`: a Welcome to an account that asked for a seat in that
 *    channel in the last `JANELA_DO_PEDIDO_MS`. The server cannot see more than
 *    that: the seat is in the Welcome, and the Welcome is opaque.
 *  - `semChave`: a local `keypackage.claim` that left a requested device (or the
 *    whole account) without a key package. It is the server's side of the
 *    client's `reseat-failed … no invite keys`. Each one also writes one log line.
 *  - `avisosDeChaves`: `keypackage.low` frames sent, at login and after claims.
 *  - `recusasPorEpoca`: commits refused with `stale-epoch`.
 */
import type { FastifyInstance } from "fastify"
import { currentMinute } from "./db.js"

export const ACONTECIMENTOS_DOS_LUGARES = [
  "pedidos",
  "pedidosSemOuvintes",
  "respondidos",
  "semChave",
  "avisosDeChaves",
  "recusasPorEpoca",
] as const
export type AcontecimentoDosLugares = (typeof ACONTECIMENTOS_DOS_LUGARES)[number]

/** One event's count: the last 60 minutes (this one included) and the last 24 hours. */
export interface ContagemDeUmAcontecimento {
  ultimaHora: number
  ultimas24h: number
}

/** What `GET /_interno/canais` answers. Version 1. Numbers only. */
export interface ContagemDosLugares {
  v: 1
  /** The minute (Unix minutes) of the count. */
  minuto: number
  /** The minute these counters started (the process start): before it, nothing was counted. */
  desde: number
  contagens: Record<AcontecimentoDosLugares, ContagemDeUmAcontecimento>
}

const MINUTOS_GUARDADOS = 24 * 60

/** At most this many `semChave` log lines per minute; the rest are counted in one summary line. */
export const LINHAS_DE_REGISTO_POR_MINUTO = 30

type Escrever = (linha: string) => void

export class ContadoresDosLugares {
  /** Per Unix minute, the counts of that minute. At most `MINUTOS_GUARDADOS` entries. */
  readonly #porMinuto = new Map<number, Record<AcontecimentoDosLugares, number>>()
  /**
   * Seat requests waiting for a Welcome, by `channel|account`, with the instant asked.
   * In memory, never exposed: only to tell a `respondido`. Bounded like the gateway's
   * pending admissions.
   */
  readonly #pedidosEmAberto = new Map<string, number>()
  readonly #desde: number
  readonly #escrever: Escrever
  #linhasNoMinuto = { minuto: -1, escritas: 0, caladas: 0 }

  /** How long a seat request waits for its Welcome to count as answered. Like `Gateway.PENDENTE_MS`. */
  static JANELA_DO_PEDIDO_MS = 10 * 60_000
  static readonly PEDIDOS_EM_ABERTO_MAXIMO = 10_000

  constructor(escrever: Escrever = (linha) => process.stderr.write(`${linha}\n`), agora = currentMinute()) {
    this.#escrever = escrever
    this.#desde = agora
  }

  notar(qual: AcontecimentoDosLugares, minuto = currentMinute()): void {
    let doMinuto = this.#porMinuto.get(minuto)
    if (!doMinuto) {
      doMinuto = Object.fromEntries(ACONTECIMENTOS_DOS_LUGARES.map((a) => [a, 0])) as Record<AcontecimentoDosLugares, number>
      this.#porMinuto.set(minuto, doMinuto)
      for (const antigo of this.#porMinuto.keys()) if (antigo <= minuto - MINUTOS_GUARDADOS) this.#porMinuto.delete(antigo)
    }
    doMinuto[qual] += 1
  }

  /** A `channel.rejoin.request` the server carried, and how many connections heard it. */
  pedido(canal: string, conta: string, ouviram: number, agora = Date.now()): void {
    this.notar("pedidos", Math.floor(agora / 60_000))
    if (ouviram === 0) this.notar("pedidosSemOuvintes", Math.floor(agora / 60_000))
    const chave = `${canal}|${conta}`
    this.#pedidosEmAberto.delete(chave)
    this.#pedidosEmAberto.set(chave, agora)
    // Oldest first (insertion order): past the cap, the oldest request goes.
    while (this.#pedidosEmAberto.size > ContadoresDosLugares.PEDIDOS_EM_ABERTO_MAXIMO) {
      const primeiro = this.#pedidosEmAberto.keys().next().value
      if (primeiro === undefined) break
      this.#pedidosEmAberto.delete(primeiro)
    }
  }

  /** A Welcome stored for `conta` in `canal`: if that account asked for a seat there lately, it was answered. */
  welcome(canal: string, conta: string, agora = Date.now()): void {
    const chave = `${canal}|${conta}`
    const em = this.#pedidosEmAberto.get(chave)
    if (em === undefined) return
    this.#pedidosEmAberto.delete(chave)
    if (agora - em <= ContadoresDosLugares.JANELA_DO_PEDIDO_MS) this.notar("respondidos", Math.floor(agora / 60_000))
  }

  /**
   * A claim that left devices without a key package: counted, and one log line.
   *
   * The line names no address, device, channel or IP: only the kind of claim and
   * how many devices were asked and served. `reseat` is a claim that named devices
   * (a seat repair since 1.3.25 names the asker's device); `convite` named none.
   */
  semChave(tipo: "reseat" | "convite", pedidos: number, servidos: number, agora = Date.now()): void {
    const minuto = Math.floor(agora / 60_000)
    this.notar("semChave", minuto)
    const linhas = this.#linhasNoMinuto
    if (linhas.minuto !== minuto) {
      if (linhas.caladas > 0) this.#escrever(`enclave: no-key-package: ${linhas.caladas} more in minute ${linhas.minuto}, not written`)
      this.#linhasNoMinuto = { minuto, escritas: 0, caladas: 0 }
    }
    const agoraLinhas = this.#linhasNoMinuto
    if (agoraLinhas.escritas >= LINHAS_DE_REGISTO_POR_MINUTO) {
      agoraLinhas.caladas += 1
      return
    }
    agoraLinhas.escritas += 1
    // `reseat-failed` is the name the client logs for the same failure, so the two can be read side by side.
    const nome = tipo === "reseat" ? "reseat-failed" : "invite-no-keys"
    this.#escrever(`enclave: ${nome}: no key package (devices asked ${pedidos}, served ${servidos})`)
  }

  contagem(agora = currentMinute()): ContagemDosLugares {
    const contagens = Object.fromEntries(
      ACONTECIMENTOS_DOS_LUGARES.map((a) => [a, { ultimaHora: 0, ultimas24h: 0 }]),
    ) as Record<AcontecimentoDosLugares, ContagemDeUmAcontecimento>
    for (const [minuto, doMinuto] of this.#porMinuto) {
      if (minuto > agora || minuto <= agora - MINUTOS_GUARDADOS) continue
      const naHora = minuto > agora - 60
      for (const a of ACONTECIMENTOS_DOS_LUGARES) {
        contagens[a].ultimas24h += doMinuto[a]
        if (naHora) contagens[a].ultimaHora += doMinuto[a]
      }
    }
    return { v: 1, minuto: agora, desde: this.#desde, contagens }
  }
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])

/** Registers `GET /_interno/canais`. Anyone not on loopback gets the same 404 as a path that does not exist. */
export function registarContagemDosLugares(app: FastifyInstance, contadores: ContadoresDosLugares): void {
  app.get("/_interno/canais", async (pedido, resposta) => {
    if (!LOOPBACK.has(pedido.raw.socket.remoteAddress ?? "")) {
      resposta.callNotFound()
      return resposta
    }
    resposta.header("Cache-Control", "no-store")
    return contadores.contagem()
  })
}
