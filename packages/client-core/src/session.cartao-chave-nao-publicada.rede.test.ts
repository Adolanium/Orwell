import { DatabaseSync } from "node:sqlite"
import { Session as SessionDoHarness } from "@enclave/client-core"
import { toBase64 } from "@enclave/protocol"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * The common room card spends a key package the server never serves (1.3.19).
 *
 * A new device joins the common room by its card (`#entrarComCartao`), and that
 * leaf was built from the FIRST key package of the local ring: one the device had
 * just published. The device burned its private half, but the server still held
 * the public half, unclaimed and the oldest of the pool, so it was served last.
 * Whoever claimed it next (the main device seating the new one in its 20th room,
 * a friend seating it in a direct) sent a Welcome that no key opens. With other
 * keys in the ring that is a `welcome-dead`; with the ring empty it is not even
 * logged. Either way the seat is "done" for the inviter, and the new device never
 * enters that channel (session.assento-paciente.rede: 1 room of 45 missing, every
 * run).
 *
 * The rule: every key package the server holds for a device is one that device
 * can open.
 */

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

/** The new device's packages the server would still serve, as the base64 the ring keys by. */
function porServirDoAparelho(conta: ContaDeTeste): string[] {
  const base = new DatabaseSync(servidor.baseDeDados, { readOnly: true })
  try {
    const linhas = base
      .prepare("SELECT package FROM key_packages WHERE address = ? AND device = ? AND claimed = 0")
      .all(conta.address, conta.session.identity.deviceSigningPublicKey) as { package: Uint8Array }[]
    return linhas.map((linha) => toBase64(new Uint8Array(linha.package)))
  } finally {
    base.close()
  }
}

describe("a entrada pelo cartão da sala comum", () => {
  it("não gasta uma chave que o servidor ainda serve: cada chave por servir do aparelho novo abre-se nele", async () => {
    const [dono] = await contasDeTeste(servidor, ["Dono"])
    abertas.push(dono!)
    const comum = dono!.session.commonRoom
    expect(comum).not.toBeNull()

    /*
      Only the first pool (`replace`) of the new device reaches the server. At
      login a top-up races it, and when the top-up lands first, `replace` deletes
      the batch the card spends from and the defect hides: here it never does.
    */
    SessionDoHarness.prototype.topUpKeyPackages = async function (this: SessionDoHarness, count: number, replace = false) {
      if (this !== dono!.session && !replace) return
      return original.call(this, count, replace)
    }
    const telemovel = await emparelharAparelho(dono!)
    abertas.push(telemovel)
    await ate(() => telemovel.session.channels.includes(comum!), "o telemóvel entra na sala comum pelo cartão", 30_000)
    // The ring as the vault keeps it, after the card's burn.
    await telemovel.session.flush()
    const anel = new Set(telemovel.vault.contents.pendingKeyPackages.map((guardada) => guardada.wire))

    const porServir = porServirDoAparelho(telemovel)
    expect(porServir.length).toBeGreaterThan(0)
    // Before the fix: exactly one, the package the card burned.
    expect(porServir.filter((pacote) => !anel.has(pacote)).length).toBe(0)
  }, 90_000)
})
