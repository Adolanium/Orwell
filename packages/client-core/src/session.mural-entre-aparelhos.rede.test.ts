import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { entradasDoCanal, PassagemDaChaveDaConta, Session, Vault } from "@enclave/client-core"

/**
 * Posts between two devices of ONE account (16/11/2026): "what I post on the
 * computer does not appear on the paired phone". Real server, real MLS.
 *
 * Ana's computer and Ana's phone, Bruno who follows Ana, and Carla whom Ana follows.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

const tem = (conta: ContaDeTeste, canal: string, id: string): boolean =>
  entradasDoCanal(conta.vault.contents, canal).some((e) => e.payload["id"] === id)

describe("o mural entre aparelhos da mesma conta", () => {
  it("um post no computador chega ao telemóvel emparelhado, ao vivo", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const mural = ana!.session.feedChannel
    // The feed exists before the phone is paired: Bruno follows it already.
    await ana!.session.acceptFollower(bruno!.address)
    await ate(() => bruno!.session.channels.includes(mural), "o Bruno segue a Ana", 30_000)
    const antes = await ana!.session.post("Antes do telemóvel")
    await ate(() => tem(bruno!, mural, antes), "o Bruno tem o primeiro post", 30_000)

    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    await ate(() => telemovel.session.feedChannel === mural, "o telemóvel conhece o mural da conta", 30_000)

    const depois = await ana!.session.post("Depois do telemóvel")
    await ate(() => tem(bruno!, mural, depois), "o Bruno tem o post novo", 30_000)
    await ate(() => tem(telemovel, mural, depois), "o post do computador chega ao telemóvel", 60_000)
    expect(telemovel.session.channels).toContain(mural)
  }, 240_000)

  it("os posts de quem sigo, os comentários e os gostos, e o que o telemóvel publica, nos dois aparelhos e depois de recarregar", async () => {
    const [ana, bruno, carla] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])
    abertas.push(ana!, bruno!, carla!)
    const muralDaAna = ana!.session.feedChannel
    const muralDaCarla = carla!.session.feedChannel
    await ana!.session.acceptFollower(bruno!.address)
    await carla!.session.acceptFollower(ana!.address)
    await ate(() => bruno!.session.channels.includes(muralDaAna) && ana!.session.channels.includes(muralDaCarla), "os dois seguimentos", 30_000)

    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)

    // Ana's computer posts; Bruno comments and likes; the phone sees all three.
    const doPc = await ana!.session.post("Do computador")
    await ate(() => tem(bruno!, muralDaAna, doPc), "o Bruno tem o post", 30_000)
    await bruno!.session.commentOnPost(muralDaAna, doPc, "Boa!")
    await bruno!.session.reactToPost(muralDaAna, doPc, "👍")
    const doTipo = (conta: ContaDeTeste, canal: string, t: string): number =>
      entradasDoCanal(conta.vault.contents, canal).filter((e) => e.payload.t === t).length
    await ate(() => tem(telemovel, muralDaAna, doPc), "o post do computador no telemóvel", 60_000)
    await ate(() => doTipo(telemovel, muralDaAna, "post.comment") === 1 && doTipo(telemovel, muralDaAna, "post.reaction") === 1, "o comentário e o gosto no telemóvel", 60_000)

    // Carla, whom Ana follows, posts: both of Ana's devices.
    const daCarla = await carla!.session.post("Da Carla")
    await ate(() => tem(ana!, muralDaCarla, daCarla), "o post da Carla no computador", 30_000)
    await ate(() => tem(telemovel, muralDaCarla, daCarla), "o post da Carla no telemóvel", 60_000)

    // The phone posts: the computer and Bruno.
    const doTelemovel = await telemovel.session.post("Do telemóvel")
    await ate(() => tem(ana!, muralDaAna, doTelemovel), "o post do telemóvel no computador", 60_000)
    await ate(() => tem(bruno!, muralDaAna, doTelemovel), "o post do telemóvel no Bruno", 60_000)

    // Edit and delete on the computer reach the phone.
    await ana!.session.editPost(doPc, "Do computador (editado)")
    await ate(() => doTipo(telemovel, muralDaAna, "edit") >= 1, "a edição no telemóvel", 60_000)

    // The phone reloads: everything is still there.
    await telemovel.session.flush()
    telemovel.session.disconnect()
    const reaberto = new Vault(telemovel.backend)
    await reaberto.unlock("frase-do-telemovel")
    const sessao = new Session(reaberto)
    sessao.loadIdentity()
    const depois = { ...telemovel, session: sessao, vault: reaberto }
    abertas.push(depois)
    await sessao.connect()
    for (const [canal, id] of [[muralDaAna, doPc], [muralDaAna, doTelemovel], [muralDaCarla, daCarla]] as const) {
      expect(tem(depois, canal, id)).toBe(true)
    }
    expect(doTipo(depois, muralDaAna, "post.comment")).toBe(1)
    expect(doTipo(depois, muralDaAna, "post.reaction")).toBe(1)
    const daCarlaDepois = await carla!.session.post("Da Carla, depois de recarregar")
    await ate(() => tem(depois, muralDaCarla, daCarlaDepois), "o telemóvel recarregado recebe a Carla", 60_000)
  }, 300_000)

  it("o mural nasce depois de emparelhar: o primeiro post do computador chega ao telemóvel", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"])
    abertas.push(ana!)
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    const mural = ana!.session.feedChannel
    const primeiro = await ana!.session.post("O primeiro post")
    await ate(() => tem(telemovel, mural, primeiro), "o primeiro post do computador no telemóvel", 60_000)
  }, 240_000)

  it("um telemóvel emparelhado antes da 1.3.16, sem a chave da conta: o post do computador chega", async () => {
    PassagemDaChaveDaConta.ligada = false
    try {
      const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
      abertas.push(ana!, bruno!)
      const mural = ana!.session.feedChannel
      await ana!.session.acceptFollower(bruno!.address)
      await ate(() => bruno!.session.channels.includes(mural), "o Bruno segue a Ana", 30_000)
      const telemovel = await emparelharAparelho(ana!, "Ana (telemóvel)", { semChaveDaConta: true })
      abertas.push(telemovel)
      const doPc = await ana!.session.post("Do computador, telemóvel antigo")
      await ate(() => tem(bruno!, mural, doPc), "o Bruno tem o post", 30_000)
      await ate(() => tem(telemovel, mural, doPc), "o post chega ao telemóvel antigo", 60_000)
      await ate(() => telemovel.session.feedChannel === mural, "o telemóvel antigo conhece o mural da conta", 60_000)
    } finally {
      PassagemDaChaveDaConta.ligada = true
    }
  }, 240_000)
})
