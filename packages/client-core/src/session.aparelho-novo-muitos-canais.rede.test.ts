import { DatabaseSync } from "node:sqlite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * A new device on an account with more channels than the device has key packages (17/11/2026).
 *
 * The report: "I opened the account I use on Windows in Safari on the Mac and it
 * does not show me half the users". The main device seats the new one in each of
 * its channels, and each seat spends one key package of the new device. The new
 * device publishes 20 (40 when two top-ups race at login) and the server only says
 * `keypackage.low` at login. Past the pool, every seat failed (`reseat-failed`) and
 * the new device stayed without those channels: the friends whose direct and feed
 * were past the pool were missing from its lists.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

describe("aparelho novo numa conta com muitos canais", () => {
  it("o aparelho novo fica em todos os canais, mesmo com mais canais do que chaves", async () => {
    const [dono] = await contasDeTeste(servidor, ["Dono"])
    abertas.push(dono!)
    // 45 rooms: past 40, the most the new device has at the start. Under the
    // server's 60 subscriptions per account per minute, which creating them spends.
    for (let i = 0; i < 45; i++) await canalComTodos(servidor, dono!, [])
    const doDono = dono!.session.channels.length
    expect(doDono).toBeGreaterThan(45)

    const telemovel = await emparelharAparelho(dono!)
    abertas.push(telemovel)
    await ate(
      () => dono!.session.channels.every((canal) => telemovel.session.channels.includes(canal)),
      "o telemóvel em todos os canais do computador",
      90_000,
      250,
    ).catch(() => {})
    const faltam = dono!.session.channels.filter((canal) => !telemovel.session.channels.includes(canal))
    expect(faltam).toEqual([])
    expect(dono!.avisos).not.toContain("reseat-failed")

    // And the nudges did not turn into one top-up each: a burst of claims, a few pools.
    const base = new DatabaseSync(servidor.baseDeDados, { readOnly: true })
    try {
      const { n } = base
        .prepare("SELECT COUNT(*) AS n FROM key_packages WHERE address = ? AND device = ?")
        .get(dono!.address, telemovel.session.identity.deviceSigningPublicKey) as { n: number }
      expect(n).toBeLessThanOrEqual(140)
    } finally {
      base.close()
    }
  }, 240_000)
})

describe("o aparelho novo ouve ao vivo cada canal onde entra", () => {
  it("dois aparelhos novos seguidos, com mais de 60 canais entre os dois: uma mensagem nova chega a cada sala", async () => {
    const [dono] = await contasDeTeste(servidor, ["Dono"])
    abertas.push(dono!)
    const salas: string[] = []
    for (let i = 0; i < 40; i++) salas.push(await canalComTodos(servidor, dono!, []))
    // Past the minute of the creations: what this measures is the welcomes' subscriptions.
    await new Promise((resolve) => setTimeout(resolve, 61_000))
    const aparelhos: ContaDeTeste[] = []
    for (const nome of ["portátil", "telemóvel"]) {
      const novo = await emparelharAparelho(dono!, nome)
      abertas.push(novo)
      aparelhos.push(novo)
      await ate(() => salas.every((sala) => novo.session.channels.includes(sala)), `o ${nome} nas salas`, 90_000, 250)
    }
    for (const [i, sala] of salas.entries()) {
      await dono!.session.send(sala, { t: "message", body: `ao vivo ${i}`, sentAt: Date.now(), id: `ao-vivo-${String(i).padStart(4, "0")}` })
    }
    const ouviu = (conta: ContaDeTeste, sala: string, i: number): boolean =>
      (conta.vault.contents.history[sala] ?? []).some((m) => (m.payload as { body?: unknown }).body === `ao vivo ${i}`)
    await ate(() => aparelhos.every((conta) => salas.every((sala, i) => ouviu(conta, sala, i))), "tudo chega ao vivo", 30_000, 250).catch(() => {})
    for (const conta of aparelhos) {
      expect(salas.filter((sala, i) => !ouviu(conta, sala, i)).length, conta.nome).toBe(0)
    }
  }, 300_000)
})
