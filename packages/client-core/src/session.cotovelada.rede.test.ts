import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { ReceivedMessage } from "./session.js"
// The real server, on an ephemeral port.
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * Direct conversations, between real clients (12/11/2026).
 *
 * 1. Opening a direct with someone who is not a friend reaches that person only as
 *    cryptography: a channel and, at most, the opener's profile. Nothing said (no
 *    message, no friend request), which is what the interface needs to stay silent.
 * 2. The nudge exists only in direct conversations. A nudge that arrives on a group
 *    channel (an altered client can send one) is dropped on the receiving side and
 *    shakes nobody; the same nudge in a direct arrives.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

function cotoveladas(conta: ContaDeTeste): string[] {
  const vistas: string[] = []
  conta.session.on("buzz", (evento) => vistas.push(evento.channel))
  return vistas
}

function recebidas(conta: ContaDeTeste): ReceivedMessage[] {
  const vistas: ReceivedMessage[] = []
  conta.session.on("message", (evento: ReceivedMessage) => vistas.push(evento))
  return vistas
}

describe("abrir uma directa sem amizade", () => {
  it("o Bruno fica com o canal e nada dito: nem mensagem, nem pedido de amizade", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const doBruno = recebidas(bruno!)

    const dm = await ana!.session.openDirect(bruno!.address)
    await ate(() => bruno!.session.channels.includes(dm), "o Bruno é sentado na directa", 30_000)
    expect(bruno!.session.tipoDoCanal(dm)).toBe("directa")

    // A real message afterwards is the fence: once it arrives, whatever the opening
    // sent has arrived too.
    await ana!.session.send(dm, { t: "message", body: "marco", sentAt: Date.now(), id: "marco-0001" })
    await ate(
      () => doBruno.some((m) => m.channel === dm && m.payload.t === "message"),
      "o Bruno recebe o marco",
      30_000,
    )
    const antesDoMarco = doBruno.filter((m) => m.channel === dm && (m.payload as { id?: string }).id !== "marco-0001")
    expect(antesDoMarco.filter((m) => m.payload.t === "message" || m.payload.t === "friend.request")).toEqual([])
  }, 120_000)
})

describe("a cotovelada só existe nas directas", () => {
  it("vinda de um canal de grupo não chega; numa directa chega", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const sentidas = cotoveladas(bruno!)
    const doBruno = recebidas(bruno!)

    // An altered client sends a nudge into the group channel, then a message as the fence.
    await ana!.session.send(canal, { t: "buzz", at: Date.now() })
    await ana!.session.send(canal, { t: "message", body: "depois", sentAt: Date.now(), id: "depois-0001" })
    await ate(() => doBruno.some((m) => m.channel === canal && m.payload.t === "message"), "o Bruno recebe a mensagem", 30_000)
    expect(sentidas).toEqual([])

    const dm = await ana!.session.openDirect(bruno!.address)
    await ate(() => bruno!.session.channels.includes(dm), "o Bruno é sentado na directa", 30_000)
    await ana!.session.send(dm, { t: "buzz", at: Date.now() })
    await ate(() => sentidas.length > 0, "o Bruno sente a cotovelada na directa", 30_000)
    expect(sentidas).toEqual([dm])
  }, 120_000)
})
