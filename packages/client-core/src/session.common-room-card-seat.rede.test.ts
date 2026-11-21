import { Session } from "@enclave/client-core"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { ate, contasDeTeste, desligarContas, levantarServidor, type ContaDeTeste, type ServidorDeTeste } from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * A device that joins the common room by its card has its place there (21/11/2026).
 *
 * `lugarEm` (the "You joined here" marker, and the place the members' history counts
 * from) was written only when a Welcome seated the device. Entering by the card, the
 * external commit set `seatSince` and nothing else: the place stayed `null`. That is
 * what made `session.historico-membros.rede` fail two runs in three: Carla entered by
 * the card when one was posted, and by a member's Welcome only when she was faster
 * than the card.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  await servidor?.fechar()
})
afterEach(() => {
  desligarContas(abertas.splice(0))
})

describe("the common room, entered by the card", () => {
  it("records the device's place: the seq of its own external commit", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const comum = servidor.sala
    await ana!.session.ensureCommonRoom()
    await ate(() => ana!.session.channels.includes(comum), "Ana is in the common room", 30_000)
    await bruno!.session.ensureCommonRoom()
    await ate(() => bruno!.session.channels.includes(comum), "Bruno is in the common room", 30_000)

    // Bruno's entry moved the epoch: the card for it is posted after CARTAO_ATRASO_MS. Past that, Carla finds it.
    await new Promise((resolve) => setTimeout(resolve, Session.CARTAO_ATRASO_MS + 2_000))
    const [carla] = await contasDeTeste(servidor, ["Carla"])
    abertas.push(carla!)
    const entradas: string[] = []
    carla!.session.on("status", (evento) => {
      if (evento.code === "channel-joined" && evento.channel === comum) entradas.push(evento.detail ?? "")
    })
    await carla!.session.ensureCommonRoom()
    await ate(() => carla!.session.channels.includes(comum), "Carla is in the common room", 30_000)
    // The card path says "entrou em <room> (evento <seq>)"; a member's Welcome says "entrou em <room>".
    await ate(() => entradas.length > 0, "Carla says how she entered", 15_000)
    expect(entradas[0]).toMatch(/\(evento \d+\)$/)

    const seat = carla!.vault.contents.seatSince?.[comum]
    expect(seat).toBeTypeOf("number")
    expect(carla!.session.lugarEm(comum)?.seq).toBe(seat)
  }, 120_000)
})
