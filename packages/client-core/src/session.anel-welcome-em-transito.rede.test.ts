import { Session } from "@enclave/client-core"
import { generateIdentity, moradaDeSala } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Gateway } from "../../../apps/server/src/gateway.js"
import {
  ate,
  Cliente,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * Resetting a stuck ring must not drop the half of a Welcome still on its way
 * (review of 1.3.19, R1).
 *
 * The server serves the newest packages first, so the last package to leave the
 * pool is the oldest one, at the head of the ring: exactly what the reset drops.
 * Outside login the `keypackage.low` of the claim that empties the pool arrives
 * before that claim's Welcome; at login nothing waited for the Welcomes of
 * `welcome.resync`. Either way the Welcome arrived dead and the inviter saw the
 * seat as given.
 */

// The harness's sessions run the built package, so its statics are the ones to change.
const AVISO = Gateway.AVISO_DE_CHAVES_MS
const ESPERA = Session.ESPERA_ANTES_DE_REINICIAR_O_ANEL_MS

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  await servidor?.fechar()
})
beforeEach(() => {
  // A short wait, so the test does not sit out 30 s.
  Session.ESPERA_ANTES_DE_REINICIAR_O_ANEL_MS = 2_000
  Gateway.AVISO_DE_CHAVES_MS = 200
})
afterEach(() => {
  desligarContas(abertas.splice(0))
  Session.ESPERA_ANTES_DE_REINICIAR_O_ANEL_MS = ESPERA
  Gateway.AVISO_DE_CHAVES_MS = AVISO
})

const reserva = (conta: ContaDeTeste): number => servidor.enclave.store.availableKeyPackages(conta.address)

/**
 * A Welcome died before the one that seated this account opened.
 *
 * A `welcome-dead` AFTER `channel-joined` is the same Welcome delivered again (each
 * handshake sends `welcome.resync`): its half is spent, it cannot open, and with the
 * channel held it is just an old Welcome.
 */
function mortoAntesDeEntrar(conta: ContaDeTeste): boolean {
  const morto = conta.avisos.indexOf("welcome-dead")
  return morto >= 0 && morto < conta.avisos.indexOf("channel-joined")
}

/**
 * Claims with no Welcome until the ring is at its cap and the server holds one package.
 *
 * At the real cap of 200: with a ring of 40 the Welcome won the race often enough to
 * hide the defect.
 */
async function anelNoTectoComUmaChave(ana: ContaDeTeste): Promise<void> {
  const atacante = await Cliente.ligar(servidor.url, generateIdentity(servidor.casa))
  try {
    for (let i = 0; i < 400; i++) {
      if (ana.session.keyPackagesLocais >= Session.KEY_PACKAGES_LOCAIS_MAX && reserva(ana) === 1) return
      atacante.enviar({ t: "keypackage.claim", address: ana.address })
      await atacante.proximoDe("keypackage.claimed")
      // Time for the nudge to become a top-up of 20, while the ring has room.
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    throw new Error(`o anel não chegou ao tecto com uma chave no servidor (${ana.session.keyPackagesLocais}, ${reserva(ana)})`)
  } finally {
    atacante.fechar()
  }
}

describe("o reinício do anel e o Welcome em trânsito", () => {
  it("fora do login: o keypackage.low da última chave chega antes do Welcome, e o Welcome abre", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"], { salaComum: false })
    abertas.push(ana!, bruno!)
    await anelNoTectoComUmaChave(ana!)
    // Past the nudge window, so the claim below sends one.
    await new Promise((resolve) => setTimeout(resolve, Gateway.AVISO_DE_CHAVES_MS + 100))

    const canal = moradaDeSala(servidor.casa)
    await bruno!.session.createSpaceChannel(canal)
    await ate(() => bruno!.session.founderOf(canal) === bruno!.address, "Bruno funda o canal")
    // Claims the last package (the oldest half of the ring): `keypackage.low` with 0
    // goes to Ana at the claim, the Welcome only after Bruno's commit.
    await bruno!.session.seat(canal, ana!.address)
    await ate(() => ana!.session.channels.includes(canal), "Ana entra no canal pelo Welcome", 10_000)
    // The first Welcome opened. Before, it died and Ana got in only by Bruno's patient
    // seat, a second claim a few seconds later (which needs Bruno still online).
    expect(mortoAntesDeEntrar(ana!)).toBe(false)

    // And the ring still recovers: the Welcome spent a half, the wait sees room, the pool is refilled.
    await ate(() => reserva(ana!) > 0, "a reserva de Ana volta a ter chaves", Session.ESPERA_ANTES_DE_REINICIAR_O_ANEL_MS + 10_000)
  }, 120_000)

  it("no login: o anel só reinicia depois de aplicados os Welcomes do welcome.resync", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"], { salaComum: false })
    abertas.push(ana!, bruno!)
    await anelNoTectoComUmaChave(ana!)
    // No channel to restore, so no catch-up between `welcome.resync` and the key step.
    expect(ana!.session.channels).toEqual([])
    ana!.session.disconnect()

    // While Ana is away, Bruno seats her: the last package, its Welcome waits on the server.
    const canal = moradaDeSala(servidor.casa)
    await bruno!.session.createSpaceChannel(canal)
    await ate(() => bruno!.session.founderOf(canal) === bruno!.address, "Bruno funda o canal")
    await bruno!.session.seat(canal, ana!.address)
    expect(reserva(ana!)).toBe(0)

    await ana!.session.connect()
    await ate(() => ana!.session.channels.includes(canal), "Ana entra no canal pelo Welcome pendente", 10_000)
    expect(mortoAntesDeEntrar(ana!)).toBe(false)
    // The ring was still reset at login: the pool is not left at 0.
    expect(reserva(ana!)).toBeGreaterThan(0)
  }, 120_000)
})
