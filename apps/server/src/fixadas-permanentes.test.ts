import { afterAll, afterEach, describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import type { Payload } from "@enclave/protocol"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * Pinned messages outlive retention (12/11/2026): a pinned message stays until
 * someone deletes it or unpins it.
 *
 * The server deletes ciphertext by retention, and with `expireEvents(0)` it deletes
 * everything. What must survive is the pinned message, with its text, its thumbnail,
 * its author, its date and who pinned it: for those already there, for those who
 * join later, and for new devices. What must disappear is everything else, and the
 * pin itself as soon as someone unpins it or deletes the message.
 *
 * The bad cases are made deterministic: anti-entropy off on whoever joins, and the
 * person who pinned offline when it matters.
 */

const abertas: ContaDeTeste[] = []
const servidores: ServidorDeTeste[] = []

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  for (const servidor of servidores.splice(0)) await servidor.fechar()
})

async function servidorDoCaso(): Promise<ServidorDeTeste> {
  const servidor = await levantarServidor()
  servidores.push(servidor)
  return servidor
}

async function contas(servidor: ServidorDeTeste, ...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  abertas.push(...novas)
  return novas
}

/** A 1x1 PNG, small enough to be its own thumbnail. */
const PNG_MINIMO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

function mensagem(corpo: string, comImagem = false): Payload & { id: string; sentAt: number } {
  return {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: corpo,
    attachments: comImagem
      ? [
          {
            url: "",
            key: "",
            nonce: "",
            digest: "",
            kind: "image",
            name: "cartaz.png",
            mediaType: "image/png",
            byteLength: 68,
            inline: PNG_MINIMO,
          },
        ]
      : [],
    links: [],
    mentions: [],
  } as unknown as Payload & { id: string; sentAt: number }
}

/** How many events of this channel the server still holds. */
function eventosNoServidor(servidor: ServidorDeTeste, canal: string): number {
  const base = new DatabaseSync(servidor.baseDeDados)
  try {
    return Number((base.prepare("SELECT COUNT(*) AS n FROM events WHERE channel = ? AND kind = 'application'").get(canal) as { n: number }).n)
  } finally {
    base.close()
  }
}

const corposFixados = (conta: ContaDeTeste, canal: string): string[] => conta.session.pinnedOf(canal, "").map((f) => f.body)
const temNaHistoria = (conta: ContaDeTeste, canal: string, id: string): boolean =>
  conta.session.history(canal).some((entrada) => (entrada.payload as { id?: string }).id === id)

/** Ana founds the channel with Bruno, writes two messages and pins the first, with its picture. */
async function canalComFixada(servidor: ServidorDeTeste): Promise<{
  ana: ContaDeTeste
  bruno: ContaDeTeste
  canal: string
  fixada: ReturnType<typeof mensagem>
  solta: ReturnType<typeof mensagem>
}> {
  const [ana, bruno] = await contas(servidor, "Ana", "Bruno")
  const canal = await canalComTodos(servidor, ana!, [bruno!])
  const fixada = mensagem("As inscrições fecham na sexta.", true)
  const solta = mensagem("Alguém viu as chaves?")
  await ana!.session.send(canal, fixada)
  await ana!.session.send(canal, solta)
  await ate(() => temNaHistoria(bruno!, canal, solta.id), "o Bruno recebe as duas mensagens")
  await ana!.session.pinMessage(canal, "", {
    id: fixada.id,
    sender: ana!.address,
    body: fixada.body as string,
    sentAt: fixada.sentAt,
    attachments: (fixada as unknown as { attachments: unknown[] }).attachments,
  })
  await ate(() => corposFixados(bruno!, canal).length === 1, "o Bruno vê a fixada")
  await ana!.session.flush()
  await bruno!.session.flush()
  return { ana: ana!, bruno: bruno!, canal, fixada, solta }
}

describe("fixadas permanentes", () => {
  it("retenção a 0: a fixada sobrevive com texto e miniatura, o resto desaparece, e quem entra depois vê-a sem quem fixou ligado", async () => {
    const servidor = await servidorDoCaso()
    const { ana, bruno, canal, fixada, solta } = await canalComFixada(servidor)

    servidor.enclave.store.expireEvents(0)
    expect(eventosNoServidor(servidor, canal)).toBe(0)

    // Whoever pinned goes away. Bruno has no role: he cannot pin.
    ana.session.disconnect()
    expect(bruno.session.mayPin(canal)).toBe(false)
    bruno.session.antiEntropiaLigada = false

    const [carla] = await contas(servidor, "Carla")
    carla!.session.antiEntropiaLigada = false
    await bruno.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra no canal")
    await ate(() => carla!.session.pinnedOf(canal, "").length === 1, "a fixada chega à Carla", 30_000)

    const [vista] = carla!.session.pinnedOf(canal, "")
    expect(vista).toMatchObject({ id: fixada.id, body: fixada.body, sender: ana.address, pinnedBy: ana.address, sentAt: fixada.sentAt })
    expect(vista!.attachments?.[0]).toMatchObject({ name: "cartaz.png", kind: "image", mediaType: "image/png", byteLength: 68 })
    expect(vista!.attachments?.[0]?.thumbnail).toBe(PNG_MINIMO)
    // And the rest is gone: Carla never had it and nobody can give it to her.
    expect(temNaHistoria(carla!, canal, solta.id)).toBe(false)
    expect(temNaHistoria(carla!, canal, fixada.id)).toBe(false)
  }, 120_000)

  it("mudar o nome à sala depois de fixar não tira a fixada a quem entra depois", async () => {
    const servidor = await servidorDoCaso()
    const { ana, bruno, canal, fixada } = await canalComFixada(servidor)
    // The rename does not talk about pins: the record merges, and its signature no longer covers them.
    await ana.session.upsertRoom(canal, { room: "", name: "praça", position: -1 })
    await ate(() => bruno.session.roomsOf(canal).some((sala) => sala.room === "" && sala.name === "praça"), "o Bruno vê o nome novo")
    expect(corposFixados(bruno, canal)).toEqual([fixada.body])
    await bruno.session.flush()

    servidor.enclave.store.expireEvents(0)
    ana.session.disconnect()
    bruno.session.antiEntropiaLigada = false
    const [carla] = await contas(servidor, "Carla")
    carla!.session.antiEntropiaLigada = false
    await bruno.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra no canal")
    await ate(() => corposFixados(carla!, canal).length === 1, "a fixada chega à Carla", 30_000)
    expect(carla!.session.roomsOf(canal).find((sala) => sala.room === "")?.name).toBe("praça")
  }, 120_000)

  it("na sala comum, quem entra pelo cartão vê a fixada sem ninguém com cargo ligado", async () => {
    const servidor = await servidorDoCaso()
    const [ana, bruno] = await contas(servidor, "Ana", "Bruno")
    const comum = servidor.sala
    await ana!.session.ensureCommonRoom()
    await ate(() => ana!.session.channels.includes(comum), "a Ana está na sala comum")
    if (!ana!.session.founderOf(comum)) await ana!.session.claimFounder(comum)
    await ate(() => ana!.session.founderOf(comum) === ana!.address, "a Ana funda a sala comum")
    await bruno!.session.ensureCommonRoom()
    await ate(() => bruno!.session.channels.includes(comum), "o Bruno entra na sala comum", 30_000)
    await ate(() => bruno!.session.founderOf(comum) === ana!.address, "o Bruno sabe quem manda", 30_000)
    const fixada = mensagem("Regras da casa: sejam simpáticos.")
    await ana!.session.send(comum, fixada)
    await ana!.session.pinMessage(comum, "", { id: fixada.id, sender: ana!.address, body: fixada.body as string, sentAt: fixada.sentAt })
    await ate(() => corposFixados(bruno!, comum).length === 1, "o Bruno vê a fixada")
    await ate(() => servidor.enclave.store.hasGroupInfo(comum), "o cartão está no servidor", 30_000)
    await bruno!.session.flush()

    servidor.enclave.store.expireEvents(0)
    ana!.session.disconnect()
    // Anti-entropy stays on, as in production: it is how whoever joins by the card
    // learns who founded the room, and without that no pin list can be judged.
    const [carla] = await contas(servidor, "Carla")
    await carla!.session.ensureCommonRoom()
    await ate(() => carla!.session.channels.includes(comum), "a Carla entra pelo cartão", 30_000)
    await ate(() => corposFixados(carla!, comum).length === 1, "a fixada chega à Carla", 30_000)
  }, 150_000)

  it("quem estava desligado quando se fixou recebe a fixada depois da retenção, de um membro sem cargo", async () => {
    const servidor = await servidorDoCaso()
    const [ana, bruno, carla] = await contas(servidor, "Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    await bruno!.session.flush()
    bruno!.session.disconnect()

    const fixada = mensagem("Reunião na quinta às 21h.")
    await ana!.session.send(canal, fixada)
    await ana!.session.pinMessage(canal, "", { id: fixada.id, sender: ana!.address, body: fixada.body as string, sentAt: fixada.sentAt })
    await ate(() => corposFixados(carla!, canal).length === 1, "a Carla vê a fixada")
    await carla!.session.flush()

    servidor.enclave.store.expireEvents(0)
    ana!.session.disconnect()

    await bruno!.session.connect()
    await ate(() => corposFixados(bruno!, canal).includes("Reunião na quinta às 21h."), "a fixada chega ao Bruno", 60_000)
  }, 150_000)

  it("desafixar tira-a de todos, e quem entra depois também não a vê", async () => {
    const servidor = await servidorDoCaso()
    const { ana, bruno, canal, fixada } = await canalComFixada(servidor)
    await ana.session.unpinMessage(canal, "", fixada.id)
    await ate(() => corposFixados(bruno, canal).length === 0, "o Bruno deixa de a ver")
    await bruno.session.flush()

    servidor.enclave.store.expireEvents(0)
    ana.session.disconnect()
    bruno.session.antiEntropiaLigada = false
    const [carla] = await contas(servidor, "Carla")
    carla!.session.antiEntropiaLigada = false
    await bruno.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra no canal")
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    expect(carla!.session.pinnedOf(canal, "")).toEqual([])
  }, 120_000)

  it("apagar a mensagem fixada tira a cópia de todos, também de quem entra depois", async () => {
    const servidor = await servidorDoCaso()
    const [ana, bruno] = await contas(servidor, "Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const doBruno = mensagem("Vendo bicicleta, 80 euros.")
    await bruno!.session.send(canal, doBruno)
    await ate(() => temNaHistoria(ana!, canal, doBruno.id), "a Ana recebe")
    await ana!.session.pinMessage(canal, "", { id: doBruno.id, sender: bruno!.address, body: doBruno.body as string, sentAt: doBruno.sentAt })
    await ate(() => corposFixados(bruno!, canal).length === 1, "o Bruno vê a fixada")

    // Bruno deletes his own message. He cannot pin or unpin.
    await bruno!.session.deleteMessage(canal, doBruno.id)
    await ate(() => corposFixados(ana!, canal).length === 0, "a fixada sai do ecrã da Ana")
    await ate(() => corposFixados(bruno!, canal).length === 0, "a fixada sai do ecrã do Bruno")
    await ana!.session.flush()
    await bruno!.session.flush()

    servidor.enclave.store.expireEvents(0)
    ana!.session.disconnect()
    bruno!.session.antiEntropiaLigada = false
    const [carla] = await contas(servidor, "Carla")
    carla!.session.antiEntropiaLigada = false
    await bruno!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra no canal")
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    expect(carla!.session.pinnedOf(canal, "")).toEqual([])
  }, 120_000)

  it("um aparelho novo vê a fixada depois da retenção", async () => {
    const servidor = await servidorDoCaso()
    const { bruno, canal, fixada } = await canalComFixada(servidor)
    servidor.enclave.store.expireEvents(0)

    const telemovel = await emparelharAparelho(bruno)
    abertas.push(telemovel)
    await ate(() => telemovel.session.channels.includes(canal), "o telemóvel entra no canal", 60_000)
    await ate(() => telemovel.session.pinnedOf(canal, "").length === 1, "a fixada chega ao telemóvel", 60_000)
    expect(telemovel.session.pinnedOf(canal, "")[0]).toMatchObject({ id: fixada.id, body: fixada.body })
  }, 150_000)
})
