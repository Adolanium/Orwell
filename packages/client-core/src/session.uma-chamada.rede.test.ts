import { ambitoDaChamada } from "@enclave/protocol"
import { createSocket } from "node:dgram"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
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
import { codigoDaRecusaDoSfu, type SfuAviso } from "@enclave/client-core"

/**
 * One call per account, with two real devices of one account (1.3.25).
 *
 *   npx vitest run --root packages/client-core src/session.uma-chamada.rede.test.ts
 *
 * The computer and the paired phone of Ana, a real server WITH the media
 * engine, and the sessions of this package from `dist`. What is measured is
 * the wire between the session and the gateway: the phone joins the call, the
 * computer hears `scope.closed` through the session's `sfu` event, and its own
 * automatic join (no `tomar`) is refused with `noutro-aparelho`; the gesture
 * (`tomar`) takes the call back. Bruno is in the same call to show that the
 * other people are not touched.
 *
 * The `Call` above this (leave, notice, no rebuild) is `call.uma-chamada.test.ts`:
 * here there is no WebRTC, only the signalling.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

/** A free UDP port: `sfuPort: 0` means "no SFU" (see `sfu.test.ts` in the server). */
async function portoLivre(): Promise<number> {
  const socket = createSocket("udp4")
  await new Promise<void>((pronto) => socket.bind(0, "127.0.0.1", pronto))
  const porto = socket.address().port
  await new Promise<void>((pronto) => socket.close(() => pronto()))
  return porto
}

beforeEach(async () => {
  servidor = await levantarServidor({ sfuPort: await portoLivre() })
}, 30_000)

afterEach(async () => {
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

/** Everything the session says about the SFU without a request. */
function avisosSfu(conta: ContaDeTeste): SfuAviso[] {
  const avisos: SfuAviso[] = []
  conta.session.on("sfu", (aviso) => avisos.push(aviso))
  return avisos
}

const fechos = (avisos: SfuAviso[]): Extract<SfuAviso, { t: "scope.closed" }>[] =>
  avisos.filter((aviso): aviso is Extract<SfuAviso, { t: "scope.closed" }> => aviso.t === "scope.closed")

describe("uma chamada por conta, com dois aparelhos reais", () => {
  it("o telemóvel entra: o computador sai da chamada no servidor, é avisado, e só volta com o gesto", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    await ate(() => telemovel.session.channels.includes(canal), "o telemóvel tem o canal", 30_000)
    await ate(() => ana!.session.suportaSfu && telemovel.session.suportaSfu && bruno!.session.suportaSfu, "o servidor encaminha media")

    const escopo = ambitoDaChamada(canal, "")
    const doComputador = avisosSfu(ana!)
    const doTelemovel = avisosSfu(telemovel)
    const doBruno = avisosSfu(bruno!)

    await bruno!.session.sfuEntrarNoAmbito(canal, escopo, { tomar: true })
    await ana!.session.sfuEntrarNoAmbito(canal, escopo, { tomar: true })

    // The phone joins the SAME call: the computer's presence there ends.
    await telemovel.session.sfuEntrarNoAmbito(canal, escopo, { tomar: true })
    await ate(() => fechos(doComputador).length === 1, "o computador recebe scope.closed")
    expect(fechos(doComputador)[0]).toMatchObject({ channel: canal, scope: escopo, mesmaChamada: true })
    expect(fechos(doTelemovel)).toEqual([])
    expect(fechos(doBruno)).toEqual([])

    // The computer's automatic join (a rebuild, a resynchronisation): refused.
    const recusa = await ana!.session.sfuEntrarNoAmbito(canal, escopo).then(
      () => null,
      (erro: unknown) => erro,
    )
    expect(codigoDaRecusaDoSfu(recusa)).toBe("noutro-aparelho")

    // The person asks for the call on the computer again: it takes it back.
    await ana!.session.sfuEntrarNoAmbito(canal, escopo, { tomar: true })
    await ate(() => fechos(doTelemovel).length === 1, "o telemóvel recebe scope.closed")
    expect(fechos(doTelemovel)[0]).toMatchObject({ channel: canal, scope: escopo, mesmaChamada: true })
    expect(fechos(doBruno)).toEqual([])
  }, 90_000)

  it("o telemóvel entra noutra sala: o aviso ao computador diz que é outra chamada", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    await ate(() => telemovel.session.channels.includes(canal), "o telemóvel tem o canal", 30_000)
    await ate(() => ana!.session.suportaSfu && telemovel.session.suportaSfu, "o servidor encaminha media")

    const doComputador = avisosSfu(ana!)
    await ana!.session.sfuEntrarNoAmbito(canal, ambitoDaChamada(canal, ""), { tomar: true })
    await telemovel.session.sfuEntrarNoAmbito(canal, ambitoDaChamada(canal, "outra sala"), { tomar: true })

    await ate(() => fechos(doComputador).length === 1, "o computador recebe scope.closed")
    expect(fechos(doComputador)[0]).toMatchObject({ scope: ambitoDaChamada(canal, ""), mesmaChamada: false })
  }, 90_000)
})
