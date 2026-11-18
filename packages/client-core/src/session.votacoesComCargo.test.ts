import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MAX_PODERES_NO_FIO, PODER_DAS_VOTACOES_DESDE_MINUTO, POWERS } from "@enclave/protocol"
import { Session } from "./session.js"
import { mensagemAEnviar } from "./mensagemAEnviar.js"
import { lerVoto } from "./votos.js"
import { entradasDoCanal, Vault, type StoredChatMessage, type VaultBackend } from "./vault.js"

/**
 * Creating polls needs a role (`votacoes`, 1.3.21), and deleting a poll takes its
 * votes with it. Three real accounts with a real relay, copied from
 * `session.lapideComAutoridade.test.ts`; the relay stamps each event with a
 * server minute (`minutoDoRele`), which is what decides whether a poll is judged.
 * What is measured is always the reader's vault and what the reader hands the
 * interface (`history`, the `message` event).
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

/** The server minute the relay stamps. After the cut by default: polls are judged. */
let minutoDoRele = PODER_DAS_VOTACOES_DESDE_MINUTO + 60

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
            receivedAtMinute: minutoDoRele,
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
      receivedAtMinute: minutoDoRele,
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
  minutoDoRele = PODER_DAS_VOTACOES_DESDE_MINUTO + 60
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

const CANAL = moradaDeTeste("lagar")


/** Ana founds the channel; Bento and Carla join as plain members. */
async function canal(): Promise<{ ana: Conta; bento: Conta; carla: Conta }> {
  const ana = await conta()
  const bento = await conta()
  const carla = await conta()
  await ana.session.createSpaceChannel(CANAL)
  await settle(20)
  await ana.session.seat(CANAL, bento.address)
  await settle(80)
  await ana.session.seat(CANAL, carla.address)
  await settle(120)
  return { ana, bento, carla }
}

const votacao = (id: string, pergunta = "Pizza ou sushi?") =>
  mensagemAEnviar(`${pergunta}\n1. Pizza\n2. Sushi`, undefined, { poll: { question: pergunta, options: ["Pizza", "Sushi"] } } as never, {
    id,
    sentAt: Date.now(),
  })

/** The entry of message `id` in this account's vault. */
const entradaDe = (quem: Conta, id: string): StoredChatMessage | undefined =>
  entradasDoCanal(quem.vault.contents, CANAL).find((entrada) => entrada.payload.t === "message" && entrada.payload["id"] === id)

/** Message `id` as this account's interface reads it. */
const noEcra = (quem: Conta, id: string) => quem.session.history(CANAL).find((entrada) => entrada.payload["id"] === id)

/** The votes for `alvo` this account's vault keeps. */
const votosGuardados = (quem: Conta, alvo: string): StoredChatMessage[] =>
  entradasDoCanal(quem.vault.contents, CANAL).filter((entrada) => lerVoto(entrada)?.alvo === alvo)

/** Ana gives Bento a role that creates polls. */
async function darOPoder(ana: Conta, bento: Conta): Promise<void> {
  await ana.session.defineRole(CANAL, { role: "sondagens", name: "Sondagens", powers: ["votacoes"], rank: 1 })
  await settle(40)
  await ana.session.assignRoles(CANAL, bento.address, ["sondagens"])
  await settle(120)
}

describe("criar votações pede um cargo", () => {
  it("sem o poder, a app não oferece e o núcleo recusa o envio; a fundadora pode", async () => {
    const { ana, bento } = await canal()
    expect(ana.session.mayCreatePoll(CANAL)).toBe(true)
    expect(bento.session.mayCreatePoll(CANAL)).toBe(false)
    // As Ana sees it, too: the same question about Bento.
    expect(ana.session.mayCreatePoll(CANAL, bento.address)).toBe(false)
    await expect(bento.session.send(CANAL, votacao("forjada-0001"))).rejects.toThrow("you may not create polls in this channel")
  })

  it("uma votação de quem não tem o poder (cliente alterado) lê-se como mensagem normal, e os votos não contam", async () => {
    const { ana, bento, carla } = await canal()
    const recebidas: unknown[] = []
    carla.session.on("message", (evento) => {
      if ((evento.payload as { id?: unknown }).id === "forjada-0002") recebidas.push(evento.payload)
    })
    // The altered client answers yes to its own gate.
    vi.spyOn(bento.session, "mayCreatePoll").mockReturnValue(true)
    await bento.session.send(CANAL, votacao("forjada-0002"))
    await settle(120)
    for (const quem of [ana, carla]) {
      // Kept whole, as signed, with the verdict on the entry.
      expect(entradaDe(quem, "forjada-0002")?.payload["poll"]).toBeDefined()
      expect(entradaDe(quem, "forjada-0002")?.semVotacao).toBe(true)
      // And the interface gets a plain message: the body, and no poll.
      const linha = noEcra(quem, "forjada-0002")
      expect(linha?.payload["body"]).toBe("Pizza ou sushi?\n1. Pizza\n2. Sushi")
      expect(linha?.payload["poll"]).toBeUndefined()
      // Marked for the screen, so the polls room shows its text with a note and not nothing (diag-votacao).
      expect(linha?.payload["votacaoSemPoder"]).toBe(true)
    }
    expect(recebidas).toHaveLength(1)
    expect((recebidas[0] as { poll?: unknown }).poll).toBeUndefined()
    expect((recebidas[0] as { votacaoSemPoder?: unknown }).votacaoSemPoder).toBe(true)
    // A vote for it is a vote for no poll: the vault's cap takes it first (`votosAGuardar`).
    await ana.session.voteOnPoll(CANAL, "forjada-0002", 0)
    await settle(80)
    expect(noEcra(carla, "forjada-0002")?.payload["poll"]).toBeUndefined()
  })

  it("a fundadora liga o poder a um cargo: quem o tem cria, e a votação chega como votação", async () => {
    const { ana, bento, carla } = await canal()
    await darOPoder(ana, bento)
    expect(bento.session.mayCreatePoll(CANAL)).toBe(true)
    expect(carla.session.mayCreatePoll(CANAL)).toBe(false)
    await bento.session.send(CANAL, votacao("valida-0001"))
    await settle(120)
    for (const quem of [ana, carla, bento]) {
      expect(noEcra(quem, "valida-0001")?.payload["poll"]).toMatchObject({ question: "Pizza ou sushi?" })
      expect(entradaDe(quem, "valida-0001")?.semVotacao).toBeUndefined()
    }
    // Taking the role later does not turn the accepted poll into text: judged at arrival.
    await ana.session.assignRoles(CANAL, bento.address, [])
    await settle(120)
    expect(bento.session.mayCreatePoll(CANAL)).toBe(false)
    expect(noEcra(carla, "valida-0001")?.payload["poll"]).toBeDefined()
  })

  it("uma fundadora em 1.3.20 que republica o cargo com a data original não lhe tira o poder", async () => {
    const { ana, bento, carla } = await canal()
    await darOPoder(ana, bento)
    const guardado = carla.vault.contents.channelRoles[CANAL]?.["sondagens"]
    expect(guardado?.payload["powers"]).toEqual(["votacoes"])
    // What a 1.3.20 republishes on each join: its own `POWERS` (no `votacoes`), the original date.
    await ana.session.send(CANAL, {
      t: "role.define",
      role: "sondagens",
      name: "Sondagens",
      powers: [],
      position: 0,
      rank: 1,
      removed: false,
      definedAt: guardado?.payload["definedAt"] as number,
    })
    await settle(120)
    expect(carla.session.mayCreatePoll(CANAL, bento.address)).toBe(true)
    // An edit (a new date) does change it.
    await ana.session.defineRole(CANAL, { role: "sondagens", name: "Sondagens", powers: [], rank: 1 })
    await settle(120)
    expect(carla.session.mayCreatePoll(CANAL, bento.address)).toBe(false)
  })

  it("a republicação 1.3.20 e a votação recuperadas na MESMA página: a votação chega como votação (I1)", async () => {
    const { ana, bento, carla } = await canal()
    await darOPoder(ana, bento)
    const definidoEm = carla.vault.contents.channelRoles[CANAL]?.["sondagens"]?.payload["definedAt"] as number
    // Carla is offline while both happen: she catches up on them in one page, with one write.
    carla.session.disconnect()
    await settle(20)
    await ana.session.send(CANAL, {
      t: "role.define",
      role: "sondagens",
      name: "Sondagens",
      powers: [],
      position: 0,
      rank: 1,
      removed: false,
      definedAt: definidoEm,
    })
    await bento.session.send(CANAL, votacao("mesma-pagina-01"))
    await settle(40)
    await carla.session.connect()
    await settle(200)
    expect(entradaDe(carla, "mesma-pagina-01")).toBeDefined()
    expect(entradaDe(carla, "mesma-pagina-01")?.semVotacao).toBeUndefined()
    expect(noEcra(carla, "mesma-pagina-01")?.payload["poll"]).toBeDefined()
  })

  it("nenhum cargo sai com mais de 32 poderes, nem com os 33 nomes pedidos ao núcleo (M2)", async () => {
    const { ana, carla } = await canal()
    await expect(ana.session.defineRole(CANAL, { role: "tudo", name: "Tudo", powers: [...POWERS], rank: 1 })).resolves.toBeUndefined()
    await settle(80)
    const poderes = carla.vault.contents.channelRoles[CANAL]?.["tudo"]?.payload["powers"] as string[] | undefined
    expect(poderes).toHaveLength(MAX_PODERES_NO_FIO)
    // And the republish does not throw on it, nor cut what comes after.
    await expect(ana.session.republishAuthority(CANAL)).resolves.toBeUndefined()
  })

  it("a marca votacaoSemPoder não se aceita do fio (I3 da revisão do diag-votacao)", async () => {
    const { ana, bento } = await canal()
    const recebidas: unknown[] = []
    ana.session.on("message", (evento) => {
      if ((evento.payload as { id?: unknown }).id === "marca-0001") recebidas.push(evento.payload)
    })
    const forjada = mensagemAEnviar("texto de outra pessoa", undefined, { votacaoSemPoder: true } as never, { id: "marca-0001", sentAt: Date.now() })
    await bento.session.send(CANAL, forjada)
    await settle(120)
    expect(noEcra(ana, "marca-0001")?.payload["body"]).toBe("texto de outra pessoa")
    expect(noEcra(ana, "marca-0001")?.payload["votacaoSemPoder"]).toBeUndefined()
    expect(recebidas).toHaveLength(1)
    expect((recebidas[0] as { votacaoSemPoder?: unknown }).votacaoSemPoder).toBeUndefined()
  })

  it("uma votação que o servidor recebeu antes do corte não é julgada: vale como em 1.3.20", async () => {
    const { ana, bento } = await canal()
    minutoDoRele = PODER_DAS_VOTACOES_DESDE_MINUTO - 1
    vi.spyOn(bento.session, "mayCreatePoll").mockReturnValue(true)
    await bento.session.send(CANAL, votacao("antiga-0001"))
    await settle(120)
    expect(noEcra(ana, "antiga-0001")?.payload["poll"]).toBeDefined()
    expect(entradaDe(ana, "antiga-0001")?.semVotacao).toBeUndefined()
    expect(noEcra(ana, "antiga-0001")?.payload["votacaoSemPoder"]).toBeUndefined()
  })
})

describe("eliminar uma votação", () => {
  it("o autor elimina: sai do ecrã dos outros pela lápide, e os votos saem do cofre", async () => {
    const { ana, bento, carla } = await canal()
    await darOPoder(ana, bento)
    await bento.session.send(CANAL, votacao("apagar-0001"))
    await settle(120)
    await ana.session.voteOnPoll(CANAL, "apagar-0001", 0)
    await carla.session.voteOnPoll(CANAL, "apagar-0001", 1)
    await settle(120)
    for (const quem of [ana, bento, carla]) expect(votosGuardados(quem, "apagar-0001")).toHaveLength(2)
    await bento.session.deleteMessage(CANAL, "apagar-0001")
    await settle(120)
    for (const quem of [ana, bento, carla]) {
      // The tombstone is in the history: the conversation fold hides the poll, as any message.
      expect(quem.session.history(CANAL).some((e) => e.payload.t === "redact" && e.payload["target"] === "apagar-0001")).toBe(true)
      expect(votosGuardados(quem, "apagar-0001")).toHaveLength(0)
    }
    // A late vote for it (an older client that had not heard) is not stored either.
    await ana.session.send(CANAL, { t: "post.reaction", id: crypto.randomUUID(), target: "apagar-0001", emoji: "", at: Date.now(), remove: false, vote: 1 })
    await settle(120)
    for (const quem of [bento, carla]) expect(votosGuardados(quem, "apagar-0001")).toHaveLength(0)
  })

  it("quem modera elimina a votação de outra pessoa, e os votos saem; uma lápide sem autoridade não os tira", async () => {
    const { ana, bento, carla } = await canal()
    await darOPoder(ana, bento)
    await bento.session.send(CANAL, votacao("apagar-0002"))
    await bento.session.send(CANAL, votacao("apagar-0003", "Praia ou campo?"))
    await settle(120)
    await carla.session.voteOnPoll(CANAL, "apagar-0002", 1)
    await carla.session.voteOnPoll(CANAL, "apagar-0003", 0)
    await settle(120)
    // Carla does not moderate: her tombstone on Bento's poll (an altered client) deletes nothing.
    await carla.session.send(CANAL, { t: "redact", id: crypto.randomUUID(), target: "apagar-0003", redactedAt: Date.now() })
    // Ana founded the channel: she moderates.
    await ana.session.deleteMessage(CANAL, "apagar-0002")
    await settle(160)
    for (const quem of [ana, bento]) {
      expect(votosGuardados(quem, "apagar-0002")).toHaveLength(0)
      expect(votosGuardados(quem, "apagar-0003")).toHaveLength(1)
    }
  })
})
