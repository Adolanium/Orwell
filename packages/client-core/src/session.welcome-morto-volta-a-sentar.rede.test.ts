import { DatabaseSync } from "node:sqlite"
import { Session, Vault } from "@enclave/client-core"
import { toBase64 } from "@enclave/protocol"
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
 * A seat whose Welcome does not open is given again (1.3.20).
 *
 * The new device marks the Welcome dead and asks for the seat again. Until now only
 * other accounts answered a request from our own address, so in a room with only
 * this account (or a friend's channel with the friend offline) nobody did: the main
 * device saw the leaf in its tree and took the seat as given. Here the device loses
 * the private half of the package the server will serve next, the main device
 * creates a room and seats it on that package, and the device must still get in.
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

describe("um Welcome que não abre", () => {
  it("o principal senta outra vez o aparelho, com uma chave nova, quando o aparelho pede o lugar", async () => {
    const [dono] = await contasDeTeste(servidor, ["Dono"])
    abertas.push(dono!)
    const telemovel = await emparelharAparelho(dono!)
    abertas.push(telemovel)
    await ate(() => dono!.session.channels.every((canal) => telemovel.session.channels.includes(canal)), "o telemóvel assentado", 60_000)

    // The device loses the private half of the package the server serves next (the newest).
    await telemovel.session.flush()
    telemovel.session.disconnect()
    const base = new DatabaseSync(servidor.baseDeDados, { readOnly: true })
    const proxima = base
      .prepare("SELECT package FROM key_packages WHERE address = ? AND device = ? AND claimed = 0 ORDER BY id DESC LIMIT 1")
      .get(dono!.address, telemovel.session.identity.deviceSigningPublicKey) as { package: Uint8Array }
    base.close()
    const perdida = toBase64(new Uint8Array(proxima.package))
    const vault = new Vault(telemovel.backend)
    await vault.unlock("frase-do-telemovel")
    expect(vault.contents.pendingKeyPackages.some((guardada) => guardada.wire === perdida)).toBe(true)
    await vault.update((contents) => {
      contents.pendingKeyPackages = contents.pendingKeyPackages.filter((guardada) => guardada.wire !== perdida)
    })
    const sessao = new Session(vault, { armazem: telemovel.armazem })
    sessoes.push(sessao)
    const avisos: string[] = []
    sessao.on("status", (evento) => {
      if (evento.code) avisos.push(evento.code)
    })
    sessao.loadIdentity()
    await sessao.connect()

    const sala = await canalComTodos(servidor, dono!, [])
    await ate(() => avisos.includes("welcome-dead"), "o Welcome da sala nova não abre", 30_000)
    await ate(() => sessao.channels.includes(sala), "o telemóvel entra na sala nova", 60_000).catch(() => {})
    expect(sessao.channels).toContain(sala)
  }, 180_000)
})
