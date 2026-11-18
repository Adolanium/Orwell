import {
  CAPACIDADE_COFRE_CIFRADO,
  fromBase64,
  generateIdentity,
  identityFromPrivateKey,
  PROTOCOL_VERSION,
  signDeviceManifest,
  signWithDevice,
  toBase64,
  type ClientFrame,
  type Identity,
  type ServerFrame,
} from "@enclave/protocol"
import { randomBytes } from "node:crypto"
import { sha256 } from "@noble/hashes/sha2.js"
import { WebSocket } from "ws"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { SERVICOS_DE_PUSH } from "./config.js"
import { Gateway } from "./gateway.js"
import { COMMIT_DEPOIS_DO_ECO, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"
import { ServicoDePushFalso } from "../testes/servico-de-push-falso.js"

/**
 * N-01: in the pairing window the device is not the account's yet (I2 and M4 of
 * the 1.3.20 review).
 *
 * A removed phone keeps the account key, and enters the window of any pairing the
 * owner starts. It had no seats there, but it could rewrite or delete the
 * account's `conta:` vault and leave a push subscription that outlived the window:
 * a removed phone woken on every message to the account, for good. And each new
 * device key wrote a row in `pairing_windows`, with no cap.
 */

let servidor: ServidorDeTeste
let servico: ServicoDePushFalso

beforeAll(async () => {
  servico = new ServicoDePushFalso()
  await servico.arrancar()
  servidor = await levantarServidor({
    push: { contacto: "", servicos: [...SERVICOS_DE_PUSH, "push.test"], transporte: servico.transporte },
  })
  servico.chaveDoServidor = servidor.enclave.push?.chavePublica ?? null
}, 30_000)

afterAll(async () => {
  await servidor?.fechar()
  await servico?.parar()
})

const JANELA_DE_TESTE_MS = 600
let janelaOriginal: number
beforeEach(() => {
  janelaOriginal = Gateway.JANELA_DE_EMPARELHAMENTO_MS
  Gateway.JANELA_DE_EMPARELHAMENTO_MS = JANELA_DE_TESTE_MS
})
afterEach(() => {
  Gateway.JANELA_DE_EMPARELHAMENTO_MS = janelaOriginal
})

class Ligacao {
  #socket: WebSocket
  #fila: ServerFrame[] = []
  #esperas: ((frame: ServerFrame) => void)[] = []
  fechada = false
  readonly #fechou: Promise<void>

  constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      const espera = this.#esperas.shift()
      if (espera) espera(frame)
      else this.#fila.push(frame)
    })
    this.#fechou = new Promise((resolve) =>
      socket.once("close", () => {
        this.fechada = true
        resolve()
      }),
    )
  }

  enviar(frame: ClientFrame): void {
    this.#socket.send(JSON.stringify(frame))
  }

  proximo(): Promise<ServerFrame> {
    const pronto = this.#fila.shift()
    if (pronto) return Promise.resolve(pronto)
    return new Promise((resolve) => {
      this.#esperas.push(resolve)
      setTimeout(() => resolve({ t: "error", code: "timeout", message: "no frame", fatal: false }), 4000)
    })
  }

  async proximoDe<K extends ServerFrame["t"]>(tipo: K): Promise<Extract<ServerFrame, { t: K }>> {
    for (let i = 0; i < 20; i++) {
      const frame = await this.proximo()
      if (frame.t === tipo) return frame as Extract<ServerFrame, { t: K }>
      if (frame.t === "error" && frame.code === "timeout") break
    }
    throw new Error(`nunca chegou um ${tipo}`)
  }

  fechado(): Promise<void> {
    return this.#fechou
  }

  fechar(): void {
    this.#socket.close()
  }
}

/** Log in with the chain, announcing the vault, and return the first frame after `auth.finish` (`auth.ok` or `error`). */
async function tentar(identidade: Identity): Promise<{ ligacao: Ligacao; resposta: ServerFrame }> {
  const socket = new WebSocket(servidor.url)
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve())
    socket.once("error", reject)
  })
  const ligacao = new Ligacao(socket)
  ligacao.enviar({ t: "hello", version: PROTOCOL_VERSION, capabilities: [COMMIT_DEPOIS_DO_ECO, CAPACIDADE_COFRE_CIFRADO] })
  await ligacao.proximoDe("hello.ok")
  ligacao.enviar({
    t: "auth.begin",
    address: identidade.address,
    signingKey: toBase64(identidade.deviceSigningPublicKey),
    accountKey: toBase64(identidade.signingPublicKey),
    deviceCert: toBase64(identidade.credential.signature),
  })
  const desafio = await ligacao.proximoDe("auth.challenge")
  ligacao.enviar({ t: "auth.finish", signature: toBase64(signWithDevice(identidade, fromBase64(desafio.nonce))) })
  return { ligacao, resposta: await ligacao.proximo() }
}

function manifesto(conta: Identity, version: number, aparelhos: Identity[]) {
  return signDeviceManifest(conta.signingPrivateKey, {
    address: conta.address,
    version,
    devices: aparelhos.map((a, i) => ({ deviceKey: a.deviceSigningPublicKey, addedAt: i })),
    signedAt: version,
  })
}

async function publicar(ligacao: Ligacao, wire: ReturnType<typeof manifesto>) {
  ligacao.enviar({ t: "manifest.publish", manifest: wire })
  return ligacao.proximoDe("manifest.published")
}

async function abrirCaixa(anfitriao: Ligacao): Promise<void> {
  const pairId = toBase64(sha256(crypto.getRandomValues(new Uint8Array(32)))).slice(0, 22)
  anfitriao.enviar({ t: "pair.open", pairId })
  await anfitriao.proximoDe("pair.opened")
}

function subscricao(): ClientFrame {
  const aparelho = servico.novoAparelho()
  return {
    t: "push.subscribe",
    endpoint: aparelho.endpoint,
    p256dh: toBase64(aparelho.p256dh),
    auth: toBase64(aparelho.auth),
    lingua: "pt",
    silenciados: [],
    calarAte: 0,
  }
}

function linhasDePush(conta: Identity, aparelho: Identity): number {
  const chave = toBase64(aparelho.deviceSigningPublicKey)
  return servidor.enclave.store.pushSubscriptionsDaConta(conta.address).filter((s) => toBase64(s.deviceKey) === chave).length
}

/** The account (computer with the key, in the manifest) and a key the removed phone certifies now. */
async function contaComCaixaAberta(): Promise<{ computador: Identity; intruso: Identity; a: Ligacao }> {
  const computador = generateIdentity(servidor.casa)
  const intruso = identityFromPrivateKey(computador.signingPrivateKey, servidor.casa)
  const { ligacao: a, resposta } = await tentar(computador)
  expect(resposta.t).toBe("auth.ok")
  expect((await publicar(a, manifesto(computador, 1, [computador]))).ok).toBe(true)
  await abrirCaixa(a)
  return { computador, intruso, a }
}

describe("N-01: na janela de emparelhamento, nada da conta se escreve", () => {
  it("cofre.put e cofre.del em conta: são recusados, e cofre.get responde", async () => {
    const { computador, intruso, a } = await contaComCaixaAberta()
    const escopo = `conta:${computador.address}`
    // The owner writes one entry first, so a del would have something to remove.
    a.enviar({ t: "cofre.put", escopo, entradas: [{ chave: toBase64(randomBytes(16)), conteudo: toBase64(randomBytes(1024)) }], ref: "dono" })
    expect((await a.proximoDe("cofre.put.result")).aceites).toHaveLength(1)
    const { ligacao: c, resposta } = await tentar(intruso)
    expect(resposta.t).toBe("auth.ok")

    c.enviar({ t: "cofre.put", escopo, entradas: [{ chave: toBase64(randomBytes(16)), conteudo: toBase64(randomBytes(1024)) }], ref: "p" })
    expect(await c.proximoDe("cofre.rejected")).toMatchObject({ code: "cofre-sem-lugar", ref: "p" })
    c.enviar({ t: "cofre.del", escopo, chave: toBase64(randomBytes(16)), ref: "d" })
    expect(await c.proximoDe("cofre.rejected")).toMatchObject({ code: "cofre-sem-lugar", ref: "d" })
    c.enviar({ t: "cofre.get", escopo, desdeVersao: 0, ref: "g" })
    expect((await c.proximoDe("cofre.entradas")).ref).toBe("g")
    a.fechar()
    c.fechar()
  })

  it("push.subscribe é recusado, e no fim da janela não fica linha de push para a chave", async () => {
    const { computador, intruso, a } = await contaComCaixaAberta()
    const { ligacao: c, resposta } = await tentar(intruso)
    expect(resposta.t).toBe("auth.ok")
    c.enviar(subscricao())
    expect(await c.proximoDe("push.subscribed")).toMatchObject({ ok: false, reason: "no-device" })
    await c.fechado()
    expect(linhasDePush(computador, intruso)).toBe(0)
    a.fechar()
  })

  it("o aparelho que o manifesto põe sai da janela, e então subscreve o push e escreve no cofre", async () => {
    const { computador, intruso: novo, a } = await contaComCaixaAberta()
    const { ligacao: c, resposta } = await tentar(novo)
    expect(resposta.t).toBe("auth.ok")
    expect((await publicar(a, manifesto(computador, 2, [computador, novo]))).ok).toBe(true)
    // The manifest reaches the gateway's connections before the next frame of `c`.
    a.enviar({ t: "ping" })
    await a.proximoDe("pong")
    c.enviar(subscricao())
    expect(await c.proximoDe("push.subscribed")).toMatchObject({ ok: true })
    const escopo = `conta:${computador.address}`
    c.enviar({ t: "cofre.put", escopo, entradas: [{ chave: toBase64(randomBytes(16)), conteudo: toBase64(randomBytes(1024)) }], ref: "p" })
    expect((await c.proximoDe("cofre.put.result")).aceites).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, JANELA_DE_TESTE_MS * 2))
    expect(c.fechada).toBe(false)
    expect(linhasDePush(computador, novo)).toBe(1)
    a.fechar()
    c.fechar()
  })

  it("quem nunca esteve no manifesto e fica sem janela recebe pairingUnfinished; um aparelho removido não (M1)", async () => {
    const computador = generateIdentity(servidor.casa)
    const telemovel = identityFromPrivateKey(computador.signingPrivateKey, servidor.casa)
    const novo = identityFromPrivateKey(computador.signingPrivateKey, servidor.casa)
    const { ligacao: a } = await tentar(computador)
    expect((await publicar(a, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)
    // No box open: the new key gets no window.
    const { resposta: semJanela } = await tentar(novo)
    expect(semJanela).toMatchObject({ t: "error", code: "device-revoked", pairingUnfinished: true })
    // Removed with a manifest: the proof goes, and no pairingUnfinished.
    a.enviar({ t: "manifest.publish", manifest: manifesto(computador, 2, [computador]), revoke: [toBase64(telemovel.deviceSigningPublicKey)] })
    expect((await a.proximoDe("manifest.published")).ok).toBe(true)
    const socket = new WebSocket(servidor.url)
    await new Promise<void>((resolve) => socket.once("open", () => resolve()))
    const r = new Ligacao(socket)
    r.enviar({ t: "hello", version: PROTOCOL_VERSION, capabilities: [COMMIT_DEPOIS_DO_ECO] })
    await r.proximoDe("hello.ok")
    r.enviar({
      t: "auth.begin",
      address: telemovel.address,
      signingKey: toBase64(telemovel.deviceSigningPublicKey),
      accountKey: toBase64(telemovel.signingPublicKey),
      deviceCert: toBase64(telemovel.credential.signature),
    })
    const removido = await r.proximoDe("error")
    expect(removido.code).toBe("device-revoked")
    expect("pairingUnfinished" in removido).toBe(false)
    expect("manifest" in removido).toBe(true)
    a.fechar()
  })

  it("sem tecto por conta: chaves novas a gastar janelas não trancam o convidado verdadeiro (N1)", async () => {
    const { computador, a } = await contaComCaixaAberta()
    // 25 keys, more than the old cap of 20, all minted from the account key as a
    // removed phone would; the last one stands for the real guest.
    const chaves = Array.from({ length: 25 }, () => identityFromPrivateKey(computador.signingPrivateKey, servidor.casa))
    const respostas: string[] = []
    for (const chave of chaves) {
      const { ligacao, resposta } = await tentar(chave)
      respostas.push(resposta.t === "error" ? resposta.code : resposta.t)
      ligacao.fechar()
    }
    expect(respostas.at(-1)).toBe("auth.ok")
    expect(respostas.filter((r) => r !== "auth.ok")).toEqual([])
    a.fechar()
  })
})
