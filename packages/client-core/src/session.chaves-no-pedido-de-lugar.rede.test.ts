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
 * A connected device at 0 key packages hears it from the claim that fails (1.3.25, P4).
 *
 * Production, 20/11/2026: two devices of one account at 0 free of 160 and of 322 for
 * more than a day, connected, and every seat repair for them ended in
 * `reseat-failed … no invite keys`. The server nudged only after a claim that SPENT
 * a package: a burst that emptied the pool inside the nudge window left the last
 * nudge unsaid, and every later claim found nothing and said nothing. A device with
 * its ring at the cap mints nothing on a nudge above 0, so it could not get out by
 * itself until its next login.
 *
 * Now the empty claim nudges too (`remaining: 0`), and the ring resets.
 */

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
  Session.ESPERA_ANTES_DE_REINICIAR_O_ANEL_MS = 2_000
  Gateway.AVISO_DE_CHAVES_MS = 2_000
})
afterEach(() => {
  desligarContas(abertas.splice(0))
  Session.ESPERA_ANTES_DE_REINICIAR_O_ANEL_MS = ESPERA
  Gateway.AVISO_DE_CHAVES_MS = AVISO
})

const reserva = (conta: ContaDeTeste): number => servidor.enclave.store.availableKeyPackages(conta.address)

/** Claims with no Welcome until the ring is at its cap (the device can mint no more above 0). */
async function anelNoTecto(ana: ContaDeTeste, atacante: Cliente): Promise<void> {
  for (let i = 0; i < 600; i++) {
    if (ana.session.keyPackagesLocais >= Session.KEY_PACKAGES_LOCAIS_MAX && reserva(ana) > 0) return
    atacante.enviar({ t: "keypackage.claim", address: ana!.address, bundle: false })
    await atacante.proximoDe("keypackage.claimed")
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  throw new Error(`o anel não chegou ao tecto (${ana.session.keyPackagesLocais}, ${reserva(ana)})`)
}

describe("P4: o aparelho ligado sem chaves ouve a reclamação vazia", () => {
  it("a reserva esvaziada numa rajada volta a encher-se quando o pedido de lugar a encontra vazia", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"], { salaComum: false })
    abertas.push(ana!, bruno!)
    const atacante = await Cliente.ligar(servidor.url, generateIdentity(servidor.casa))
    try {
      await anelNoTecto(ana!, atacante)
      // Past the window, then the burst: the first claim nudges (above 0, the full ring
      // mints nothing), the rest fall inside the window and empty the pool in silence.
      await new Promise((resolve) => setTimeout(resolve, Gateway.AVISO_DE_CHAVES_MS + 100))
      while (reserva(ana!) > 0) {
        atacante.enviar({ t: "keypackage.claim", address: ana!.address, bundle: false })
        await atacante.proximoDe("keypackage.claimed")
      }
      expect(reserva(ana!)).toBe(0)
    } finally {
      atacante.fechar()
    }
    await new Promise((resolve) => setTimeout(resolve, Gateway.AVISO_DE_CHAVES_MS + 100))

    // Bruno tries to seat Ana: his claim finds the pool empty and the seat fails.
    const canal = moradaDeSala(servidor.casa)
    await bruno!.session.createSpaceChannel(canal)
    await ate(() => bruno!.session.founderOf(canal) === bruno!.address, "Bruno funda o canal")
    await bruno!.session.seat(canal, ana!.address).catch(() => {})

    // That empty claim nudged Ana with 0: the ring resets and the pool is refilled,
    // with Ana connected the whole time. Before 1.3.25 it stayed at 0 until her next login.
    await ate(() => reserva(ana!) > 0, "a reserva de Ana volta a ter chaves", Session.ESPERA_ANTES_DE_REINICIAR_O_ANEL_MS + 15_000)
    // The next try gets in.
    await bruno!.session.seat(canal, ana!.address)
    await ate(() => ana!.session.channels.includes(canal), "Ana entra no canal", 15_000)
    expect(servidor.enclave.gateway.lugares.contagem().contagens.semChave.ultimaHora).toBeGreaterThanOrEqual(1)
  }, 180_000)
})
