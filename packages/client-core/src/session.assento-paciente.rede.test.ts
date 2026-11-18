import { Session as SessionDoHarness } from "@enclave/client-core"
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
 * Seating a new device waits for its top-up, however late (hotfix 1.3.19).
 *
 * Under load a burst of claims emptied the new device's pool before its top-up
 * landed. The main device tried each channel three times, 3 s apart, and a top-up
 * later than that left the channel out for good (e2e-membros-aparelho-novo, 12/14
 * in Chromium with the machine loaded). Here the new device's top-ups are held back
 * 40 s each: past what three tries gave (each claim retries for ~3 s, then 3 s
 * between tries, ~15 s in all), within what the six waits give (~1 min).
 */

const ATRASO_DA_REPOSICAO_MS = 40_000

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const original = SessionDoHarness.prototype.topUpKeyPackages
beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  SessionDoHarness.prototype.topUpKeyPackages = original
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

describe("assentar um aparelho novo, com a reposição dele atrasada", () => {
  it("o principal não desiste de nenhum lugar, mesmo quando as chaves do aparelho novo chegam 40 s tarde", async () => {
    const [dono] = await contasDeTeste(servidor, ["Dono"])
    abertas.push(dono!)
    // 45 rooms: past the 20 or 40 the new device has at the start, so it tops up twice.
    for (let i = 0; i < 45; i++) await canalComTodos(servidor, dono!, [])

    // Every top-up of the new device (not the first pool, `replace`) lands 40 s late.
    SessionDoHarness.prototype.topUpKeyPackages = async function (this: SessionDoHarness, count: number, replace = false) {
      if (this !== dono!.session && !replace) await new Promise((resolve) => setTimeout(resolve, ATRASO_DA_REPOSICAO_MS))
      return original.call(this, count, replace)
    }
    const telemovel = await emparelharAparelho(dono!)
    abertas.push(telemovel)
    await ate(
      () => dono!.session.channels.every((canal) => telemovel.session.channels.includes(canal)),
      "o telemóvel em todos os canais do computador",
      150_000,
      250,
    ).catch(() => {})
    SessionDoHarness.prototype.topUpKeyPackages = original
    // Each channel the main device gave up on says so (`reseat-failed`): before, 4 of
    // them, and 5 rooms missing. And no room is missing: before 1.3.19 one always was,
    // the room whose seat claimed the key package the common room card had burned
    // (see session.cartao-chave-nao-publicada.rede).
    expect(dono!.session.channels.filter((canal) => !telemovel.session.channels.includes(canal))).toEqual([])
    expect(dono!.avisos).not.toContain("reseat-failed")
  }, 300_000)
})
