import { moradaDeSala, type Payload } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { ate, contasDeTeste, desligarContas, levantarServidor, type ContaDeTeste, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/**
 * The vault is written once for the whole recovery, not once per channel (hotfix 1.3.12).
 *
 * Up to 1.3.10 the end of each channel's recovery forced the deferred write
 * (`gravarAdiada` in `#catchUpChannel`): with 20 channels, 20 writes of the whole
 * vault in a row at startup, 0.5 to 1 s each on a large vault in a phone browser.
 * What a recovery writes is only what the server gives again, so the disk can take
 * it once, at the end of `#catchUp`.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 60_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

const CANAIS = 12

describe("escritas do cofre ao recuperar muitos canais", () => {
  it("doze canais com novidades custam poucas escritas, e não uma por canal", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canais: string[] = []
    for (let i = 0; i < CANAIS; i++) {
      const canal = moradaDeSala(servidor.casa)
      await ana!.session.createSpaceChannel(canal)
      await ana!.session.seat(canal, bruno!.address)
      canais.push(canal)
    }
    await ate(() => canais.every((canal) => bruno!.session.channels.includes(canal)), "o Bruno está nos doze", 60_000)
    await new Promise((resolve) => setTimeout(resolve, 3_000))

    bruno!.session.disconnect()
    // The profile repair round runs once in an account's life; a real account has done it.
    bruno!.vault.contents.profileRepairRound = Number.MAX_SAFE_INTEGER
    for (const canal of canais) {
      for (let n = 0; n < 3; n++) await ana!.session.send(canal, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: `nova ${n}`, attachments: [], mentions: [], links: [] } as Payload)
    }
    const escritasAntes = bruno!.backend.escritas
    await bruno!.session.connect()
    // `connect()` resolves when the recovery of every channel is done.
    expect(canais.every((canal) => bruno!.session.history(canal).some((m) => (m.payload as { body?: string }).body === "nova 2"))).toBe(true)
    const escritas = bruno!.backend.escritas - escritasAntes
    console.log(`[medida] ${CANAIS} canais recuperados: ${escritas} escritas do cofre até ao connect() acabar`)
    expect(escritas).toBeLessThanOrEqual(3)
  }, 180_000)
})
