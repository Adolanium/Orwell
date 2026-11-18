import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { podeVotar } from "@enclave/protocol"
import {
  contasDeTeste,
  desligarContas,
  levantarServidor,
  recarregar,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { Session } from "./session.js"

/**
 * "No answer yet" is not "unknown" (review of 1.3.18, C1).
 *
 * The app asks for its own age as soon as the vault opens, before the socket has
 * said `hello.ok`. The capabilities were still empty then, so the session
 * answered `null` (unknown, does not vote) and kept it for the whole session:
 * an old account saw its poll options off until the app restarted. On localhost
 * `hello.ok` wins the race; with real latency, or a cold start without network,
 * the request does.
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

const SEIS_DIAS = 6 * 86_400_000

describe("a idade da conta, sem resposta", () => {
  it("pedida antes de ligar rejeita e não fica guardada; ligada, a mesma conta tem idade e vota", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"])
    abertas.push(ana!)
    const depois = await recarregar(ana!)
    ana!.session.disconnect()

    // Cold start: the vault is open and the identity loaded, the socket is not.
    depois.session.loadIdentity()
    await expect(depois.session.idadeDaConta(ana!.address)).rejects.toThrow(Session.IDADE_SEM_RESPOSTA)

    await depois.session.connect()
    try {
      const criadaEm = await depois.session.idadeDaConta(ana!.address)
      expect(criadaEm).not.toBeNull()
      expect(depois.session.suportaIdadeAtestada).toBe(true)
      // Six days on, this account votes: the early request left nothing behind.
      expect(podeVotar(criadaEm as number, Date.now() + SEIS_DIAS)).toBe(true)
    } finally {
      depois.session.disconnect()
    }
  }, 60_000)
})
