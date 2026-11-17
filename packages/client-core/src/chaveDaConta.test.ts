import { generateDeviceKey, generateIdentity, parseServerName, toBase64 } from "@enclave/protocol"
import { ed25519 } from "@noble/curves/ed25519.js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PassagemDaChaveDaConta, TECTOS_DA_CHAVE_DA_CONTA, type PortaDaChaveDaConta } from "./chaveDaConta.js"

/**
 * The account private key, from the device that has it to a paired device that
 * does not, over an in-memory relay of account channel signals. Real ciphers on
 * both layers; the signal key is fixed (the MLS one is proven in
 * `session.chave-da-conta.rede.test.ts`, with the server).
 */

const CASA = parseServerName("localhost")
const CANAL_DA_CONTA = "!conta:localhost"
const CHAVE = { epoca: 1n, chave: new Uint8Array(32).fill(7) }

interface Aparelho {
  nome: string
  aparelho: Uint8Array
  privadaDoAparelho: Uint8Array
  chaveDaConta: Uint8Array | undefined
  ligado: boolean
  passagem: PassagemDaChaveDaConta
  sinais: string[]
}

function rede(conta: ReturnType<typeof generateIdentity>, opcoes: { revogados?: string[]; folhas?: (lista: Aparelho[]) => string[] } = {}) {
  const aparelhos: Aparelho[] = []
  function aparelho(nome: string, comChave: boolean): Aparelho {
    const { privateKey, publicKey } = generateDeviceKey()
    const eu: Aparelho = {
      nome,
      aparelho: publicKey,
      privadaDoAparelho: privateKey,
      chaveDaConta: comChave ? conta.signingPrivateKey : undefined,
      ligado: true,
      sinais: [],
      passagem: undefined as unknown as PassagemDaChaveDaConta,
    }
    const porta: PortaDaChaveDaConta = {
      eu: () => ({ address: conta.address, aparelho: eu.aparelho, assinar: (m) => ed25519.sign(m, eu.privadaDoAparelho) }),
      chavePublicaDaConta: () => conta.signingPublicKey,
      chavePrivadaDaConta: () => eu.chaveDaConta,
      canalDaConta: () => CANAL_DA_CONTA,
      contaPronta: async () => true,
      folhasDaConta: () => (opcoes.folhas ? opcoes.folhas(aparelhos) : aparelhos.map((a) => toBase64(a.aparelho))),
      aparelhoAdmitido: (chave) => !(opcoes.revogados ?? []).includes(chave),
      derivarChave: async () => CHAVE,
      podeSinalizar: () => eu.ligado,
      enviarSinal: (sinal) => {
        eu.sinais.push(sinal)
        for (const outro of aparelhos) {
          if (outro !== eu && outro.ligado) void outro.passagem.aoSinal({ channel: CANAL_DA_CONTA, from: conta.address, sinal })
        }
      },
      receber: async (chave) => {
        eu.chaveDaConta = chave
      },
      agora: () => Date.now(),
    }
    eu.passagem = new PassagemDaChaveDaConta(porta)
    aparelhos.push(eu)
    return eu
  }
  return { aparelho, aparelhos }
}

const espera = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe("a chave da conta passa para o telemóvel emparelhado antes da 1.3.16", () => {
  const tectos = { ...TECTOS_DA_CHAVE_DA_CONTA }
  beforeEach(() => {
    Object.assign(TECTOS_DA_CHAVE_DA_CONTA, { primeiroPedidoMs: 5, pedirCadaMs: 40, respostaPorAparelhoMs: 30 })
  })
  afterEach(() => {
    Object.assign(TECTOS_DA_CHAVE_DA_CONTA, tectos)
  })

  it("o telemóvel pede, o computador responde, e a chave que chega é a da conta", async () => {
    const conta = generateIdentity(CASA)
    const { aparelho } = rede(conta)
    const pc = aparelho("pc", true)
    const tel = aparelho("telemóvel", false)
    pc.passagem.aoLigar()
    tel.passagem.aoLigar()
    for (let i = 0; i < 50 && tel.chaveDaConta === undefined; i++) await espera(10)
    expect(tel.chaveDaConta && toBase64(tel.chaveDaConta)).toBe(toBase64(conta.signingPrivateKey))
    expect(tel.passagem.estatisticas.recebidas).toBe(1)
    expect(pc.passagem.estatisticas.respostas).toBeGreaterThanOrEqual(1)
    // Nothing on the wire carries the key in the clear, nor in plain base64.
    for (const sinal of [...pc.sinais, ...tel.sinais]) expect(sinal).not.toContain(toBase64(conta.signingPrivateKey))
    // With the key, the phone stops asking.
    const pedidos = tel.passagem.estatisticas.pedidos
    await espera(150)
    expect(tel.passagem.estatisticas.pedidos).toBe(pedidos)
    pc.passagem.aoDesligar()
    tel.passagem.aoDesligar()
  })

  it("sem o computador ligado nada chega; quando ele liga, chega sem o telemóvel fazer nada", async () => {
    const conta = generateIdentity(CASA)
    const { aparelho } = rede(conta)
    const pc = aparelho("pc", true)
    const tel = aparelho("telemóvel", false)
    pc.ligado = false
    tel.passagem.aoLigar()
    await espera(120)
    expect(tel.chaveDaConta).toBeUndefined()
    expect(tel.passagem.estatisticas.pedidos).toBeGreaterThan(1)
    pc.ligado = true
    pc.passagem.aoLigar()
    for (let i = 0; i < 50 && tel.chaveDaConta === undefined; i++) await espera(10)
    expect(tel.chaveDaConta && toBase64(tel.chaveDaConta)).toBe(toBase64(conta.signingPrivateKey))
    tel.passagem.aoDesligar()
  })

  it("um aparelho que o computador sabe removido não recebe a chave", async () => {
    const conta = generateIdentity(CASA)
    const revogados: string[] = []
    const { aparelho } = rede(conta, { revogados })
    const pc = aparelho("pc", true)
    const tel = aparelho("telemóvel", false)
    revogados.push(toBase64(tel.aparelho))
    tel.passagem.aoLigar()
    await espera(150)
    expect(tel.chaveDaConta).toBeUndefined()
    expect(pc.passagem.estatisticas.respostas).toBe(0)
    expect(pc.passagem.estatisticas.recusadas).toBeGreaterThan(0)
    tel.passagem.aoDesligar()
  })

  it("quem não é folha da conta no canal da conta não recebe a chave, nem a dá", async () => {
    const conta = generateIdentity(CASA)
    // Only the computer is a leaf: the phone's requests are refused there.
    const { aparelho } = rede(conta, { folhas: (lista) => lista.filter((a) => a.nome === "pc").map((a) => toBase64(a.aparelho)) })
    const pc = aparelho("pc", true)
    const tel = aparelho("telemóvel", false)
    tel.passagem.aoLigar()
    await espera(150)
    expect(tel.chaveDaConta).toBeUndefined()
    expect(pc.passagem.estatisticas.respostas).toBe(0)
    tel.passagem.aoDesligar()
  })

  it("uma chave de outra conta, bem cifrada, não se aceita", async () => {
    const conta = generateIdentity(CASA)
    const outra = generateIdentity(CASA)
    const { aparelho } = rede(conta)
    const pc = aparelho("pc", true)
    // A device of this account that holds another account's private key (a bug, or a lie).
    pc.chaveDaConta = outra.signingPrivateKey
    const tel = aparelho("telemóvel", false)
    tel.passagem.aoLigar()
    await espera(150)
    expect(tel.chaveDaConta).toBeUndefined()
    expect(tel.passagem.estatisticas.recusadas).toBeGreaterThan(0)
    tel.passagem.aoDesligar()
  })

  it("um sinal do histórico (outro primeiro byte) não é deste módulo", async () => {
    const conta = generateIdentity(CASA)
    const { aparelho } = rede(conta)
    const tel = aparelho("telemóvel", false)
    expect(await tel.passagem.aoSinal({ channel: CANAL_DA_CONTA, from: conta.address, sinal: "AAAA" })).toBe(false)
    expect(await tel.passagem.aoSinal({ channel: "!outro:localhost", from: conta.address, sinal: "AAAA" })).toBe(false)
  })
})
