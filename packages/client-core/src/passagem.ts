import {
  APARELHOS_POR_CONTA,
  CAPACIDADE_APARELHOS,
  PROTOCOL_VERSION,
  identityFromPrivateKey,
  parseServerName,
  signDeviceManifest,
  signWithDevice,
  toBase64,
  fromBase64,
  verifyDeviceManifest,
  type ClientFrame,
  type DeviceManifestWire,
  type ServerFrame,
} from "@enclave/protocol"

/**
 * The handover ("passagem") of an imported account file (1.3.26, 21/11/2026).
 *
 * The account file is the proof that the account belongs to whoever holds it and
 * its password. Importing it on a device makes a NEW device of the account, and
 * never removes one: the device that exported the file keeps working.
 *
 * The device that imports draws a new device key and certifies it with the
 * account key in the file (`Vault.importVault`). The server only takes a new
 * manifest from a device that is already in the current one (N-01, the rule of
 * 16/11/2026), and the new key is not. So this opens ONE short connection with
 * the device key of the file, which is in the manifest, and on it does exactly
 * this: read the account's manifest, and publish the next one with the new key
 * added, signed by the account. Then it closes. The new device then logs in with
 * its own key, as any device of the manifest.
 *
 * **What this connection never does**, and the tests hold it
 * (`passagem.test.ts`): subscribe to a channel, restore, publish or claim key
 * packages, touch SFrame, send a signal, or write anything in a channel. The
 * only frames that leave are `TRAMAS_DA_PASSAGEM`; `#enviar` refuses any other.
 * The old device key shares MLS leaves with the device that exported the file:
 * one frame in a channel from here would spend that device's ratchet.
 * It never sends `assumirPosse` either: nobody's possession changes.
 *
 * And it never trims: an account at `APARELHOS_POR_CONTA` refuses the import
 * (`ERRO_CONTA_CHEIA_NO_IMPORTAR`), and `aparelhosDoManifestoSeguinte` (which
 * cuts the oldest) is not called here.
 */

/** What the handover needs, all of it from the decrypted account file. */
export interface PedidoDePassagem {
  /** The account's address, as the file's account key and server give it. */
  address: string
  /** The server the account lives on (`homeserver` in the vault). */
  homeserver: string
  /** The ACCOUNT private key from the file. Signs the new manifest. */
  chaveDaConta: Uint8Array
  /** The device private key of the file: the device that exported it. Only logs in here. */
  chaveDoAparelhoAntigo: Uint8Array
  /** That device's possession generation on the server, as the file has it. */
  posse?: number | undefined
  /** The PUBLIC key of the new device, the one this import made. */
  chaveNova: Uint8Array
  /** The highest manifest version of the account the file saw: a lower one is a rollback. */
  versaoVista?: number | undefined
}

/** What the handover answers. `versao` is the manifest that names the new key; `null` for a server without manifests. */
export interface ResultadoDaPassagem {
  versao: number | null
}

/** The handover as `Vault.importVault` calls it: the session gives it (`Session.passagemDoImportar`). */
export type PassagemDoImportar = (pedido: PedidoDePassagem) => Promise<ResultadoDaPassagem>

/** The only frames this connection may send. */
export const TRAMAS_DA_PASSAGEM: ReadonlySet<ClientFrame["t"]> = new Set([
  "hello",
  "auth.begin",
  "auth.finish",
  "manifest.get",
  "manifest.publish",
])

/** The device of the file was removed from the account (or replaced by a 1.3.25 import). Keys of the interface's error catalog. */
export const ERRO_FICHEIRO_DE_APARELHO_REVOGADO = "this account file is from a device that left the account"
/** The account already has `APARELHOS_POR_CONTA` devices. */
export const ERRO_CONTA_CHEIA_NO_IMPORTAR = "this account is full, so the file cannot add a device"
/** The file has a device but not the account key (a phone paired before 1.3.16): it cannot certify a new device. */
export const ERRO_FICHEIRO_SEM_CHAVE_DA_CONTA = "this account file cannot add a device"
/** The server refused the new list for a reason that is not one of the above, or served a list that does not verify. */
export const ERRO_PASSAGEM_RECUSADA = "the server did not add this device to the account"

/** The socket this needs: the browser `WebSocket`, Node's global one, or a test double. */
export interface SocketDaPassagem {
  readonly readyState: number
  send(texto: string): void
  close(): void
  addEventListener(tipo: "open" | "close" | "error", ouvinte: () => void): void
  addEventListener(tipo: "message", ouvinte: (evento: { data: unknown }) => void): void
}

export interface AmbienteDaPassagem {
  /** The gateway URL of `pedido.homeserver`. */
  url: string
  /** The app version, for `hello` (a server with a minimum version refuses a `hello` without it). */
  versao?: string | undefined
  /** How to open the socket. By default `new WebSocket(url)`. */
  abrir?: ((url: string) => SocketDaPassagem) | undefined
  /** How long to wait for each answer. */
  prazoMs?: number | undefined
  /** The clock, in ms. For tests. */
  agora?: (() => number) | undefined
}

/** How many times to read and publish again after a `stale-version` (another device published at the same moment). */
const TENTATIVAS_DE_PUBLICAR = 3

export async function fazerPassagem(pedido: PedidoDePassagem, ambiente: AmbienteDaPassagem): Promise<ResultadoDaPassagem> {
  const ligacao = new LigacaoDePassagem(
    (ambiente.abrir ?? ((url) => new WebSocket(url) as unknown as SocketDaPassagem))(ambiente.url),
    ambiente.prazoMs ?? 15_000,
  )
  try {
    await ligacao.aberta()
    return await passar(ligacao, pedido, ambiente)
  } finally {
    ligacao.fechar()
  }
}

async function passar(ligacao: LigacaoDePassagem, pedido: PedidoDePassagem, ambiente: AmbienteDaPassagem): Promise<ResultadoDaPassagem> {
  // A hello with no capabilities: this connection promises nothing and asks for nothing
  // (no signals, no encrypted vault, no live manifest).
  ligacao.enviar({ t: "hello", version: PROTOCOL_VERSION, ...(ambiente.versao ? { versao: ambiente.versao } : {}) })
  const ola = await ligacao.esperar("hello.ok")
  // A server without manifests lets any certified device in: nothing to hand over, and the old key never logs in.
  if (!ola.capabilities.includes(CAPACIDADE_APARELHOS)) return { versao: null }

  const antigo = identityFromPrivateKey(pedido.chaveDaConta, parseServerName(pedido.homeserver), pedido.chaveDoAparelhoAntigo)
  if (antigo.address !== pedido.address) throw new Error(ERRO_PASSAGEM_RECUSADA)
  ligacao.enviar({
    t: "auth.begin",
    address: antigo.address,
    signingKey: toBase64(antigo.deviceSigningPublicKey),
    accountKey: toBase64(antigo.signingPublicKey),
    deviceCert: toBase64(antigo.credential.signature),
  })
  const desafio = await ligacao.esperar("auth.challenge")
  ligacao.enviar({
    t: "auth.finish",
    signature: toBase64(signWithDevice(antigo, fromBase64(desafio.nonce))),
    // The generation the file has, and never `assumirPosse`: the device that exported keeps its possession.
    ...(pedido.posse !== undefined ? { posse: pedido.posse } : {}),
  })
  await ligacao.esperar("auth.ok")

  const antiga = toBase64(antigo.deviceSigningPublicKey)
  const nova = toBase64(pedido.chaveNova)
  const agora = (): number => Math.floor((ambiente.agora ?? Date.now)() / 1000)
  for (let tentativa = 0; tentativa < TENTATIVAS_DE_PUBLICAR; tentativa++) {
    ligacao.enviar({ t: "manifest.get", address: antigo.address })
    const lido = await ligacao.esperar("manifest.result", (frame) => frame.address === antigo.address)
    const actual = manifestoVerificado(lido.manifest, antigo.address, pedido.versaoVista)
    // Already in: an import that published and then failed (a lost reply, a failed vault write, a closed tab), tried
    // again. The retry has the same key because the import keeps its seed until the vault is written (`pendingImportKeys.ts`).
    if (actual !== null && actual.devices.some((device) => device.deviceKey === nova)) return { versao: actual.version }
    // The device of the file is not in the list: it left the account, and the server would refuse it anyway.
    if (actual !== null && !actual.devices.some((device) => device.deviceKey === antiga)) {
      throw new Error(ERRO_FICHEIRO_DE_APARELHO_REVOGADO)
    }
    // Refuse, never trim: see the module comment.
    if (actual !== null && actual.devices.length >= APARELHOS_POR_CONTA) throw new Error(ERRO_CONTA_CHEIA_NO_IMPORTAR)
    const segundos = agora()
    const devices = [
      ...(actual?.devices ?? [{ deviceKey: antiga, addedAt: segundos }]).map((device) => ({
        deviceKey: fromBase64(device.deviceKey),
        addedAt: device.addedAt,
      })),
      { deviceKey: pedido.chaveNova, addedAt: segundos },
    ]
    const version = Math.max(actual?.version ?? 0, pedido.versaoVista ?? 0) + 1
    ligacao.enviar({
      t: "manifest.publish",
      manifest: signDeviceManifest(pedido.chaveDaConta, { address: antigo.address, version, devices, signedAt: segundos }),
    })
    const veredicto = await ligacao.esperar("manifest.published", (frame) => frame.address === antigo.address)
    if (veredicto.ok) return { versao: veredicto.version }
    if (veredicto.reason === "stale-version") continue
    // `not-yours`: the old device is no longer an active device of the account (N-01).
    if (veredicto.reason === "not-yours" || veredicto.reason === "revoked-device") throw new Error(ERRO_FICHEIRO_DE_APARELHO_REVOGADO)
    throw new Error(ERRO_PASSAGEM_RECUSADA)
  }
  throw new Error(ERRO_PASSAGEM_RECUSADA)
}

/** The manifest as read, verified for this account, or `null` when the account never published one. Throws on one that does not verify. */
function manifestoVerificado(wire: DeviceManifestWire | null, address: string, versaoVista: number | undefined): DeviceManifestWire | null {
  if (wire === null) {
    // The file saw a manifest, and the server says there is none: a server that lost it. Do not publish blind.
    if (versaoVista !== undefined && versaoVista > 0) throw new Error(ERRO_PASSAGEM_RECUSADA)
    return null
  }
  const verificado = verifyDeviceManifest(wire)
  if (!verificado.ok || verificado.wire.address !== address) throw new Error(ERRO_PASSAGEM_RECUSADA)
  // A version below what the file saw is an old manifest, maybe from before a revocation.
  if (versaoVista !== undefined && verificado.wire.version < versaoVista) throw new Error(ERRO_PASSAGEM_RECUSADA)
  return verificado.wire
}

/** One socket, one queue: frames wait to be asked for, in order. */
class LigacaoDePassagem {
  readonly #socket: SocketDaPassagem
  readonly #prazoMs: number
  #fila: ServerFrame[] = []
  #aEspera: (() => void) | null = null
  #fechada = false
  readonly #abriu: Promise<void>

  constructor(socket: SocketDaPassagem, prazoMs: number) {
    this.#socket = socket
    this.#prazoMs = prazoMs
    this.#abriu = new Promise((resolve, reject) => {
      socket.addEventListener("open", () => resolve())
      socket.addEventListener("error", () => reject(new Error("could not reach the homeserver")))
    })
    // A rejection nobody awaits yet (the error comes before `aberta`) must not be unhandled.
    this.#abriu.catch(() => {})
    socket.addEventListener("message", (evento) => {
      let frame: ServerFrame
      try {
        frame = JSON.parse(String(evento.data)) as ServerFrame
      } catch {
        return
      }
      this.#fila.push(frame)
      this.#aEspera?.()
    })
    socket.addEventListener("close", () => {
      this.#fechada = true
      this.#aEspera?.()
    })
  }

  aberta(): Promise<void> {
    return this.#abriu
  }

  enviar(frame: ClientFrame): void {
    // The guard that makes the module comment true, at the only door out.
    if (!TRAMAS_DA_PASSAGEM.has(frame.t)) throw new Error("the handover connection never sends this frame", { cause: { t: frame.t } })
    this.#socket.send(JSON.stringify(frame))
  }

  /**
   * The next frame of type `t` (that passes `filtro`). Frames of other types are
   * dropped: the server may push things to an authenticated connection
   * (`keypackage.low`), and none of them is ours to act on. An `error` frame ends
   * the handover, with the sentence for its code.
   */
  async esperar<K extends ServerFrame["t"]>(
    t: K,
    filtro: (frame: Extract<ServerFrame, { t: K }>) => boolean = () => true,
  ): Promise<Extract<ServerFrame, { t: K }>> {
    const ate = Date.now() + this.#prazoMs
    for (;;) {
      while (this.#fila.length > 0) {
        const frame = this.#fila.shift()!
        if (frame.t === "error") {
          // `device-revoked`: removed from the manifest, or a copy replaced by a 1.3.25 import.
          if (frame.code === "device-revoked") throw new Error(ERRO_FICHEIRO_DE_APARELHO_REVOGADO)
          if (frame.fatal) throw new Error("the server refused the login")
          continue
        }
        if (frame.t === t && filtro(frame as Extract<ServerFrame, { t: K }>)) return frame as Extract<ServerFrame, { t: K }>
      }
      if (this.#fechada) throw new Error("the connection dropped")
      const falta = ate - Date.now()
      if (falta <= 0) throw new Error("the server did not answer in time")
      await new Promise<void>((resolve) => {
        const relogio = setTimeout(resolve, falta)
        this.#aEspera = () => {
          clearTimeout(relogio)
          resolve()
        }
      })
      this.#aEspera = null
    }
  }

  fechar(): void {
    if (this.#socket.readyState === 0 || this.#socket.readyState === 1) this.#socket.close()
  }
}
