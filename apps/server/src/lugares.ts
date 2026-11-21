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
 *    Claims, not attempts (1.3.26): the same claim again from the same connection
 *    within `REPETICAO_MS` (a client tries up to three times in ~3 s) counts once
 *    and writes no line.
 *  - `semChaveEmPedido` (1.3.26): of the `semChave`, the claims for an account
 *    that asked for a seat (`pedidos`) in the last `EM_PEDIDO_MS`. That is what the
 *    deaf channel's seat request (P3) runs into. The rest is mostly a device seating
 *    its siblings and invites to accounts with no keys. A claim names no channel, so
 *    this is by account: a seat request in one channel and a claim for another
 *    channel of the same account in the same 30 s count here too.
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
  "semChaveEmPedido",
  "avisosDeChaves",
  "recusasPorEpoca",
  "pacotesServidos",
  "recusasDepoisDeReclamar",
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
  /** The last seat request of each account, for `semChaveEmPedido`. Bounded like `#pedidosEmAberto`. */
  readonly #pedidoDaConta = new Map<string, number>()
  /** The last claim that served packages on each connection: when, and how many. For `recusasDepoisDeReclamar`. */
  readonly #ultimaReclamacao = new Map<string, { em: number; n: number }>()
  /** The last empty claim of each "connection|account|devices", to count claims, not attempts. */
  readonly #reclamacoesVazias = new Map<string, number>()
  readonly #desde: number
  readonly #escrever: Escrever
  #linhasNoMinuto = { minuto: -1, escritas: 0, caladas: 0 }

  /** How long a seat request waits for its Welcome to count as answered. Like `Gateway.PENDENTE_MS`. */
  static JANELA_DO_PEDIDO_MS = 10 * 60_000
  static readonly PEDIDOS_EM_ABERTO_MAXIMO = 10_000
  /** The same empty claim within this time is a retry of the same claim. The client waits 1.5 s between tries. */
  static REPETICAO_MS = 10_000
  /** A claim this soon after the account's seat request counts as `semChaveEmPedido`. */
  static EM_PEDIDO_MS = 30_000
  /** A stale-epoch refusal this soon after the same connection was served packages counts as `recusasDepoisDeReclamar`. */
  static RECUSA_DEPOIS_DE_RECLAMAR_MS = 60_000

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
    lembrar(this.#pedidosEmAberto, chave, agora)
    lembrar(this.#pedidoDaConta, conta, agora)
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
   *
   * `reclamacao` (1.3.26): who claimed (the connection, never written out), for whom,
   * and which devices. With it, a retry of the same claim is not counted again, and a
   * claim for an account that just asked for a seat also counts as `semChaveEmPedido`.
   */
  semChave(
    tipo: "reseat" | "convite",
    pedidos: number,
    servidos: number,
    agora = Date.now(),
    reclamacao?: { quem: string; alvo: string; aparelhos?: readonly string[] | undefined },
  ): void {
    const minuto = Math.floor(agora / 60_000)
    if (reclamacao !== undefined) {
      const chave = `${reclamacao.quem}|${reclamacao.alvo}|${[...(reclamacao.aparelhos ?? [])].sort().join(",")}`
      const anterior = this.#reclamacoesVazias.get(chave)
      lembrar(this.#reclamacoesVazias, chave, agora)
      if (anterior !== undefined && agora - anterior < ContadoresDosLugares.REPETICAO_MS) return
      const pediu = this.#pedidoDaConta.get(reclamacao.alvo)
      if (pediu !== undefined && agora - pediu <= ContadoresDosLugares.EM_PEDIDO_MS) this.notar("semChaveEmPedido", minuto)
    }
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

  /** A local claim served `n` key packages to connection `quem` (never written out). */
  reclamou(quem: string, n: number, agora = Date.now()): void {
    if (n <= 0) return
    const minuto = Math.floor(agora / 60_000)
    for (let i = 0; i < n; i++) this.notar("pacotesServidos", minuto)
    this.#ultimaReclamacao.delete(quem)
    this.#ultimaReclamacao.set(quem, { em: agora, n })
    while (this.#ultimaReclamacao.size > ContadoresDosLugares.PEDIDOS_EM_ABERTO_MAXIMO) {
      const primeiro = this.#ultimaReclamacao.keys().next().value
      if (primeiro === undefined) break
      this.#ultimaReclamacao.delete(primeiro)
    }
  }

  /**
   * A commit refused with `stale-epoch` (layer A, 21/11/2026). When the same connection
   * was served key packages just before, it is the shape that spent the iPhone's pool in
   * production: claim, commit, refused, claim again. Counted, and one line that names no
   * connection, address, channel or IP: only the seconds and the packages.
   */
  recusaPorEpoca(quem: string, agora = Date.now()): void {
    const minuto = Math.floor(agora / 60_000)
    this.notar("recusasPorEpoca", minuto)
    const antes = this.#ultimaReclamacao.get(quem)
    if (antes === undefined || agora - antes.em > ContadoresDosLugares.RECUSA_DEPOIS_DE_RECLAMAR_MS) return
    this.notar("recusasDepoisDeReclamar", minuto)
    this.#escreverComTecto(
      minuto,
      `enclave: stale-epoch-after-claim: commit refused ${Math.round((agora - antes.em) / 1_000)} s after ${antes.n} key package(s) were claimed on the same connection`,
    )
  }

  /** One log line, under the per-minute cap shared with `semChave`. */
  #escreverComTecto(minuto: number, linha: string): void {
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
    this.#escrever(linha)
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

/** Set `chave` as the newest entry; past the cap, the oldest goes (insertion order). */
function lembrar(mapa: Map<string, number>, chave: string, agora: number): void {
  mapa.delete(chave)
  mapa.set(chave, agora)
  while (mapa.size > ContadoresDosLugares.PEDIDOS_EM_ABERTO_MAXIMO) {
    const primeiro = mapa.keys().next().value
    if (primeiro === undefined) break
    mapa.delete(primeiro)
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
