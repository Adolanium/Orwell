import { fromBase64 } from "@enclave/protocol"
import { p256 } from "@noble/curves/nist.js"
import { createServer, type Server } from "node:http"
import { decifrarPush, lerJwtVapid } from "../src/push-cifra.js"
import type { TransporteDoPush } from "../src/push.js"

/**
 * A push service on 127.0.0.1 that behaves like the real ones where it matters:
 * it checks the VAPID token and the headers, and it decrypts the body with the
 * private key of the subscription it handed out, like the browser would.
 *
 * Outside `src/` on purpose: never in the image.
 *
 * Endpoints are `https://push.test/<id>`; `transporte` sends them to this
 * process over plain HTTP, with the exact headers and body the server built.
 */
export interface PushRecebido {
  id: string
  /** What the browser would hand the Service Worker: the decrypted text. */
  texto: string
  cabecalhos: Record<string, string>
  aud: string
  sub: string
  exp: number
  /** The encrypted body length, the same for every push. */
  bytes: number
}

export interface AparelhoDoPush {
  id: string
  endpoint: string
  /** `p256dh` and `auth` as `push.subscribe` sends them. */
  p256dh: Uint8Array
  auth: Uint8Array
  privada: Uint8Array
}

export class ServicoDePushFalso {
  readonly recebidos: PushRecebido[] = []
  readonly recusados: { id: string; motivo: string }[] = []
  /** The status to answer for an id, instead of 201 (404, 410, 429, 500...). */
  readonly respostas = new Map<string, number[]>()
  /** The VAPID public key the server must sign with. Set once the server starts. */
  chaveDoServidor: Uint8Array | null = null
  #aparelhos = new Map<string, AparelhoDoPush>()
  #servidor: Server
  #porta = 0
  #contador = 0

  constructor() {
    this.#servidor = createServer((pedido, resposta) => {
      const pedacos: Buffer[] = []
      pedido.on("data", (p: Buffer) => pedacos.push(p))
      pedido.on("end", () => {
        const id = (pedido.url ?? "/").slice(1)
        const cabecalhos = Object.fromEntries(
          Object.entries(pedido.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")]),
        )
        const recusar = (motivo: string, codigo = 400): void => {
          this.recusados.push({ id, motivo })
          resposta.writeHead(codigo).end()
        }
        const programada = this.respostas.get(id)?.shift()
        if (programada !== undefined) {
          resposta.writeHead(programada).end()
          return
        }
        const aparelho = this.#aparelhos.get(id)
        if (!aparelho) return recusar("unknown subscription", 404)
        const m = /^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/.exec(cabecalhos.authorization ?? "")
        if (!m) return recusar("no vapid authorization", 401)
        if (this.chaveDoServidor && m[2] !== Buffer.from(this.chaveDoServidor).toString("base64url")) {
          return recusar("vapid key changed", 403)
        }
        const claims = lerJwtVapid(m[1] as string, fromBase64(m[2] as string))
        if (!claims) return recusar("bad vapid signature", 403)
        if (cabecalhos["content-encoding"] !== "aes128gcm") return recusar("not aes128gcm")
        let texto: string
        try {
          texto = new TextDecoder().decode(decifrarPush(new Uint8Array(Buffer.concat(pedacos)), aparelho))
        } catch {
          return recusar("could not decrypt")
        }
        this.recebidos.push({ id, texto, cabecalhos, aud: claims.aud, sub: claims.sub, exp: claims.exp, bytes: Buffer.concat(pedacos).length })
        resposta.writeHead(201).end()
      })
    })
  }

  async arrancar(): Promise<void> {
    await new Promise<void>((resolve) => this.#servidor.listen(0, "127.0.0.1", resolve))
    this.#porta = (this.#servidor.address() as { port: number }).port
  }

  async parar(): Promise<void> {
    await new Promise<void>((resolve) => this.#servidor.close(() => resolve()))
  }

  /** A new browser subscription, as `PushManager.subscribe` would make one. */
  novoAparelho(): AparelhoDoPush {
    const privada = p256.utils.randomSecretKey()
    const id = `sub-${++this.#contador}-${Math.random().toString(36).slice(2, 8)}`
    const aparelho: AparelhoDoPush = {
      id,
      endpoint: `https://push.test/${id}`,
      p256dh: p256.getPublicKey(privada, false),
      auth: crypto.getRandomValues(new Uint8Array(16)),
      privada,
    }
    this.#aparelhos.set(id, aparelho)
    return aparelho
  }

  /** How many pushes reached this subscription. */
  quantos(aparelho: AparelhoDoPush): number {
    return this.recebidos.filter((r) => r.id === aparelho.id).length
  }

  /** The transport the server uses in tests: `https://push.test/x` goes to this process. */
  readonly transporte: TransporteDoPush = async (url, cabecalhos, corpo, prazoMs) => {
    const alvo = new URL(url)
    const resposta = await fetch(`http://127.0.0.1:${this.#porta}${alvo.pathname}`, {
      method: "POST",
      headers: cabecalhos,
      body: Buffer.from(corpo),
      signal: AbortSignal.timeout(prazoMs),
    })
    return resposta.status
  }
}
