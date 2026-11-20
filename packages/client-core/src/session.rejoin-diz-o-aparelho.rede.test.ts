import { DatabaseSync } from "node:sqlite"
import { Session as SessionDoHarness } from "@enclave/client-core"
import { deviceKeyAtLeaf, leavesOf } from "@enclave/crypto"
import { toBase64, type UserAddress } from "@enclave/protocol"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  recarregar,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * The seat request names the device that asks, and only its leaf leaves (1.3.25,
 * the root fix of C1 in the 1.3.20 review).
 *
 * What the diag-c1 report left open: nobody is missing, one sibling is deaf and
 * another is offline. The repair took out every leaf of the account with no proof
 * of life in the epoch, so the offline tablet left with the deaf phone, and one of
 * its key packages was spent per channel. The 24-hour rule of
 * `#repararAparelhosDaConta` did not cover a tablet paired less than a day ago,
 * `#repararCanalDaConta` has no such rule (I5), and another account's `#reseat` had
 * none either.
 *
 * Here, with the real server: the owner's PC, a tablet paired minutes ago and a
 * phone. All three sit in a room of the owner alone, in a room with Eva (online),
 * and in the account channel. The tablet goes offline. The PC reloads (no proof of
 * life in memory) and forgets who it saw in the owner's room. The phone asks for a
 * seat in the three channels, as a deaf device does. The server names the phone in
 * each `channel.rejoin`. The tablet's leaf (index and HPKE key) stays the same in
 * the three channels, no key package of the tablet is claimed, and the phone gets a
 * new leaf in each.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const sessoes: SessionDoHarness[] = []
beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  desligarContas(abertas.splice(0))
  for (const sessao of sessoes.splice(0)) sessao.disconnect()
  await servidor?.fechar()
})

/** Index and HPKE key of each leaf of `aparelho` in `canal`, as `quem` sees it. */
function folhaDe(quem: SessionDoHarness, canal: string, address: string, aparelho: string): string {
  const grupo = quem.groupFor(canal)
  if (!grupo) return "sem grupo"
  const arvore = grupo.state.ratchetTree
  const folhas = leavesOf(arvore, address as UserAddress).filter((folha) => {
    const chave = deviceKeyAtLeaf(arvore, folha)
    return chave !== undefined && toBase64(chave) === aparelho
  })
  return folhas
    .map((folha) => {
      const no = arvore[folha * 2]
      return `${folha}:${no?.nodeType === "leaf" ? toBase64(no.leaf.hpkePublicKey) : "?"}`
    })
    .join(",")
}

function reclamadosDe(address: string, aparelho: Uint8Array): number {
  const base = new DatabaseSync(servidor.baseDeDados, { readOnly: true })
  const linha = base
    .prepare("SELECT COUNT(*) AS n FROM key_packages WHERE address = ? AND device = ? AND claimed = 1")
    .get(address, aparelho) as { n: number }
  base.close()
  return Number(linha.n)
}

describe("o pedido de lugar diz o aparelho", () => {
  it("o telemóvel surdo pede lugar em três canais, e a folha do tablet desligado fica igual em todos", async () => {
    const [dono, eva] = await contasDeTeste(servidor, ["Dono", "Eva"])
    abertas.push(dono!, eva!)
    const salaDoDono = await canalComTodos(servidor, dono!, [])
    const salaComEva = await canalComTodos(servidor, dono!, [eva!])
    const canalDaConta = dono!.session.canalDaConta
    const canais = [salaDoDono, salaComEva, canalDaConta]

    const tablet = await emparelharAparelho(dono!, "Dono (tablet)")
    abertas.push(tablet)
    const telemovel = await emparelharAparelho(dono!, "Dono (telemóvel)")
    abertas.push(telemovel)
    const chaveDoTablet = tablet.session.identity.deviceSigningPublicKey
    const doTablet = toBase64(chaveDoTablet)
    const doTelemovel = toBase64(telemovel.session.identity.deviceSigningPublicKey)
    const sentado = (quem: SessionDoHarness, canal: string, aparelho: string): boolean =>
      !["", "sem grupo"].includes(folhaDe(quem, canal, dono!.address, aparelho))
    await ate(
      () => canais.every((canal) => sentado(dono!.session, canal, doTablet) && sentado(dono!.session, canal, doTelemovel)),
      "o tablet e o telemóvel nos três canais",
      180_000,
      500,
    )
    await ate(
      () => canais.every((canal) => tablet.session.groupFor(canal) !== undefined && telemovel.session.groupFor(canal) !== undefined),
      "os grupos abertos no tablet e no telemóvel",
      120_000,
      500,
    )

    // The tablet reads and never writes. Then it goes offline.
    await tablet.session.flush()
    tablet.session.disconnect()

    // The PC reloads: no proof of life in memory. In its own room, no record of the tablet either.
    dono!.session.disconnect()
    const recarregado = await recarregar(dono!)
    await recarregado.vault.update((contents) => {
      const vistos = { ...contents.aparelhoVistoNoCanal }
      delete vistos[salaDoDono]
      contents.aparelhoVistoNoCanal = vistos
    })
    const pc = recarregado.session
    sessoes.push(pc)
    pc.loadIdentity()
    await pc.connect()
    await ate(() => canais.every((canal) => pc.groupFor(canal) !== undefined), "o PC com os três grupos", 60_000, 200)

    const antes = canais.map((canal) => folhaDe(pc, canal, dono!.address, doTablet))
    expect(antes.every((folha) => folha !== "" && folha !== "sem grupo")).toBe(true)
    const doTelemovelAntes = canais.map((canal) => folhaDe(pc, canal, dono!.address, doTelemovel))
    const reclamadosAntes = reclamadosDe(dono!.address, chaveDoTablet)

    // The phone is deaf in the three channels: it asks, as the deafness detector does.
    for (const canal of canais) telemovel.session.requestRejoin(canal)

    // The answers: proof of life, the turns (siblings and Eva), the claim and two commits per channel.
    await ate(
      () => canais.every((canal, i) => folhaDe(pc, canal, dono!.address, doTelemovel) !== doTelemovelAntes[i]),
      "o telemóvel com uma folha nova nos três canais",
      90_000,
      500,
    )
    // And some more time, for a second repair that should not come.
    await new Promise((resolve) => setTimeout(resolve, 15_000))

    // Both first, so a failure shows the whole damage.
    expect({
      folhas: canais.map((canal) => folhaDe(pc, canal, dono!.address, doTablet)),
      reclamados: reclamadosDe(dono!.address, chaveDoTablet),
    }).toEqual({ folhas: antes, reclamados: reclamadosAntes })
  }, 480_000)
})
