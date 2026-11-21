import { moradaDeSala } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { ate, contasDeTeste, desligarContas, levantarServidor, type ContaDeTeste, type ServidorDeTeste } from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * Layer A (21/11/2026): a key package a refused commit left unspent is used next time,
 * not claimed again.
 *
 * Production, 20-21/11/2026: one device burned more than a hundred key
 * packages in four hours and got six Welcomes. The shape: members answer the same seat
 * at the same time, each claims a package of the device, one commit wins the epoch, and
 * the others are refused (`stale-epoch`). The loser, on its retry, finds the device
 * already seated and commits nothing: the package it claimed was spent on the server and
 * used by no one. The next repair claimed again.
 *
 * Here Bruno and Carla seat Dora in the same channel at once. Both claim, one commit
 * wins. The loser keeps Dora's unspent package and uses it to seat her in a second
 * channel, with no claim; Dora opens that Welcome, so the package was good. The server
 * ties the refusal to the claim just before it on the same connection.
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

const contagem = (qual: "pacotesServidos" | "recusasDepoisDeReclamar" | "recusasPorEpoca"): number =>
  servidor.enclave.gateway.lugares.contagem().contagens[qual].ultimaHora

describe("unspent key packages after concurrent commits", () => {
  it("the loser of the epoch keeps the package it claimed, and seats with it later without claiming", async () => {
    const [bruno, carla, dora] = await contasDeTeste(servidor, ["Bruno", "Carla", "Dora"], { salaComum: false })
    abertas.push(bruno!, carla!, dora!)
    const primeiro = moradaDeSala(servidor.casa)
    const segundo = moradaDeSala(servidor.casa)
    for (const canal of [primeiro, segundo]) {
      await bruno!.session.createSpaceChannel(canal)
      await ate(() => bruno!.session.founderOf(canal) === bruno!.address, "Bruno founds the channel")
      await bruno!.session.seat(canal, carla!.address)
      await ate(() => carla!.session.channels.includes(canal), "Carla is in the channel", 15_000)
    }

    // The race, until it happens: both claim before either commit lands.
    let corrida = false
    for (let volta = 0; volta < 5 && !corrida; volta++) {
      const canal = volta === 0 ? primeiro : moradaDeSala(servidor.casa)
      if (volta > 0) {
        await bruno!.session.createSpaceChannel(canal)
        await ate(() => bruno!.session.founderOf(canal) === bruno!.address, "Bruno founds the channel")
        await bruno!.session.seat(canal, carla!.address)
        await ate(() => carla!.session.channels.includes(canal), "Carla is in the channel", 15_000)
      }
      const servidosAntes = contagem("pacotesServidos")
      const recusasAntes = contagem("recusasDepoisDeReclamar")
      await Promise.allSettled([bruno!.session.seat(canal, dora!.address), carla!.session.seat(canal, dora!.address)])
      await ate(() => dora!.session.channels.includes(canal), "Dora is in the channel", 15_000)
      corrida = contagem("pacotesServidos") - servidosAntes === 2 && contagem("recusasDepoisDeReclamar") > recusasAntes
    }
    expect(corrida).toBe(true)

    // The loser has Dora's package, unspent; the winner has none.
    const porGastar = [bruno!, carla!].map((conta) => conta.session.pacotesPorGastar(dora!.address))
    expect(porGastar.sort()).toEqual([0, 1])
    const perdedor = bruno!.session.pacotesPorGastar(dora!.address) === 1 ? bruno! : carla!

    // The loser seats Dora in the second channel: no claim, and Dora opens the Welcome.
    const servidosAntes = contagem("pacotesServidos")
    await perdedor.session.seat(segundo, dora!.address)
    await ate(() => dora!.session.channels.includes(segundo), "Dora opens the Welcome made with the kept package", 15_000)
    expect(contagem("pacotesServidos")).toBe(servidosAntes)
    expect(perdedor.session.pacotesPorGastar(dora!.address)).toBe(0)
  }, 180_000)
})
