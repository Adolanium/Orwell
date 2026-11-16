import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * Publishing the profile writes the vault once per burst, not twice per channel
 * (hotfix 1.3.13).
 *
 * Measured on a loaded account (`scripts/medir-memoria-conta-carregada.mjs`): of
 * the 25 whole-vault writes in the first 60 s, 16 came in 0.9 s from
 * `publishProfile` at connection, one channel after the other: the send's own
 * write (the ratchet before the frame leaves) and then `publishedProfileAt`.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeEach(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(async () => {
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

describe("gravações do cofre ao publicar o perfil", () => {
  it("seis canais não dão doze gravações (hotfix 1.3.13)", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canais: string[] = []
    for (let c = 0; c < 6; c++) canais.push(await canalComTodos(servidor, ana!, [bruno!]))
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    await ana!.session.flush()
    const antes = ana!.backend.escritas
    const falhados = await ana!.session.publishProfile(canais, true)
    expect(falhados).toEqual([])
    // The deferred `publishedProfileAt` counts too: written now, not in a second.
    await ana!.vault.gravarAdiada()
    const escritas = ana!.backend.escritas - antes
    console.log(`gravações do cofre ao publicar o perfil em 6 canais: ${escritas}`)
    // Measured: 12 before (two per channel, one after the other).
    expect(escritas).toBeLessThanOrEqual(3)
    // And every channel has the publish recorded.
    for (const canal of canais) expect(ana!.vault.contents.publishedProfileAt[canal]).toBe(ana!.session.profile.updatedAt)
  }, 90_000)
})
