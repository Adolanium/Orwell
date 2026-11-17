import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { newRoomId } from "@enclave/protocol"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * A room tombstone counts only with authority, and then wins both ways
 * (17/11/2026, review of the 1.3.16.1 hotfix). Deleting a room deletes its polls
 * for everyone, so the tombstone is checked on RECEIPT: `channel.meta` is
 * accepted from any member, and the `gerirsalas` guard only exists on the
 * sending side. Two and three real accounts with a real relay, copied from
 * `session.fixar.test.ts`; what is measured is always the reader's vault.
 */

/** Creating an account is real cryptography. See the same note nearby. */
vi.setConfig({ testTimeout: 60_000 })

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

interface Frame {
  t: string
  [key: string]: unknown
}

interface Evento {
  seq: number
  kind: string
  ciphertext: string
  recipient?: string | undefined
  ref?: string | undefined
}

const TRAMAS_MAXIMAS = 3_000

class Rele {
  readonly eventos = new Map<string, Evento[]>()
  readonly pools = new Map<string, string[]>()
  readonly ligacoes = new Set<FakeSocket>()
  entregues = 0

  frame(socket: FakeSocket, frame: Frame): void {
    switch (frame.t) {
      case "hello":
        socket.entregar({ t: "hello.ok", version: 1, capabilities: [] })
        return
      case "auth.begin":
        socket.address = frame.address as string
        socket.entregar({ t: "auth.challenge", nonce: "AAAA" })
        return
      case "auth.finish":
        socket.entregar({ t: "auth.ok", address: socket.address })
        return
      case "channel.subscribe":
        for (const canal of frame.channels as string[]) socket.canais.add(canal)
        return
      case "channel.unsubscribe":
        for (const canal of frame.channels as string[]) socket.canais.delete(canal)
        return
      case "keypackage.publish": {
        const anterior = frame.replace ? [] : (this.pools.get(socket.address ?? "") ?? [])
        this.pools.set(socket.address ?? "", [...anterior, ...(frame.packages as string[])])
        return
      }
      case "keypackage.claim": {
        const pool = this.pools.get(frame.address as string) ?? []
        const pacote = pool.shift() ?? null
        socket.entregar({ t: "keypackage.claimed", address: frame.address, keyPackage: pacote })
        return
      }
      case "channel.send": {
        const canal = frame.channel as string
        const log = this.eventos.get(canal) ?? []
        const evento: Evento = {
          seq: log.length,
          kind: frame.kind as string,
          ciphertext: frame.ciphertext as string,
          recipient: frame.recipient as string | undefined,
          ref: frame.ref as string | undefined,
        }
        log.push(evento)
        this.eventos.set(canal, log)
        this.difundir(canal, evento)
        return
      }
      case "channel.backfill": {
        const canal = frame.channel as string
        const log = this.eventos.get(canal) ?? []
        const depois = (frame.afterSeq as number | undefined) ?? -1
        const visiveis = log.filter(
          (evento) => evento.seq > depois && (evento.recipient === undefined || evento.recipient === socket.address),
        )
        const pagina = visiveis.slice(0, (frame.limit as number | undefined) ?? 50)
        socket.entregar({
          t: "channel.backfill.page",
          channel: canal,
          events: pagina.map((evento) => ({
            seq: evento.seq,
            kind: evento.kind,
            ciphertext: evento.ciphertext,
            receivedAtMinute: 0,
          })),
          more: pagina.length < visiveis.length,
        })
        return
      }
      case "welcome.resync": {
        for (const [canal, log] of this.eventos) {
          for (const evento of log) {
            if (evento.kind === "welcome" && evento.recipient === socket.address) {
              socket.entregar(this.#comoEvento(canal, evento))
            }
          }
        }
        return
      }
      default:
        return
    }
  }

  difundir(canal: string, evento: Evento): void {
    for (const ligacao of this.ligacoes) {
      if (!ligacao.address) continue
      if (evento.recipient) {
        if (ligacao.address !== evento.recipient) continue
      } else if (!ligacao.canais.has(canal)) continue
      ligacao.entregar(this.#comoEvento(canal, evento))
    }
  }

  #comoEvento(canal: string, evento: Evento): Frame {
    return {
      t: "channel.event",
      channel: canal,
      seq: evento.seq,
      kind: evento.kind,
      ciphertext: evento.ciphertext,
      receivedAtMinute: 0,
      ...(evento.ref !== undefined ? { ref: evento.ref } : {}),
    }
  }
}

let rele = new Rele()

class FakeSocket {
  address: string | null = null
  readonly canais = new Set<string>()
  readyState = 0
  readonly #rele = rele
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    this.#rele.ligacoes.add(this)
    setTimeout(() => {
      this.readyState = 1
      this.#fire("open", {})
    }, 0)
  }

  addEventListener(kind: string, handler: (event: unknown) => void, options?: { once?: boolean }): void {
    const wrapped = options?.once
      ? (event: unknown): void => {
          this.removeEventListener(kind, wrapped)
          handler(event)
        }
      : handler
    this.#listeners.set(kind, [...(this.#listeners.get(kind) ?? []), wrapped])
  }

  removeEventListener(kind: string, handler: (event: unknown) => void): void {
    this.#listeners.set(
      kind,
      (this.#listeners.get(kind) ?? []).filter((item) => item !== handler),
    )
  }

  send(raw: string): void {
    this.#rele.frame(this, JSON.parse(raw) as Frame)
  }

  entregar(frame: unknown): void {
    if (this.#rele.entregues++ > TRAMAS_MAXIMAS) return
    setTimeout(() => this.#fire("message", { data: JSON.stringify(frame) }), 0)
  }

  close(): void {
    this.readyState = 3
    this.#rele.ligacoes.delete(this)
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

async function settle(times = 200): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

let abertas: Session[] = []

interface Conta {
  session: Session
  address: string
  vault: Vault
}

async function conta(): Promise<Conta> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  const { address } = await session.createIdentity("localhost:8448")
  await session.connect()
  await settle(20)
  return { session, address, vault }
}

beforeEach(() => {
  rele = new Rele()
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

const CANAL = moradaDeTeste("lagar")

const SALA = "forum-votos-aaaa"

function meta(room: string, name: string, extra: Record<string, unknown>) {
  return { t: "channel.meta" as const, room, name, category: "", kind: "text" as const, layout: "polls", position: 0, closed: false, removed: false, ...extra }
}

/** Ana founds the channel with a polls room, and Bento joins as a plain member. */
async function canalComSala(): Promise<{ ana: Conta; bento: Conta }> {
  const ana = await conta()
  const bento = await conta()
  await ana.session.createSpaceChannel(CANAL)
  await settle(20)
  await ana.session.upsertRoom(CANAL, { room: SALA, name: "polls", kind: "text", layout: "polls" })
  await settle(20)
  await ana.session.seat(CANAL, bento.address)
  await settle(80)
  await ana.session.republishRooms(CANAL)
  await settle(80)
  return { ana, bento }
}

const viva = (quem: Conta, room = SALA): boolean => quem.session.roomsOf(CANAL).some((sala) => sala.room === room)

describe("a lápide de uma sala só conta com autoridade", () => {
  it("a lápide de um membro sem `gerirsalas` (cliente alterado) é ignorada: não esconde votações nem prende a sala", async () => {
    const { ana, bento } = await canalComSala()
    expect(viva(bento)).toBe(true)
    // The raw `send` is the altered client: it skips the sender gate.
    await bento.session.send(CANAL, meta(SALA, "polls", { closed: true, removed: true, updatedAt: Date.now() + 1000 }))
    await settle(80)
    expect(ana.session.removedRoomsOf(CANAL)).toEqual([])
    // And a later statement by the founder still takes the room, by its stamp.
    await ana.session.upsertRoom(CANAL, { room: SALA, name: "votos", kind: "text", layout: "polls" })
    await settle(80)
    expect(ana.session.roomsOf(CANAL).find((sala) => sala.room === SALA)?.name).toBe("votos")
    expect(bento.session.removedRoomsOf(CANAL)).toEqual([])
  })

  it("a lápide de quem administra vence uma declaração mais recente da mesma sala, que chegou antes", async () => {
    const { ana, bento } = await canalComSala()
    // Someone that had not heard of the deletion states the room alive with a LATER stamp.
    const depois = Date.now() + 60_000
    await bento.session.send(CANAL, meta(SALA, "polls", { position: 3, updatedAt: depois }))
    await settle(80)
    expect(viva(ana)).toBe(true)
    // The founder's tombstone, stamped BEFORE it.
    await ana.session.send(CANAL, meta(SALA, "polls", { closed: true, removed: true, updatedAt: depois - 30_000 }))
    await settle(80)
    for (const quem of [ana, bento]) {
      expect(quem.session.removedRoomsOf(CANAL)).toEqual([SALA])
      expect(viva(quem)).toBe(false)
    }
  })

  it("recriar a sala com o mesmo nome dá um identificador novo, que vive ao lado da lápide", async () => {
    const { ana, bento } = await canalComSala()
    await ana.session.upsertRoom(CANAL, { room: SALA, name: "polls", kind: "text", layout: "polls", closed: true, removed: true })
    await settle(40)
    const nova = newRoomId("text")
    expect(nova).not.toBe(SALA)
    await ana.session.upsertRoom(CANAL, { room: nova, name: "polls", kind: "text", layout: "polls" })
    await settle(80)
    for (const quem of [ana, bento]) {
      expect(quem.session.removedRoomsOf(CANAL)).toEqual([SALA])
      expect(viva(quem, nova)).toBe(true)
      expect(viva(quem)).toBe(false)
    }
  })
})
