import { generateIdentity, parseServerName, signDeviceManifest, toBase64 } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { provaDeRemocao } from "./revogacao.js"
// The harness server, for real, on an ephemeral port.
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
 * Removing a device in Settings › Devices (1.3.16): the
 * account becomes unreachable on that device. The server refuses it, and when it
 * connects again the session says `removido` (with the signed manifest as proof),
 * which is what makes the interface sign out and erase the vault.
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

/** The `device-revoked` statuses of a session, with `removido` when it came. */
function revogacoes(conta: ContaDeTeste): () => { removido: boolean }[] {
  const vistos: { removido: boolean }[] = []
  conta.session.on("status", (evento) => {
    if (evento.code === "device-revoked") vistos.push({ removido: evento.removido === true })
  })
  return () => vistos
}

describe("tirar um aparelho da conta", () => {
  it("o telemóvel tirado volta a ligar-se e a sessão diz removido, com a prova assinada", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"])
    abertas.push(ana!)
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    const vistos = revogacoes(telemovel)
    // The phone saw its own manifest (it has the key, and `#garantirManifesto` read it).
    await ate(() => (telemovel.vault.contents.deviceManifests?.[ana!.address] ?? 0) >= 2, "o telemóvel viu o manifesto com ele", 30_000)
    telemovel.session.disconnect()

    await ana!.session.revokeDevice(toBase64(telemovel.session.identity.deviceSigningPublicKey))
    await telemovel.session.connect().catch(() => {})
    await ate(() => vistos().length > 0, "o telemóvel recebe device-revoked", 15_000)
    expect(vistos()[0]).toEqual({ removido: true })
  }, 120_000)

  it("ligado no momento em que o tiram: sai logo, também com a prova", async () => {
    const [ana] = await contasDeTeste(servidor, ["Ana"])
    abertas.push(ana!)
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    const vistos = revogacoes(telemovel)
    await ate(() => (telemovel.vault.contents.deviceManifests?.[ana!.address] ?? 0) >= 2, "o telemóvel viu o manifesto com ele", 30_000)
    await ana!.session.revokeDevice(toBase64(telemovel.session.identity.deviceSigningPublicKey))
    await ate(() => vistos().length > 0, "o telemóvel recebe device-revoked", 15_000)
    expect(vistos()[0]).toEqual({ removido: true })
  }, 120_000)
})

describe("provaDeRemocao: o servidor não basta para apagar um cofre", () => {
  const CASA = parseServerName("localhost")
  const conta = generateIdentity(CASA)
  const outra = generateIdentity(CASA)
  const telemovel = toBase64(new Uint8Array(32).fill(9))
  const pc = conta.deviceSigningPublicKey
  const manifesto = (de: typeof conta, version: number, comTelemovel: boolean) =>
    signDeviceManifest(de.signingPrivateKey, {
      address: de.address,
      version,
      devices: [
        { deviceKey: pc, addedAt: 0 },
        ...(comTelemovel ? [{ deviceKey: new Uint8Array(32).fill(9), addedAt: 1 }] : []),
      ],
      signedAt: version,
    })

  it("vale: assinado pela conta, mais novo do que o visto, sem o aparelho", () => {
    expect(provaDeRemocao(manifesto(conta, 3, false), conta.address, telemovel, 2)).toBe(true)
  })
  it("não vale: um manifesto velho reposto pelo servidor (de antes de o aparelho entrar)", () => {
    expect(provaDeRemocao(manifesto(conta, 1, false), conta.address, telemovel, 2)).toBe(false)
  })
  it("não vale: o aparelho ainda lá está", () => {
    expect(provaDeRemocao(manifesto(conta, 3, true), conta.address, telemovel, 2)).toBe(false)
  })
  it("não vale: de outra conta, ou mexido depois de assinado", () => {
    expect(provaDeRemocao(manifesto(outra, 3, false), conta.address, telemovel, 2)).toBe(false)
    expect(provaDeRemocao({ ...manifesto(conta, 3, false), version: 4 }, conta.address, telemovel, 2)).toBe(false)
  })
  it("não vale: sem manifesto, ou sem nenhuma versão vista neste cofre", () => {
    expect(provaDeRemocao(undefined, conta.address, telemovel, 2)).toBe(false)
    expect(provaDeRemocao(manifesto(conta, 3, false), conta.address, telemovel, undefined)).toBe(false)
  })
})
