import { Session, Vault } from "@enclave/client-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * The last time this device was online with this account (1.3.26), for the
 * members column while a history syncs ("You haven't logged in X days").
 *
 * The value the interface reads is the one from BEFORE this opening: a fresh
 * device has none, a deliberate disconnect writes the moment, and the next
 * opening reads it and keeps it while it goes online and writes again.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const sessoes: Session[] = []
beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  desligarContas(abertas.splice(0))
  for (const sessao of sessoes.splice(0)) sessao.disconnect()
  await servidor?.fechar()
})

describe("previousOnlineAt", () => {
  it("a new device has none; the disconnect writes the moment; the next opening reads it and keeps it", async () => {
    const [conta] = await contasDeTeste(servidor, ["Ana"])
    abertas.push(conta!)
    // A device that has never been online with this account: nothing to say.
    expect(conta!.session.previousOnlineAt()).toBeNull()

    const antes = Date.now()
    conta!.session.disconnect()
    // The disconnect's flush is not awaited by `disconnect`: read the disk until it lands.
    let guardado: number | undefined
    for (let tentativa = 0; tentativa < 100 && guardado === undefined; tentativa++) {
      const noDisco = new Vault(conta!.backend)
      await noDisco.unlock("frase-passe-de-teste")
      guardado = noDisco.contents.lastOnlineAt
      if (guardado === undefined) await new Promise((resolver) => setTimeout(resolver, 50))
    }
    expect(guardado).toBeGreaterThanOrEqual(antes - 60_000)
    expect(guardado).toBeLessThanOrEqual(Date.now())

    // The next opening: the value from before, which going online does not replace.
    const vault = new Vault(conta!.backend)
    await vault.unlock("frase-passe-de-teste")
    const sessao = new Session(vault, { armazem: conta!.armazem })
    sessoes.push(sessao)
    sessao.loadIdentity()
    expect(sessao.previousOnlineAt()).toBe(guardado)
    await sessao.connect()
    await ate(() => sessao.connection === "online", "online again")
    await sessao.flush()
    expect(vault.contents.lastOnlineAt).toBeGreaterThanOrEqual(guardado!)
    expect(sessao.previousOnlineAt()).toBe(guardado)

    // `reset` (lock) forgets it: the next unlock reads the disk again.
    sessao.disconnect()
    sessao.reset()
    expect(sessao.previousOnlineAt()).toBe(vault.contents.lastOnlineAt)
  }, 60_000)
})
