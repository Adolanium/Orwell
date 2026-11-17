import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CARGO_TODOS, comSoLeitura, soLeituraDe } from "@enclave/protocol"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Read-only rooms (12/11/2026): only some roles write, everyone reads.
 *
 * Measured in the VAULT OF THE READER, with real accounts and a real relay, the
 * harness of `session.fixar.test.ts`. The rule is an app rule: an altered app
 * can still encrypt to the group. So the question that matters is on the other
 * side of the wire: does an honest reader drop it, and keep what came before?
 *
 * The altered app is played by answering yes to `mayWrite` on the sender: the
 * only guard it skips is its own.
 */

vi.setConfig({ testTimeout: 90_000 })

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

const CANAL = moradaDeTeste("anuncios")
const AVISOS = "avisos"

let contador = 0
function mensagem(corpo: string, room = AVISOS) {
  contador += 1
  return {
    t: "message" as const,
    room,
    id: `m-${contador}-${corpo.slice(0, 8)}`,
    sentAt: 1_700_000_000_000 + contador,
    body: corpo,
    attachments: [],
    mentions: [],
    links: [],
  }
}

/** The bodies a person has stored for a room, in order. */
function corpos(quem: Conta, room = AVISOS): string[] {
  return quem.session
    .history(CANAL)
    .filter((entrada) => entrada.payload.t === "message" && ((entrada.payload as { room?: string }).room ?? "") === room)
    .map((entrada) => (entrada.payload as { body: string }).body)
}

/** Ana founds, Bento gets `anuncios`, Carla is a plain member. Room "Avisos" exists. */
async function canalComTres(): Promise<{ ana: Conta; bento: Conta; carla: Conta }> {
  const ana = await conta()
  const bento = await conta()
  const carla = await conta()
  await ana.session.createSpaceChannel(CANAL)
  await settle(20)
  await ana.session.seat(CANAL, bento.address)
  await settle(80)
  await ana.session.seat(CANAL, carla.address)
  await settle(120)
  await ana.session.upsertRoom(CANAL, { room: AVISOS, name: "Avisos", kind: "text" })
  await ana.session.defineRole(CANAL, { role: "anuncios", name: "Anúncios", powers: [], rank: 1 })
  await ana.session.assignRoles(CANAL, bento.address, ["anuncios"])
  await settle(120)
  return { ana, bento, carla }
}

async function tornarSoLeitura(ana: Conta, quemEscreve: string[]): Promise<void> {
  const antes = ana.session.sobreposicoesDe(CANAL, { sala: AVISOS })
  await ana.session.setSobreposicoes(CANAL, { sala: AVISOS }, comSoLeitura(antes, { soLeitura: true, quemEscreve }))
  await settle(120)
}

/** Carla as an altered app: her own guard says yes. */
async function enviaAlterada(carla: Conta, corpo: string): Promise<void> {
  const espiao = vi.spyOn(carla.session, "mayWrite").mockReturnValue(true)
  try {
    await carla.session.send(CANAL, mensagem(corpo))
  } finally {
    espiao.mockRestore()
  }
  await settle(120)
}

describe("salas só de leitura, de ponta a ponta", () => {
  it("a definição viaja e todos a lêem igual", async () => {
    const { ana, bento, carla } = await canalComTres()
    await tornarSoLeitura(ana, ["anuncios"])
    for (const quem of [ana, bento, carla]) {
      expect(soLeituraDe(quem.session.sobreposicoesDe(CANAL, { sala: AVISOS }))).toEqual({
        soLeitura: true,
        quemEscreve: ["anuncios"],
      })
    }
    expect(carla.session.mayWrite(CANAL, AVISOS)).toBe(false)
    expect(bento.session.mayWrite(CANAL, AVISOS)).toBe(true)
    expect(ana.session.mayWrite(CANAL, AVISOS)).toBe(true)
    // Only in that room.
    expect(carla.session.mayWrite(CANAL, "")).toBe(true)
  })

  it("quem não tem o cargo não envia; o cargo e quem funda enviam e todos lêem", async () => {
    const { ana, bento, carla } = await canalComTres()
    await tornarSoLeitura(ana, ["anuncios"])
    await expect(carla.session.send(CANAL, mensagem("da Carla"))).rejects.toThrow("you may not write in this room")
    await bento.session.send(CANAL, mensagem("do Bento"))
    await ana.session.send(CANAL, mensagem("da Ana"))
    await settle(160)
    expect(corpos(carla)).toEqual(["do Bento", "da Ana"])
    expect(corpos(bento)).toEqual(["do Bento", "da Ana"])
  })

  it("uma app alterada escreve na mesma: os outros descartam, e guardam o que veio antes", async () => {
    const { ana, bento, carla } = await canalComTres()
    await carla.session.send(CANAL, mensagem("antes da regra"))
    await settle(120)
    await tornarSoLeitura(ana, ["anuncios"])
    await enviaAlterada(carla, "depois da regra")
    expect(corpos(ana)).toEqual(["antes da regra"])
    expect(corpos(bento)).toEqual(["antes da regra"])
    // Reacting stays allowed, as on Discord.
    const alvo = bento.session.history(CANAL).find((e) => e.payload.t === "message")!.payload as { id: string }
    const vistas: string[] = []
    bento.session.on("message", (evento) => {
      if (evento.sender === carla.address) vistas.push(evento.payload.t)
    })
    await carla.session.send(CANAL, { t: "reaction", target: alvo.id, emoji: "👍", remove: false })
    await settle(120)
    expect(vistas).toEqual(["reaction"])
  })

  it("dar o cargo a meio deixa escrever, sem recarregar; desligar a regra abre a todos", async () => {
    const { ana, bento, carla } = await canalComTres()
    await tornarSoLeitura(ana, ["anuncios"])
    await ana.session.assignRoles(CANAL, carla.address, ["anuncios"])
    await settle(120)
    expect(carla.session.mayWrite(CANAL, AVISOS)).toBe(true)
    await carla.session.send(CANAL, mensagem("com cargo"))
    await settle(120)
    expect(corpos(bento)).toEqual(["com cargo"])

    await ana.session.assignRoles(CANAL, carla.address, [])
    await settle(120)
    expect(carla.session.mayWrite(CANAL, AVISOS)).toBe(false)
    const antes = ana.session.sobreposicoesDe(CANAL, { sala: AVISOS })
    await ana.session.setSobreposicoes(CANAL, { sala: AVISOS }, comSoLeitura(antes, { soLeitura: false, quemEscreve: [] }))
    await settle(120)
    expect(carla.session.mayWrite(CANAL, AVISOS)).toBe(true)
    expect(ana.session.sobreposicoesDe(CANAL, { sala: AVISOS })).toEqual([])
  })

  it("quem volta de estar fora lê pela ordem do servidor: cargo e regra na mesma página contam", async () => {
    const { ana, bento, carla } = await canalComTres()
    await carla.session.send(CANAL, mensagem("antes"))
    await settle(120)
    bento.session.disconnect()
    await settle(20)
    await tornarSoLeitura(ana, [])
    await enviaAlterada(carla, "proibida")
    await ana.session.assignRoles(CANAL, carla.address, ["anuncios"])
    await tornarSoLeitura(ana, ["anuncios"])
    await carla.session.send(CANAL, mensagem("com cargo"))
    await settle(120)

    await bento.session.connect()
    const fim = Date.now() + 20_000
    while (Date.now() < fim && !corpos(bento).includes("com cargo")) await settle(100)
    expect(corpos(bento)).toEqual(["antes", "com cargo"])
  })

  it("apagar o cargo tira-o a quem o tinha: deixa de escrever, e os outros descartam", async () => {
    const { ana, bento, carla } = await canalComTres()
    await tornarSoLeitura(ana, ["anuncios"])
    expect(bento.session.mayWrite(CANAL, AVISOS)).toBe(true)
    await ana.session.deleteRole(CANAL, "anuncios")
    await settle(120)
    expect(bento.session.mayWrite(CANAL, AVISOS)).toBe(false)
    expect(carla.session.mayWrite(CANAL, AVISOS)).toBe(false)
    expect(ana.session.mayWrite(CANAL, AVISOS)).toBe(true)
    const espiao = vi.spyOn(bento.session, "mayWrite").mockReturnValue(true)
    await bento.session.send(CANAL, mensagem("do Bento sem cargo"))
    espiao.mockRestore()
    await settle(120)
    expect(corpos(carla)).toEqual([])
    expect(corpos(ana)).toEqual([])
  })

  it("a sala nova pode nascer só de leitura, numa só publicação", async () => {
    const { ana, carla } = await canalComTres()
    await ana.session.upsertRoom(CANAL, {
      room: "regras",
      name: "Regras",
      kind: "text",
      perms: comSoLeitura(undefined, { soLeitura: true, quemEscreve: [] }),
    })
    await settle(120)
    expect(carla.session.sobreposicoesDe(CANAL, { sala: "regras" })).toEqual([
      { role: CARGO_TODOS, allow: [], deny: ["escrever"] },
    ])
    expect(carla.session.mayWrite(CANAL, "regras")).toBe(false)
    // A plain member cannot create a room that way (and has no `gerirsalas` anyway).
    await expect(
      carla.session.upsertRoom(CANAL, { room: "x", name: "X", kind: "text", perms: [] }),
    ).rejects.toThrow()
  })
})

describe("o aviso de cargo atribuído (12/11/2026)", () => {
  it("vários cargos de uma vez dão um só evento; retirar e republicar não dão nada", async () => {
    const { ana, carla } = await canalComTres()
    await ana.session.defineRole(CANAL, { role: "mods", name: "Moderação", powers: [], colour: "lima", rank: 2 })
    await settle(80)
    const vistos: { role: string; nome?: string; cor?: string }[][] = []
    carla.session.on("message", (evento) => {
      if (evento.cargosNovos) vistos.push(evento.cargosNovos)
    })
    await ana.session.assignRoles(CANAL, carla.address, ["anuncios", "mods"])
    await settle(120)
    expect(vistos).toEqual([
      [
        { role: "anuncios", nome: "Anúncios" },
        { role: "mods", nome: "Moderação", cor: "lima" },
      ],
    ])
    // Taking one away: no notice.
    await ana.session.assignRoles(CANAL, carla.address, ["mods"])
    await settle(120)
    // The same list again (a republish): no notice.
    await ana.session.assignRoles(CANAL, carla.address, ["mods"])
    await settle(120)
    expect(vistos).toHaveLength(1)
  })

  it("repetições, cascatas e atribuições antigas não dão aviso: só a primeira, ao vivo e recente", async () => {
    const { ana, carla } = await canalComTres()
    await ana.session.defineRole(CANAL, { role: "mods", name: "Moderação", powers: [], colour: "lima", rank: 2 })
    await settle(80)
    const vistos: { role: string; nome?: string; cor?: string }[][] = []
    carla.session.on("message", (evento) => {
      if (evento.cargosNovos) vistos.push(evento.cargosNovos)
    })
    // An assignment made two hours ago, repeated now by a state cascade: the roles
    // are new to Carla, but the act is old. It applies, quietly.
    const antiga = { t: "role.assign" as const, subject: carla.address, roles: ["anuncios"], assignedAt: Date.now() - 2 * 3_600_000 }
    await ana.session.send(CANAL, antiga)
    await settle(120)
    expect(carla.session.rolesFor(CANAL, carla.address)).toEqual(["anuncios"])
    expect(vistos).toEqual([])
    // A fresh assignment repeated in a burst, before any vault write (the cascade
    // since 1.3.12): one notice, not one per copy.
    const nova = { t: "role.assign" as const, subject: carla.address, roles: ["anuncios", "mods"], assignedAt: Date.now() }
    await Promise.all(Array.from({ length: 5 }, () => ana.session.send(CANAL, nova)))
    await settle(200)
    expect(vistos).toEqual([[{ role: "mods", nome: "Moderação", cor: "lima" }]])
    expect(carla.session.rolesFor(CANAL, carla.address).sort()).toEqual(["anuncios", "mods"])
  })
})
