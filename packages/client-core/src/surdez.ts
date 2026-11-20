/**
 * A deaf channel, after it is declared deaf (1.3.25, P2, P3, P5).
 *
 * "Deaf" is decided in `session.ts` (`surdezConfirmada`): five frames in a row
 * that do not open, over thirty seconds, with no frame that opens in between.
 * Frames from an epoch before ours are never counted (`anteriorAoNossoLugar`),
 * so a healthy device that receives the old-epoch sends of a stuck device is
 * never deaf. Here is what comes after:
 *
 *  - **The seat request repeats** (`PedidosDeLugar`). It went out once per
 *    channel per session, and after a `reseat-failed` (the answerer had no key
 *    package of ours) nothing asked again until the app restarted. Measured on
 *    20/11/2026: devices stuck for eleven days in an old epoch.
 *  - **The device stops sending into the void** (`surdezAvisada`). A deaf
 *    device encrypts in an epoch that nobody else holds. The server accepts the
 *    frame, and nobody reads it.
 *  - **The room says so** (`surdezAvisada`, same rule). The person reads
 *    "you are not receiving new messages" instead of a quiet room.
 *
 * Pure, and with its clock and timers given from outside, so the tests run it
 * without a session and without waiting thirty minutes.
 */

/** The consecutive failures of a channel. The same shape as `FalhasSeguidas` in `session.ts`. */
export interface SerieDeFalhas {
  falhas: number
  desde: number
}

/**
 * How long a channel must stay deaf before the device holds what it sends and
 * the room says so. Counted from the first failure of the series.
 *
 * Longer than the thirty seconds that start the seat request, on purpose.
 * The request costs little and fixes the case. Holding a person's message is
 * the expensive mistake: a false positive here means a healthy room where
 * nothing goes out. One minute of failures with NOT ONE frame that opens is
 * not a slow network or a long catch-up, which both open frames all the time.
 */
export const SURDEZ_AVISADA_MS = 60_000

/**
 * Deaf for long enough to hold sends and say so in the room. See `SURDEZ_AVISADA_MS`.
 * `limiar` is `DEAF_FAILURES` from `session.ts`.
 */
export function surdezAvisada(serie: SerieDeFalhas | undefined, agora: number, limiar: number): boolean {
  return serie !== undefined && serie.falhas >= limiar && agora - serie.desde >= SURDEZ_AVISADA_MS
}

/**
 * The wait after each seat request, while the channel stays deaf: 30 s, 1, 2,
 * 5, 15 and 30 min, then every 30 min.
 *
 * Why it never stops: the case that this fixes is the one where nobody can
 * seat us NOW (no key package of ours on the server, nobody online who holds
 * the channel). That case ends when the keys come back or someone comes
 * online, and only a request that is still being sent then gets an answer.
 * Thirty minutes is the ceiling of `PEDIDO_DE_LUGAR_MAX_MS` too.
 */
export const ATRASOS_DO_PEDIDO_MS: readonly number[] = [30_000, 60_000, 120_000, 300_000, 900_000, 1_800_000]

/** Each wait moves by up to this fraction, up or down, so devices that went deaf together do not ask together. */
export const VARIACAO_DO_PEDIDO = 0.2

/** The wait after request number `tentativa` (0 is the first), with `aleatorio` in [0, 1). */
export function atrasoDoPedido(tentativa: number, aleatorio: number, atrasos: readonly number[] = ATRASOS_DO_PEDIDO_MS): number {
  const base = atrasos[Math.min(Math.max(tentativa, 0), atrasos.length - 1)] ?? 0
  return Math.round(base * (1 - VARIACAO_DO_PEDIDO + 2 * VARIACAO_DO_PEDIDO * aleatorio))
}

/** What the session says about a channel when a request is due. */
export type EstadoDoCanalSurdo =
  /** Still deaf: ask. */
  | "surdo"
  /** It hears again, or the channel is gone: stop. */
  | "ouve"
  /**
   * Do not ask now (the channel is catching up, and the catch-up can fix it):
   * ask after the first wait, the same attempt. Once per attempt: in a busy
   * room each unreadable frame starts a catch-up, and a request that waited for
   * a quiet moment would never go out.
   */
  | "adiar"

export interface PortaDosPedidos {
  estado(canal: string): EstadoDoCanalSurdo
  /** Send the request. `false` when it did not leave (no connection): the attempt does not count. */
  pedir(canal: string): boolean
  /** A monotonic clock, in ms. */
  agora(): number
  /** In [0, 1). */
  aleatorio(): number
  /** Run `fn` after `ms`. Returns the cancel. */
  programar(fn: () => void, ms: number): () => void
}

export interface RegrasDosPedidos {
  atrasos: readonly number[]
  /** How many requests the device may send at once, after a quiet time. */
  rajada: number
  /** One more request allowed each `intervaloMs`, up to `rajada`. */
  intervaloMs: number
  /** After `adiantar`, the request goes out in this time (with the variation). */
  adiantamentoMs: number
}

/**
 * The rules in production.
 *
 * Three at once, then one each two seconds: a device deaf in ninety channels
 * (the common room of a busy server, after a long time away) takes three
 * minutes to ask in all, and never sends a wall of frames to the server.
 */
export const REGRAS_DOS_PEDIDOS: RegrasDosPedidos = {
  atrasos: ATRASOS_DO_PEDIDO_MS,
  rajada: 3,
  intervaloMs: 2_000,
  adiantamentoMs: 10_000,
}

interface CanalSurdo {
  /** How many requests went out for this series. */
  tentativa: number
  /** When the next request is due (clock of the port). */
  proxima: number
  /** When the last one went out, or `null`. */
  ultimo: number | null
  /** This attempt was already put off once (`adiar`). */
  adiado: boolean
}

/**
 * The seat requests of the channels this device cannot read.
 *
 * `comecar` when the channel is declared deaf, `parar` when a frame opens
 * again or a new seat arrives. In between, it asks with `ATRASOS_DO_PEDIDO_MS`,
 * and never more than the bucket of `RegrasDosPedidos` lets out.
 *
 * The request is the same frame as before (`channel.rejoin.request`), and the
 * C1 rules of 1.3.25 stay as they are: the server names this device, and the
 * answerer takes out only this device's leaf.
 */
export class PedidosDeLugar {
  readonly #porta: PortaDosPedidos
  readonly #regras: RegrasDosPedidos
  readonly #canais = new Map<string, CanalSurdo>()
  /** Requests due, in the order they became due, waiting for the bucket. */
  #fila: string[] = []
  #fichas: number
  #fichasEm: number
  #cancelar: (() => void) | null = null
  #quando = Number.POSITIVE_INFINITY

  constructor(porta: PortaDosPedidos, regras: RegrasDosPedidos = REGRAS_DOS_PEDIDOS) {
    this.#porta = porta
    this.#regras = regras
    this.#fichas = regras.rajada
    this.#fichasEm = porta.agora()
  }

  /** Whether the channel is in a series of requests. */
  ativo(canal: string): boolean {
    return this.#canais.has(canal)
  }

  /** The channels in a series of requests. For diagnostics and tests. */
  ativos(): string[] {
    return [...this.#canais.keys()]
  }

  /**
   * The channel was declared deaf: the first request now (if the bucket lets
   * it), the others with the waits. A channel already in a series keeps its
   * clock, so a send to a deaf channel never makes an extra request.
   */
  comecar(canal: string): void {
    if (this.#canais.has(canal)) return
    this.#canais.set(canal, { tentativa: 0, proxima: this.#porta.agora(), ultimo: null, adiado: false })
    this.#rever()
  }

  /** It hears again, or the channel is gone: no more requests. */
  parar(canal: string): void {
    if (!this.#canais.delete(canal)) return
    this.#fila = this.#fila.filter((item) => item !== canal)
    this.#rever()
  }

  /** The session ends: nothing more goes out. */
  limpar(): void {
    this.#canais.clear()
    this.#fila = []
    this.#cancelarRelogio()
  }

  /**
   * Something changed that can make a request work now: this device has new
   * key packages on the server, or the connection came back. Every channel in
   * a series asks in `adiantamentoMs`, but never less than the first wait
   * after its last request: a connection that drops every ten seconds must not
   * ask every ten seconds.
   */
  adiantar(): void {
    const agora = this.#porta.agora()
    const minimo = this.#regras.atrasos[0] ?? 0
    for (const canal of this.#canais.values()) {
      const cedo = agora + this.#variar(this.#regras.adiantamentoMs)
      const depoisDoUltimo = canal.ultimo === null ? cedo : canal.ultimo + minimo
      canal.proxima = Math.min(canal.proxima, Math.max(cedo, depoisDoUltimo))
    }
    this.#rever()
  }

  #variar(ms: number): number {
    return Math.round(ms * (1 - VARIACAO_DO_PEDIDO + 2 * VARIACAO_DO_PEDIDO * this.#porta.aleatorio()))
  }

  #reporFichas(agora: number): void {
    const { rajada, intervaloMs } = this.#regras
    if (this.#fichas >= rajada) {
      this.#fichasEm = agora
      return
    }
    const ganhas = Math.floor((agora - this.#fichasEm) / intervaloMs)
    if (ganhas <= 0) return
    this.#fichas = Math.min(rajada, this.#fichas + ganhas)
    this.#fichasEm = this.#fichas >= rajada ? agora : this.#fichasEm + ganhas * intervaloMs
  }

  /** Send what is due and the bucket allows, then set the clock for the next thing. */
  #rever(): void {
    const agora = this.#porta.agora()
    for (const [canal, dados] of this.#canais) {
      if (dados.proxima <= agora && !this.#fila.includes(canal)) this.#fila.push(canal)
    }
    this.#reporFichas(agora)
    while (this.#fila.length > 0 && this.#fichas > 0) {
      const canal = this.#fila.shift() as string
      const dados = this.#canais.get(canal)
      if (!dados) continue
      // The first request goes out as it always did, at the moment of the
      // declaration. The repeats ask the session again: a channel that is
      // catching up may hear again without any help.
      const estado = dados.tentativa === 0 ? "surdo" : this.#porta.estado(canal)
      if (estado === "ouve") {
        this.#canais.delete(canal)
        continue
      }
      if (estado === "adiar" && !dados.adiado) {
        dados.adiado = true
        dados.proxima = agora + (this.#regras.atrasos[0] ?? 0)
        continue
      }
      dados.adiado = false
      this.#fichas -= 1
      if (this.#porta.pedir(canal)) {
        dados.ultimo = agora
        dados.proxima = agora + atrasoDoPedido(dados.tentativa, this.#porta.aleatorio(), this.#regras.atrasos)
        dados.tentativa += 1
      } else {
        // No connection: the frame did not leave and costs nothing. The same
        // attempt again after its wait, or sooner when the connection comes
        // back (`adiantar`).
        this.#fichas += 1
        dados.proxima = agora + atrasoDoPedido(dados.tentativa, this.#porta.aleatorio(), this.#regras.atrasos)
      }
    }
    this.#programar(agora)
  }

  #programar(agora: number): void {
    let quando = Number.POSITIVE_INFINITY
    // What is in the queue is already due: it waits for the token below, not for its own time.
    for (const [canal, dados] of this.#canais) if (!this.#fila.includes(canal)) quando = Math.min(quando, dados.proxima)
    // Something waits for the bucket: the next token.
    if (this.#fila.length > 0) quando = Math.min(quando, this.#fichasEm + this.#regras.intervaloMs)
    if (quando === this.#quando && this.#cancelar !== null) return
    this.#cancelarRelogio()
    if (quando === Number.POSITIVE_INFINITY) return
    this.#quando = quando
    this.#cancelar = this.#porta.programar(() => {
      this.#cancelar = null
      this.#quando = Number.POSITIVE_INFINITY
      this.#rever()
    }, Math.max(0, quando - agora))
  }

  #cancelarRelogio(): void {
    this.#cancelar?.()
    this.#cancelar = null
    this.#quando = Number.POSITIVE_INFINITY
  }
}
