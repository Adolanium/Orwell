import { CALAR_PARA_SEMPRE, toBase64 } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { ERRO_PUSH_RECUSADO_PELO_SERVIDOR, ERRO_PUSH_SEM_SERVIDOR, type DadosDoPush } from "./push.js"
// The harness server, for real, on an ephemeral port.
import {
  ate,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { ServicoDePushFalso } from "../../../apps/server/testes/servico-de-push-falso.js"

/**
 * The session side of Web Push, against a real server: reading the key,
 * subscribing, renewing on every reconnect, cancelling, and sending no
 * `push.*` frame at all to a server that does not announce the capability.
 */

let comPush: ServidorDeTeste
let semPush: ServidorDeTeste
let servico: ServicoDePushFalso
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servico = new ServicoDePushFalso()
  await servico.arrancar()
  comPush = await levantarServidor({ push: { contacto: "", servicos: ["push.test"], transporte: servico.transporte } })
  semPush = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
  vi.restoreAllMocks()
})

afterAll(async () => {
  await comPush?.fechar()
  await semPush?.fechar()
  await servico?.parar()
})

function dados(extra: Partial<DadosDoPush> = {}): DadosDoPush {
  const aparelho = servico.novoAparelho()
  return {
    endpoint: aparelho.endpoint,
    p256dh: toBase64(aparelho.p256dh),
    auth: toBase64(aparelho.auth),
    lingua: "pt",
    silenciados: [],
    calarAte: 0,
    ...extra,
  }
}

/** Every `push.*` frame a session writes to its socket, by type. */
function tramasDoPush(): () => string[] {
  const vistas: string[] = []
  const original = WebSocket.prototype.send
  vi.spyOn(WebSocket.prototype, "send").mockImplementation(function (this: WebSocket, dados) {
    if (typeof dados === "string" && dados.includes('"t":"push.')) vistas.push((JSON.parse(dados) as { t: string }).t)
    return original.call(this, dados)
  })
  return () => vistas
}

describe("a sessão e o Web Push", () => {
  it("lê a capacidade e a chave do servidor", async () => {
    const [ana] = await contasDeTeste(comPush, ["Ana"])
    abertas.push(ana!)
    expect(ana!.session.suportaPush).toBe(true)
    expect(await ana!.session.chaveDoPush()).toBe(toBase64(comPush.enclave.push?.chavePublica as Uint8Array))
  })

  it("subscreve, e a linha é a deste aparelho", async () => {
    const [ana] = await contasDeTeste(comPush, ["Ana"])
    abertas.push(ana!)
    const d = dados({ silenciados: ["!x:casa.pt"], calarAte: CALAR_PARA_SEMPRE })
    await ana!.session.subscreverPush(d)
    const [linha] = comPush.enclave.store.pushSubscriptionsDaConta(ana!.address)
    expect(linha?.endpoint).toBe(d.endpoint)
    expect(linha?.silenciados).toEqual(["!x:casa.pt"])
    expect(toBase64(linha?.deviceKey as Uint8Array)).toBe(toBase64(ana!.session.identity.deviceSigningPublicKey))
  })

  it("religar reenvia a última subscrição, uma vez por ligação", async () => {
    const [ana] = await contasDeTeste(comPush, ["Ana"])
    abertas.push(ana!)
    const espiao = vi.spyOn(comPush.enclave.store, "putPushSubscription")
    await ana!.session.subscreverPush(dados({ lingua: "en" }))
    expect(espiao).toHaveBeenCalledTimes(1)
    for (let vez = 2; vez <= 3; vez++) {
      ana!.session.disconnect()
      await ana!.session.connect()
      await ate(() => espiao.mock.calls.length >= vez, `reenvio ${vez}`)
    }
    expect(espiao).toHaveBeenCalledTimes(3)
    expect(espiao.mock.calls.every(([sub]) => sub.lingua === "en")).toBe(true)
  })

  it("cancelar apaga a linha, e religar já não reenvia", async () => {
    const [ana] = await contasDeTeste(comPush, ["Ana"])
    abertas.push(ana!)
    await ana!.session.subscreverPush(dados())
    await ana!.session.cancelarPush()
    expect(comPush.enclave.store.pushSubscriptionsDaConta(ana!.address)).toHaveLength(0)
    const vistas = tramasDoPush()
    ana!.session.disconnect()
    await ana!.session.connect()
    // Something after the login that needs a round trip, so a resend would already be out.
    await ana!.session.chaveDoPush()
    expect(vistas()).toEqual(["push.key.get"])
  })

  it("uma recusa do servidor chega como erro com a razão", async () => {
    const [ana] = await contasDeTeste(comPush, ["Ana"])
    abertas.push(ana!)
    const erro = await ana!.session.subscreverPush(dados({ endpoint: "https://fora.da.lista/x" })).catch((e: Error) => e)
    expect((erro as Error).message).toBe(ERRO_PUSH_RECUSADO_PELO_SERVIDOR)
    expect((erro as Error).cause).toMatchObject({ reason: "endpoint-not-allowed" })
    expect(comPush.enclave.store.pushSubscriptionsDaConta(ana!.address)).toHaveLength(0)
  })

  it("contra um servidor sem a capacidade não sai trama push.* nenhuma", async () => {
    const vistas = tramasDoPush()
    const [rui] = await contasDeTeste(semPush, ["Rui"])
    abertas.push(rui!)
    expect(rui!.session.suportaPush).toBe(false)
    await expect(rui!.session.chaveDoPush()).rejects.toThrow(ERRO_PUSH_SEM_SERVIDOR)
    await expect(rui!.session.subscreverPush(dados())).rejects.toThrow(ERRO_PUSH_SEM_SERVIDOR)
    // Cancelling is quiet: there is nothing on this server to cancel.
    await rui!.session.cancelarPush()
    rui!.session.disconnect()
    await rui!.session.connect()
    expect(vistas()).toEqual([])
  })
})
