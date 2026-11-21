/**
 * A refusal by the operating system stops the call before the capture, with its own key.
 *
 * macOS (TCC) refuses the microphone without failing `getUserMedia`: the track
 * is live and carries silence. The host reads the state first
 * (`permissaoDoSistema`), and the call says which device and where to turn it on,
 * instead of starting mute with no error (1.3.25, Intel Mac).
 */
import type { Payload, UserAddress } from "@enclave/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Call, type CallBridge, type MediaKeyMaterial } from "./call.js"
import { CHAVES_DA_RECUSA_DO_SISTEMA, type DispositivoRecusado } from "./recusa-do-sistema.js"

class FakePeerConnection {
  localDescription: unknown = null
  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  constructor(public config: unknown) {}
  addTrack(): unknown {
    return {}
  }
  async createOffer(): Promise<unknown> {
    return { type: "offer", sdp: "v=0\r\n" }
  }
  async setLocalDescription(): Promise<void> {}
  close(): void {}
}

function fluxo(): MediaStream {
  const audio = { kind: "audio", enabled: true, stop: vi.fn() }
  return {
    getTracks: () => [audio],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [],
  } as unknown as MediaStream
}

const EU = "@eu:enclave.test" as UserAddress
const CANAL = "!geral:enclave.test"

function ponte(recusado: DispositivoRecusado | null, perguntas: boolean[]): CallBridge {
  return {
    selfAddress: EU,
    async sendSignal(_channel: string, _payload: Payload) {},
    async mediaKey(): Promise<MediaKeyMaterial | null> {
      return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
    },
    async reservarContadorSframe(): Promise<number> {
      return 0
    },
    async setMediaActive() {},
    async permissaoDoSistema(video: boolean) {
      perguntas.push(video)
      return recusado
    },
  } as unknown as CallBridge
}

const getUserMedia = vi.fn(async () => fluxo())

beforeEach(() => {
  getUserMedia.mockClear()
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("RTCRtpSender", class {})
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } })
})

describe("a recusa do sistema", () => {
  it("o microfone recusado não abre captura e diz a chave do microfone", async () => {
    const perguntas: boolean[] = []
    const call = new Call(ponte("microfone", perguntas))
    const erros: Array<{ detail: string }> = []
    call.on("error", (evento) => erros.push(evento))

    await expect(call.join(CANAL)).rejects.toThrow(CHAVES_DA_RECUSA_DO_SISTEMA.microfone)
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(perguntas).toEqual([false])
    expect(erros.map((erro) => erro.detail)).toEqual(["the system does not allow the microphone"])
  })

  it("com vídeo pergunta pela câmara, e a recusa dela tem a sua chave", async () => {
    const perguntas: boolean[] = []
    const call = new Call(ponte("camara", perguntas))
    const erros: Array<{ detail: string }> = []
    call.on("error", (evento) => erros.push(evento))

    await expect(call.join(CANAL, { video: true })).rejects.toThrow()
    expect(perguntas).toEqual([true])
    expect(erros.map((erro) => erro.detail)).toEqual(["the system does not allow the camera"])
  })

  it("concedido, a captura segue como antes", async () => {
    const perguntas: boolean[] = []
    const call = new Call(ponte(null, perguntas))
    await call.join(CANAL)
    expect(perguntas).toEqual([false])
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it("a prévia e a entrada na chamada ao mesmo tempo fazem uma só pergunta ao sistema", async () => {
    // The preview does not go through the join queue. Two questions while macOS
    // has no answer can be two dialogs (1.3.25, Mac M1).
    let responder: (valor: DispositivoRecusado | null) => void = () => {}
    let perguntas = 0
    const bridge = {
      ...ponte(null, []),
      permissaoDoSistema: () => {
        perguntas += 1
        return new Promise<DispositivoRecusado | null>((resolver) => (responder = resolver))
      },
    } as unknown as CallBridge
    const call = new Call(bridge)
    const ligacoes = (call.audio as unknown as { ligacoes: { abrirMicrofone: () => Promise<MediaStream> } }).ligacoes
    const previa = ligacoes.abrirMicrofone()
    const entrada = call.join(CANAL)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(perguntas).toBe(1)
    responder(null)
    await Promise.all([previa, entrada])
    expect(perguntas).toBe(1)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  it("acabada a pergunta, a chamada seguinte lê o estado outra vez", async () => {
    const perguntas: boolean[] = []
    const call = new Call(ponte(null, perguntas))
    await call.join(CANAL)
    await call.leave()
    await call.join(CANAL)
    expect(perguntas).toEqual([false, false])
  })
})
