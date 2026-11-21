import {
  CAPACIDADE_EMPARELHAMENTO,
  CAPABILITY_PAIRING_PAKE,
  CAPACIDADE_ESTADO_DA_CONTA,
  PROTOCOL_VERSION,
  pairCodeBoxKey,
  chaveDeEmparelhamento,
  pairCodeCi,
  encodePake,
  cpaceStart,
  cpaceRespond,
  cpaceFinish,
  decodePake,
  generatePairingCode,
  nameplateOf,
  pairCodeSasWords,
  pairCodePrs,
  cifrarPairPayload,
  decifrarPairPayload,
  devicePublicKeyOf,
  fromBase64,
  generateDeviceKey,
  gerarSegredoDeEmparelhamento,
  juntarEstado,
  pairIdDe,
  palavrasDoSas,
  partirEstado,
  privadaDaConta,
  signDeviceCert,
  toBase64,
  verifyDeviceChain,
  type AccountIdentity,
  type ClientFrame,
  type CpaceStateA,
  type CpaceResult,
  type EstadoDeConta,
  type PairPayload,
  type PalavraPasseDaConta,
  type ServerFrame,
} from "@enclave/protocol"

/**
 * Pairing from the client side: two state machines, one on each end.
 *
 * The HOST is the device that owns the account (the computer). It lives inside
 * the `Session`, on its authenticated socket, because that connection opens
 * the vault (`pair.open` requires an account). The GUEST is the new device
 * (the phone) and has no `Session` yet, because `Session` requires identity:
 * it runs on its own socket, sends `hello` and `pair.join` unauthenticated,
 * and when done it writes the vault and disconnects. Both share the encryption
 * from `pair.ts` and the four-payload protocol (device key in both directions,
 * host certificate, guest ready, rejected from either).
 *
 * **The account private key crosses here since 1.3.16** (the fix for
 * "Erro 609": the phone opens new direct conversations by itself).
 * The `certificate` carries the address, account PUBLIC key, the signature over
 * the guest device key and the account PRIVATE key, inside the box AEAD and
 * only after the SAS on both screens. The guest writes the private key only if
 * it closes with the account public key (`privadaDaConta`). There is no notice
 * and no choice: "Cancel" cancels the whole pairing, and there is no phone
 * paired without the key. A guest before 1.3.16 drops the field and pairs as
 * before. What removing a device rests on now is the server refusing it
 * (`aparelhosRevogados`), see `revogacao.ts`.
 *
 * **The SAS is the only thing the person does**, and it is the entire defense
 * against someone with the secret but not the phone in hand (a photo of the QR,
 * the link in a message) and against a server in the middle if it ever reached
 * the key: both sides compute six words from the `pairId` and the two device
 * public keys, and ONLY after the person confirms on both screens does the host
 * sign. See `palavrasDoSas`.
 *
 * **The order, and what it costs.** The account is defended by the yes on the
 * computer: the phone is no source of trust and a yes from it authorizes
 * nothing. But the host still waits for the `confirmado` from the guest, and
 * only then signs: otherwise, any pairing that died after the computer said yes
 * (different words on the other side, network, vault closed) would leave a dead
 * key in the manifest forever, and three of those would hit the device cap of
 * four with no revocation to remove them. For the same reason the manifest only
 * publishes after `pronto`: the phone does not need it to join (login validates
 * the chain), it needs it to be seated in channels, and that comes after.
 */

/** Why a pairing did not happen. Codes, not phrases: the interface translates. */
export type PairFalha =
  /** The server does not announce `pairing`. */
  | "servidor-sem-emparelhamento"
  /** The `Session` is not connected, or the guest socket did not open. */
  | "sem-ligacao"
  /** This device does not have the account key and cannot add devices. */
  | "sem-chave-de-conta"
  /** The link is not a pairing link. */
  | "link-invalido"
  /** `pair.rejected` from the server, with its reason. */
  | `recusado:${"exists" | "unknown" | "full" | "rate-limited"}`
  /** `pair.closed` from the server before completion, with its reason. */
  | `fechado:${"closed" | "peer-left" | "expired" | "intruder"}`
  /** One side said the words do not match. */
  | "palavras-diferentes"
  /** The certificate that arrived does not verify with the account it claims. */
  | "cadeia-invalida"
  /** "Join the other account" (phase 8.2): the certificate is from this same account, and an account cannot join itself. */
  | "mesma-conta"
  /** The manifest with the new device was not published: without it the phone cannot enter any channel. */
  | "manifesto"
  /** The account hit the device cap. Without revocation, the slot only opens by removing the oldest. */
  | "manifesto-cheio"
  /** A pessoa cancelou. */
  | "cancelado"
  /** A reply did not arrive in time. */
  | "tempo-esgotado"
  /**
   * Short code (1.3.26): CPace's key confirmation failed. The code typed is not
   * the code shown (or someone else answered in the box). The box is closed at
   * once, and the code is spent.
   */
  | "wrong-code"
  /** Short code: no open box has this code (wrong first characters, expired, or used). The server cannot tell which. */
  | "unknown-code"
  /** Short code: the new device's code waited five minutes and nobody typed it. */
  | "expired-code"
  /** Short code: what was typed is not six characters of the alphabet. */
  | "invalid-code"
  /** Short code: the server does not announce `pairing-pake`. The QR of the device with the account still works. */
  | "server-without-short-code"
  /** Short code: the QR read names another server than this account's. */
  | "code-for-another-server"

/**
 * What the interface hears, in the order it happens.
 *
 * `aguarda`: the vault is open (host) and the link and QR can be shown.
 * `ligado`: both sides are in the vault. `sas`: the six words, to show in large
 * type. `estado` (guest only, phase 5): the certificate verified and the
 * account snapshot is arriving; the step "receiving your state". `certificado`:
 * the guest wrote the vault, and the interface can load the identity and
 * connect. `concluido`: done on both sides. `falhou`: it failed, with the reason.
 */
export type PairEvento =
  | { fase: "aguarda"; pairId: string; link: string }
  /**
   * Short code, new device only (1.3.26): the box is open and the code can be
   * shown, as text and in a QR (`link`). Comes again if the code had to be
   * drawn again (its nameplate was taken).
   */
  | { fase: "code"; code: string; link: string }
  | { fase: "ligado" }
  | { fase: "sas"; palavras: string }
  | { fase: "estado" }
  /**
   * `estado` only comes when the host announced the snapshot (a host on 0.5.7
   * does not announce it): "inteiro" if it arrived in time, "em-falta" if the
   * deadline passed or the parts did not close. In both cases the device joins;
   * the interface tells you.
   */
  /**
   * `palavraPasse` (1.3.26): "conta" when the host sent the account password
   * record, so the interface asks for the account password; "nova" when it did
   * not, so the interface asks for a new one. Absent from the core's own event,
   * filled by the session.
   */
  | { fase: "certificado"; address: string; estado?: "inteiro" | "em-falta"; palavraPasse?: "conta" | "nova" }
  | { fase: "concluido" }
  | { fase: "falhou"; razao: PairFalha }

/** What the guest learns at the end: what goes in the vault, and nothing more. */
export interface CofreDeAparelho {
  address: string
  homeserver: string
  /** Account PUBLIC key. */
  accountKey: Uint8Array
  /** The account signature over `deviceSigningPublicKey`. */
  deviceCert: Uint8Array
  /**
   * The account PRIVATE key, checked against `accountKey`. Absent with a host
   * before 1.3.16: the phone gets it later through the account channel
   * (`chaveDaConta.ts`).
   */
  accountPrivateKey?: Uint8Array
  deviceSigningPrivateKey: Uint8Array
  /**
   * The snapshot of the account state (phase 5), if the host sent it and it
   * arrived complete. Absent with a host on 0.5.7, or if the parts did not
   * arrive in time: the new device joins anyway, with empty state.
   */
  estado?: EstadoDeConta
  /**
   * The account password record (1.3.26): the new device asks for the account
   * password after pairing and checks it against this. Absent: a host before
   * 1.3.26, or one with no password; the new device chooses one.
   */
  palavraPasse?: PalavraPasseDaConta
}

/** How long to wait for the server in each step that has a reply. */
const PRAZO_MS = 15_000

/**
 * How long to wait for the snapshot parts after the certificate.
 *
 * The parts all leave together after the certificate, and the deadline covers
 * their travel. Exceeded, the device joins with no state, same as with a host
 * on 0.5.7: the account channel brings the rest after.
 */
export const PRAZO_DO_ESTADO_MS = 15_000

type Enviar = (frame: ClientFrame) => void

// ------------------------------------------------------------ the host

/** The account side of a short-code pairing, while CPace runs. See `AnfitriaoDeEmparelhamento.#onCpaceFrame`. */
interface HostCodeState {
  readonly code: string
  readonly nameplate: string
  stage: "joining" | "awaiting-a" | "awaiting-tag" | "done"
  /** CPace's result, between Yb going out and the new device's tag coming back. */
  result: CpaceResult | null
}

/**
 * The side that owns the account. See the file header.
 *
 * Receives `pair.*` frames from the `Session` socket through `receber`, and
 * sends back through `enviar`. What it does with the account key is in two
 * hooks that the `Session` gives it, because it knows how to publish manifests
 * and seat devices: `publicarManifestoCom(deviceKey)` and `assentar(deviceKey)`.
 */
export class AnfitriaoDeEmparelhamento {
  /** The box. With a short code, empty until the server finds the box (`pair.code.joined`). */
  pairId: string
  /** The QR link. Empty with a short code: here the code came from the other screen. */
  readonly link: string
  /**
   * The box key. With a QR, from the secret, at once; with a short code, from
   * CPace, only after the new device's confirmation tag verifies.
   */
  #chave: Uint8Array | null
  /**
   * Short code only (1.3.26): this side is CPace's responder. `transcricao`
   * goes into the words once CPace is done.
   */
  #code: HostCodeState | null = null
  #transcript: Uint8Array | null = null
  #pubConvidado: Uint8Array | null = null
  /** The guest already said yes. May arrive before this side says yes, and waits for it. */
  #simDoConvidado = false
  #fase: "a-abrir" | "aberta" | "ligada" | "sas" | "a-espera-do-sim" | "a-certificar" | "certificado" | "a-publicar" | "fim" =
    "a-abrir"
  #prazo: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly identity: AccountIdentity,
    servidor: string,
    formatarLink: (servidor: string, segredo: Uint8Array) => string,
    private readonly enviar: Enviar,
    private readonly emitir: (evento: PairEvento) => void,
    private readonly ganchos: {
      /**
       * Is there space in the manifest for one more device? Called BEFORE signing
       * anything. Throws `manifesto-cheio` if the account hit the cap, and
       * `manifesto` if the manifest was not read.
       */
      confirmarEspaco: () => Promise<void>
      /** Publish the manifest with this device added. Throws if it fails. */
      publicarManifestoCom: (deviceKey: Uint8Array) => Promise<void>
      /** Seat the new device in each channel of this account. Best-effort, never throws. */
      assentar: (deviceKey: Uint8Array) => Promise<void>
      /**
       * The snapshot of the account state, to send to the new device after the
       * certificate (phase 5). `null`, or a hook that throws, means pair with
       * no state: the certificate still goes out.
       */
      estado?: () => EstadoDeConta | null
      /** The new device said in `pronto` what it can do. */
      capacidades?: (deviceKey: Uint8Array, capacidades: readonly string[]) => void
      /** The account password record, for the new device (1.3.26). `null`: this vault has no password. */
      palavraPasse?: () => PalavraPasseDaConta | null
    },
    /**
     * Short code (1.3.26): the code the person typed, already normalized
     * (`normalizePairingCode`). Without it, the QR pairing: this
     * side makes the secret and shows it.
     */
    byCode?: { code: string },
  ) {
    if (byCode) {
      this.pairId = ""
      this.#chave = null
      this.link = ""
      this.#code = { code: byCode.code, nameplate: nameplateOf(byCode.code), stage: "joining", result: null }
      return
    }
    const segredo = gerarSegredoDeEmparelhamento()
    this.pairId = pairIdDe(segredo)
    this.#chave = chaveDeEmparelhamento(segredo, this.pairId)
    this.link = formatarLink(servidor, segredo)
  }

  get acabou(): boolean {
    return this.#fase === "fim"
  }

  abrir(): void {
    if (this.#code) this.enviar({ t: "pair.code.join", nameplate: this.#code.nameplate })
    else this.enviar({ t: "pair.open", pairId: this.pairId })
    this.#armarPrazo()
  }

  /** A frame from the server. `true` if it was for this vault and got handled. */
  receber(frame: ServerFrame): boolean {
    const code = this.#code
    if (code !== null && (frame.t === "pair.code.joined" || frame.t === "pair.code.rejected")) {
      if (frame.nameplate !== code.nameplate || code.stage !== "joining") return false
      if (this.#fase === "fim") return true
      if (frame.t === "pair.code.rejected") {
        this.#terminar(frame.reason === "unknown" ? "unknown-code" : "recusado:rate-limited")
        return true
      }
      this.pairId = frame.pairId
      code.stage = "awaiting-a"
      this.#fase = "ligada"
      this.emitir({ fase: "ligado" })
      // The new device speaks first (CPace's initiator): its Ya comes now.
      this.#armarPrazo()
      return true
    }
    if (!frame.t.startsWith("pair.") || !("pairId" in frame) || this.pairId === "" || frame.pairId !== this.pairId) return false
    if (this.#fase === "fim") return true
    if (code !== null && code.stage !== "done") {
      this.#onCpaceFrame(frame, code)
      return true
    }
    switch (frame.t) {
      case "pair.opened":
        this.#desarmarPrazo()
        this.#fase = "aberta"
        this.emitir({ fase: "aguarda", pairId: this.pairId, link: this.link })
        return true
      case "pair.rejected":
        this.#terminar(`recusado:${frame.reason}`)
        return true
      case "pair.joined":
        this.#fase = "ligada"
        this.emitir({ fase: "ligado" })
        // The host key goes out now: the guest needs it to compute the words.
        this.#mandar({ t: "chave-do-aparelho", deviceKey: toBase64(this.identity.deviceSigningPublicKey) })
        this.#armarPrazo()
        return true
      case "pair.message": {
        if (this.#chave === null) return true
        const payload = decifrarPairPayload(this.#chave, this.pairId, frame.payload)
        // What does not decrypt is not from our pair: ignore it. A server or
        // someone else in the vault sending garbage does not move forward or back.
        if (payload === null) return true
        this.#aoPayload(payload)
        return true
      }
      case "pair.closed":
        // After the certificate is delivered, the other side closing is the normal
        // end: the phone wrote the vault and went to connect. Before, it is a failure.
        // While publishing, the `pronto` already came and did its thing: ignore it.
        if (this.#fase === "a-publicar") return true
        if (this.#fase === "certificado") void this.#concluir()
        else this.#terminar(`fechado:${frame.reason}`)
        return true
      default:
        return true
    }
  }

  /**
   * The box during CPace (short code only). This side is the responder:
   * Ya comes, Yb and our tag go, the new device's tag comes. Anything else, or
   * a tag that does not verify, closes the box: one code, one guess.
   */
  #onCpaceFrame(frame: ServerFrame, code: HostCodeState): void {
    if (frame.t === "pair.closed") {
      // The new device closes the box when OUR tag does not verify there: in
      // the middle of CPace, a close is a wrong code far more often than anything else.
      this.#terminar(frame.reason === "expired" ? "tempo-esgotado" : "wrong-code")
      return
    }
    if (frame.t !== "pair.message") return
    const message = decodePake(frame.payload)
    if (message !== null && message.t === "pake-a" && code.stage === "awaiting-a") {
      const result = cpaceRespond(pairCodePrs(code.code), pairCodeCi(), { sid: message.sid, y: message.y })
      if (result === null) {
        this.#terminar("wrong-code")
        return
      }
      code.result = result
      code.stage = "awaiting-tag"
      this.#sendCpace(encodePake({ t: "pake-b", y: result.message.y, tag: result.tag }))
      this.#armarPrazo()
      return
    }
    if (message !== null && message.t === "pake-tag" && code.stage === "awaiting-tag" && code.result !== null) {
      if (!code.result.verifyPeerTag(message.tag)) {
        this.#terminar("wrong-code")
        return
      }
      this.#desarmarPrazo()
      // The ISK leaves memory here: only the box key, bound to this box, stays.
      this.#chave = pairCodeBoxKey(code.result.isk, this.pairId)
      this.#transcript = code.result.transcript
      code.result = null
      code.stage = "done"
      // From here the QR protocol, unchanged: our device key first.
      this.#mandar({ t: "chave-do-aparelho", deviceKey: toBase64(this.identity.deviceSigningPublicKey) })
      this.#armarPrazo()
      return
    }
    // Anything else in the middle of CPace (a second Ya, garbage, an encrypted
    // payload before the key): this is not the protocol, and the box dies.
    this.#terminar("wrong-code")
  }

  #sendCpace(payload: string): void {
    try {
      this.enviar({ t: "pair.send", pairId: this.pairId, payload })
    } catch {
      this.#terminar("sem-ligacao")
    }
  }

  #aoPayload(payload: PairPayload): void {
    switch (payload.t) {
      case "chave-do-aparelho": {
        if (this.#fase !== "ligada") return
        this.#desarmarPrazo()
        this.#pubConvidado = fromBase64(payload.deviceKey)
        this.#fase = "sas"
        this.emitir({
          fase: "sas",
          palavras:
            this.#transcript !== null
              ? pairCodeSasWords(this.pairId, this.identity.deviceSigningPublicKey, this.#pubConvidado, this.#transcript)
              : palavrasDoSas(this.pairId, this.identity.deviceSigningPublicKey, this.#pubConvidado),
        })
        return
      }
      case "confirmado":
        // The other side said yes. If this side has not said yes yet, mark it and
        // `confirmarSas()` will sign; if already done, sign now.
        if (this.#fase === "sas") {
          this.#simDoConvidado = true
          return
        }
        if (this.#fase !== "a-espera-do-sim") return
        void this.#assinar()
        return
      case "pronto":
        if (this.#fase !== "certificado") return
        if (payload.capacidades !== undefined && this.#pubConvidado !== null) {
          try {
            this.ganchos.capacidades?.(this.#pubConvidado, payload.capacidades)
          } catch {
            // Cleanup: a hook that fails does not stop pairing.
          }
        }
        void this.#concluir()
        return
      case "recusado":
        this.#terminar("palavras-diferentes")
        return
      case "certificado":
      case "estado":
        // A certificate or state arriving TO the host is the protocol backwards. Ignore it.
        return
    }
  }

  /**
   * The person confirmed the words on THIS screen.
   *
   * Do not sign here: wait for `confirmado` from the other side. What defends
   * the account is still this yes (the phone authorizes nothing), but signing
   * before it answers would leave a key in the manifest for each pairing that
   * died after. See the file header.
   */
  async confirmarSas(): Promise<void> {
    if (this.#fase !== "sas" || this.#pubConvidado === null) return
    this.#fase = "a-espera-do-sim"
    if (this.#simDoConvidado) {
      await this.#assinar()
      return
    }
    // The person needs to pick up the other device and press. One minute.
    this.#armarPrazo(60_000)
  }

  /**
   * Both yeses are given: confirm there is space in the account and sign the certificate.
   *
   * The space check comes first because it is the last chance to refuse free:
   * with the cap full, what you refuse here is a device that does not exist yet.
   * The manifest does NOT publish now: it publishes on `pronto`, when the phone
   * is already in.
   */
  async #assinar(): Promise<void> {
    const deviceKey = this.#pubConvidado
    if (this.#fase !== "a-espera-do-sim" || deviceKey === null) return
    this.#fase = "a-certificar"
    try {
      await this.ganchos.confirmarEspaco()
    } catch (erro) {
      this.#terminar((erro as Error).message === "manifesto-cheio" ? "manifesto-cheio" : "manifesto")
      return
    }
    if (this.#fase !== "a-certificar") return
    const deviceCert = signDeviceCert(this.identity.signingPrivateKey, deviceKey, this.identity.address)
    const partes = this.#partesDoEstado()
    this.#mandar({
      t: "certificado",
      address: this.identity.address,
      accountKey: toBase64(this.identity.signingPublicKey),
      deviceCert: toBase64(deviceCert),
      accountPrivateKey: toBase64(this.identity.signingPrivateKey),
      ...(partes.length > 0 ? { estado: partes.length } : {}),
      ...((): { palavraPasse?: PalavraPasseDaConta } => {
        try {
          const registo = this.ganchos.palavraPasse?.() ?? null
          return registo ? { palavraPasse: registo } : {}
        } catch {
          return {}
        }
      })(),
    })
    // The snapshot pieces follow the certificate immediately, through the same box and in order,
    // encrypted one by one like everything that passes through it.
    partes.forEach((dados, parte) => this.#mandar({ t: "estado", parte, dados }))
    this.#fase = "certificado"
    // Since 1.3.26 the new device asks for the account password before it connects: time to type it.
    this.#armarPrazo(5 * 60_000)
  }

  /**
   * The snapshot split for the mailbox, or no part at all.
   *
   * Never blocks pairing: a hook that fails pairs without state, like a host
   * version 0.5.7. A state too large for the cap arrives truncated to the
   * most recent (`cortarEstadoAteCaber`, M5), not empty.
   */
  #partesDoEstado(): string[] {
    try {
      const estado = this.ganchos.estado?.() ?? null
      return estado === null ? [] : partirEstado(estado)
    } catch {
      return []
    }
  }

  /** The person said the words are NOT the same. Alert the other side and burn the box. */
  recusarSas(): void {
    if (this.#fase === "fim") return
    this.#mandar({ t: "recusado" })
    this.#terminar("palavras-diferentes")
  }

  cancelar(): void {
    if (this.#fase === "fim") return
    this.#terminar("cancelado")
  }

  /**
   * The mobile said `ready`: it is inside the account, with the vault written and the
   * keys published. This is WHERE the v2 manifest publishes.
   *
   * After and not before, on purpose: until this moment nothing was written to the
   * account, and a pairing that died along the way left no trace. If publishing
   * fails now, the mobile already entered but is not seated on any channel, and
   * that is what the failure says.
   */
  async #concluir(): Promise<void> {
    const deviceKey = this.#pubConvidado
    if (this.#fase !== "certificado" || deviceKey === null) return
    this.#fase = "a-publicar"
    this.#desarmarPrazo()
    try {
      await this.ganchos.publicarManifestoCom(deviceKey)
    } catch {
      this.#terminar("manifesto")
      return
    }
    if (this.#fase !== "a-publicar") return
    this.#fase = "fim"
    this.#fechar()
    this.emitir({ fase: "concluido" })
    // Seating on channels is background work: each channel is a claim and a commit,
    // and the interface already said it is done.
    void this.ganchos.assentar(deviceKey)
  }

  #terminar(razao: PairFalha): void {
    if (this.#fase === "fim") return
    this.#fase = "fim"
    this.#desarmarPrazo()
    this.#fechar()
    this.emitir({ fase: "falhou", razao })
  }

  #fechar(): void {
    // A short code the server never found: there is no box to close.
    if (this.pairId === "") return
    try {
      this.enviar({ t: "pair.close", pairId: this.pairId })
    } catch {
      // Without a connection there is no box to close: the server burns it itself.
    }
  }

  #mandar(payload: PairPayload): void {
    // No key yet (short code before CPace) means nothing encrypted can leave.
    if (this.#chave === null) return
    try {
      this.enviar({ t: "pair.send", pairId: this.pairId, payload: cifrarPairPayload(this.#chave, this.pairId, payload) })
    } catch {
      this.#terminar("sem-ligacao")
    }
  }

  #armarPrazo(ms = PRAZO_MS): void {
    this.#desarmarPrazo()
    this.#prazo = setTimeout(() => this.#terminar("tempo-esgotado"), ms)
  }

  #desarmarPrazo(): void {
    if (this.#prazo !== null) clearTimeout(this.#prazo)
    this.#prazo = null
  }
}

// ------------------------------------------------------------ the guest

/** How many codes the new device draws when the server says the nameplate is taken. */
const CODE_DRAWS = 5

/** The new device's side of a short-code pairing, until the box key exists. */
interface GuestCodeState {
  readonly formatLink: (server: string, code: string) => string
  code: string
  draws: number
  /** CPace's initiator state, between Ya going out and Yb coming back. Holds the secret scalar. */
  state: CpaceStateA | null
  stage: "opening" | "awaiting-account" | "awaiting-b" | "done"
}

/**
 * The new side, no account. Opens its own socket to the link server.
 *
 * Ends with `resultado` resolving what goes to the vault, or rejecting with
 * the reason. The mailbox stays open until `pronto()`, which the interface
 * calls AFTER writing the vault, loading the identity and connecting to
 * `Session` (with key packages published): at that point the host can place
 * this device on the channels.
 */
export class ConvidadoDeEmparelhamento {
  /** The box. With a short code, random, and drawn again with the code if its nameplate was taken. */
  pairId: string
  readonly servidor: string
  /** The box key: from the QR secret at once, or from CPace after the other side's tag verifies. */
  #chave: Uint8Array | null
  /**
   * Short code only (1.3.26): this side makes the code and is CPace's
   * initiator. `null` in a QR pairing.
   */
  #code: GuestCodeState | null = null
  #transcript: Uint8Array | null = null
  readonly #deviceSigningPrivateKey: Uint8Array
  readonly #deviceSigningPublicKey: Uint8Array
  #socket: WebSocket | null = null
  /**
   * The mailbox closed (or the socket fell) AFTER the certificate and BEFORE
   * our `pronto`. In normal pairing that's fine: the certificate is good and
   * you log in. But whoever closes at that point is the computer, which gave
   * up or ran out of time waiting for `pronto`, and no longer publishes this
   * device in the manifest. "Merge accounts" (phase 8.2) asks about it before
   * deleting the local account: see `caixaAberta`.
   */
  #caixaFechada = false
  #pubAnfitriao: Uint8Array | null = null
  #certificado: CofreDeAparelho | null = null
  /** The snapshot parts, by position, as they arrive. See `#aplicarCertificado`. */
  #partesDoEstado: (string | undefined)[] = []
  #fase:
    | "a-ligar"
    | "a-juntar"
    | "ligada"
    | "sas"
    | "a-espera-do-certificado"
    | "a-receber-estado"
    | "certificado"
    | "fim" = "a-ligar"
  #prazo: ReturnType<typeof setTimeout> | null = null
  #resolver!: (cofre: CofreDeAparelho) => void
  #rejeitar!: (razao: Error) => void
  /** What goes into the vault, when the certificate arrives and closes. */
  readonly resultado: Promise<CofreDeAparelho>

  constructor(
    /**
     * A QR pairing: the server and secret read from the other device's link.
     * A short-code pairing (1.3.26): the server this device uses, and how to
     * write the code's QR link; the code is drawn here.
     */
    link: { server: string; segredo: Uint8Array } | { server: string; byCode: { formatLink: (server: string, code: string) => string } },
    private readonly urlDoGateway: (servidor: string) => string,
    /** Are two server names the same server? The canonical rule lives in the core. */
    private readonly mesmoServidor: (a: string, b: string) => boolean,
    private readonly emitir: (evento: PairEvento) => void,
    deviceSigningPrivateKey: Uint8Array = generateDeviceKey().privateKey,
  ) {
    this.servidor = link.server
    if ("segredo" in link) {
      this.pairId = pairIdDe(link.segredo)
      this.#chave = chaveDeEmparelhamento(link.segredo, this.pairId)
    } else {
      this.pairId = ""
      this.#chave = null
      this.#code = { formatLink: link.byCode.formatLink, code: "", draws: 0, state: null, stage: "opening" }
      this.#drawCode()
    }
    this.#deviceSigningPrivateKey = deviceSigningPrivateKey
    this.#deviceSigningPublicKey = devicePublicKeyOf(deviceSigningPrivateKey)
    this.resultado = new Promise((resolve, reject) => {
      this.#resolver = resolve
      this.#rejeitar = reject
    })
    // An unexpected result cannot crash the process.
    this.resultado.catch(() => {})
  }

  get deviceSigningPublicKey(): Uint8Array {
    return this.#deviceSigningPublicKey
  }

  /** The short code this device shows, or `null` in a QR pairing. */
  get code(): string | null {
    return this.#code?.code ?? null
  }

  /** A fresh code and a fresh box id, both from the CSPRNG. */
  #drawCode(): void {
    const code = this.#code
    if (!code) return
    code.code = generatePairingCode()
    code.draws++
    this.pairId = pairIdDe(globalThis.crypto.getRandomValues(new Uint8Array(32)))
  }

  #openByCode(): void {
    const code = this.#code
    if (!code) return
    this.#enviar({ t: "pair.code.open", nameplate: nameplateOf(code.code), pairId: this.pairId })
  }

  /**
   * Opens the socket, does `hello`, checks capacity, and `pair.join`.
   *
   * `versaoDaApp` goes in `hello`: a server with minimum version
   * (`ENCLAVE_VERSAO_MINIMA_DO_CLIENTE`, 1.0 "Arca") rejects a `hello` without
   * it, and rejected pairing from 1.0 itself. See `Session` (`versaoDaApp`).
   */
  ligar(versaoDaApp?: string): void {
    let socket: WebSocket
    try {
      socket = new WebSocket(this.urlDoGateway(this.servidor))
    } catch {
      this.#terminar("sem-ligacao")
      return
    }
    this.#socket = socket
    this.#armarPrazo()
    socket.addEventListener("open", () => {
      this.#enviar({ t: "hello", version: PROTOCOL_VERSION, ...(versaoDaApp ? { versao: versaoDaApp } : {}) })
    })
    socket.addEventListener("error", () => {
      if (this.#fase === "a-ligar") this.#terminar("sem-ligacao")
    })
    socket.addEventListener("close", () => {
      if (this.#socket !== socket) return
      this.#socket = null
      // Halfway through the snapshot, the certificate is already good: enter with what arrived.
      if (this.#fase === "a-receber-estado") this.#entregar()
      else if (this.#fase === "certificado") this.#caixaFechada = true
      else if (this.#fase !== "fim") this.#terminar("sem-ligacao")
    })
    socket.addEventListener("message", (event) => {
      let frame: ServerFrame
      try {
        frame = JSON.parse(String((event as MessageEvent).data)) as ServerFrame
      } catch {
        return
      }
      this.#receber(frame)
    })
  }

  #receber(frame: ServerFrame): void {
    if (this.#fase === "fim") return
    if (frame.t === "hello.ok") {
      if (this.#fase !== "a-ligar") return
      if (this.#code) {
        // A server that does not know short codes: the person uses the QR of the other device.
        if (!frame.capabilities.includes(CAPABILITY_PAIRING_PAKE)) {
          this.#terminar("server-without-short-code")
          return
        }
        this.#fase = "a-juntar"
        this.#openByCode()
        return
      }
      if (!frame.capabilities.includes(CAPACIDADE_EMPARELHAMENTO)) {
        this.#terminar("servidor-sem-emparelhamento")
        return
      }
      this.#fase = "a-juntar"
      this.#enviar({ t: "pair.join", pairId: this.pairId })
      return
    }
    if (frame.t === "error") {
      // After the certificate the box may be gone (the computer gave up), and the
      // server then closes this socket with `login-timeout`: the close handler
      // already notes it (`#caixaFechada`), and the pairing itself did not fail.
      if (frame.fatal && this.#fase !== "certificado") this.#terminar("sem-ligacao")
      return
    }
    if (!frame.t.startsWith("pair.") || !("pairId" in frame) || frame.pairId !== this.pairId) return
    const code = this.#code
    if (code !== null && code.stage !== "done") {
      this.#onCodeFrame(frame, code)
      return
    }
    switch (frame.t) {
      case "pair.rejected":
        this.#terminar(`recusado:${frame.reason}`)
        return
      case "pair.joined":
        this.#desarmarPrazo()
        this.#fase = "ligada"
        this.emitir({ fase: "ligado" })
        this.#mandar({ t: "chave-do-aparelho", deviceKey: toBase64(this.#deviceSigningPublicKey) })
        this.#armarPrazo()
        return
      case "pair.message": {
        if (this.#chave === null) return
        const payload = decifrarPairPayload(this.#chave, this.pairId, frame.payload)
        if (payload === null) return
        this.#aoPayload(payload)
        return
      }
      case "pair.closed":
        // While receiving state, the certificate is already good: the box closing only
        // trims the snapshot, and it enters with what arrived.
        if (this.#fase === "a-receber-estado") {
          this.#entregar()
          return
        }
        if (this.#fase === "certificado") this.#caixaFechada = true
        else this.#terminar(`fechado:${frame.reason}`)
        return
      default:
        return
    }
  }

  /**
   * The box before the key, with a short code: open, wait for the account,
   * then CPace as the initiator. One guess per box: a tag that does not
   * verify, or anything out of order, closes it.
   */
  #onCodeFrame(frame: ServerFrame, code: GuestCodeState): void {
    switch (frame.t) {
      case "pair.opened":
        if (code.stage !== "opening") return
        this.#desarmarPrazo()
        code.stage = "awaiting-account"
        // No deadline here: the server's five minutes are the code's life.
        this.emitir({ fase: "code", code: code.code, link: code.formatLink(this.servidor, code.code) })
        return
      case "pair.rejected":
        // Another code waiting has this nameplate (or the id is taken): draw again, a few times.
        if (frame.reason === "exists" && code.stage === "opening" && code.draws < CODE_DRAWS) {
          this.#drawCode()
          this.#openByCode()
          return
        }
        this.#terminar(`recusado:${frame.reason}`)
        return
      case "pair.closed":
        if (code.stage === "awaiting-account") this.#terminar(frame.reason === "expired" ? "expired-code" : `fechado:${frame.reason}`)
        // In the middle of CPace the other side closed: it saw our tag fail.
        else this.#terminar("wrong-code")
        return
      case "pair.joined": {
        if (code.stage !== "awaiting-account") return
        code.state = cpaceStart(pairCodePrs(code.code), pairCodeCi())
        code.stage = "awaiting-b"
        this.emitir({ fase: "ligado" })
        this.#enviar({ t: "pair.send", pairId: this.pairId, payload: encodePake({ t: "pake-a", ...code.state.message }) })
        this.#armarPrazo()
        return
      }
      case "pair.message": {
        const message = decodePake(frame.payload)
        const state = code.state
        if (message === null || message.t !== "pake-b" || code.stage !== "awaiting-b" || state === null) {
          this.#terminar("wrong-code")
          return
        }
        const result = cpaceFinish(state, { y: message.y })
        code.state = null
        if (result === null || !result.verifyPeerTag(message.tag)) {
          this.#terminar("wrong-code")
          return
        }
        this.#desarmarPrazo()
        // Our tag first, so the other side can check it; then the key, and the QR protocol from here.
        this.#enviar({ t: "pair.send", pairId: this.pairId, payload: encodePake({ t: "pake-tag", tag: result.tag }) })
        this.#chave = pairCodeBoxKey(result.isk, this.pairId)
        this.#transcript = result.transcript
        code.stage = "done"
        this.#fase = "ligada"
        this.#mandar({ t: "chave-do-aparelho", deviceKey: toBase64(this.#deviceSigningPublicKey) })
        this.#armarPrazo()
        return
      }
      default:
        return
    }
  }

  #aoPayload(payload: PairPayload): void {
    switch (payload.t) {
      case "chave-do-aparelho":
        if (this.#fase !== "ligada") return
        this.#desarmarPrazo()
        this.#pubAnfitriao = fromBase64(payload.deviceKey)
        this.#fase = "sas"
        this.emitir({
          fase: "sas",
          palavras:
            this.#transcript !== null
              ? pairCodeSasWords(this.pairId, this.#pubAnfitriao, this.#deviceSigningPublicKey, this.#transcript)
              : palavrasDoSas(this.pairId, this.#pubAnfitriao, this.#deviceSigningPublicKey),
        })
        return
      case "certificado": {
        // Only after the person has confirmed HERE, and the host signs only after the
        // `confirmed` arrives there: a certificate before this screen's yes is a host
        // that did not wait, and does not apply.
        if (this.#fase !== "a-espera-do-certificado") return
        this.#aplicarCertificado(payload)
        return
      }
      case "estado": {
        if (this.#fase !== "a-receber-estado") return
        if (payload.parte >= this.#partesDoEstado.length) return
        this.#partesDoEstado[payload.parte] = payload.dados
        if (this.#partesDoEstado.every((parte) => parte !== undefined)) this.#entregar()
        return
      }
      case "recusado":
        // After the certificate, a refusal undoes nothing: the person already said yes
        // on both screens. Only before it counts.
        if (this.#fase === "a-receber-estado") return
        this.#terminar("palavras-diferentes")
        return
      case "confirmado":
      case "pronto":
        return
    }
  }

  #aplicarCertificado(payload: Extract<PairPayload, { t: "certificado" }>): void {
    this.#desarmarPrazo()
    const accountKey = fromBase64(payload.accountKey)
    const deviceCert = fromBase64(payload.deviceCert)
    // The entire chain, before writing anything: the address must be the account
    // hash, and the signature must be over OUR device key. A host that signs
    // something else did not certify us, and a vault written with that does not
    // open on any connection.
    if (
      !verifyDeviceChain({
        address: payload.address,
        accountKey,
        deviceKey: this.#deviceSigningPublicKey,
        signature: deviceCert,
      })
    ) {
      this.#terminar("cadeia-invalida")
      return
    }
    const homeserver = payload.address.slice(payload.address.indexOf(":") + 1)
    // And the server at the address must be the link server. The signature proves
    // the account certified this key; it does not prove it is the account we
    // retrieved. Without this, a host could certify this device for an account on
    // ANOTHER server, and the vault would be written there.
    if (!this.mesmoServidor(homeserver, this.servidor)) {
      this.#terminar("cadeia-invalida")
      return
    }
    // The account private key, when the host sends it (1.3.16), must be the private
    // half of the account the chain names. One that does not close is a host that
    // sent something else: the pairing fails, it does not go on without the key.
    let accountPrivateKey: Uint8Array | undefined
    if (payload.accountPrivateKey !== undefined) {
      accountPrivateKey = fromBase64(payload.accountPrivateKey)
      if (!privadaDaConta(accountPrivateKey, accountKey)) {
        this.#terminar("cadeia-invalida")
        return
      }
    }
    this.#certificado = {
      address: payload.address,
      homeserver,
      accountKey,
      deviceCert,
      deviceSigningPrivateKey: this.#deviceSigningPrivateKey,
      ...(accountPrivateKey ? { accountPrivateKey } : {}),
      ...(payload.palavraPasse ? { palavraPasse: payload.palavraPasse } : {}),
    }
    /*
      The snapshot comes after, in pieces, if the host sends it (phase 5). A
      0.5.7 host does not say `state` and it enters already, as always. With
      pieces announced it waits for them, with a timeout; what does not arrive
      by the timeout is to enter without state, never fail pairing because of it.
    */
    if (payload.estado !== undefined) {
      this.#partesDoEstado = new Array<string | undefined>(payload.estado).fill(undefined)
      this.#fase = "a-receber-estado"
      this.emitir({ fase: "estado" })
      this.#prazo = setTimeout(() => this.#entregar(), PRAZO_DO_ESTADO_MS)
      return
    }
    this.#entregar()
  }

  /** The certificate (and the state, if it arrived complete) for those waiting, and the interface alerted. */
  #entregar(): void {
    const certificado = this.#certificado
    if (certificado === null || (this.#fase !== "a-receber-estado" && this.#fase !== "a-espera-do-certificado")) return
    this.#desarmarPrazo()
    let chegou: "inteiro" | "em-falta" | undefined
    if (this.#partesDoEstado.length > 0) {
      const estado = juntarEstado(this.#partesDoEstado)
      if (estado !== null) certificado.estado = estado
      chegou = estado !== null ? "inteiro" : "em-falta"
      this.#partesDoEstado = []
    }
    this.#fase = "certificado"
    this.emitir({ fase: "certificado", address: certificado.address, ...(chegou ? { estado: chegou } : {}) })
    this.#resolver(certificado)
  }

  /** The account password record that came with the certificate (1.3.26), or `null`. */
  get palavraPasseRecebida(): PalavraPasseDaConta | null {
    return this.#certificado?.palavraPasse ?? null
  }

  /** The person confirmed the words on THIS screen. Tell the host and wait for the certificate. */
  confirmarSas(): void {
    if (this.#fase !== "sas") return
    this.#fase = "a-espera-do-certificado"
    this.#mandar({ t: "confirmado" })
    // The host can take time: the person still has to confirm there, and it reads the
    // manifest (one round trip to the server) before signing. One minute.
    this.#armarPrazo(60_000)
  }

  recusarSas(): void {
    if (this.#fase === "fim") return
    this.#mandar({ t: "recusado" })
    this.#terminar("palavras-diferentes")
  }

  cancelar(): void {
    if (this.#fase === "fim") return
    this.#terminar("cancelado")
  }

  /** The certificate arrived and the computer still waits for `ready`. */
  get caixaAberta(): boolean {
    return this.#fase === "certificado" && !this.#caixaFechada && this.#socket?.readyState === 1
  }

  /**
   * The vault is written and the account linked: tell the host it can seat this
   * device, and close the box and the socket.
   */
  pronto(): void {
    if (this.#fase !== "certificado") return
    this.#mandar({ t: "pronto", capacidades: [CAPACIDADE_ESTADO_DA_CONTA] })
    this.#fase = "fim"
    this.#desarmarPrazo()
    this.#fecharCaixa()
    this.emitir({ fase: "concluido" })
    this.#fecharSocket()
  }

  #terminar(razao: PairFalha): void {
    if (this.#fase === "fim") return
    this.#fase = "fim"
    this.#desarmarPrazo()
    this.#fecharCaixa()
    this.#fecharSocket()
    this.emitir({ fase: "falhou", razao })
    this.#rejeitar(new Error(razao))
  }

  #fecharCaixa(): void {
    if (this.#socket?.readyState === 1 && this.pairId !== "") this.#enviar({ t: "pair.close", pairId: this.pairId })
  }

  #fecharSocket(): void {
    const socket = this.#socket
    this.#socket = null
    try {
      socket?.close()
    } catch {
      // Already closed.
    }
  }

  #enviar(frame: ClientFrame): void {
    if (this.#socket?.readyState !== 1) {
      if (this.#fase !== "fim") this.#terminar("sem-ligacao")
      return
    }
    this.#socket.send(JSON.stringify(frame))
  }

  #mandar(payload: PairPayload): void {
    if (this.#chave === null) return
    this.#enviar({ t: "pair.send", pairId: this.pairId, payload: cifrarPairPayload(this.#chave, this.pairId, payload) })
  }

  #armarPrazo(ms = PRAZO_MS): void {
    this.#desarmarPrazo()
    this.#prazo = setTimeout(() => this.#terminar("tempo-esgotado"), ms)
  }

  #desarmarPrazo(): void {
    if (this.#prazo !== null) clearTimeout(this.#prazo)
    this.#prazo = null
  }
}
