import { ed25519 } from "@noble/curves/ed25519.js"
import { fromBase64, toBase64 } from "./canonical.js"

/**
 * The proof that a device itself asked for a new seat (1.3.26).
 *
 * **The flaw.** Since 1.3.25 the server names the device that asked in
 * `channel.rejoin` (`device`), and the members take out only that device's
 * leaf. The name comes from the server. A lying server could name a healthy
 * device, and its siblings took its leaf out and seated it again, at most once a
 * minute per device: one key package and one commit each time.
 *
 * **The choice.** The device signs the request with its device key
 * (`signWithDevice`, the key its leaf credential carries). The server forwards
 * the signature untouched. A member verifies it against the device key at the
 * named leaf, whose chain to the account the MLS credential already proves. The
 * server does not hold the device's private key, so it cannot make a proof for a
 * device that did not ask. Without a valid proof (an older client, or a forged
 * name), a member takes out the named leaf only when it has no proof of life in
 * the epoch, which is the rule before 1.3.25.
 *
 * **What gets signed.** A domain, the channel, the account address, the device
 * key and the time (`em`, ms on the asker's clock). The channel and address stop
 * a proof from one channel or account being used in another. The time and the
 * receiver's memory of the last time it accepted (`ProvasDosPedidosDeLugar`)
 * limit a replay: the server can hold a real request and deliver it again only
 * inside `JANELA_DA_PROVA_DO_PEDIDO_MS`, and only to a member that did not
 * accept it yet.
 */
export interface ProvaDoPedidoDeLugar {
  /** When the device signed, in ms since the epoch, on its own clock. */
  em: number
  /** Ed25519 signature by the device key, base64url. */
  assinatura: string
}

/** How far from the receiver's clock a proof may be, either way. Clocks drift; replays stay short. */
export const JANELA_DA_PROVA_DO_PEDIDO_MS = 10 * 60_000

const DOMINIO = "orwell:channel-rejoin:v1\0"

export function mensagemDoPedidoDeLugar(canal: string, address: string, deviceKey: Uint8Array, em: number): Uint8Array {
  const texto = new TextEncoder()
  const partes = [texto.encode(DOMINIO), texto.encode(`${canal}\0${address}\0`), deviceKey, texto.encode(`\0${em}`)]
  const total = partes.reduce((soma, parte) => soma + parte.length, 0)
  const mensagem = new Uint8Array(total)
  let posicao = 0
  for (const parte of partes) {
    mensagem.set(parte, posicao)
    posicao += parte.length
  }
  return mensagem
}

/** Sign a seat request with the DEVICE private key. */
export function assinarPedidoDeLugar(
  devicePrivateKey: Uint8Array,
  devicePublicKey: Uint8Array,
  canal: string,
  address: string,
  em: number,
): ProvaDoPedidoDeLugar {
  return { em, assinatura: toBase64(ed25519.sign(mensagemDoPedidoDeLugar(canal, address, devicePublicKey, em), devicePrivateKey)) }
}

/** Whether the signature is the device's, for this channel and account. Returns, never throws. Freshness is the caller's. */
export function verificarPedidoDeLugar(prova: ProvaDoPedidoDeLugar, canal: string, address: string, deviceKey: Uint8Array): boolean {
  if (!Number.isSafeInteger(prova.em) || prova.em < 0) return false
  try {
    return ed25519.verify(fromBase64(prova.assinatura), mensagemDoPedidoDeLugar(canal, address, deviceKey, prova.em), deviceKey)
  } catch {
    return false
  }
}

/**
 * What a member remembers of the proofs it accepted, to refuse a replay.
 *
 * Per channel and device, the `em` of the last proof accepted; a proof must be
 * newer than that, and inside the window of the receiver's clock. Memory only:
 * after a reload a proof still inside the window can pass once more, which costs
 * that device one key package at most. Bounded: past the cap, the oldest entry goes.
 */
export class ProvasDosPedidosDeLugar {
  static MAXIMO = 4096
  readonly #ultima = new Map<string, number>()

  /**
   * Accept the proof if it is the device's, fresh, and newer than the last one accepted.
   * `deviceKey` must be the key at the named leaf of `address`, read from the tree.
   */
  aceitar(prova: ProvaDoPedidoDeLugar | undefined, canal: string, address: string, deviceKey: Uint8Array, agora = Date.now()): boolean {
    if (prova === undefined) return false
    if (Math.abs(agora - prova.em) > JANELA_DA_PROVA_DO_PEDIDO_MS) return false
    const chave = `${canal}|${toBase64(deviceKey)}`
    const ultima = this.#ultima.get(chave)
    if (ultima !== undefined && prova.em <= ultima) return false
    if (!verificarPedidoDeLugar(prova, canal, address, deviceKey)) return false
    this.#ultima.delete(chave)
    this.#ultima.set(chave, prova.em)
    while (this.#ultima.size > ProvasDosPedidosDeLugar.MAXIMO) {
      const primeira = this.#ultima.keys().next().value
      if (primeira === undefined) break
      this.#ultima.delete(primeira)
    }
    return true
  }
}
