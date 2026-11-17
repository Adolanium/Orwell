import { Payload, type UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Call, type CallBridge, type MediaKeyMaterial } from "./call.js"

/**
 * Screen sharing as a role power (`transmitir`, 12/11/2026), in the call: our
 * own share is refused before the system picker, and someone else's screen
 * (an altered app) is not shown. The harness is the one of `call.afk.test.ts`.
 */
// -------------------------------------------------------------------- stubs

class FakePeerConnection {
  static instances: FakePeerConnection[] = []
  localDescription: { type: string; sdp: string } | null = null
  connectionState = "new"
  closed = false
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
  close(): void {
    this.closed = true
  }
  emitConnected(): void {
    this.connectionState = "connected"
    this.onconnectionstatechange?.()
  }
}

function fakeStream(): MediaStream {
  const audio = { kind: "audio", enabled: true, stop: vi.fn() }
  return {
    getTracks: () => [audio],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [],
  } as unknown as MediaStream
}

const ALICE = "@alice-um-dois-tres:s" as UserAddress
const BRUNO = "@bruno-um-dois-tres:s" as UserAddress
const CANAL = "!geral:s"

const SALA_AFK = "contio-afk"
const SALA_VOZ = "contio-geral"

type Ponte = CallBridge & {
  sent: { channel: string; payload: Payload }[]
  portao: boolean[]
  suportaSfu: ReturnType<typeof vi.fn>
}

function ponte(selfAddress: UserAddress, comAfk = true, podeTransmitir?: CallBridge["podeTransmitir"]): Ponte {
  const sent: { channel: string; payload: Payload }[] = []
  const portao: boolean[] = []
  const suportaSfu = vi.fn(() => false)
  return {
    selfAddress,
    sent,
    portao,
    suportaSfu,
    async sendSignal(channel, payload) {
      sent.push({ channel, payload })
    },
    async mediaKey(): Promise<MediaKeyMaterial | null> {
      return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
    },
    async reservarContadorSframe(): Promise<number> {
      return 0
    },
    async setMediaActive(activo: boolean) {
      portao.push(activo)
    },
    sfu: { suportaSfu } as unknown as CallBridge["sfu"],
    ...(comAfk ? { salaAfk: async (_canal: string, sala: string) => sala === SALA_AFK } : {}),
    ...(podeTransmitir ? { podeTransmitir } : {}),
  }
}

const joins = (p: Ponte): Extract<Payload, { t: "voice.join" }>[] =>
  p.sent.map((cada) => cada.payload).filter((payload): payload is Extract<Payload, { t: "voice.join" }> => payload.t === "voice.join")

let getUserMedia: ReturnType<typeof vi.fn>
let getDisplayMedia: ReturnType<typeof vi.fn>

beforeEach(() => {
  FakePeerConnection.instances = []
  getUserMedia = vi.fn(async () => fakeStream())
  getDisplayMedia = vi.fn(async () => fakeStream())
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("RTCRtpSender", class {})
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, getDisplayMedia } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const joinComEcra = (room: string, muted = false): Payload =>
  ({ t: "voice.join", at: Date.now(), video: false, sframe: false, alone: false, muted, room, joinId: "bbbbbbbbbbbbbbbbbbbbbbbb", screen: true }) as Payload

describe("transmitir na chamada", () => {
  it("sem a permissão, partilhar o ecrã é recusado antes do selector do sistema", async () => {
    const p = ponte(ALICE, true, () => false)
    const call = new Call(p)
    const erros: string[] = []
    call.on("error", ({ detail }) => erros.push(detail))
    await call.join(CANAL, { room: SALA_VOZ })
    expect(await call.startScreenShare()).toBe(false)
    expect(getDisplayMedia).not.toHaveBeenCalled()
    expect(erros).toContain("you may not share your screen in this room")
  })

  it("com a permissão, pede o ecrã ao sistema; a pergunta leva a sala e a conta", async () => {
    const perguntas: string[] = []
    const p = ponte(ALICE, true, (canal, sala, quem) => {
      perguntas.push(`${canal}|${sala}|${quem}`)
      return true
    })
    const call = new Call(p)
    await call.join(CANAL, { room: SALA_VOZ })
    // The share itself needs a media pipeline jsdom lacks: what is measured is that the picker opened.
    await call.startScreenShare().catch(() => false)
    expect(getDisplayMedia).toHaveBeenCalled()
    expect(perguntas).toContain(`${CANAL}|${SALA_VOZ}|${ALICE}`)
  })

  it("o ecrã de quem não tem a permissão não se oferece (modo directo)", async () => {
    const pode = { bruno: false }
    const p = ponte(ALICE, true, (_c, _s, quem) => (quem === BRUNO ? pode.bruno : true))
    const call = new Call(p)
    let ultima: { address: string; ecraOferecido: boolean }[] = []
    call.on("participants", ({ participants }) => (ultima = participants))
    await call.join(CANAL, { room: SALA_VOZ })
    await call.handleSignal(CANAL, BRUNO, joinComEcra(SALA_VOZ))
    for (const ligacao of FakePeerConnection.instances) ligacao.emitConnected()
    await call.handleSignal(CANAL, BRUNO, joinComEcra(SALA_VOZ))
    expect(ultima.find((q) => q.address === BRUNO)?.ecraOferecido).toBe(false)
    // The role given: the offer shows on the next announcement of the call (here, Bruno mutes).
    pode.bruno = true
    await call.handleSignal(CANAL, BRUNO, joinComEcra(SALA_VOZ, true))
    expect(ultima.find((q) => q.address === BRUNO)?.ecraOferecido).toBe(true)
  })
})
