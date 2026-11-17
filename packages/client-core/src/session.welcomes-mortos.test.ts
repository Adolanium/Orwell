import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Welcomes that no longer open, delivered again all at once (hotfix 1.3.10).
 *
 * The server keeps every Welcome for the retention window and sends all of
 * them on each `welcome.resync`. One that was already used cannot open again
 * (its key package was burned), and `deadWelcomes` is what skips it. "Sync the
 * account" empties that list on purpose. An account with 175 pending Welcomes
 * then got 175 frames in one burst, each handled in parallel, and each death
 * wrote the WHOLE vault right away: 175 full writes in flight at once. A phone
 * browser ran out of memory before any write landed, so the marks never
 * reached the disk and the same burst came back at every start.
 *
 * The relay is from `session.bloqueio.test.ts`, with a disk that takes time.
 */

vi.setConfig({ testTimeout: 90_000 })

/**
 * A disk that takes a while to write, like IndexedDB with a large record, and
 * counts: how many writes, and how many were in flight at the same time.
 */
class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  escritas = 0
  emCurso = 0
  maximoEmCurso = 0
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.escritas++
    this.emCurso++
    this.maximoEmCurso = Math.max(this.maximoEmCurso, this.emCurso)
    await new Promise((resolve) => setTimeout(resolve, 2))
    this.bytes = bytes
    this.emCurso--
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

/** See `TRAMAS_MAXIMAS` in `session.corrida.test.ts`: a cap on a cascade to keep
 * the whole suite from collapsing. */
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
          (evento) =>
            evento.seq > depois && (evento.recipient === undefined || evento.recipient === socket.address),
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
      case "channel.rejoin.request": {
        // Like in `gateway.ts`: delivered to connected members of the channel.
        const canal = frame.channel as string
        for (const ligacao of this.ligacoes) {
          if (ligacao === socket || !ligacao.canais.has(canal)) continue
          ligacao.entregar({ t: "channel.rejoin", channel: canal, address: socket.address })
        }
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
  /** The relay this socket was born with. See the note in `session.corrida.test.ts`:
   * without it, old sessions talk to the next test's relay. */
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
  disco: MemoryBackend
}

async function conta(): Promise<Conta> {
  const disco = new MemoryBackend()
  const vault = new Vault(disco)
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  const { address } = await session.createIdentity("localhost:8448")
  await session.connect()
  await settle(20)
  return { session, address, vault, disco }
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


describe("Welcomes mortos entregues de novo", () => {
  it("uma rajada de Welcomes já usados marca-os todos com poucas escritas, nunca em paralelo", async () => {
    const ana = await conta()
    const bento = await conta()
    const salas: string[] = []
    for (let indice = 0; indice < 8; indice++) {
      const sala = moradaDeTeste(`sala-${indice}`)
      await ana.session.createSpaceChannel(sala)
      await ana.session.seat(sala, bento.address)
      salas.push(sala)
    }
    await settle(400)
    for (const sala of salas) expect(bento.session.channels).toContain(sala)

    // What "Sync the account" does: forget the marks and ask again.
    await bento.session.resyncWelcomes()
    await settle(600)
    await bento.vault.gravarAdiada()
    const marcados = bento.vault.contents.deadWelcomes.filter((marca) => salas.some((sala) => marca.includes(sala)))
    expect(marcados).toHaveLength(salas.length)

    // Close the device and open it again from the disk, as a person does.
    const reabrir = async (): Promise<{ session: Session; vault: Vault }> => {
      await bento.session.flush()
      bento.session.disconnect()
      const vault = new Vault(bento.disco)
      await vault.unlock("frase-passe")
      const session = new Session(vault)
      abertas.push(session)
      session.loadIdentity()
      bento.disco.escritas = 0
      bento.disco.maximoEmCurso = 0
      await session.connect()
      await settle(600)
      await vault.gravarAdiada()
      bento.session = session
      bento.vault = vault
      return { session, vault }
    }

    // The measure of an ordinary start, with every mark in place.
    await reabrir()
    const escritasDeUmArranque = bento.disco.escritas

    // The state a real phone was left in: marks emptied and saved, and the
    // server still holding every Welcome.
    await bento.vault.update((contents) => {
      contents.deadWelcomes = []
    })
    const { session, vault } = await reabrir()

    // It heals alone, at the first start: every mark back, and on the disk.
    const mortos = (lista: string[]): string[] => lista.filter((marca) => salas.some((sala) => marca.includes(sala)))
    expect(mortos(vault.contents.deadWelcomes)).toHaveLength(salas.length)
    const relido = new Vault(bento.disco)
    await relido.unlock("frase-passe")
    expect(mortos(relido.contents.deadWelcomes)).toHaveLength(salas.length)
    // Never two whole-vault writes at the same time, and at most one more write than an ordinary start.
    expect(bento.disco.maximoEmCurso).toBeLessThanOrEqual(1)
    expect(bento.disco.escritas).toBeLessThanOrEqual(escritasDeUmArranque + 1)
    // Nothing was lost: every channel is still open.
    for (const sala of salas) expect(session.channels).toContain(sala)
  })
})
