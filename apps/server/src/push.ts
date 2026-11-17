import { request as httpsRequest } from "node:https"
import type { ChaveVapid } from "./config.js"
import { guardedLookup, urlPermitida } from "./link-preview.js"
import { cabecalhoVapid, cifrarPush } from "./push-cifra.js"

/**
 * Sending Web Push messages: the queue, the HTTP request, and what each
 * answer from the push service means.
 *
 * Who gets a push, and the per-device caps, are decided in the gateway
 * (`Gateway.acordarAparelhos`). This file only delivers, and never learns
 * which channel or which sender a push is for: it gets an endpoint, two keys
 * and a language.
 *
 * A slow or broken push service never slows the gateway: `enviar` returns at
 * once, at most `EM_PARALELO` requests are in flight, and a full queue drops
 * its oldest entry. A dropped push loses nothing but the wake-up: the message
 * is on the server, and the app reads it when it opens.
 */

/** POST `corpo` to `url` with these headers; resolve with the HTTP status. */
export type TransporteDoPush = (url: string, cabecalhos: Record<string, string>, corpo: Uint8Array, prazoMs: number) => Promise<number>

export interface DestinoDoPush {
  endpoint: string
  p256dh: Uint8Array
  auth: Uint8Array
  lingua: "pt" | "en"
}

/**
 * May the server POST to this endpoint? https, port 443, no credentials, and a
 * host on the list of push services (`*.x` for any subdomain of `x`). A literal
 * private address never passes (`urlPermitida`), and the real request resolves
 * names through `guardedLookup`, so a listed name that resolves inward is
 * refused at connect time too.
 */
export function endpointPermitido(raw: string, servicos: readonly string[]): URL | null {
  const url = urlPermitida(raw)
  if (!url || url.protocol !== "https:" || (url.port !== "" && url.port !== "443")) return null
  if (url.username !== "" || url.password !== "") return null
  const anfitriao = url.hostname.toLowerCase()
  const listado = servicos.some((servico) =>
    servico.startsWith("*.") ? anfitriao.endsWith(servico.slice(1)) && anfitriao.length > servico.length - 1 : anfitriao === servico,
  )
  return listado ? url : null
}

/** The production transport: HTTPS, with the same name guard as link previews. */
export const transporteHttps: TransporteDoPush = (url, cabecalhos, corpo, prazoMs) =>
  new Promise((resolve, reject) => {
    const pedido = httpsRequest(
      url,
      { method: "POST", lookup: guardedLookup, timeout: prazoMs, headers: { ...cabecalhos, "content-length": String(corpo.length) } },
      (resposta) => {
        // The body says nothing we use: drain it so the socket is released.
        resposta.resume()
        resolve(resposta.statusCode ?? 0)
      },
    )
    pedido.on("timeout", () => pedido.destroy(new Error("push service timed out")))
    pedido.on("error", reject)
    pedido.end(corpo)
  })

interface Pendente {
  destino: DestinoDoPush
  tentativa: number
}

export class CarteiroDoPush {
  /** Waiting pushes; above this the oldest is dropped. */
  static FILA_MAX = 1000
  /** Requests in flight at once. */
  static EM_PARALELO = 8
  /** Per request. */
  static PRAZO_MS = 10_000
  /** A day: an older wake-up is no use. */
  static TTL_S = 86_400
  /** The VAPID token lives 12 h; a new one is signed after 1 h. */
  static VALIDADE_DO_JWT_S = 12 * 3600
  static RENOVAR_JWT_S = 3600

  readonly metricas = { enviados: 0, expirados: 0, falhados: 0, repetidos: 0, descartados: 0 }

  #fila: Pendente[] = []
  #emVoo = 0
  #reenvios = new Set<ReturnType<typeof setTimeout>>()
  #ociosos: (() => void)[] = []
  #jwts = new Map<string, { cabecalho: string; criadoS: number }>()
  readonly #transporte: TransporteDoPush
  readonly #reenvioMs: number

  constructor(
    private readonly opcoes: {
      chave: ChaveVapid
      /** The `sub` claim: `mailto:` or `https:`. */
      contacto: string
      transporte?: TransporteDoPush | undefined
      /** The push service said the subscription is gone (404, 410). */
      aoExpirar: (endpoint: string) => void
      /** Wait before the single repeat after a 429 or 5xx. */
      reenvioMs?: number
    },
  ) {
    this.#transporte = opcoes.transporte ?? transporteHttps
    this.#reenvioMs = opcoes.reenvioMs ?? 30_000
  }

  /** Queue one push. Never throws, never waits. */
  enviar(destino: DestinoDoPush): void {
    this.#porNaFila({ destino, tentativa: 0 })
  }

  /** Pushes not yet answered: queued, in flight, or waiting to repeat. */
  get pendentes(): number {
    return this.#fila.length + this.#emVoo + this.#reenvios.size
  }

  /** Resolves when nothing is pending. For tests and for a clean shutdown. */
  ocioso(): Promise<void> {
    if (this.pendentes === 0) return Promise.resolve()
    return new Promise((resolve) => this.#ociosos.push(resolve))
  }

  /** Drop what is waiting to repeat. In-flight requests finish on their own. */
  parar(): void {
    for (const temporizador of this.#reenvios) clearTimeout(temporizador)
    this.#reenvios.clear()
    this.#fila = []
    this.#talvezOcioso()
  }

  #porNaFila(pendente: Pendente): void {
    if (this.#fila.length >= CarteiroDoPush.FILA_MAX) {
      this.#fila.shift()
      this.metricas.descartados += 1
    }
    this.#fila.push(pendente)
    this.#bombear()
  }

  #bombear(): void {
    while (this.#emVoo < CarteiroDoPush.EM_PARALELO && this.#fila.length > 0) {
      const pendente = this.#fila.shift() as Pendente
      this.#emVoo += 1
      void this.#entregar(pendente).finally(() => {
        this.#emVoo -= 1
        this.#bombear()
        this.#talvezOcioso()
      })
    }
  }

  #talvezOcioso(): void {
    if (this.pendentes > 0) return
    const ociosos = this.#ociosos.splice(0)
    for (const resolver of ociosos) resolver()
  }

  async #entregar(pendente: Pendente): Promise<void> {
    const { destino } = pendente
    let estado: number
    try {
      const corpo = cifrarPush(new TextEncoder().encode(destino.lingua), destino).mensagem
      estado = await this.#transporte(destino.endpoint, this.#cabecalhos(destino.endpoint), corpo, CarteiroDoPush.PRAZO_MS)
    } catch {
      // Network failure or timeout: treated like a 5xx.
      estado = 0
    }
    if (estado >= 200 && estado < 300) {
      this.metricas.enviados += 1
      return
    }
    if (estado === 404 || estado === 410) {
      this.metricas.expirados += 1
      this.opcoes.aoExpirar(destino.endpoint)
      return
    }
    if ((estado === 0 || estado === 429 || estado >= 500) && pendente.tentativa === 0) {
      this.metricas.repetidos += 1
      const temporizador = setTimeout(() => {
        this.#reenvios.delete(temporizador)
        this.#porNaFila({ destino, tentativa: 1 })
      }, this.#reenvioMs)
      temporizador.unref?.()
      this.#reenvios.add(temporizador)
      return
    }
    this.metricas.falhados += 1
  }

  /**
   * The request headers. `Urgency: high` wakes an Android phone in Doze;
   * `Topic: m` lets the push service fold undelivered pushes into one, and the
   * name says nothing.
   */
  #cabecalhos(endpoint: string): Record<string, string> {
    return {
      authorization: this.#vapid(new URL(endpoint).origin),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(CarteiroDoPush.TTL_S),
      urgency: "high",
      topic: "m",
    }
  }

  /** One VAPID token per push service origin, signed again after an hour. */
  #vapid(aud: string): string {
    const agoraS = Math.floor(Date.now() / 1000)
    const guardado = this.#jwts.get(aud)
    if (guardado && agoraS - guardado.criadoS < CarteiroDoPush.RENOVAR_JWT_S) return guardado.cabecalho
    const cabecalho = cabecalhoVapid(this.opcoes.chave.privateKey, this.opcoes.chave.publicKey, {
      aud,
      exp: agoraS + CarteiroDoPush.VALIDADE_DO_JWT_S,
      sub: this.opcoes.contacto,
    })
    this.#jwts.set(aud, { cabecalho, criadoS: agoraS })
    return cabecalho
  }
}
