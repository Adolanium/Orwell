import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * A nudge reaches every device of both accounts (21/11/2026: both sides shake
 * and hear it).
 *
 * The core's part: the `buzz` event fires on the other person's devices and on
 * the sender's OTHER devices. Never on the device that sent it: that one plays
 * its sound when the send is accepted (`useBuzz`), and an echo here would play
 * it twice.
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

function nudgesFelt(conta: ContaDeTeste): { channel: string; from: string }[] {
  const felt: { channel: string; from: string }[] = []
  conta.session.on("buzz", (event) => felt.push({ channel: event.channel, from: String(event.from) }))
  return felt
}

describe("a nudge reaches every device of both accounts", () => {
  it("the other person's two devices and the sender's other device feel it; the sending device does not", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const anaPhone = await emparelharAparelho(ana!)
    abertas.push(anaPhone)
    const brunoPhone = await emparelharAparelho(bruno!)
    abertas.push(brunoPhone)

    const dm = await ana!.session.openDirect(bruno!.address)
    for (const device of [anaPhone, bruno!, brunoPhone]) {
      await ate(() => device.session.channels.includes(dm), `${device.nome} is in the direct conversation`, 60_000)
    }
    const onAna = nudgesFelt(ana!)
    const onAnaPhone = nudgesFelt(anaPhone)
    const onBruno = nudgesFelt(bruno!)
    const onBrunoPhone = nudgesFelt(brunoPhone)

    await ana!.session.send(dm, { t: "buzz", at: Date.now() })
    await ate(
      () => onBruno.length > 0 && onBrunoPhone.length > 0 && onAnaPhone.length > 0,
      "the nudge reaches Bruno's two devices and Ana's phone",
      30_000,
    )
    // A message after the nudge is the fence: once it is in, the nudge had its chance to echo.
    await ana!.session.send(dm, { t: "message", body: "fence", sentAt: Date.now(), id: "fence-nudge-0001" } as never)
    await ate(() => bruno!.session.history(dm).some((e) => e.payload["id"] === "fence-nudge-0001"), "the fence arrives")

    const expected = [{ channel: dm, from: ana!.address }]
    expect(onBruno).toEqual(expected)
    expect(onBrunoPhone).toEqual(expected)
    expect(onAnaPhone).toEqual(expected)
    expect(onAna).toEqual([])
  }, 180_000)
})
