import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PODER_DAS_VOTACOES_DESDE_MINUTO } from "@enclave/protocol"
import { Session } from "./session.js"
import { mensagemAEnviar } from "./mensagemAEnviar.js"
import { entradasDoCanal, Vault, type StoredChatMessage, type VaultBackend } from "./vault.js"

/**
 * A poll judged as text (`semVotacao`) because this device did not yet know its
 * author's roles is judged again once the roles arrive (polls-somem, 19/11/2026).
 *
 * The verdict is taken at arrival, against what the device holds at that point. A
 * device that does not yet hold the author's role (a newcomer before the admin's
 * cascade, a role assignment it refused because it did not yet know the assigner
 * was an admin, a role carried by a report) turned a valid poll into text, for good.
 * Same relay as `session.votacoesComCargo.test.ts`.
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
  /** The server minute of receipt, stamped once, as the real server keeps it. */
  minuto: number
}

const TRAMAS_MAXIMAS = 3_000

/**
 * The server minute the relay stamps at receipt. Its own clock by default, like the
 * real server: today is after the cut, so polls are judged. A fixed minute in the
 * past would date every poll before the roles given in the test.
 */
let minutoDoRele: number | undefined
const minutoAgora = (): number => minutoDoRele ?? Math.max(PODER_DAS_VOTACOES_DESDE_MINUTO, Math.floor(Date.now() / 60_000))

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
          minuto: minutoAgora(),
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
            receivedAtMinute: evento.minuto,
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
      receivedAtMinute: evento.minuto,
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
  minutoDoRele = undefined
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

const votacao = (id: string, pergunta = "Pizza ou sushi?", sentAt = Date.now()) =>
  mensagemAEnviar(`${pergunta}\n1. Pizza\n2. Sushi`, undefined, { poll: { question: pergunta, options: ["Pizza", "Sushi"] } } as never, {
    id,
    sentAt,
  })

/** The server receives what follows a minute later than now: the roles given so far are from an earlier minute. */
function umMinutoDepois(): void {
  minutoDoRele = Math.floor(Date.now() / 60_000) + 1
}

/** The entry of message `id` in this account's vault. */
const entradaDe = (quem: Conta, id: string): StoredChatMessage | undefined =>
  entradasDoCanal(quem.vault.contents, CANAL).find((entrada) => entrada.payload.t === "message" && entrada.payload["id"] === id)

/** Message `id` as this account's interface reads it. */
const noEcra = (quem: Conta, id: string) => quem.session.history(CANAL).find((entrada) => entrada.payload["id"] === id)

/** Ana gives Bento a role that creates polls. */
async function darOPoder(ana: Conta, bento: Conta): Promise<void> {
  await ana.session.defineRole(CANAL, { role: "sondagens", name: "Sondagens", powers: ["votacoes"], rank: 1 })
  await settle(40)
  await ana.session.assignRoles(CANAL, bento.address, ["sondagens"])
  await settle(120)
}
/**
 * This device does not know `quem`'s roles yet: what a newcomer holds before the
 * admin's cascade (`#arrumarParaQuemEntrou`), or a device that refused the
 * assignment because it did not yet know the assigner.
 */
function semOsCargosDe(leitor: Conta, quem: string): void {
  delete leitor.vault.contents.channelMemberRoles[CANAL]?.[quem]
  delete leitor.vault.contents.channelMemberRolesAt?.[CANAL]?.[quem]
}

/** The `message` events this account's interface got for `id`. */
function ouvir(quem: Conta, id: string): Record<string, unknown>[] {
  const ouvidas: Record<string, unknown>[] = []
  quem.session.on("message", (evento) => {
    const payload = evento.payload as Record<string, unknown>
    if (payload["id"] === id && payload["t"] === "message") ouvidas.push(payload)
  })
  return ouvidas
}

describe("uma votação julgada sem os cargos do autor é julgada outra vez quando os cargos chegam", () => {
  it("quem tem o cargo: texto enquanto o aparelho não sabe o cargo, votação depois da cascata", async () => {
    const { ana, bento, carla } = await canal()
    await darOPoder(ana, bento)
    semOsCargosDe(carla, bento.address)
    expect(carla.session.mayCreatePoll(CANAL, bento.address)).toBe(false)
    const ouvidas = ouvir(carla, "rejulgar-0001")
    umMinutoDepois()
    await bento.session.send(CANAL, votacao("rejulgar-0001"))
    await settle(120)
    // The wrong verdict, taken at arrival.
    expect(entradaDe(carla, "rejulgar-0001")?.semVotacao).toBe(true)
    expect(noEcra(carla, "rejulgar-0001")?.payload["poll"]).toBeUndefined()
    // The admin's cascade brings the role, with its original date.
    await ana.session.republishAuthority(CANAL)
    await settle(200)
    expect(carla.session.mayCreatePoll(CANAL, bento.address)).toBe(true)
    expect(entradaDe(carla, "rejulgar-0001")?.semVotacao).toBeUndefined()
    expect(noEcra(carla, "rejulgar-0001")?.payload["poll"]).toMatchObject({ question: "Pizza ou sushi?" })
    expect(noEcra(carla, "rejulgar-0001")?.payload["votacaoSemPoder"]).toBeUndefined()
    // And the interface hears it: the last copy it got is the poll.
    expect(ouvidas.at(-1)?.["poll"]).toBeDefined()
    expect(ouvidas.at(-1)?.["votacaoSemPoder"]).toBeUndefined()
  })

  it("um admin cujo cargo o aparelho ainda não sabe: o mesmo", async () => {
    const { ana, bento, carla } = await canal()
    await ana.session.assignRoles(CANAL, bento.address, ["admin"])
    await settle(120)
    semOsCargosDe(carla, bento.address)
    umMinutoDepois()
    await bento.session.send(CANAL, votacao("rejulgar-0002"))
    await settle(120)
    expect(entradaDe(carla, "rejulgar-0002")?.semVotacao).toBe(true)
    await ana.session.republishAuthority(CANAL)
    await settle(200)
    expect(entradaDe(carla, "rejulgar-0002")?.semVotacao).toBeUndefined()
    expect(noEcra(carla, "rejulgar-0002")?.payload["poll"]).toBeDefined()
  })

  it("uma votação julgada antes desta versão, com o cargo já no aparelho: julgada outra vez na primeira escrita do canal", async () => {
    const { ana, bento, carla } = await canal()
    await darOPoder(ana, bento)
    const cargos = structuredClone(carla.vault.contents.channelMemberRoles[CANAL]?.[bento.address])
    const carimbo = structuredClone(carla.vault.contents.channelMemberRolesAt?.[CANAL]?.[bento.address])
    semOsCargosDe(carla, bento.address)
    umMinutoDepois()
    await bento.session.send(CANAL, votacao("antiga-0001"))
    await settle(120)
    expect(entradaDe(carla, "antiga-0001")?.semVotacao).toBe(true)
    // As 1.3.23 left it: no limit on the entry, and the role arrived later, in a session without this fix.
    await carla.session.flush()
    carla.session.disconnect()
    await carla.vault.update((contents) => {
      const entrada = entradasDoCanal(contents, CANAL).find((item) => item.payload["id"] === "antiga-0001")
      delete entrada?.semVotacaoAte
      contents.channelMemberRoles[CANAL]![bento.address] = cargos!
      contents.channelMemberRolesAt![CANAL]![bento.address] = carimbo!
    })
    const reaberta = new Session(carla.vault)
    abertas.push(reaberta)
    reaberta.loadIdentity()
    await reaberta.connect()
    await settle(40)
    expect(entradaDe(carla, "antiga-0001")?.semVotacao).toBe(true)
    // Any message in the channel: the first write of this session judges its text polls again.
    await ana.session.send(CANAL, mensagemAEnviar("bom dia", undefined, undefined, { id: "bom-dia-0001", sentAt: Date.now() }))
    await settle(120)
    expect(entradaDe(carla, "antiga-0001")?.semVotacao).toBeUndefined()
    expect(reaberta.history(CANAL).find((entrada) => entrada.payload["id"] === "antiga-0001")?.payload["poll"]).toBeDefined()
  })

  it("I3: num canal calmo, a leitura do canal basta: sem nenhuma mensagem nova", async () => {
    const { ana, bento, carla } = await canal()
    await darOPoder(ana, bento)
    const cargos = structuredClone(carla.vault.contents.channelMemberRoles[CANAL]?.[bento.address])
    const carimbo = structuredClone(carla.vault.contents.channelMemberRolesAt?.[CANAL]?.[bento.address])
    semOsCargosDe(carla, bento.address)
    umMinutoDepois()
    await bento.session.send(CANAL, votacao("calma-0001"))
    await settle(120)
    expect(entradaDe(carla, "calma-0001")?.semVotacao).toBe(true)
    await carla.session.flush()
    carla.session.disconnect()
    await carla.vault.update((contents) => {
      const entrada = entradasDoCanal(contents, CANAL).find((item) => item.payload["id"] === "calma-0001")
      delete entrada?.semVotacaoAte
      contents.channelMemberRoles[CANAL]![bento.address] = cargos!
      contents.channelMemberRolesAt![CANAL]![bento.address] = carimbo!
    })
    const reaberta = new Session(carla.vault)
    abertas.push(reaberta)
    reaberta.loadIdentity()
    // No connection, no message: the interface only reads the channel.
    const lida = reaberta.history(CANAL).find((entrada) => entrada.payload["id"] === "calma-0001")
    expect(lida?.payload["poll"]).toBeDefined()
    expect(entradaDe(carla, "calma-0001")?.semVotacao).toBeUndefined()
  })

  it("I4: uma sala renomeada depois da votação não a deixa em texto", async () => {
    const { ana, bento, carla } = await canal()
    await ana.session.upsertRoom(CANAL, { room: "votos", name: "Votos", kind: "text" })
    await settle(80)
    await darOPoder(ana, bento)
    semOsCargosDe(carla, bento.address)
    umMinutoDepois()
    await bento.session.send(
      CANAL,
      mensagemAEnviar("Pizza ou sushi?\n1. Pizza\n2. Sushi", "votos", { poll: { question: "Pizza ou sushi?", options: ["Pizza", "Sushi"] } } as never, {
        id: "sala-0001",
        sentAt: Date.now(),
      }),
    )
    await settle(120)
    expect(entradaDe(carla, "sala-0001")?.semVotacao).toBe(true)
    // Ana renames the room two minutes later, by her clock.
    const agora = Date.now()
    const relogio = vi.spyOn(Date, "now").mockImplementation(() => agora + 120_000)
    await ana.session.upsertRoom(CANAL, { room: "votos", name: "Votações", kind: "text" })
    await settle(80)
    relogio.mockRestore()
    await ana.session.republishAuthority(CANAL)
    await settle(200)
    expect(entradaDe(carla, "sala-0001")?.semVotacao).toBeUndefined()
  })

  it("I2: uma entrada sem limite com sentAt no futuro fica limitada à primeira vista", async () => {
    const { ana, bento, carla } = await canal()
    vi.spyOn(bento.session, "mayCreatePoll").mockReturnValue(true)
    await bento.session.send(CANAL, votacao("futuro-0001", "Futuro?", Date.now() + 3_600_000))
    await settle(120)
    // As 1.3.23 (or an old sibling) wrote it: no limit.
    delete entradaDe(carla, "futuro-0001")!.semVotacaoAte
    // A first view: any role write in the channel.
    await ana.session.defineRole(CANAL, { role: "outro", name: "Outro", powers: ["reagir"], rank: 0 })
    await settle(80)
    expect(entradaDe(carla, "futuro-0001")?.semVotacaoAte).toBeLessThanOrEqual(Date.now())
    // Bento gets the power for real, two minutes later: after the stamp, so it does not count.
    const agora = Date.now()
    const relogio = vi.spyOn(Date, "now").mockImplementation(() => agora + 120_000)
    await darOPoder(ana, bento)
    relogio.mockRestore()
    await ana.session.republishAuthority(CANAL)
    await settle(200)
    expect(carla.session.mayCreatePoll(CANAL, bento.address)).toBe(true)
    expect(entradaDe(carla, "futuro-0001")?.semVotacao).toBe(true)
  })

  it("a fundadora passa sempre, mesmo sem nenhum cargo conhecido (controlo)", async () => {
    const { ana, carla } = await canal()
    carla.vault.contents.channelMemberRoles[CANAL] = {}
    await ana.session.send(CANAL, votacao("fundadora-0001"))
    await settle(120)
    expect(entradaDe(carla, "fundadora-0001")?.semVotacao).toBeUndefined()
    expect(noEcra(carla, "fundadora-0001")?.payload["poll"]).toBeDefined()
  })

  it("nunca forja: uma votação sem o poder continua texto, também quando o cargo é dado depois dela", async () => {
    const { ana, bento, carla } = await canal()
    // The altered client answers yes to its own gate.
    vi.spyOn(bento.session, "mayCreatePoll").mockReturnValue(true)
    await bento.session.send(CANAL, votacao("forjada-0101"))
    await settle(120)
    expect(entradaDe(carla, "forjada-0101")?.semVotacao).toBe(true)
    // The cascade alone changes nothing: Bento has no role.
    await ana.session.republishAuthority(CANAL)
    await settle(200)
    expect(entradaDe(carla, "forjada-0101")?.semVotacao).toBe(true)
    // A role given AFTER the poll does not turn it into a poll: dated after it.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await darOPoder(ana, bento)
    expect(carla.session.mayCreatePoll(CANAL, bento.address)).toBe(true)
    expect(entradaDe(carla, "forjada-0101")?.semVotacao).toBe(true)
    expect(noEcra(carla, "forjada-0101")?.payload["poll"]).toBeUndefined()
    expect(noEcra(carla, "forjada-0101")?.payload["votacaoSemPoder"]).toBe(true)
  })

  it("nunca forja: um sentAt no futuro não faz contar um cargo dado no mesmo minuto do servidor", async () => {
    const { ana, bento, carla } = await canal()
    vi.spyOn(bento.session, "mayCreatePoll").mockReturnValue(true)
    // The server minute stays fixed: poll and role in the same minute.
    minutoDoRele = Math.floor(Date.now() / 60_000)
    await bento.session.send(CANAL, votacao("forjada-0102", "Futuro?", Date.now() + 3_600_000))
    await settle(120)
    expect(entradaDe(carla, "forjada-0102")?.semVotacao).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await darOPoder(ana, bento)
    await ana.session.republishAuthority(CANAL)
    await settle(200)
    expect(carla.session.mayCreatePoll(CANAL, bento.address)).toBe(true)
    expect(entradaDe(carla, "forjada-0102")?.semVotacao).toBe(true)
    expect(noEcra(carla, "forjada-0102")?.payload["poll"]).toBeUndefined()
  })

  it("nunca forja: um cargo que ganhou o poder depois da votação não conta", async () => {
    const { ana, bento, carla } = await canal()
    // Bento has a role without `votacoes` before the poll.
    await ana.session.defineRole(CANAL, { role: "sondagens", name: "Sondagens", powers: ["reagir"], rank: 1 })
    await settle(40)
    await ana.session.assignRoles(CANAL, bento.address, ["sondagens"])
    await settle(120)
    vi.spyOn(bento.session, "mayCreatePoll").mockReturnValue(true)
    umMinutoDepois()
    await bento.session.send(CANAL, votacao("forjada-0103"))
    await settle(120)
    expect(entradaDe(carla, "forjada-0103")?.semVotacao).toBe(true)
    // The role gains the power two minutes later, by Ana's clock: its date is after the poll.
    const agora = Date.now()
    const relogio = vi.spyOn(Date, "now").mockImplementation(() => agora + 120_000)
    await ana.session.defineRole(CANAL, { role: "sondagens", name: "Sondagens", powers: ["reagir", "votacoes"], rank: 1 })
    await settle(40)
    relogio.mockRestore()
    // And the cascade re-sends Bento's assignment, dated before the poll.
    await ana.session.republishAuthority(CANAL)
    await settle(200)
    expect(carla.session.mayCreatePoll(CANAL, bento.address)).toBe(true)
    expect(entradaDe(carla, "forjada-0103")?.semVotacao).toBe(true)
  })

  /*
    I1 of the polls-somem review: a tie of timestamps. `venceCarimbo` gives the win
    to the larger server `seq` when the date is equal, and `#tinhaOPoder` read only
    the date stored. Someone with authority over roles, on an altered client, could
    re-send a definition or an assignment with the date already stored and new
    content: it won by `seq`, the stored date stayed before the poll, and an old poll
    of somebody else turned into a poll. An honest client never ties
    (`#carimboSeguinte`).
  */
  it("I1: nunca forja: um cargo redefinido com a data guardada (empate) não valida uma votação antiga", async () => {
    const { ana, bento, carla } = await canal()
    await ana.session.defineRole(CANAL, { role: "sondagens", name: "Sondagens", powers: ["reagir"], rank: 1 })
    await settle(40)
    await ana.session.assignRoles(CANAL, bento.address, ["sondagens"])
    await settle(120)
    vi.spyOn(bento.session, "mayCreatePoll").mockReturnValue(true)
    umMinutoDepois()
    await bento.session.send(CANAL, votacao("empate-0001"))
    await settle(120)
    expect(entradaDe(carla, "empate-0001")?.semVotacao).toBe(true)
    // Ana's altered client: the same role, now with `votacoes`, and the date already stored.
    const definidoEm = carla.vault.contents.channelRoles[CANAL]?.["sondagens"]?.at
    expect(definidoEm).toBeDefined()
    await ana.session.send(CANAL, {
      t: "role.define",
      role: "sondagens",
      name: "Sondagens",
      powers: ["reagir", "votacoes"],
      position: 0,
      rank: 1,
      removed: false,
      definedAt: definidoEm!,
    } as never)
    await settle(120)
    // The definition is accepted (it won the tie by `seq`): the power is there now.
    expect(carla.vault.contents.channelRoles[CANAL]?.["sondagens"]?.at).toBe(definidoEm)
    expect(carla.session.mayCreatePoll(CANAL, bento.address)).toBe(true)
    // But it changed after the poll, in server order: the old poll stays text.
    expect(entradaDe(carla, "empate-0001")?.semVotacao).toBe(true)
    await ana.session.republishAuthority(CANAL)
    await settle(200)
    expect(entradaDe(carla, "empate-0001")?.semVotacao).toBe(true)
    expect(noEcra(carla, "empate-0001")?.payload["poll"]).toBeUndefined()
  })

  it("I1: nunca forja: uma atribuição re-enviada com a data guardada (empate) não valida uma votação antiga", async () => {
    const { ana, bento, carla } = await canal()
    await ana.session.defineRole(CANAL, { role: "sondagens", name: "Sondagens", powers: ["votacoes"], rank: 1 })
    await settle(40)
    await ana.session.defineRole(CANAL, { role: "leitores", name: "Leitores", powers: ["reagir"], rank: 0 })
    await settle(40)
    await ana.session.assignRoles(CANAL, bento.address, ["leitores"])
    await settle(120)
    vi.spyOn(bento.session, "mayCreatePoll").mockReturnValue(true)
    umMinutoDepois()
    await bento.session.send(CANAL, votacao("empate-0002"))
    await settle(120)
    expect(entradaDe(carla, "empate-0002")?.semVotacao).toBe(true)
    // Ana's altered client: Bento's assignment with the role that creates polls, and the date already stored.
    const atribuidoEm = carla.vault.contents.channelMemberRolesAt?.[CANAL]?.[bento.address]?.at
    expect(atribuidoEm).toBeDefined()
    await ana.session.send(CANAL, { t: "role.assign", subject: bento.address, roles: ["sondagens"], assignedAt: atribuidoEm! } as never)
    await settle(120)
    expect(carla.vault.contents.channelMemberRolesAt?.[CANAL]?.[bento.address]?.at).toBe(atribuidoEm)
    expect(carla.session.mayCreatePoll(CANAL, bento.address)).toBe(true)
    expect(entradaDe(carla, "empate-0002")?.semVotacao).toBe(true)
    await ana.session.republishAuthority(CANAL)
    await settle(200)
    expect(entradaDe(carla, "empate-0002")?.semVotacao).toBe(true)
  })
})
