import { ambitoDaChamada, type Payload, type UserAddress } from "@enclave/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Call, type CallBridge, type MediaKeyMaterial } from "./call.js"
import {
  CHAMADA_NOUTRO_APARELHO,
  RecusaDoSfu,
  type ConsumidorDeMedia,
  type DispositivoDeMedia,
  type ParametrosDoTransporte,
  type ProdutorDeMedia,
  type TransporteDeMedia,
} from "./call-sfu.js"

/**
 * One call per account, as in Discord (1.3.25): the device that lost the call.
 *
 * The server already closed this device's call because the account joined one
 * on another device (see `sfu-uma-chamada.test.ts` in the server). What is
 * measured here is the other half: this device LEAVES, says why, and does not
 * try to rebuild the call, neither on the notice (`sfu.scope.closed`) nor on the
 * refusal (`noutro-aparelho`) of a rebuild or a resynchronisation that came
 * after a notice that was lost.
 *
 * And the join a person asks for says so (`tomar`), while the automatic one
 * (the rebuild) does not: that is what lets the server tell them apart.
 */

// -------------------------------------------------------------------- stubs

class FakePeerConnection {
  static instances: FakePeerConnection[] = []
  localDescription: { type: string; sdp: string } | null = null
  connectionState = "new"
  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor() {
    FakePeerConnection.instances.push(this)
  }
  addTrack(): unknown {
    return {}
  }
  addTransceiver(): unknown {
    return { sender: {} }
  }
  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "v=0\r\n" }
  }
  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: "v=0\r\n" }
  }
  async setLocalDescription(d: { type: string; sdp: string }): Promise<void> {
    this.localDescription = d
  }
  async setRemoteDescription(): Promise<void> {}
  async addIceCandidate(): Promise<void> {}
  close(): void {}
}

function fakeStream(): MediaStream {
  const audio = { kind: "audio", enabled: true, stop: vi.fn() }
  return {
    getTracks: () => [audio],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [],
  } as unknown as MediaStream
}

const ALICE = "@alice:s" as UserAddress
const BRUNO = "@bruno:s" as UserAddress
const CARLA = "@carla:s" as UserAddress
const CANAL = "!geral:s"

/** The `mediasoup-client` pretending. Only what is needed to set up the call. */
class DispositivoFalso implements DispositivoDeMedia {
  readonly rtpCapabilities = { codecs: [] }
  async load(): Promise<void> {}
  canProduce(): boolean {
    return true
  }
  #transporte(id: string): TransporteDeMedia {
    let aoLigar: ((d: { dtlsParameters: unknown }, feito: () => void, falhou: (e: Error) => void) => void) | null = null
    let aoProduzir:
      | ((
          d: { kind: "audio" | "video"; rtpParameters: unknown; appData: Record<string, unknown> },
          feito: (r: { id: string }) => void,
          falhou: (e: Error) => void,
        ) => void)
      | null = null

    const fecharDtls = async (): Promise<void> => {
      const ligar = aoLigar
      aoLigar = null
      if (ligar) await new Promise<void>((resolve, reject) => ligar({ dtlsParameters: {} }, resolve, reject))
    }

    return {
      id,
      on: (evento: "connect" | "produce", ouvinte: never) => {
        if (evento === "connect") aoLigar = ouvinte
        else aoProduzir = ouvinte
      },
      produce: async (opcoes): Promise<ProdutorDeMedia> => {
        // Like `mediasoup-client`: the sender is born before the offer and goes to `onRtpSender` (SEC-02).
        const emissor = {
          createEncodedStreams: () => ({ readable: new ReadableStream(), writable: new WritableStream() }),
        } as unknown as RTCRtpSender
        opcoes.onRtpSender?.(emissor)
        await fecharDtls()
        const feito = await new Promise<{ id: string }>((resolve, reject) =>
          aoProduzir?.(
            { kind: opcoes.track.kind as "audio" | "video", rtpParameters: {}, appData: opcoes.appData ?? {} },
            resolve,
            reject,
          ),
        )
        return { id: feito.id, rtpSender: emissor, close: () => {} }
      },
      consume: async (opcoes): Promise<ConsumidorDeMedia> => {
        await fecharDtls()
        return {
          id: opcoes.id,
          producerId: opcoes.producerId,
          track: { kind: "audio" } as MediaStreamTrack,
          rtpReceiver: {
            createEncodedStreams: () => ({ readable: new ReadableStream(), writable: new WritableStream() }),
          } as unknown as RTCRtpReceiver,
          close: () => {},
        }
      },
      close: () => {},
    }
  }
  createSendTransport(o: ParametrosDoTransporte): TransporteDeMedia {
    return this.#transporte(o.id)
  }
  createRecvTransport(o: ParametrosDoTransporte): TransporteDeMedia {
    return this.#transporte(o.id)
  }
}

interface Ponte extends CallBridge {
  sent: Payload[]
  pedidosSfu: string[]
}

/** Set a code here and every `sfu.scope.join` from then on is refused with it, as the gateway does. */
const recusarEntrada: { codigo: string | null } = { codigo: null }

/** A bridge with SFU, which is the only path where the roster exists. */
function ponte(selfAddress: UserAddress): Ponte {
  const sent: Payload[] = []
  const pedidosSfu: string[] = []
  return {
    selfAddress,
    sent,
    pedidosSfu,
    async sendSignal(_canal, payload) {
      sent.push(payload)
    },
    async mediaKey(): Promise<MediaKeyMaterial | null> {
      return { keyId: 41, senderId: 0, material: new Uint8Array(32).fill(7) }
    },
    async reservarContadorSframe(): Promise<number> {
      return 0
    },
    sfu: {
      suportaSfu: () => true,
      criarDispositivo: () => new DispositivoFalso(),
      async sfuEntrarNoAmbito(canal, ambito, opcoes) {
        pedidosSfu.push(`scope.join:${canal}:${ambito}${opcoes?.tomar === true ? ":tomar" : ""}`)
        if (recusarEntrada.codigo) throw new RecusaDoSfu(recusarEntrada.codigo, "esta conta está numa chamada noutro aparelho")
        return { rtpCapabilities: {}, producers: [] }
      },
      sfuSairDoAmbito(canal, ambito) {
        pedidosSfu.push(`scope.leave:${canal}:${ambito}`)
      },
      async sfuCriarTransporte(_c, _a, sentido) {
        pedidosSfu.push(`transport.create:${sentido}`)
        return { id: `t-${sentido}`, iceParameters: {}, iceCandidates: [], dtlsParameters: {} }
      },
      async sfuLigarTransporte(transporte) {
        pedidosSfu.push(`transport.connect:${transporte}`)
      },
      async sfuProduzir(_t, _kind, _rtp, fonte) {
        pedidosSfu.push(`produce:${fonte ?? "sem-fonte"}`)
        return `p-${fonte ?? "nosso"}`
      },
      async sfuFecharProdutor(produtor) {
        pedidosSfu.push(`produce.close:${produtor}`)
      },
      async sfuConsumir(_t, produtor) {
        pedidosSfu.push(`consume:${produtor}`)
        return { id: `c-${produtor}`, producerId: produtor, kind: "audio" as const, rtpParameters: {} }
      },
      async sfuRetomar(_t, consumidor) {
        pedidosSfu.push(`resume:${consumidor}`)
      },
      // The symmetric case. Missing, any path that reached `largarEcraDe` would blow
      // up with "sfuPausar is not a function", caught by the method's own
      // `try/catch` and reduced to a diagnosis: green on the call that never
      // happened. These tests are not typechecked by anyone.
      async sfuPausar(_t, consumidor) {
        pedidosSfu.push(`pause:${consumidor}`)
      },
    },
  }
}

/** A join announcement, like the one that travels encrypted inside MLS. */
function anuncioDe(): Payload {
  return { t: "voice.join", at: Date.now(), video: false, sframe: true, alone: false } as Payload
}

beforeEach(() => {
  recusarEntrada.codigo = null
  FakePeerConnection.instances = []
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  class MotorQueCifra {
    createEncodedStreams(): unknown {
      return { readable: new ReadableStream(), writable: new WritableStream() }
    }
  }
  vi.stubGlobal("RTCRtpSender", MotorQueCifra)
  vi.stubGlobal("RTCRtpReceiver", MotorQueCifra)
  vi.stubGlobal(
    "MediaStream",
    class {
      readonly tracks: MediaStreamTrack[]
      constructor(tracks: MediaStreamTrack[] = []) {
        this.tracks = [...tracks]
      }
      getTracks(): MediaStreamTrack[] {
        return [...this.tracks]
      }
      getVideoTracks(): MediaStreamTrack[] {
        return this.tracks.filter((faixa) => faixa.kind === "video")
      }
      addTrack(): void {}
      removeTrack(): void {}
    },
  )
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => fakeStream() },
  })
})


const ESCOPO = ambitoDaChamada(CANAL, "")

/** Everything a call says to the screen, in order. */
function escutar(call: Call): { erros: string[]; fins: number; diagnosticos: string[] } {
  const registo = { erros: [] as string[], fins: 0, diagnosticos: [] as string[] }
  call.on("error", (evento) => registo.erros.push(evento.detail))
  call.on("ended", () => registo.fins++)
  call.on("diagnostic", (evento) => registo.diagnosticos.push(evento.code))
  return registo
}

const entradas = (p: Ponte): string[] => p.pedidosSfu.filter((pedido) => pedido.startsWith("scope.join:"))
const despedidas = (p: Ponte): Payload[] => p.sent.filter((payload) => payload.t === "voice.leave")

describe("uma chamada por conta: o aparelho que perde a chamada", () => {
  it("a entrada que a pessoa pede leva `tomar`; a reconstrução não", async () => {
    const p = ponte(ALICE)
    const alice = new Call(p)
    await alice.join(CANAL)
    expect(entradas(p)).toEqual([`scope.join:${CANAL}:${ESCOPO}:tomar`])

    await alice.ligacaoVoltou()
    expect(entradas(p)).toEqual([`scope.join:${CANAL}:${ESCOPO}:tomar`, `scope.join:${CANAL}:${ESCOPO}`])
    await alice.leave()
  })

  it("o aviso do servidor (outra chamada): sai, despede-se, diz porquê, e não religa", async () => {
    const p = ponte(ALICE)
    const alice = new Call(p)
    const registo = escutar(alice)
    await alice.join(CANAL)

    await alice.handleSfuAviso({ t: "scope.closed", channel: CANAL, scope: ESCOPO, mesmaChamada: false })

    expect(alice.channel).toBeNull()
    expect(registo.fins).toBe(1)
    expect(registo.erros).toEqual([CHAMADA_NOUTRO_APARELHO])
    expect(registo.diagnosticos).toContain("call-noutro-aparelho")
    expect(registo.diagnosticos).not.toContain("call-sfu-a-religar")
    // The goodbye goes: the account is in ANOTHER call, and this room must stop showing it.
    expect(despedidas(p)).toHaveLength(1)
    // No rebuild: the only join is the first one, even when the connection "comes back".
    await alice.ligacaoVoltou()
    expect(entradas(p)).toHaveLength(1)
  })

  it("o aviso do servidor (a mesma chamada): sai sem `voice.leave`, que apagaria o outro aparelho da lista dos outros", async () => {
    const p = ponte(ALICE)
    const alice = new Call(p)
    const registo = escutar(alice)
    await alice.join(CANAL)

    await alice.handleSfuAviso({ t: "scope.closed", channel: CANAL, scope: ESCOPO, mesmaChamada: true })

    expect(alice.channel).toBeNull()
    expect(registo.erros).toEqual([CHAMADA_NOUTRO_APARELHO])
    expect(despedidas(p)).toEqual([])
  })

  it("um aviso de outra sala não toca nesta chamada", async () => {
    const p = ponte(ALICE)
    const alice = new Call(p)
    const registo = escutar(alice)
    await alice.join(CANAL)

    await alice.handleSfuAviso({ t: "scope.closed", channel: CANAL, scope: ambitoDaChamada(CANAL, "outra"), mesmaChamada: false })

    expect(alice.channel).toBe(CANAL)
    expect(registo.erros).toEqual([])
    await alice.leave()
  })

  it("a reconstrução recusada com noutro-aparelho: uma tentativa só, sai com o aviso, não com o 403", async () => {
    const p = ponte(ALICE)
    const alice = new Call(p)
    const registo = escutar(alice)
    await alice.join(CANAL)

    // The notice was lost with the socket; on its return the server refuses the plain join.
    recusarEntrada.codigo = "noutro-aparelho"
    await alice.ligacaoVoltou()

    expect(entradas(p)).toHaveLength(2)
    expect(alice.channel).toBeNull()
    expect(registo.fins).toBe(1)
    expect(registo.erros).toEqual([CHAMADA_NOUTRO_APARELHO])
    expect(registo.diagnosticos).not.toContain("call-sfu-refazer-falhou")
    // Without the goodbye: this device does not know whether the other one is in this same call.
    expect(despedidas(p)).toEqual([])
  })

  it("a ressincronização recusada com noutro-aparelho também acaba a chamada, sem religar", async () => {
    const p = ponte(ALICE)
    const alice = new Call(p)
    const registo = escutar(alice)
    await alice.join(CANAL)

    recusarEntrada.codigo = "noutro-aparelho"
    // Someone announces and we have no sound from them: the engine asks the server who is in the call.
    await alice.handleSignal(CANAL, BRUNO, anuncioDe())
    await vi.waitFor(() => expect(alice.channel).toBeNull())

    expect(registo.erros).toEqual([CHAMADA_NOUTRO_APARELHO])
    expect(registo.diagnosticos).not.toContain("call-sfu-a-religar")
    expect(entradas(p)).toHaveLength(2)
  })
})
