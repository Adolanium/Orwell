import { ArmazemEmMemoria, Session, Vault } from "@enclave/client-core"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { CofreEmMemoria, contasDeTeste, desligarContas, levantarServidor, type ContaDeTeste, type ServidorDeTeste } from "../testes/cliente-de-teste.js"
import { Gateway } from "./gateway.js"

/**
 * The guest of a pairing, after the certificate, when the computer gave up
 * (final review of 1.3.19, M2).
 *
 * The computer closes the box at 60 s without `pronto`. The guest's socket is
 * then in no box, and since 1.3.19 the server closes a socket without an
 * account after `PRAZO_DO_LOGIN_MS` with the fatal `login-timeout`. The guest
 * already has its certificate: the box closing is noted (`caixaAberta`), and
 * this error must not turn the pairing into "falhou: sem-ligacao".
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const sessoes: Session[] = []
let prazoOriginal: number

beforeAll(async () => {
  servidor = await levantarServidor()
  prazoOriginal = Gateway.PRAZO_DO_LOGIN_MS
  Gateway.PRAZO_DO_LOGIN_MS = 300
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
  for (const sessao of sessoes.splice(0)) sessao.disconnect()
})

afterAll(async () => {
  Gateway.PRAZO_DO_LOGIN_MS = prazoOriginal
  await servidor?.fechar()
})

function fase(session: Session, alvo: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const prazo = setTimeout(() => reject(new Error(`nunca chegou a ${alvo}`)), 20_000)
    const desligar = session.on("pair", (evento) => {
      if (evento.fase !== alvo) return
      clearTimeout(prazo)
      desligar()
      resolve()
    })
  })
}

describe("o convidado com o certificado, quando o computador desiste", () => {
  it("o login-timeout do socket da caixa não faz falhar o emparelhamento", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"])
    abertas.push(ana!)
    const vault = new Vault(new CofreEmMemoria())
    await vault.create("frase-do-telemovel")
    const telemovel = new Session(vault, { armazem: new ArmazemEmMemoria() })
    sessoes.push(telemovel)
    const fases: string[] = []
    telemovel.on("pair", (evento) => fases.push(evento.fase))

    const sasA = fase(ana!.session, "sas")
    const { link } = await ana!.session.emparelharComoAnfitriao()
    const sasT = fase(telemovel, "sas")
    telemovel.emparelharComoConvidado(link)
    await Promise.all([sasA, sasT])
    const certificado = fase(telemovel, "certificado")
    await telemovel.confirmarSas()
    await ana!.session.confirmarSas()
    await certificado

    // The computer gives up: the box closes, and the guest's socket is left without one.
    ana!.session.cancelarEmparelhamento()
    await new Promise((pronto) => setTimeout(pronto, 1_500))
    expect(fases).not.toContain("falhou")
  }, 60_000)
})
