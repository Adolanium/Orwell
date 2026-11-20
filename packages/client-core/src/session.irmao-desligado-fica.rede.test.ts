import { DatabaseSync } from "node:sqlite"
import { Session as SessionDoHarness } from "@enclave/client-core"
import { deviceKeyAtLeaf, leavesOf } from "@enclave/crypto"
import { friendsOfTies, toBase64, type UserAddress } from "@enclave/protocol"
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
 * A new phone's seat request does not take the leaf of a sibling that is offline
 * (C1 of the 1.3.20 review).
 *
 * The phone asks for a seat in each friend's feed where it has no group. The PC
 * answered with `#repararAparelhosDaConta`, which took out every leaf of the account
 * with no proof of life in this epoch and never seen in this channel, and seated it
 * again. A tablet that is merely offline, and never wrote in a friend's feed, is such
 * a leaf: it lost the seat, and with it what is said in the feed until it comes back.
 *
 * Here the PC is reloaded after the tablet goes offline (no proof of life in memory),
 * the phone's top-ups are held so the PC is still seating it when the phone asks, and
 * the two friends are offline (nobody else answers). In the second friend's feed the
 * PC's record of the tablet (`aparelhoVistoNoCanal`) is also erased. The tablet is
 * older than the repair's "new" (shortened for the test). The tablet's leaf
 * must stay the same in both feeds, in a room of the owner and in the account
 * channel, and no key package of the tablet is claimed. The account channel has its
 * own repair (`#repararCanalDaConta`), and it took the tablet's leaf the same way.
 */

const ATRASO_DA_REPOSICAO_MS = 100_000
/*
  "New" for the repair is a day in the app (`Session.APARELHO_NOVO_S`). Here a
  minute, and the tablet is 90 s old when the phone pairs: the tablet seated in
  September of the review, the phone seated now.
*/
const APARELHO_NOVO_DE_TESTE_S = 60
const IDADE_DO_TABLET_MS = 90_000
const novoOriginal = SessionDoHarness.APARELHO_NOVO_S

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const sessoes: SessionDoHarness[] = []
const originalTopUp = SessionDoHarness.prototype.topUpKeyPackages
const originalRejoin = SessionDoHarness.prototype.requestRejoin
beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  SessionDoHarness.APARELHO_NOVO_S = novoOriginal
  SessionDoHarness.prototype.topUpKeyPackages = originalTopUp
  SessionDoHarness.prototype.requestRejoin = originalRejoin
  desligarContas(abertas.splice(0))
  for (const sessao of sessoes.splice(0)) sessao.disconnect()
  await servidor?.fechar()
})

/** Index and HPKE key of each leaf of `aparelho` in `canal`, as `pc` sees it. */
function folhaDe(pc: SessionDoHarness, canal: string, address: string, aparelho: string): string {
  const grupo = pc.groupFor(canal)
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

async function fazerAmigos(dono: ContaDeTeste, amiga: ContaDeTeste): Promise<string> {
  const directa = await amiga.session.openDirect(dono.address)
  await ate(() => dono.session.channels.includes(directa), `a directa da ${amiga.nome} chega ao dono`)
  await amiga.session.sendFriendRequest(directa)
  await ate(() => dono.session.friendTies().get(amiga.address)?.link === "pedido-recebido", `o pedido da ${amiga.nome} chega`)
  await dono.session.acceptFriend(directa, amiga.address)
  await ate(() => friendsOfTies(dono.session.friendTies()).includes(amiga.address), `amigo da ${amiga.nome}`)
  const mural = amiga.session.feedChannel
  await ate(() => dono.session.channels.includes(mural), `o dono no mural da ${amiga.nome}`, 30_000)
  return mural
}

describe("um irmão desligado não perde o lugar", () => {
  it("o telemóvel novo pede lugar no mural de uma amiga desligada, e a folha do tablet desligado fica igual", async () => {
    const [dono, eva, rita] = await contasDeTeste(servidor, ["Dono", "Eva", "Rita"])
    abertas.push(dono!, eva!, rita!)
    const sala = await canalComTodos(servidor, dono!, [])
    // Past the 20 key packages of the phone's first pool, BEFORE the feeds: the PC
    // seats in channel order, and the feeds must be among those still waiting.
    for (let i = 0; i < 22; i++) await canalComTodos(servidor, dono!, [])
    const muralDaEva = await fazerAmigos(dono!, eva!)
    const muralDaRita = await fazerAmigos(dono!, rita!)

    const tablet = await emparelharAparelho(dono!, "Dono (tablet)")
    abertas.push(tablet)
    const tabletEmparelhadoEm = Date.now()
    await ate(
      () => dono!.session.channels.every((canal) => tablet.session.channels.includes(canal)),
      "o tablet em todos os canais",
      180_000,
      500,
    )
    const chaveDoTablet = tablet.session.identity.deviceSigningPublicKey
    const aparelho = toBase64(chaveDoTablet)
    // And in the account channel, where the phone asks for its seat too.
    const canalDaConta = dono!.session.canalDaConta
    await ate(
      () => !["", "sem grupo"].includes(folhaDe(dono!.session, canalDaConta, dono!.address, aparelho)),
      "o tablet no canal da conta",
      120_000,
      500,
    )
    // The tablet reads and never writes. Then it and both friends go offline.
    await tablet.session.flush()
    tablet.session.disconnect()
    eva!.session.disconnect()
    rita!.session.disconnect()

    // The PC reloads: no proof of life in memory, as after any restart since the
    // tablet was seated. In Rita's feed, no record of the tablet either.
    dono!.session.disconnect()
    const recarregado = await recarregar(dono!)
    await recarregado.vault.update((contents) => {
      const vistos = { ...contents.aparelhoVistoNoCanal }
      delete vistos[muralDaRita]
      contents.aparelhoVistoNoCanal = vistos
    })
    const pc = recarregado.session
    // The tablet gets old before the phone comes.
    SessionDoHarness.APARELHO_NOVO_S = APARELHO_NOVO_DE_TESTE_S
    const falta = IDADE_DO_TABLET_MS - (Date.now() - tabletEmparelhadoEm)
    if (falta > 0) await new Promise((resolve) => setTimeout(resolve, falta))
    sessoes.push(pc)
    const avisos: string[] = []
    pc.on("status", (evento) => {
      if (evento.code) avisos.push(evento.code)
    })
    pc.loadIdentity()
    await pc.connect()
    const donoRecarregado: ContaDeTeste = { ...dono!, session: pc, vault: recarregado.vault, avisos }

    const canais = [sala, muralDaEva, muralDaRita, canalDaConta]
    const antes = canais.map((canal) => folhaDe(pc, canal, dono!.address, aparelho))
    expect(antes.every((folha) => folha !== "" && folha !== "sem grupo")).toBe(true)
    const reclamadosAntes = reclamadosDe(dono!.address, chaveDoTablet)

    // The phone's top-ups wait, so the PC is still seating it when it asks.
    SessionDoHarness.prototype.topUpKeyPackages = async function (this: SessionDoHarness, count: number, replace = false) {
      if (this !== pc && !replace) await new Promise((resolve) => setTimeout(resolve, ATRASO_DA_REPOSICAO_MS))
      return originalTopUp.call(this, count, replace)
    }
    const pedidos = new Set<string>()
    SessionDoHarness.prototype.requestRejoin = function (this: SessionDoHarness, channel: string) {
      if (this !== pc) pedidos.add(channel)
      return originalRejoin.call(this, channel)
    }
    const telemovel = await emparelharAparelho(donoRecarregado)
    abertas.push(telemovel)
    /*
      The phone asks for a seat in each friend's feed at the end of each handshake
      (and in the sync passes, minutes apart). Right after pairing it does not know
      the friends yet: once it does, it reconnects, as a page reload would.
    */
    await ate(() => friendsOfTies(telemovel.session.friendTies()).length === 2, "o telemóvel sabe das duas amigas", 90_000, 200)
    telemovel.session.disconnect()
    await telemovel.session.connect()
    await ate(
      () => pedidos.has(muralDaEva) && pedidos.has(muralDaRita) && pedidos.has(canalDaConta),
      "o telemóvel pede lugar nos dois murais e no canal da conta",
      90_000,
      200,
    )
    // The PC's answer: proof of life, the turn, the claim, and the commits behind
    // the seats it is still giving the phone.
    await new Promise((resolve) => setTimeout(resolve, 45_000))
    SessionDoHarness.prototype.topUpKeyPackages = originalTopUp
    SessionDoHarness.prototype.requestRejoin = originalRejoin

    // Both first, so a failure shows the whole damage.
    expect({
      folhas: canais.map((canal) => folhaDe(pc, canal, dono!.address, aparelho)),
      reclamados: reclamadosDe(dono!.address, chaveDoTablet),
    }).toEqual({ folhas: antes, reclamados: reclamadosAntes })
  }, 480_000)
})
