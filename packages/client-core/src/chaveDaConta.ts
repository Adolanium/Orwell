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
import { canonicoTolerante, fromBase64, privadaDaConta, toBase64, verify } from "@enclave/protocol"

/**
 * The account private key, from the device that has it to a device of the same
 * account that does not (1.3.16, "Erro 609").
 *
 * Pairing passes the key since 1.3.16 (`emparelhar.ts`). This module is for the
 * phones paired BEFORE: the rule is that nobody pairs again. The first
 * time the phone and a device with the key are both connected, the key passes,
 * with no question and no notice.
 *
 * ## The path
 *
 * Ephemeral signals (`channel.sinal`) on the ACCOUNT CHANNEL, the same path as
 * the history between devices (`historico/historico.ts`), and for the same
 * reasons: the server passes them to whoever is online and stores nothing, and
 * a sibling on an older version drops a signal it does not read without counting
 * it against the channel. A 1.3.15 sibling reads this signal as a history signal
 * with the wrong first byte, and drops it.
 *
 * ## The cipher
 *
 * Two layers, like the history. Outside, the signal key of the account channel's
 * epoch: only leaves of the account channel open it. Inside, a key for just the
 * two devices (ephemeral X25519, `chaveDoHistorico`, with both device keys in the
 * context). Each signal carries the signature of the device that sends it, and
 * the receiver checks it against the leaves of THIS account in the account
 * channel. A third device of the account, or a device that joins the channel
 * later, cannot open what passed between the two.
 *
 * ## The wire
 *
 * - `kp`: the device without the key asks, with its ephemeral public key. Again
 *   every `pedirCadaMs` while it is connected and still has no key.
 * - `kr`: a device with the key answers ONE request, to that device only
 *   (`para`), with its ephemeral public key and the account private key sealed
 *   with the session key.
 *
 * The device that receives the key checks it against the account public key
 * (`privadaDaConta`) before it writes anything.
 *
 * ## Who gets an answer
 *
 * A leaf of this account in the account channel (MLS authenticates it, and the
 * account channel only seats devices of the account manifest), with a valid
 * signature, and that the responder does not know as removed
 * (`aparelhoAdmitido`: not in the vault's revoked list, and in the account
 * manifest the responder last read). A removed device has no leaf after the
 * revocation, and the server does not let it connect at all.
 */

/** The wire numbers. Mutable only for tests. */
export const TECTOS_DA_CHAVE_DA_CONTA = {
  /** Between two requests from the device without the key. */
  pedirCadaMs: 20_000,
  /** The first request waits this long after connecting: catch-up and history start first. */
  primeiroPedidoMs: 3_000,
  /** A responder answers the same device at most once in this window. */
  respostaPorAparelhoMs: 10_000,
  /** An open request is forgotten after this. Two can be open at once (a late answer still counts). */
  pedidoVivoMs: 60_000,
}

/** What the module needs from the session. */
export interface PortaDaChaveDaConta {
  eu(): { address: string; aparelho: Uint8Array; assinar: (mensagem: Uint8Array) => Uint8Array }
  /** The account PUBLIC key: the received private key must close with it. */
  chavePublicaDaConta(): Uint8Array
  /** The account PRIVATE key, when this device has it. */
  chavePrivadaDaConta(): Uint8Array | undefined
  /** The account channel, or empty. */
  canalDaConta(): string
  /** The account channel group exists and is actually for the account. */
  contaPronta(): Promise<boolean>
  /** The device keys (base64url) of the leaves of this account in the account channel. */
  folhasDaConta(): string[]
  /** May this device of the account receive the key? Not revoked, and in the manifest the session last read. */
  aparelhoAdmitido(aparelho: string): boolean
  derivarChave(): Promise<ChaveDoSinal | null>
  /** Connected, and the server forwards signals. */
  podeSinalizar(): boolean
  enviarSinal(sinal: string, ref: string): void
  /** The key arrived and closes with the account: write it to the vault and use it. */
  receber(chavePrivada: Uint8Array): Promise<void>
  agora(): number
}

interface Cabecalho {
  v: 1
  k: "kp" | "kr"
  /** The request id: the session salt of the key between the two devices. */
  s: string
  /** The device that sends, base64url. */
  ap: string
  /** The device this is for (only on `kr`). */
  para?: string
  /** The ephemeral X25519 public key of who sends. */
  x: string
  /** The device signature over everything else. */
  as?: string
}

/** The first byte inside the signal. The history uses 0x48 ("H"); this is "K". */
const MAGIA = 0x4b
/** What the sealed block answers to: the key, and nothing else. */
const ROTULO = "conta:chave-privada"

function novoId(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(9)))
}

/** The text being signed: the domain, channel, account, epoch, header, and body summary. */
function mensagemDoSinal(canal: string, address: string, epoca: bigint, cabecalho: Omit<Cabecalho, "as">, corpo: Uint8Array): Uint8Array {
  const prefixo = new TextEncoder().encode(
    `orwell-chave-da-conta-sinal-v1\0${canal}\0${address}\0${epoca}\0${canonicoTolerante(cabecalho)}\0`,
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
    if ((cabecalho.k !== "kp" && cabecalho.k !== "kr") || typeof cabecalho.s !== "string" || cabecalho.s.length > 32) return null
    if (typeof cabecalho.ap !== "string" || typeof cabecalho.x !== "string" || typeof cabecalho.as !== "string") return null
    return { cabecalho, corpo: bytes.subarray(3 + comprimento) }
  } catch {
    return null
  }
}

export class PassagemDaChaveDaConta {
  /**
   * Off only in tests that prove what a device WITHOUT the key does (the phones
   * paired before 1.3.16, until a device with the key is connected). Static, like
   * the other test switches of the session.
   */
  static ligada = true
  readonly #porta: PortaDaChaveDaConta
  /** Open requests from this device, by id. */
  readonly #pedidos = new Map<string, { par: ParDoHistorico; em: number }>()
  /** When this device last answered each device. */
  readonly #respondidos = new Map<string, number>()
  #relogio: ReturnType<typeof setInterval> | undefined
  #primeiro: ReturnType<typeof setTimeout> | undefined
  #aReceber = false
  /** For tests. */
  readonly estatisticas = { pedidos: 0, respostas: 0, recebidas: 0, recusadas: 0 }

  constructor(porta: PortaDaChaveDaConta) {
    this.#porta = porta
  }

  aoLigar(): void {
    this.aoDesligar()
    if (!PassagemDaChaveDaConta.ligada || this.#porta.chavePrivadaDaConta() !== undefined) return
    const t = TECTOS_DA_CHAVE_DA_CONTA
    this.#primeiro = setTimeout(() => void this.pedir(), t.primeiroPedidoMs)
    this.#relogio = setInterval(() => void this.pedir(), t.pedirCadaMs)
    ;(this.#primeiro as { unref?: () => void }).unref?.()
    ;(this.#relogio as { unref?: () => void }).unref?.()
  }

  aoDesligar(): void {
    if (this.#relogio !== undefined) clearInterval(this.#relogio)
    if (this.#primeiro !== undefined) clearTimeout(this.#primeiro)
    this.#relogio = undefined
    this.#primeiro = undefined
    this.#pedidos.clear()
  }

  /** Ask the devices with the key, once. Does nothing if this device already has it. */
  async pedir(): Promise<void> {
    if (this.#porta.chavePrivadaDaConta() !== undefined) {
      this.aoDesligar()
      return
    }
    if (!this.#porta.podeSinalizar() || !this.#porta.canalDaConta()) return
    if (!(await this.#porta.contaPronta())) return
    const agora = this.#porta.agora()
    for (const [s, pedido] of this.#pedidos) if (agora - pedido.em > TECTOS_DA_CHAVE_DA_CONTA.pedidoVivoMs) this.#pedidos.delete(s)
    const s = novoId()
    const par = novoParDoHistorico()
    this.#pedidos.set(s, { par, em: agora })
    this.estatisticas.pedidos += 1
    await this.#enviar({ v: 1, k: "kp", s, ap: this.#meuAparelho(), x: toBase64(par.publica) }, new Uint8Array(0))
  }

  /**
   * A `channel.sinal` from the account channel. `true` if it was a signal of this
   * module (opened and with the right first byte), handled or refused; `false`
   * if it is someone else's (the history), so the caller passes it on.
   */
  async aoSinal(frame: { channel: string; from: string; sinal: string }): Promise<boolean> {
    const canal = this.#porta.canalDaConta()
    if (!canal || frame.channel !== canal || frame.from !== this.#porta.eu().address) return false
    let bytes: Uint8Array
    try {
      bytes = fromBase64(frame.sinal)
    } catch {
      return false
    }
    const chave = await this.#porta.derivarChave()
    if (!chave || epocaDoSinal(bytes) !== chave.epoca) return false
    const aberto = abrirSinal(chave, canal, bytes)
    return aberto ? this.aoSinalAberto(aberto, frame.from, chave.epoca) : false
  }

  /**
   * The same, for a signal the history module already opened (the session passes
   * account channel signals there first: one decryption per signal).
   */
  async aoSinalAberto(aberto: Uint8Array, remetente: string, epoca: bigint): Promise<boolean> {
    const canal = this.#porta.canalDaConta()
    if (!canal || remetente !== this.#porta.eu().address) return false
    const lido = desembrulhar(aberto)
    if (!lido) return false
    const { cabecalho, corpo } = lido
    const meu = this.#meuAparelho()
    if (cabecalho.ap === meu) return true
    if (cabecalho.para !== undefined && cabecalho.para !== meu) return true
    // A leaf of this account in the account channel, signing for itself.
    if (!this.#porta.folhasDaConta().includes(cabecalho.ap)) {
      this.estatisticas.recusadas += 1
      return true
    }
    const { as: assinatura, ...semAssinatura } = cabecalho
    let valida = false
    try {
      valida = verify(fromBase64(cabecalho.ap), mensagemDoSinal(canal, remetente, epoca, semAssinatura, corpo), fromBase64(assinatura as string))
    } catch {
      valida = false
    }
    if (!valida) {
      this.estatisticas.recusadas += 1
      return true
    }
    if (cabecalho.k === "kp") await this.#aoPedido(cabecalho)
    else await this.#aoResposta(cabecalho, corpo)
    return true
  }

  async #aoPedido(cabecalho: Cabecalho): Promise<void> {
    const privada = this.#porta.chavePrivadaDaConta()
    if (privada === undefined || !PassagemDaChaveDaConta.ligada) return
    if (!this.#porta.aparelhoAdmitido(cabecalho.ap)) {
      this.estatisticas.recusadas += 1
      return
    }
    const agora = this.#porta.agora()
    const antes = this.#respondidos.get(cabecalho.ap)
    if (antes !== undefined && agora - antes < TECTOS_DA_CHAVE_DA_CONTA.respostaPorAparelhoMs) return
    const par = novoParDoHistorico()
    let chave: Uint8Array
    let publica: Uint8Array
    try {
      publica = fromBase64(cabecalho.x)
      chave = chaveDoHistorico(par.privada, publica, cabecalho.s, {
        aparelhoQuePede: fromBase64(cabecalho.ap),
        aparelhoQueResponde: this.#porta.eu().aparelho,
        efemeraQuePede: publica,
        efemeraQueResponde: par.publica,
      })
    } catch {
      return
    }
    this.#respondidos.set(cabecalho.ap, agora)
    const selado = selarBloco(chave, cabecalho.s, ROTULO, privada)
    chave.fill(0)
    this.estatisticas.respostas += 1
    await this.#enviar({ v: 1, k: "kr", s: cabecalho.s, ap: this.#meuAparelho(), para: cabecalho.ap, x: toBase64(par.publica) }, selado)
  }

  async #aoResposta(cabecalho: Cabecalho, corpo: Uint8Array): Promise<void> {
    if (this.#porta.chavePrivadaDaConta() !== undefined || this.#aReceber) return
    const pedido = this.#pedidos.get(cabecalho.s)
    if (!pedido) return
    let chave: Uint8Array
    try {
      const publica = fromBase64(cabecalho.x)
      chave = chaveDoHistorico(pedido.par.privada, publica, cabecalho.s, {
        aparelhoQuePede: this.#porta.eu().aparelho,
        aparelhoQueResponde: fromBase64(cabecalho.ap),
        efemeraQuePede: pedido.par.publica,
        efemeraQueResponde: publica,
      })
    } catch {
      return
    }
    const privada = abrirBloco(chave, cabecalho.s, ROTULO, corpo)
    chave.fill(0)
    if (!privada || !privadaDaConta(privada, this.#porta.chavePublicaDaConta())) {
      this.estatisticas.recusadas += 1
      return
    }
    this.#aReceber = true
    try {
      await this.#porta.receber(privada)
      this.estatisticas.recebidas += 1
      this.aoDesligar()
    } finally {
      this.#aReceber = false
    }
  }

  async #enviar(semAssinatura: Omit<Cabecalho, "as">, corpo: Uint8Array): Promise<void> {
    const canal = this.#porta.canalDaConta()
    const chave = await this.#porta.derivarChave()
    if (!canal || !chave || !this.#porta.podeSinalizar()) return
    const eu = this.#porta.eu()
    const cabecalho: Cabecalho = {
      ...semAssinatura,
      as: toBase64(eu.assinar(mensagemDoSinal(canal, eu.address, chave.epoca, semAssinatura, corpo))),
    }
    try {
      this.#porta.enviarSinal(toBase64(selarSinal(chave, canal, embrulhar(cabecalho, corpo))), novoId())
    } catch {
      // No connection: the next request goes out on the next connection.
    }
  }

  #meuAparelho(): string {
    return toBase64(this.#porta.eu().aparelho)
  }
}
