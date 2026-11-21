import { moradaDeTeste } from "../testes/moradas.js"
import type { FichaDoCanal } from "@enclave/client-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { motor } from "./sons/motor.js"
import { strings } from "./strings.js"
import { DEFAULT_PREFS, readPrefs, writePrefs } from "./hooks/usePrefs.js"

/**
 * What sound each event makes, measured at the shell.
 *
 * The rules (gesture, focus, burst, activity) have their own tests in
 * `sons/motor.test.ts`. This measures the link: each event reaches the engine
 * with the right type, the right channel, and only once.
 */

vi.mock("./sons/motor.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./sons/motor.js")>()
  return {
    ...real,
    motor: {
      tocar: vi.fn(() => "tocou"),
      tocarChamada: vi.fn(() => "tocou"),
      pararChamada: vi.fn(),
      chamadaATocar: vi.fn(() => null),
      chamar: vi.fn(() => "tocou"),
      pararDeChamar: vi.fn(),
      aChamar: vi.fn(() => null),
      ouvir: vi.fn(() => true),
      armar: () => () => {},
      ligarAmbiente: vi.fn(),
    },
  }
})

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

afterEach(cleanup)
beforeEach(() => {
  vi.mocked(motor.tocar).mockClear()
  vi.mocked(motor.tocarChamada).mockClear()
})

const EU = "@eu:casa.pt"

const MURAL_DA_ANA = moradaDeTeste("mural ana", "casa.pt")
const MEU_FEED = moradaDeTeste("mural eu", "casa.pt")
/** The card of each channel (1.0 "Arca", slice 6b), for the false bridge to give to the interface. */
const FICHAS = (): Record<string, FichaDoCanal> => ({
  [DM]: { tipo: "directa" },
  [MURAL_DA_ANA]: { tipo: "mural", dono: "@ana:casa.pt" },
  [MEU_FEED]: { tipo: "mural", dono: "@eu:casa.pt" },
})
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"
const DM = moradaDeTeste("directa ana eu", "casa.pt")

type Mensagem = { channel: string; sender: string; seq: number; aoVivo?: boolean; payload: Record<string, unknown> }
let onMessage: ((message: Mensagem) => void) | null = null
let onCallActivity: ((event: { channel: string; from: string; joined: boolean; room: string }) => void) | null = null
let onConnection: ((payload: { state: string }) => void) | null = null
let onChannels: ((payload: { channels: string[] }) => void) | null = null

function ponte(): EnclaveBridge {
  return {
    vault: {
      status: async () => ({ exists: true, supportsOsProtection: true }),
      unlock: async () => ({ ok: true }),
      create: async () => ({ ok: true }),
      lock: async () => ({ ok: true }),
      destroy: async () => ({ ok: true }),
    },
    identity: {
      load: async () => ({ address: EU, accountId: "eu" }),
      create: async () => ({ address: EU, accountId: "eu" }),
    },
    session: {
      connect: async () => ({ ok: true }),
      capabilities: async () => ["mls"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
        fichas: FICHAS,
      list: async () => [LAGAR],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      rooms: () => [{ room: "voz", name: "voz", category: "", kind: "voice", position: 0 }],
    },
    invites: {
      create: async () => "enclave://join/x/y#z",
      redeem: async () => ({ ok: true }),
      list: async () => [],
      revoke: async () => ({ ok: true }),
    },
    social: {
      post: async () => ({ ok: true }),
      acceptFollower: vi.fn().mockResolvedValue({ ok: true }),
      acceptFriend: vi.fn().mockResolvedValue({ ok: true }),
      declineFriend: vi.fn().mockResolvedValue({ ok: true }),
      unfriend: vi.fn().mockResolvedValue({ ok: true }),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      feedChannel: async () => MEU_FEED,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      directory: async () => ({}),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: (handler: never) => {
        onMessage = handler as never
        return () => {}
      },
      epoch: () => () => {},
      status: () => () => {},
      connection: (handler: never) => {
        onConnection = handler as never
        return () => {}
      },
      channels: (handler: never) => {
        onChannels = handler as never
        return () => {}
      },
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: (handler: never) => {
        onCallActivity = handler as never
        return () => {}
      },
    },
    call: {
      on: () => () => {},
      setMuted: () => {},
      setCameraOff: () => {},
      join: async () => ({ ok: true }),
      leave: async () => ({ ok: true }),
      tectoDePartilha: 6,
      podePartilharEcra: false,
    },
  } as unknown as EnclaveBridge
}

async function abrir(bridge: EnclaveBridge = ponte()): Promise<void> {
  render(<App bridge={bridge} />)
  await screen.findByRole("button", { name: strings.rail.chat })
}

let seq = 0
async function chega(channel: string, sender: string, payload: Record<string, unknown>, aoVivo = false): Promise<void> {
  seq += 1
  await act(async () => {
    // `aoVivo`: as from the socket. What comes from history is silent (12/11/2026).
    onMessage?.({ channel, sender, seq, ...(aoVivo ? { aoVivo } : {}), payload: { id: `m${seq}`, sentAt: Date.now(), ...payload } } as Mensagem)
    await Promise.resolve()
  })
}

const tipos = (): string[] => vi.mocked(motor.tocar).mock.calls.map(([acontecimento]) => acontecimento.tipo)

describe("cada acontecimento chega ao motor com o seu som", () => {
  it('uma mensagem directa toca "directa", no canal dela', async () => {
    await abrir()
    await chega(DM, ANA, { t: "message", body: "olá" }, true)
    expect(vi.mocked(motor.tocar).mock.calls).toEqual([
      [{ tipo: "directa", canal: DM, deMim: false, avisoComSom: false }],
    ])
  })

  it("uma mensagem qualquer numa sala de grupo não faz som", async () => {
    await abrir()
    await chega(LAGAR, ANA, { t: "message", body: "bom dia a todos" })
    expect(tipos()).toEqual([])
  })

  it('uma menção numa sala toca "mencao", uma vez', async () => {
    await abrir()
    await chega(LAGAR, ANA, { t: "message", body: "@Vera vê isto", mentions: [EU] }, true)
    expect(tipos()).toEqual(["mencao"])
  })

  it("uma menção que chega pelo histórico não toca, e a mesma menção ao vivo duas vezes toca uma (12/11/2026)", async () => {
    await abrir()
    seq += 1
    await act(async () => {
      // Recovery: no `aoVivo`.
      onMessage?.({ channel: LAGAR, sender: ANA, seq, payload: { t: "message", id: "m-ontem", sentAt: Date.now() - 86_400_000, body: "@Vera", mentions: [EU] } } as Mensagem)
      await Promise.resolve()
    })
    expect(tipos()).toEqual([])
    await chega(LAGAR, ANA, { t: "message", id: "m-agora", body: "@Vera", mentions: [EU] }, true)
    await chega(LAGAR, ANA, { t: "message", id: "m-agora", body: "@Vera", mentions: [EU] }, true)
    expect(tipos()).toEqual(["mencao"])
  })

  it('um pedido de amizade toca "pedido", e o aceite toca "aceite"', async () => {
    await abrir()
    await chega(DM, ANA, { t: "friend.request" })
    await chega(DM, ANA, { t: "friend.accept", acceptedAt: Date.now() })
    expect(tipos()).toEqual(["pedido", "aceite"])
  })

  it("o que eu próprio escrevo não chega ao motor", async () => {
    await abrir()
    await chega(DM, EU, { t: "message", body: "eu" })
    await chega(LAGAR, EU, { t: "message", body: "eu", mentions: [EU] })
    expect(tipos()).toEqual([])
  })

  it("o que a minha conta escreve noutro aparelho, ao vivo, não toca nem entra no sino (16/11/2026)", async () => {
    await abrir()
    await ligar()
    // The same account on the phone: author EU, live, with a real `seq`.
    await chega(DM, EU, { t: "message", body: "do telemóvel" }, true)
    await chega(LAGAR, EU, { t: "message", body: "do telemóvel" }, true)
    await chega(LAGAR, EU, { t: "message", body: "@todos", mentions: [EU] }, true)
    await chega(LAGAR, EU, { t: "message", body: "um ticket", room: "suporte", ticket: { id: "t1", subject: "Ajuda" } }, true)
    await chega(MEU_FEED, EU, { t: "post", postedAt: Date.now(), body: "foto" }, true)
    await chega(LAGAR, EU, { t: "reaction", target: "m1", emoji: "👍", remove: false }, true)
    await chega(DM, EU, { t: "friend.accept", acceptedAt: Date.now() }, true)
    await chega(DM, EU, { t: "friend.request" }, true)
    expect(tipos()).toEqual([])
    expect(motor.tocarChamada).not.toHaveBeenCalled()
    expect(screen.queryByText(strings.notifCenter.dmMessage("Vera"))).toBeNull()
  })

  it("uma publicação no mural de um amigo pede o som da publicação", async () => {
    await abrir()
    await chega(MURAL_DA_ANA, ANA, { t: "post", postedAt: Date.now(), body: "foto" })
    expect(tipos()).toEqual(["publicacao"])
  })
})

/**
 * Connect, and the channel list arrives: what the ring gate expects before
 * allowing a call to ring. See `createCallRingGate` in `lib/sounds.ts`.
 */
async function ligar(): Promise<void> {
  await act(async () => {
    onConnection?.({ state: "online" })
    onChannels?.({ channels: [LAGAR, DM] })
    await Promise.resolve()
  })
}

/** An entry into a call, `depoisMs` after the connection. */
async function entraNaChamada(channel: string, room: string, depoisMs: number): Promise<void> {
  const agora = Date.now()
  const relogio = vi.spyOn(Date, "now").mockReturnValue(agora + depoisMs)
  try {
    await act(async () => {
      onCallActivity?.({ channel, from: ANA, joined: true, room })
      await Promise.resolve()
    })
  } finally {
    relogio.mockRestore()
  }
}

describe("a chamada a entrar", () => {
  it("numa directa, toca e repete até atender", async () => {
    await abrir()
    await ligar()
    await entraNaChamada(DM, "", 10_000)
    expect(vi.mocked(motor.tocarChamada).mock.calls).toEqual([[DM, { repetir: true }]])
  })

  /*
    The ring is only for
    private messages. In a community voice room nothing rings.
  */
  it("numa sala de voz de uma comunidade, não toca", async () => {
    await abrir()
    await ligar()
    await entraNaChamada(LAGAR, "voz", 10_000)
    expect(motor.tocarChamada).not.toHaveBeenCalled()
  })

  /*
    The bug: "when a user enters the
    platform, they hear the call sound ahead of time, during loading". The
    presence announcements from calls already in progress arrive right after the connection.
  */
  it("durante a abertura, as chamadas que já decorriam não tocam", async () => {
    await abrir()
    await entraNaChamada(LAGAR, "voz", 0)
    await ligar()
    await entraNaChamada(DM, "", 500)
    expect(motor.tocarChamada).not.toHaveBeenCalled()
  })

  it("o motor fica a saber qual é o canal aberto", async () => {
    await abrir()
    expect(motor.ligarAmbiente).toHaveBeenCalled()
  })
})

/*
  The ring in a direct conversation stops when I answer, decline, the call ends,
  or after 30 s (21/11/2026). Answering on ANOTHER device of my account is
  answering too: this device stops ringing.
*/
describe("the incoming ring stops (21/11/2026)", () => {
  afterEach(() => {
    vi.mocked(motor.chamadaATocar).mockReset().mockReturnValue(null)
    vi.mocked(motor.pararChamada).mockClear()
  })

  it("another device of my account answers: this device stops ringing", async () => {
    await abrir()
    await ligar()
    await entraNaChamada(DM, "", 10_000)
    vi.mocked(motor.chamadaATocar).mockReturnValue(DM)
    vi.mocked(motor.pararChamada).mockClear()
    await callEvent(DM, EU, true)
    expect(motor.pararChamada).toHaveBeenCalledWith(DM)
  })

  it("the ring shows a notice with Decline, and Decline stops the ring on this device", async () => {
    await abrir()
    await ligar()
    await entraNaChamada(DM, "", 10_000)
    vi.mocked(motor.chamadaATocar).mockReturnValue(DM)
    vi.mocked(motor.pararChamada).mockClear()
    const decline = await screen.findByRole("button", { name: strings.call.declineRing })
    await userEvent.click(decline)
    expect(motor.pararChamada).toHaveBeenCalledWith(DM)
    expect(screen.queryByRole("button", { name: strings.call.declineRing })).toBeNull()
  })

  it("the notice goes when the caller gives up", async () => {
    await abrir()
    await ligar()
    await entraNaChamada(DM, "", 10_000)
    await screen.findByRole("button", { name: strings.call.declineRing })
    await callEvent(DM, ANA, false)
    expect(screen.queryByRole("button", { name: strings.call.declineRing })).toBeNull()
  })

  it("a call in a community room shows no notice", async () => {
    await abrir()
    await ligar()
    await entraNaChamada(LAGAR, "voz", 10_000)
    expect(screen.queryByRole("button", { name: strings.call.declineRing })).toBeNull()
  })
})

/** Someone joins or leaves a call, now. */
async function callEvent(channel: string, from: string, joined: boolean, room = ""): Promise<void> {
  await act(async () => {
    onCallActivity?.({ channel, from, joined, room })
    await Promise.resolve()
  })
}

/*
  When muting and when unmuting, a
  short sound. The "mute all" plays both ways: the sound goes through the alert
  motor, which "mute all" does not silence (it only silences the call voices).
*/
describe("os sons do silenciar", () => {
  it("o botão do microfone toca ao calar e ao voltar", async () => {
    await abrir()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: strings.call.micAria(false) }))
    await user.click(screen.getByRole("button", { name: strings.call.micAria(true) }))
    expect(tipos()).toEqual(["mic-silenciado", "mic-ligado"])
  })

  it('"silenciar tudo" toca ao ligar e ao desligar, e o som de voltar não fica calado', async () => {
    await abrir()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: strings.call.soundAria(false) }))
    await user.click(screen.getByRole("button", { name: strings.call.soundAria(true) }))
    expect(tipos()).toEqual(["tudo-silenciado", "tudo-ligado"])
  })
})

/*
  The sound when sending. The rule lives in
  the outbox (`hooks/useOutbox.ts`); this measures that the shell's message box
  passes through it, and that what arrives from outside never triggers it.
*/
describe("o som ao enviar", () => {
  async function escrever(texto: string): Promise<void> {
    const user = userEvent.setup()
    const caixa = await screen.findByPlaceholderText(strings.chat.composerPlaceholder)
    await user.type(caixa, `${texto}{Enter}`)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it("enviar uma mensagem pela caixa de escrita não toca nada: é um acontecimento da própria conta (16/11/2026)", async () => {
    await abrir()
    await ligar()
    await escrever("bom dia")
    expect(tipos()).toEqual([])
  })

  it("um envio recusado não toca", async () => {
    const bridge = ponte()
    bridge.channels.send = (async () => {
      throw new Error("vault is locked")
    }) as never
    await abrir(bridge)
    await ligar()
    await escrever("bom dia")
    expect(tipos()).not.toContain("enviada")
  })

  it('uma mensagem recebida, numa sala ou numa directa, nunca toca "enviada"', async () => {
    await abrir()
    await ligar()
    await chega(LAGAR, ANA, { t: "message", body: "bom dia a todos" })
    await chega(DM, ANA, { t: "message", body: "olá" }, true)
    await chega(DM, EU, { t: "message", body: "a minha, vinda da sessão" })
    expect(tipos()).not.toContain("enviada")
    expect(tipos()).toEqual(["directa"])
  })
})

/*
  The sound of messages in channels and mentions. The rules are in `sons/canal.test.ts`; here we measure the shell's link:
  what reaches the engine, with the channel and room.
*/
describe("o som das mensagens nos canais", () => {
  afterEach(() => {
    writePrefs({ ...readPrefs(), silenciados: [] })
    localStorage.removeItem("enclave.salaComumCalada")
  })

  async function chegaAoVivo(channel: string, sender: string, payload: Record<string, unknown>): Promise<void> {
    seq += 1
    await act(async () => {
      onMessage?.({ channel, sender, seq, aoVivo: true, payload: { id: `m${seq}`, sentAt: Date.now(), ...payload } } as Mensagem)
      await Promise.resolve()
    })
  }

  it('uma mensagem nova, ao vivo, numa sala toca "canal", com o canal e a sala', async () => {
    await abrir()
    await chegaAoVivo(LAGAR, ANA, { t: "message", body: "bom dia", room: "vinha" })
    expect(vi.mocked(motor.tocar).mock.calls).toEqual([[{ tipo: "canal", canal: LAGAR, sala: "vinha" }]])
  })

  it("o histórico (sem `aoVivo`) não toca", async () => {
    await abrir()
    await chega(LAGAR, ANA, { t: "message", body: "de ontem", room: "vinha" })
    expect(tipos()).toEqual([])
  })

  it("a minha mensagem, e as de sistema, não tocam", async () => {
    await abrir()
    await chegaAoVivo(LAGAR, EU, { t: "message", body: "eu" })
    await chegaAoVivo(LAGAR, ANA, { t: "channel.meta", name: "Lagar" })
    await chegaAoVivo(LAGAR, ANA, { t: "profile", displayName: "Ana" })
    expect(tipos()).toEqual([])
  })

  it('a menção ganha: uma mensagem que me nomeia toca só "mencao", com a sala', async () => {
    await abrir()
    await chegaAoVivo(LAGAR, ANA, { t: "message", body: "@Vera olha", room: "vinha", mentions: [EU] })
    expect(tipos()).toEqual(["mencao"])
    expect(vi.mocked(motor.tocar).mock.calls[0]?.[0]).toMatchObject({ tipo: "mencao", canal: LAGAR, sala: "vinha" })
  })

  it('numa directa, a menção também ganha: toca só "mencao", e não também "directa"', async () => {
    await abrir()
    await chegaAoVivo(DM, ANA, { t: "message", body: "@Vera olha", mentions: [EU] })
    expect(tipos()).toEqual(["mencao"])
  })

  it('numa resposta a um ticket, a menção toca "mencao"', async () => {
    await abrir()
    await chegaAoVivo(LAGAR, ANA, { t: "message", body: "@Vera vê", room: "apoio", ticket: { id: "t1" }, mentions: [EU] })
    expect(tipos()).toEqual(["mencao"])
  })

  it("num canal silenciado não toca; a menção continua a tocar", async () => {
    writePrefs({ ...DEFAULT_PREFS, silenciados: [LAGAR] })
    await abrir()
    await chegaAoVivo(LAGAR, ANA, { t: "message", body: "bom dia", room: "vinha" })
    expect(tipos()).toEqual([])
    await chegaAoVivo(LAGAR, ANA, { t: "message", body: "@Vera", room: "vinha", mentions: [EU] })
    expect(tipos()).toEqual(["mencao"])
  })

  it("o motor fica a saber a sala aberta, além do canal", async () => {
    await abrir()
    const ambientes = vi.mocked(motor.ligarAmbiente).mock.calls.map(([parcial]) => parcial)
    expect(ambientes.some((parcial) => typeof parcial.salaAberta === "function" && parcial.salaAberta() === "")).toBe(true)
  })

  it("o canal comum fica silenciado de fábrica quando o servidor o diz", async () => {
    const bridge = ponte()
    const COMUM = "!orwell:casa.pt"
    ;(bridge.session as { commonRoom?: () => Promise<string | null> }).commonRoom = async () => COMUM
    await abrir(bridge)
    await ligar()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(readPrefs().silenciados).toContain(COMUM)
    // And the message does not ring there until the person switches it back on.
    await chegaAoVivo(COMUM, ANA, { t: "message", body: "olá a todos" })
    expect(tipos()).toEqual([])
  })
})
