import {
  CAPABILITY_ROOM_LIMIT,
  CAPACIDADE_ENVIO_RECUSADO,
  CAPACIDADE_LIMITE_DE_CANAIS,
  CAPACIDADE_LIMITES_DE_CONTA_NOVA,
  CAPACIDADE_PROVA_DE_TRABALHO,
  CODIGO_CONVITE_DE_REGISTO_INVALIDO,
  CODIGO_PROVA_EM_FALTA,
  CODIGO_PROVA_INVALIDA,
  CODIGO_REDE_COM_MUITAS_CONTAS,
  CODIGO_VERSAO_ANTIGA,
  chaveDaProvaDoConvite,
  provarConviteNoRegisto,
  provarCodigoDoConvite,
  fromBase64,
  generateIdentity,
  identityFromPrivateKey,
  moradaDeSala,
  procurarNonce,
  PROTOCOL_VERSION,
  signWithDevice,
  toBase64,
  type AccountIdentity,
  type ClientFrame,
  type ProvaDeTrabalho,
  type ServerFrame,
} from "@enclave/protocol"
import { createChannel, publishableGroupInfo } from "@enclave/crypto"
import { sha256 } from "@noble/hashes/sha2.js"
import type { z } from "zod"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"
import type { ServerConfig } from "./config.js"
import { currentMinute } from "./db.js"
import { Gateway } from "./gateway.js"

/**
 * The abuse brake, part 2 (1.3.26), on a real server and real sockets.
 *
 * Each connection says where it comes from with X-Forwarded-For, as Caddy does
 * in production: the test talks to the server from loopback, which is a
 * trusted proxy, so `request.ip` is the address in the header. A connection
 * with no header is loopback itself (development on the same machine), which
 * the per-network limit, the new-account limits and the join ceiling leave
 * alone.
 */

let servidor: ServidorDeTeste | undefined
const abertos: Cliente[] = []
afterEach(async () => {
  for (const cliente of abertos.splice(0)) cliente.fechar()
  await servidor?.fechar()
  servidor = undefined
})

const TODAS = ["commit-after-echo", CAPACIDADE_ENVIO_RECUSADO, CAPACIDADE_PROVA_DE_TRABALHO, CAPACIDADE_LIMITES_DE_CONTA_NOVA]

type TramaDoCliente = z.input<typeof ClientFrame>

class Cliente {
  hello: Extract<ServerFrame, { t: "hello.ok" }> | null = null
  address = ""
  readonly #fila: ServerFrame[] = []
  readonly #esperas: ((frame: ServerFrame) => void)[] = []
  readonly fechou: Promise<void>

  private constructor(readonly socket: WebSocket) {
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      const espera = this.#esperas.shift()
      if (espera) espera(frame)
      else this.#fila.push(frame)
    })
    this.fechou = new Promise((resolve) => socket.once("close", () => resolve()))
  }

  static async ligar(url: string, ip?: string): Promise<Cliente> {
    const socket = new WebSocket(url, ip ? { headers: { "x-forwarded-for": ip } } : {})
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve())
      socket.once("error", reject)
    })
    const cliente = new Cliente(socket)
    abertos.push(cliente)
    return cliente
  }

  enviar(frame: TramaDoCliente): void {
    this.socket.send(JSON.stringify(frame))
  }

  proximo(ms = 3000): Promise<ServerFrame> {
    const pronta = this.#fila.shift()
    if (pronta) return Promise.resolve(pronta)
    return new Promise((resolve) => {
      const espera = (frame: ServerFrame) => {
        clearTimeout(prazo)
        resolve(frame)
      }
      const prazo = setTimeout(() => {
        const i = this.#esperas.indexOf(espera)
        if (i >= 0) this.#esperas.splice(i, 1)
        resolve({ t: "error", code: "timeout", message: "no frame", fatal: false })
      }, ms)
      this.#esperas.push(espera)
    })
  }

  async proximoDe<K extends ServerFrame["t"]>(tipo: K, ms = 3000): Promise<Extract<ServerFrame, { t: K }> | null> {
    for (let i = 0; i < 20; i++) {
      const frame = await this.proximo(ms)
      if (frame.t === tipo) return frame as Extract<ServerFrame, { t: K }>
      if (frame.t === "error" && frame.code === "timeout") return null
    }
    return null
  }

  /** Every frame that arrives before a ping's pong. */
  async ate(): Promise<ServerFrame[]> {
    this.enviar({ t: "ping" })
    const vistas: ServerFrame[] = []
    for (let i = 0; i < 50; i++) {
      const frame = await this.proximo()
      if (frame.t === "pong" || (frame.t === "error" && frame.code === "timeout")) break
      vistas.push(frame)
    }
    return vistas
  }

  fechar(): void {
    this.socket.close()
  }
}

/** Solve a challenge the way the app does. */
function resolver(desafio: { desafio: string; trabalho: number }): ProvaDeTrabalho {
  const nonce = procurarNonce(desafio.desafio, desafio.trabalho, 0, 50_000_000)
  if (nonce === null) throw new Error("no nonce")
  return { desafio: desafio.desafio, nonce }
}

interface Opcoes {
  ip?: string
  capacidades?: string[]
  /** `true`: solve the challenge from this connection's `hello.ok`. A proof: send it as is. */
  prova?: boolean | ProvaDeTrabalho
  convite?: string
  conviteDeComunidade?: { codeHash: string; prova: string }
}

/** A full login with the device chain. Returns the client and the last frame (`auth.ok` or the refusal). */
async function entrar(identidade: AccountIdentity, opcoes: Opcoes = {}): Promise<{ cliente: Cliente; fim: ServerFrame }> {
  const cliente = await Cliente.ligar(servidor!.url, opcoes.ip)
  cliente.enviar({ t: "hello", version: PROTOCOL_VERSION, capabilities: opcoes.capacidades ?? TODAS })
  cliente.hello = (await cliente.proximoDe("hello.ok"))!
  cliente.address = identidade.address
  cliente.enviar({
    t: "auth.begin",
    address: identidade.address,
    signingKey: toBase64(identidade.deviceSigningPublicKey),
    accountKey: toBase64(identidade.signingPublicKey),
    deviceCert: toBase64(identidade.credential.signature),
  })
  const desafio = (await cliente.proximoDe("auth.challenge"))!
  const prova =
    opcoes.prova === true && cliente.hello.provaDeTrabalho
      ? resolver(cliente.hello.provaDeTrabalho)
      : typeof opcoes.prova === "object"
        ? opcoes.prova
        : undefined
  cliente.enviar({
    t: "auth.finish",
    signature: toBase64(signWithDevice(identidade, fromBase64(desafio.nonce))),
    ...(prova ? { provaDeTrabalho: prova } : {}),
    ...(opcoes.convite ? { conviteDeRegisto: opcoes.convite } : {}),
    ...(opcoes.conviteDeComunidade ? { conviteDeComunidade: opcoes.conviteDeComunidade } : {}),
  })
  let fim = await cliente.proximo()
  // `cofre.versoes` and `keypackage.low` may follow; the verdict is the first frame.
  while (fim.t !== "auth.ok" && fim.t !== "error") fim = await cliente.proximo()
  return { cliente, fim }
}

const codigo = (frame: ServerFrame): string | undefined => (frame.t === "error" ? frame.code : undefined)

const TRABALHO_DE_TESTE = { trabalho: 64, trabalhoNoPico: 4096, picoPorHora: 3 }
const LIMITES = {
  intervaloAte24hS: 30,
  intervaloAte72hS: 10,
  maxBytesAte24h: 4096,
  pessoasAte24h: 2,
  pessoasAte72h: 4,
  comunidades: 1,
  canaisAte24h: 3,
  canaisAte72h: 5,
}

async function levantar(extra: Partial<ServerConfig>): Promise<ServidorDeTeste> {
  servidor = await levantarServidor(extra)
  return servidor
}

let rede = 0
/** A fresh public network for each account, so the per-network limit stays out of tests about other things. */
const outraRede = (): string => `198.18.${(rede++ % 250) + 1}.10`

// ---------------------------------------------------------------- proof of work

describe("a prova de trabalho no registo", () => {
  it("o hello.ok leva um desafio quando o servidor o pede, e não leva quando não pede nem quando está fechado", async () => {
    await levantar({ provaDeTrabalho: TRABALHO_DE_TESTE })
    const { cliente } = await entrar(generateIdentity(servidor!.casa), { prova: true })
    expect(cliente.hello?.provaDeTrabalho).toEqual({ desafio: expect.stringMatching(/^v1\.64\./), trabalho: 64 })
    await servidor!.fechar()
    await levantar({})
    expect((await entrar(generateIdentity(servidor!.casa))).cliente.hello?.provaDeTrabalho).toBeUndefined()
    await servidor!.fechar()
    await levantar({ provaDeTrabalho: TRABALHO_DE_TESTE, registo: "fechado" })
    expect((await entrar(generateIdentity(servidor!.casa))).cliente.hello?.provaDeTrabalho).toBeUndefined()
  })

  it("uma conta nova com a prova entra; a mesma prova não serve para outra conta", async () => {
    const { enclave } = await levantar({ provaDeTrabalho: TRABALHO_DE_TESTE })
    const primeira = generateIdentity(servidor!.casa)
    const ligada = await Cliente.ligar(servidor!.url)
    ligada.enviar({ t: "hello", version: PROTOCOL_VERSION, capabilities: TODAS })
    const prova = resolver((await ligada.proximoDe("hello.ok"))!.provaDeTrabalho!)
    expect((await entrar(primeira, { prova })).fim.t).toBe("auth.ok")
    expect(enclave.store.signingKeyOf(primeira.address)).toBeDefined()
    const segunda = generateIdentity(servidor!.casa)
    const { fim } = await entrar(segunda, { prova })
    expect(codigo(fim)).toBe(CODIGO_PROVA_INVALIDA)
    expect(enclave.store.signingKeyOf(segunda.address)).toBeUndefined()
  })

  it("sem prova, de uma app que sabe resolvê-la: registration-proof-required, fatal, e a conta não fica", async () => {
    const { enclave } = await levantar({ provaDeTrabalho: TRABALHO_DE_TESTE })
    const conta = generateIdentity(servidor!.casa)
    const { cliente, fim } = await entrar(conta)
    expect(codigo(fim)).toBe(CODIGO_PROVA_EM_FALTA)
    expect(fim.t === "error" && fim.fatal).toBe(true)
    await cliente.fechou
    expect(enclave.store.signingKeyOf(conta.address)).toBeUndefined()
  })

  it("sem prova, de uma app antiga (sem a capacidade): versao-antiga, com a frase de actualizar nas duas línguas", async () => {
    const { enclave } = await levantar({ provaDeTrabalho: TRABALHO_DE_TESTE })
    const conta = generateIdentity(servidor!.casa)
    const { cliente, fim } = await entrar(conta, { capacidades: ["commit-after-echo"] })
    expect(codigo(fim)).toBe(CODIGO_VERSAO_ANTIGA)
    expect(fim.t === "error" && fim.message).toBe(Gateway.FRASE_VERSAO_ANTIGA)
    await cliente.fechou
    expect(enclave.store.signingKeyOf(conta.address)).toBeUndefined()
  })

  it("uma prova com nonce errado é recusada", async () => {
    await levantar({ provaDeTrabalho: { trabalho: 2 ** 30, trabalhoNoPico: 2 ** 30, picoPorHora: 50 } })
    const ligada = await Cliente.ligar(servidor!.url)
    ligada.enviar({ t: "hello", version: PROTOCOL_VERSION, capabilities: TODAS })
    const desafio = (await ligada.proximoDe("hello.ok"))!.provaDeTrabalho!
    const { fim } = await entrar(generateIdentity(servidor!.casa), { prova: { desafio: desafio.desafio, nonce: "0" } })
    expect(codigo(fim)).toBe(CODIGO_PROVA_INVALIDA)
  })

  it("uma conta que já existe entra sem prova, de qualquer versão; um aparelho novo dela também", async () => {
    await levantar({ provaDeTrabalho: TRABALHO_DE_TESTE })
    const conta = generateIdentity(servidor!.casa)
    expect((await entrar(conta, { prova: true })).fim.t).toBe("auth.ok")
    expect((await entrar(conta)).fim.t).toBe("auth.ok")
    expect((await entrar(conta, { capacidades: [] })).fim.t).toBe("auth.ok")
    // A second device of the same account: same account key, another device key.
    const aparelho = identityFromPrivateKey(conta.signingPrivateKey, servidor!.casa)
    expect(toBase64(aparelho.deviceSigningPublicKey)).not.toBe(toBase64(conta.deviceSigningPublicKey))
    expect((await entrar(aparelho, { capacidades: [] })).fim.t).toBe("auth.ok")
  })

  it("num pico (mais contas na última hora do que o limite), o desafio pede o trabalho do pico", async () => {
    const { enclave } = await levantar({ provaDeTrabalho: TRABALHO_DE_TESTE })
    for (let i = 0; i < 4; i++) {
      const outra = generateIdentity(servidor!.casa)
      enclave.store.registarContaNoMinuto(outra.address, outra.signingPublicKey, currentMinute())
    }
    const { cliente } = await entrar(generateIdentity(servidor!.casa), { prova: true })
    expect(cliente.hello?.provaDeTrabalho?.trabalho).toBe(4096)
  })
})

// ---------------------------------------------------------------- per network

describe("contas novas por rede", () => {
  it("3 por hora da mesma /24; a quarta é recusada; outra rede entra; um convite de registo passa", async () => {
    const { enclave } = await levantar({ limiteDeRede: { porHora: 3, porDia: 10 } })
    for (let i = 0; i < 3; i++) {
      expect((await entrar(generateIdentity(servidor!.casa), { ip: `203.0.113.${i + 1}` })).fim.t).toBe("auth.ok")
    }
    const quarta = generateIdentity(servidor!.casa)
    const recusada = await entrar(quarta, { ip: "203.0.113.200" })
    expect(codigo(recusada.fim)).toBe(CODIGO_REDE_COM_MUITAS_CONTAS)
    expect(recusada.fim.t === "error" && recusada.fim.fatal).toBe(true)
    expect(enclave.store.signingKeyOf(quarta.address)).toBeUndefined()

    expect((await entrar(generateIdentity(servidor!.casa), { ip: "203.0.114.1" })).fim.t).toBe("auth.ok")

    expect(codigo((await entrar(quarta, { ip: "203.0.113.200", convite: "AAAA-BBBB-CCCC-DDDD" })).fim)).toBe(CODIGO_CONVITE_DE_REGISTO_INVALIDO)
    const convite = enclave.store.criarConviteDeRegisto({ usos: 1, dias: 7 })
    expect((await entrar(quarta, { ip: "203.0.113.200", convite })).fim.t).toBe("auth.ok")
    expect(enclave.store.convitesDeRegisto()[0]?.usos).toBe(1)
  })

  describe("um convite de comunidade também passa o limite", () => {
    /** A community invite as an app makes it: the hash and the proof key from the code. */
    const conviteDe = (canal: string, regras: { expiresAt?: number | null; maxUses?: number | null; semChave?: boolean } = {}) => {
      const code = toBase64(crypto.getRandomValues(new Uint8Array(16)))
      const codeHash = toBase64(sha256(new TextEncoder().encode(code)))
      servidor!.enclave.store.createInvite({
        codeHash,
        channel: canal,
        expiresAt: regras.expiresAt ?? null,
        maxUses: regras.maxUses ?? null,
        ...(regras.semChave ? {} : { codeKey: toBase64(chaveDaProvaDoConvite(code).publica) }),
      })
      return { code, codeHash, para: (address: string) => ({ codeHash, prova: provarConviteNoRegisto(code, { codeHash, address }) }) }
    }
    /** A community with one member older than 72 hours. */
    const comunidadeAntiga = (horas = 100): string => {
      const canal = moradaDeSala(servidor!.casa)
      const antiga = generateIdentity(servidor!.casa)
      servidor!.enclave.store.registarContaNoMinuto(antiga.address, antiga.signingPublicKey, currentMinute() - horas * 60)
      servidor!.enclave.store.subscribe(canal, antiga.address)
      return canal
    }
    /** Fill the network 203.0.113.x (limit 1 per hour). */
    const encher = async () => {
      expect((await entrar(generateIdentity(servidor!.casa), { ip: "203.0.113.1" })).fim.t).toBe("auth.ok")
    }

    it("um convite real e válido de uma comunidade com uma conta antiga passa, sem gastar um uso", async () => {
      const { enclave } = await levantar({ limiteDeRede: { porHora: 1, porDia: 10 } })
      await encher()
      const convite = conviteDe(comunidadeAntiga(), { maxUses: 1 })
      const nova = generateIdentity(servidor!.casa)
      expect(codigo((await entrar(nova, { ip: "203.0.113.2" })).fim)).toBe(CODIGO_REDE_COM_MUITAS_CONTAS)
      expect((await entrar(nova, { ip: "203.0.113.2", conviteDeComunidade: convite.para(nova.address) })).fim.t).toBe("auth.ok")
      expect(enclave.store.signingKeyOf(nova.address)).toBeDefined()
      // The use is spent later, by `invite.redeem`, as always.
      expect(enclave.store.listInvites(enclave.store.channelOfInvite(convite.codeHash)!)[0]?.uses).toBe(0)
    })

    it("a prova é da conta que se regista: outra conta com a mesma prova, ou uma prova de resgate, não passa", async () => {
      await levantar({ limiteDeRede: { porHora: 1, porDia: 10 } })
      await encher()
      const convite = conviteDe(comunidadeAntiga())
      const a = generateIdentity(servidor!.casa)
      const b = generateIdentity(servidor!.casa)
      expect(codigo((await entrar(b, { ip: "203.0.113.3", conviteDeComunidade: convite.para(a.address) })).fim)).toBe(
        CODIGO_REDE_COM_MUITAS_CONTAS,
      )
      // A redeem proof is signed over another domain: it does not stand in.
      const resgate = provarCodigoDoConvite(convite.code, { codeHash: convite.codeHash, address: b.address, keyPackage: bytes(64) })
      expect(codigo((await entrar(b, { ip: "203.0.113.3", conviteDeComunidade: { codeHash: convite.codeHash, prova: resgate } })).fim)).toBe(
        CODIGO_REDE_COM_MUITAS_CONTAS,
      )
      // A code that is not there.
      const falso = conviteDe(comunidadeAntiga())
      servidor!.enclave.store.revokeInvite(falso.codeHash)
      expect(codigo((await entrar(b, { ip: "203.0.113.3", conviteDeComunidade: falso.para(b.address) })).fim)).toBe(
        CODIGO_REDE_COM_MUITAS_CONTAS,
      )
    })

    it("um convite expirado, esgotado ou sem a chave da prova (0.9.x) não passa", async () => {
      await levantar({ limiteDeRede: { porHora: 1, porDia: 10 } })
      await encher()
      const nova = generateIdentity(servidor!.casa)
      const tentar = async (convite: ReturnType<typeof conviteDe>) =>
        codigo((await entrar(nova, { ip: "203.0.113.4", conviteDeComunidade: convite.para(nova.address) })).fim)
      expect(await tentar(conviteDe(comunidadeAntiga(), { expiresAt: Math.floor(Date.now() / 1000) - 1 }))).toBe(CODIGO_REDE_COM_MUITAS_CONTAS)
      expect(await tentar(conviteDe(comunidadeAntiga(), { maxUses: 0 }))).toBe(CODIGO_REDE_COM_MUITAS_CONTAS)
      expect(await tentar(conviteDe(comunidadeAntiga(), { semChave: true }))).toBe(CODIGO_REDE_COM_MUITAS_CONTAS)
    })

    it("um convite de um canal só com contas novas (uma porta feita à medida) não passa", async () => {
      await levantar({ limiteDeRede: { porHora: 1, porDia: 10 } })
      await encher()
      const nova = generateIdentity(servidor!.casa)
      const convite = conviteDe(comunidadeAntiga(48))
      expect(codigo((await entrar(nova, { ip: "203.0.113.5", conviteDeComunidade: convite.para(nova.address) })).fim)).toBe(
        CODIGO_REDE_COM_MUITAS_CONTAS,
      )
      // A channel nobody is in.
      const vazio = conviteDe(moradaDeSala(servidor!.casa))
      expect(codigo((await entrar(nova, { ip: "203.0.113.5", conviteDeComunidade: vazio.para(nova.address) })).fim)).toBe(
        CODIGO_REDE_COM_MUITAS_CONTAS,
      )
    })

    it("cada comunidade passa no máximo o limite de uma rede (aqui 1 por hora); outra comunidade conta à parte", async () => {
      await levantar({ limiteDeRede: { porHora: 1, porDia: 10 } })
      await encher()
      const canal = comunidadeAntiga()
      const convite = conviteDe(canal)
      const primeira = generateIdentity(servidor!.casa)
      expect((await entrar(primeira, { ip: "203.0.113.6", conviteDeComunidade: convite.para(primeira.address) })).fim.t).toBe("auth.ok")
      // Another invite of the same community counts against the same community.
      const outroConvite = conviteDe(canal)
      const segunda = generateIdentity(servidor!.casa)
      expect(codigo((await entrar(segunda, { ip: "203.0.113.7", conviteDeComunidade: outroConvite.para(segunda.address) })).fim)).toBe(
        CODIGO_REDE_COM_MUITAS_CONTAS,
      )
      const deOutra = conviteDe(comunidadeAntiga())
      expect((await entrar(segunda, { ip: "203.0.113.7", conviteDeComunidade: deOutra.para(segunda.address) })).fim.t).toBe("auth.ok")
    })

    it("sem a rede no limite, o convite de comunidade não é preciso e não conta para a comunidade", async () => {
      await levantar({ limiteDeRede: { porHora: 1, porDia: 10 } })
      const canal = comunidadeAntiga()
      const convite = conviteDe(canal)
      const a = generateIdentity(servidor!.casa)
      expect((await entrar(a, { ip: "198.51.100.1", conviteDeComunidade: convite.para(a.address) })).fim.t).toBe("auth.ok")
      // The network 198.51.100.x is now full; the community still has its pass for the hour.
      const b = generateIdentity(servidor!.casa)
      expect((await entrar(b, { ip: "198.51.100.2", conviteDeComunidade: convite.para(b.address) })).fim.t).toBe("auth.ok")
    })
  })

  it("as contas que já existem entram mesmo com a rede no limite", async () => {
    await levantar({ limiteDeRede: { porHora: 1, porDia: 10 } })
    const conta = generateIdentity(servidor!.casa)
    expect((await entrar(conta, { ip: "192.0.2.1" })).fim.t).toBe("auth.ok")
    expect(codigo((await entrar(generateIdentity(servidor!.casa), { ip: "192.0.2.2" })).fim)).toBe(CODIGO_REDE_COM_MUITAS_CONTAS)
    expect((await entrar(conta, { ip: "192.0.2.3" })).fim.t).toBe("auth.ok")
  })

  it("IPv6 conta por /56", async () => {
    await levantar({ limiteDeRede: { porHora: 1, porDia: 10 } })
    expect((await entrar(generateIdentity(servidor!.casa), { ip: "2001:db8:1:100::1" })).fim.t).toBe("auth.ok")
    expect(codigo((await entrar(generateIdentity(servidor!.casa), { ip: "2001:db8:1:1ff::9" })).fim)).toBe(CODIGO_REDE_COM_MUITAS_CONTAS)
    expect((await entrar(generateIdentity(servidor!.casa), { ip: "2001:db8:1:200::1" })).fim.t).toBe("auth.ok")
  })

  it("pela cadeia de produção (nginx > docker-proxy > Caddy > servidor), conta a rede do cliente", async () => {
    // Caddy, trusting the compose gateway, appends it: "client, 172.18.0.1" (see `ip-do-cliente.test.ts`).
    await levantar({ limiteDeRede: { porHora: 1, porDia: 10 } })
    expect((await entrar(generateIdentity(servidor!.casa), { ip: "203.0.113.5, 172.18.0.1" })).fim.t).toBe("auth.ok")
    expect(codigo((await entrar(generateIdentity(servidor!.casa), { ip: "203.0.113.77, 172.18.0.1" })).fim)).toBe(CODIGO_REDE_COM_MUITAS_CONTAS)
    expect((await entrar(generateIdentity(servidor!.casa), { ip: "198.51.100.1, 172.18.0.1" })).fim.t).toBe("auth.ok")
  })

  it("um endereço privado (a cadeia de proxies partida) não junta toda a gente numa só rede", async () => {
    // Without X-Forwarded-For from nginx, every client would be 172.18.0.1: one /24 for the whole
    // server, and 3 accounts an hour for everyone. A private address is never limited.
    await levantar({ limiteDeRede: { porHora: 1, porDia: 1 } })
    for (const ip of ["172.18.0.1", "172.18.0.1", "10.0.0.7", "192.168.1.2", "fd00::1", "fe80::1"]) {
      expect((await entrar(generateIdentity(servidor!.casa), { ip })).fim.t, ip).toBe("auth.ok")
    }
  })

  it("loopback (desenvolvimento na mesma máquina) não tem limite", async () => {
    await levantar({ limiteDeRede: { porHora: 1, porDia: 1 } })
    for (let i = 0; i < 3; i++) expect((await entrar(generateIdentity(servidor!.casa))).fim.t).toBe("auth.ok")
  })
})

// ---------------------------------------------------------------- new accounts

/** An account of this age (hours), already registered, logged in from a fresh network. */
async function contaComIdade(horas: number, capacidades = TODAS): Promise<{ cliente: Cliente; conta: AccountIdentity; fim: ServerFrame }> {
  const conta = generateIdentity(servidor!.casa)
  servidor!.enclave.store.registarContaNoMinuto(conta.address, conta.signingPublicKey, currentMinute() - Math.round(horas * 60))
  const { cliente, fim } = await entrar(conta, { ip: outraRede(), capacidades })
  return { cliente, conta, fim }
}

/** Seat this connection in the common room the way the first account does: it claims the room. */
async function primeiroNaSala(cliente: Cliente): Promise<void> {
  cliente.enviar({ t: "channel.claim", channel: servidor!.sala })
  const claim = await cliente.proximoDe("channel.claim.result")
  expect(claim?.mine).toBe(true)
  cliente.enviar({ t: "channel.subscribe", channels: [servidor!.sala] })
  await cliente.ate()
}

const bytes = (n: number): string => toBase64(crypto.getRandomValues(new Uint8Array(n)))

describe("os limites da conta nova", () => {
  it("o auth.ok diz a uma conta nova até quando valem os limites; a uma conta antiga não diz nada", async () => {
    await levantar({ contaNova: LIMITES })
    const nova = await contaComIdade(2)
    expect(nova.fim.t === "auth.ok" && nova.fim.contaNova).toMatchObject({ intervaloAte24hS: 30, intervaloAte72hS: 10 })
    const ok = nova.fim as Extract<ServerFrame, { t: "auth.ok" }>
    expect(ok.contaNova!.ate24h - Date.now()).toBeGreaterThan(21 * 3_600_000)
    expect(ok.contaNova!.ate72h - ok.contaNova!.ate24h).toBe(48 * 3_600_000)
    const antiga = await contaComIdade(100)
    expect(antiga.fim.t === "auth.ok" && antiga.fim.contaNova).toBeUndefined()
  })

  it("na sala comum: 3 de folga, depois uma mensagem por 30 s no primeiro dia; a recusa diz quando, e marca a conta nova", async () => {
    await levantar({ contaNova: LIMITES })
    const { cliente } = await contaComIdade(1)
    await primeiroNaSala(cliente)
    for (const ref of ["a", "b", "c"]) {
      cliente.enviar({ t: "channel.send", channel: servidor!.sala, kind: "application", ciphertext: bytes(512), ref })
      expect((await cliente.proximoDe("channel.event"))?.ref).toBe(ref)
    }
    cliente.enviar({ t: "channel.send", channel: servidor!.sala, kind: "application", ciphertext: bytes(512), ref: "d" })
    const recusa = await cliente.proximoDe("channel.rejected")
    expect(recusa).toMatchObject({ reason: "rate-limited", ref: "d", contaNova: true })
    expect(recusa!.retryAfterMs).toBeGreaterThan(28_000)
    expect(recusa!.retryAfterMs).toBeLessThanOrEqual(30_000)
  })

  it("de 24 a 72 h, 3 de folga e depois uma por 10 s; depois de 72 h, sem limite da conta nova", async () => {
    await levantar({ contaNova: LIMITES })
    const media = await contaComIdade(30)
    await primeiroNaSala(media.cliente)
    for (const ref of ["a", "b", "c", "d"]) {
      media.cliente.enviar({ t: "channel.send", channel: servidor!.sala, kind: "application", ciphertext: bytes(64), ref })
    }
    const recusa = await media.cliente.proximoDe("channel.rejected")
    expect(recusa?.ref).toBe("d")
    expect(recusa!.retryAfterMs).toBeLessThanOrEqual(10_000)
  })

  it("só na sala comum: noutro canal a conta nova escreve ao ritmo de sempre", async () => {
    await levantar({ contaNova: LIMITES })
    const { cliente } = await contaComIdade(1)
    const canal = moradaDeSala(servidor!.casa)
    cliente.enviar({ t: "channel.subscribe", channels: [canal] })
    await cliente.ate()
    for (const ref of ["a", "b", "c"]) cliente.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: bytes(64), ref })
    const vistas = await cliente.ate()
    expect(vistas.filter((f) => f.t === "channel.event").length).toBe(3)
    expect(vistas.some((f) => f.t === "channel.rejected")).toBe(false)
  })

  it("no primeiro dia, uma mensagem grande (imagem, ficheiro, GIF) na sala comum é recusada; ao segundo dia passa", async () => {
    await levantar({ contaNova: LIMITES })
    const nova = await contaComIdade(1)
    await primeiroNaSala(nova.cliente)
    nova.cliente.enviar({ t: "channel.send", channel: servidor!.sala, kind: "application", ciphertext: bytes(8192), ref: "img" })
    expect(await nova.cliente.proximoDe("channel.rejected")).toMatchObject({ reason: "conta-nova", ref: "img" })
    // The refusal by size does not spend the 30 seconds: a text right after goes through.
    nova.cliente.enviar({ t: "channel.send", channel: servidor!.sala, kind: "application", ciphertext: bytes(256), ref: "texto" })
    expect((await nova.cliente.proximoDe("channel.event"))?.ref).toBe("texto")
    const segundoDia = await contaComIdade(30)
    servidor!.enclave.store.subscribe(servidor!.sala, segundoDia.conta.address)
    segundoDia.cliente.enviar({ t: "channel.send", channel: servidor!.sala, kind: "application", ciphertext: bytes(8192), ref: "img" })
    expect((await segundoDia.cliente.proximoDe("channel.event"))?.ref).toBe("img")
  })

  it("uma app sem a capacidade da conta nova recebe o ritmo como dantes, sem a marca", async () => {
    await levantar({ contaNova: LIMITES })
    const { cliente } = await contaComIdade(1, ["commit-after-echo", CAPACIDADE_ENVIO_RECUSADO])
    await primeiroNaSala(cliente)
    for (const ref of ["a", "b", "c", "d"]) {
      cliente.enviar({ t: "channel.send", channel: servidor!.sala, kind: "application", ciphertext: bytes(64), ref })
    }
    const recusa = await cliente.proximoDe("channel.rejected")
    expect(recusa?.reason).toBe("rate-limited")
    expect(recusa?.contaNova).toBeUndefined()
  })

  it("pessoas por dia: a terceira pessoa (limite 2) vem vazia com a recusa; a própria conta e a mesma pessoa não contam", async () => {
    await levantar({ contaNova: LIMITES })
    const { cliente, conta } = await contaComIdade(1)
    const pedir = async (address: string) => {
      cliente.enviar({ t: "keypackage.claim", address, bundle: true })
      return cliente.proximoDe("keypackage.claimed")
    }
    const outras = [0, 1, 2].map(() => generateIdentity(servidor!.casa).address)
    expect((await pedir(conta.address))?.recusa).toBeUndefined()
    expect((await pedir(outras[0]!))?.recusa).toBeUndefined()
    expect((await pedir(outras[0]!))?.recusa).toBeUndefined()
    expect((await pedir(outras[1]!))?.recusa).toBeUndefined()
    expect(await pedir(outras[2]!)).toMatchObject({ keyPackage: null, recusa: "conta-nova" })
  })

  it("quem pediu para entrar na sala comum não conta como pessoa nova (admitir na sala comum)", async () => {
    await levantar({ contaNova: { ...LIMITES, pessoasAte24h: 1 } })
    const membro = await contaComIdade(1)
    await primeiroNaSala(membro.cliente)
    const pedidos: string[] = []
    for (let i = 0; i < 2; i++) {
      const recem = await contaComIdade(200)
      recem.cliente.enviar({ t: "channel.rejoin.request", channel: servidor!.sala })
      await recem.cliente.proximoDe("channel.rejoin.sent")
      pedidos.push(recem.conta.address)
    }
    for (const address of pedidos) {
      membro.cliente.enviar({ t: "keypackage.claim", address, bundle: true })
      expect((await membro.cliente.proximoDe("keypackage.claimed"))?.recusa).toBeUndefined()
    }
  })

  it("canais novos por dia: o quarto (limite 3) é recusado por channel.claim e pelo primeiro envio", async () => {
    await levantar({ contaNova: LIMITES })
    const { cliente } = await contaComIdade(1)
    for (let i = 0; i < 3; i++) {
      cliente.enviar({ t: "channel.claim", channel: moradaDeSala(servidor!.casa) })
      const r = await cliente.proximoDe("channel.claim.result")
      expect(r?.mine).toBe(true)
      expect(r?.recusa).toBeUndefined()
    }
    cliente.enviar({ t: "channel.claim", channel: moradaDeSala(servidor!.casa) })
    expect(await cliente.proximoDe("channel.claim.result")).toMatchObject({ mine: false, recusa: "conta-nova" })
    cliente.enviar({ t: "channel.send", channel: moradaDeSala(servidor!.casa), kind: "application", ciphertext: bytes(64), ref: "x" })
    expect(await cliente.proximoDe("channel.rejected")).toMatchObject({ reason: "conta-nova", ref: "x" })
  })

  it("account.age.get diz até quando a conta é nova (arredondado à hora), só no primeiro dia", async () => {
    await levantar({ contaNova: LIMITES })
    const nova = await contaComIdade(2)
    nova.cliente.enviar({ t: "account.age.get", address: nova.conta.address })
    const r = await nova.cliente.proximoDe("account.age.result")
    expect(r?.novaAte).toBeDefined()
    expect(r!.novaAte! % 3_600_000).toBe(0)
    expect(r!.novaAte! - Date.now()).toBeGreaterThan(21 * 3_600_000)
    expect(r!.novaAte! - Date.now()).toBeLessThanOrEqual(23 * 3_600_000)
    const media = await contaComIdade(30)
    media.cliente.enviar({ t: "account.age.get", address: media.conta.address })
    expect((await media.cliente.proximoDe("account.age.result"))?.novaAte).toBeUndefined()
  })

  it("num servidor em modo de comunidade (uma família, todos se conhecem), não há limites da conta nova", async () => {
    await levantar({ contaNova: LIMITES, communityMode: true })
    const nova = await contaComIdade(1)
    expect(nova.fim.t === "auth.ok" && nova.fim.contaNova).toBeUndefined()
    await primeiroNaSala(nova.cliente)
    for (const ref of ["a", "b"]) nova.cliente.enviar({ t: "channel.send", channel: servidor!.sala, kind: "application", ciphertext: bytes(64), ref })
    expect((await nova.cliente.ate()).filter((f) => f.t === "channel.event").length).toBe(2)
  })

  it("loopback não tem os limites da conta nova", async () => {
    await levantar({ contaNova: LIMITES })
    const conta = generateIdentity(servidor!.casa)
    const { cliente, fim } = await entrar(conta)
    expect(fim.t === "auth.ok" && fim.contaNova).toBeUndefined()
    await primeiroNaSala(cliente)
    for (const ref of ["a", "b"]) cliente.enviar({ t: "channel.send", channel: servidor!.sala, kind: "application", ciphertext: bytes(64), ref })
    expect((await cliente.ate()).filter((f) => f.t === "channel.event").length).toBe(2)
  })
})

// ---------------------------------------------------------------- common room ceiling

describe("o tecto de entradas na sala comum", () => {
  it("passa 2 por hora; a terceira conta espera na fila e o pedido não chega aos membros", async () => {
    await levantar({ entradasNaSalaComumPorHora: 2 })
    const membro = await contaComIdade(200)
    await primeiroNaSala(membro.cliente)
    const pedir = async (horas = 200) => {
      const recem = await contaComIdade(horas)
      recem.cliente.enviar({ t: "channel.rejoin.request", channel: servidor!.sala })
      return { recem, recibo: await recem.cliente.proximoDe("channel.rejoin.sent") }
    }
    const a = await pedir()
    expect(a.recibo).toMatchObject({ ouviram: 1 })
    expect(a.recibo?.fila).toBeUndefined()
    expect((await membro.cliente.proximoDe("channel.rejoin"))?.address).toBe(a.recem.conta.address)
    const b = await pedir()
    expect(b.recibo?.fila).toBeUndefined()
    await membro.cliente.proximoDe("channel.rejoin")
    const c = await pedir()
    expect(c.recibo).toMatchObject({ ouviram: 0, fila: { posicao: 1 } })
    expect(c.recibo!.fila!.esperaMs).toBeLessThanOrEqual(120_000)
    expect((await membro.cliente.ate()).some((f) => f.t === "channel.rejoin")).toBe(false)
    // The same account asking again keeps its place and is not counted twice.
    c.recem.cliente.enviar({ t: "channel.rejoin.request", channel: servidor!.sala })
    expect((await c.recem.cliente.proximoDe("channel.rejoin.sent"))?.fila?.posicao).toBe(1)
  })

  it("o cartão da sala comum não é dado a quem está na fila, e fica lá para quem vem a seguir", async () => {
    await levantar({ entradasNaSalaComumPorHora: 1 })
    const fundador = await contaComIdade(200)
    await primeiroNaSala(fundador.cliente)
    fundador.cliente.enviar({ t: "channel.send", channel: servidor!.sala, kind: "application", ciphertext: bytes(64) })
    await fundador.cliente.proximoDe("channel.event")
    const grupo = await createChannel(fundador.conta, servidor!.sala)
    fundador.cliente.enviar({ t: "channel.groupinfo.put", channel: servidor!.sala, info: toBase64(await publishableGroupInfo(grupo)) })
    await fundador.cliente.ate()
    expect(servidor!.enclave.store.hasGroupInfo(servidor!.sala)).toBe(true)
    // The ceiling is taken by a first join through the members.
    const primeira = await contaComIdade(200)
    primeira.cliente.enviar({ t: "channel.rejoin.request", channel: servidor!.sala })
    expect((await primeira.cliente.proximoDe("channel.rejoin.sent"))?.fila).toBeUndefined()
    // The next one waits: no card, and the card stays for when the room has space.
    const segunda = await contaComIdade(200)
    segunda.cliente.enviar({ t: "channel.groupinfo.take", channel: servidor!.sala })
    expect((await segunda.cliente.proximoDe("channel.groupinfo"))?.info).toBeUndefined()
    expect(servidor!.enclave.store.hasGroupInfo(servidor!.sala)).toBe(true)
    // The first, already let in this hour, still gets the card.
    primeira.cliente.enviar({ t: "channel.groupinfo.take", channel: servidor!.sala })
    expect((await primeira.cliente.proximoDe("channel.groupinfo"))?.info).toBeDefined()
  })

  it("os membros que voltam (reparar o lugar, um aparelho novo) nunca contam nem esperam", async () => {
    await levantar({ entradasNaSalaComumPorHora: 1 })
    const membro = await contaComIdade(200)
    await primeiroNaSala(membro.cliente)
    const outro = await contaComIdade(200)
    servidor!.enclave.store.subscribe(servidor!.sala, outro.conta.address)
    for (let i = 0; i < 3; i++) {
      outro.cliente.enviar({ t: "channel.rejoin.request", channel: servidor!.sala })
      const recibo = await outro.cliente.proximoDe("channel.rejoin.sent")
      expect(recibo?.fila).toBeUndefined()
    }
    // The ceiling is still free for a first join.
    const recem = await contaComIdade(200)
    recem.cliente.enviar({ t: "channel.rejoin.request", channel: servidor!.sala })
    expect((await recem.cliente.proximoDe("channel.rejoin.sent"))?.fila).toBeUndefined()
  })

  it("sem tecto configurado, ninguém espera", async () => {
    await levantar({})
    const membro = await contaComIdade(200)
    await primeiroNaSala(membro.cliente)
    for (let i = 0; i < 4; i++) {
      const recem = await contaComIdade(200)
      recem.cliente.enviar({ t: "channel.rejoin.request", channel: servidor!.sala })
      expect((await recem.cliente.proximoDe("channel.rejoin.sent"))?.fila).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------- the cap on channels

describe("o tecto de canais (comunidades) por conta", () => {
  const COM_CANAIS = [...TODAS, CAPACIDADE_LIMITE_DE_CANAIS]
  const reclamar = async (cliente: Cliente, comunidade: boolean) => {
    const canal = moradaDeSala(servidor!.casa)
    cliente.enviar({ t: "channel.claim", channel: canal, ...(comunidade ? { comunidade: true as const } : {}) })
    return { canal, resposta: await cliente.proximoDe("channel.claim.result") }
  }
  const quota = async (cliente: Cliente) => {
    cliente.enviar({ t: "channel.quota" })
    return (await cliente.proximoDe("channel.quota.result"))?.criarCanais
  }

  it("uma conta antiga cria até ao tecto (aqui 3); o seguinte é recusado; directas e o mural não contam", async () => {
    await levantar({ comunidadesPorConta: 3, contaNova: LIMITES })
    const { cliente } = await contaComIdade(100, COM_CANAIS)
    expect(cliente.hello?.capabilities).toContain(CAPACIDADE_LIMITE_DE_CANAIS)
    expect(await quota(cliente)).toEqual({ criados: 0, maximo: 3, contaNova: false })
    for (let i = 1; i <= 3; i++) {
      const { resposta } = await reclamar(cliente, true)
      expect(resposta).toMatchObject({ mine: true, criarCanais: { criados: i, maximo: 3 } })
      expect(resposta?.recusa).toBeUndefined()
    }
    const { resposta } = await reclamar(cliente, true)
    expect(resposta).toMatchObject({ mine: false, recusa: "limite-de-canais", criarCanais: { criados: 3, maximo: 3 } })
    // A claim that is not a community (a direct message, the feed) still goes through.
    expect((await reclamar(cliente, false)).resposta).toMatchObject({ mine: true })
    expect(await quota(cliente)).toEqual({ criados: 3, maximo: 3, contaNova: false })
  })

  it("uma conta com menos de 72 h cria 1 canal; o tecto da conta nova é o mais baixo", async () => {
    await levantar({ comunidadesPorConta: 5, contaNova: LIMITES })
    const { cliente } = await contaComIdade(30, COM_CANAIS)
    expect(await quota(cliente)).toEqual({ criados: 0, maximo: 1, contaNova: true })
    expect((await reclamar(cliente, true)).resposta).toMatchObject({ mine: true, criarCanais: { criados: 1, maximo: 1, contaNova: true } })
    expect((await reclamar(cliente, true)).resposta).toMatchObject({ recusa: "limite-de-canais" })
  })

  it("pedir outra vez a mesma reclamação não gasta outro lugar; um canal que todos deixaram liberta o lugar", async () => {
    await levantar({ comunidadesPorConta: 1 })
    const { cliente } = await contaComIdade(100, COM_CANAIS)
    const { canal } = await reclamar(cliente, true)
    cliente.enviar({ t: "channel.claim", channel: canal, comunidade: true })
    expect(await cliente.proximoDe("channel.claim.result")).toMatchObject({ mine: true, criarCanais: { criados: 1 } })
    cliente.enviar({ t: "channel.subscribe", channels: [canal] })
    cliente.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: bytes(64), ref: "a" })
    await cliente.ate()
    expect((await reclamar(cliente, true)).resposta).toMatchObject({ recusa: "limite-de-canais" })
    cliente.enviar({ t: "channel.unsubscribe", channels: [canal] })
    await cliente.ate()
    expect(await quota(cliente)).toMatchObject({ criados: 0 })
  })

  it("sem tecto configurado, e em loopback, channel.quota diz null e nada é recusado", async () => {
    await levantar({})
    const { cliente } = await contaComIdade(100, COM_CANAIS)
    expect(await quota(cliente)).toBeNull()
    for (let i = 0; i < 3; i++) expect((await reclamar(cliente, true)).resposta?.recusa).toBeUndefined()
    await servidor!.fechar()
    await levantar({ comunidadesPorConta: 1 })
    const conta = generateIdentity(servidor!.casa)
    servidor!.enclave.store.registarContaNoMinuto(conta.address, conta.signingPublicKey, currentMinute() - 6000)
    const local = (await entrar(conta, { capacidades: COM_CANAIS })).cliente
    expect(await quota(local)).toBeNull()
    for (let i = 0; i < 3; i++) expect((await reclamar(local, true)).resposta?.recusa).toBeUndefined()
  })

  describe("um canal de uma app antiga conta quando recebe um convite", () => {
    const convidar = (cliente: Cliente, canal: string) => {
      const code = toBase64(crypto.getRandomValues(new Uint8Array(16)))
      const codeHash = toBase64(sha256(new TextEncoder().encode(code)))
      cliente.enviar({
        t: "invite.create",
        channel: canal,
        codeHash,
        expiresAt: null,
        maxUses: null,
        codeKey: toBase64(chaveDaProvaDoConvite(code).publica),
      })
      return codeHash
    }

    it("com o fundador no tecto: o convite é recusado com a razão (app nova) ou sem resposta (app antiga)", async () => {
      await levantar({ comunidadesPorConta: 1 })
      const { cliente } = await contaComIdade(100, COM_CANAIS)
      const { canal: contada } = await reclamar(cliente, true)
      // A channel an old app created: claimed by `channel.subscribe`, never said to be a community.
      const { canal: antiga } = await reclamar(cliente, false)
      const recusado = convidar(cliente, antiga)
      expect(await cliente.proximoDe("invite.created")).toMatchObject({ codeHash: recusado, recusa: "limite-de-canais" })
      expect(servidor!.enclave.store.channelOfInvite(recusado)).toBeUndefined()
      // Into the counted channel, the invite is made.
      const feito = convidar(cliente, contada)
      const criado = await cliente.proximoDe("invite.created")
      expect(criado?.codeHash).toBe(feito)
      expect(criado?.recusa).toBeUndefined()
      // An old app: no answer, and no invite.
      const velha = await contaComIdade(100, TODAS)
      const { canal: daVelha } = await reclamar(velha.cliente, true)
      const { canal: daVelhaSemMarca } = await reclamar(velha.cliente, false)
      expect(servidor!.enclave.store.claimComunidade(daVelha)).toBe(true)
      const semResposta = convidar(velha.cliente, daVelhaSemMarca)
      expect(await velha.cliente.proximoDe("invite.created", 800)).toBeNull()
      expect(servidor!.enclave.store.channelOfInvite(semResposta)).toBeUndefined()
    })

    it("com lugar: o convite é feito e o canal passa a contar", async () => {
      await levantar({ comunidadesPorConta: 2 })
      const { cliente } = await contaComIdade(100, COM_CANAIS)
      const { canal } = await reclamar(cliente, false)
      convidar(cliente, canal)
      expect((await cliente.proximoDe("invite.created"))?.recusa).toBeUndefined()
      expect(servidor!.enclave.store.claimComunidade(canal)).toBe(true)
      expect(await quota(cliente)).toMatchObject({ criados: 1, maximo: 2 })
    })
  })
})

describe("o tecto dos convites de comunidade por quem os criou", () => {
  it("todos os convites de uma conta, somados, passam no máximo o limite de uma rede; os de outra conta contam à parte", async () => {
    const { enclave } = await levantar({ limiteDeRede: { porHora: 1, porDia: 10 } })
    /** An account older than 72 hours that founds a community and makes an invite into it, by the gateway. */
    const dono = await contaComIdade(100, [...TODAS, CAPACIDADE_LIMITE_DE_CANAIS])
    const outroDono = await contaComIdade(100, [...TODAS, CAPACIDADE_LIMITE_DE_CANAIS])
    const comunidadeComConvite = async (quem: Awaited<ReturnType<typeof contaComIdade>>) => {
      const canal = moradaDeSala(servidor!.casa)
      quem.cliente.enviar({ t: "channel.claim", channel: canal, comunidade: true })
      await quem.cliente.proximoDe("channel.claim.result")
      enclave.store.subscribe(canal, quem.conta.address)
      const code = toBase64(crypto.getRandomValues(new Uint8Array(16)))
      const codeHash = toBase64(sha256(new TextEncoder().encode(code)))
      quem.cliente.enviar({ t: "invite.create", channel: canal, codeHash, expiresAt: null, maxUses: null, codeKey: toBase64(chaveDaProvaDoConvite(code).publica) })
      expect((await quem.cliente.proximoDe("invite.created"))?.codeHash).toBe(codeHash)
      return { canal, para: (address: string) => ({ codeHash, prova: provarConviteNoRegisto(code, { codeHash, address }) }) }
    }
    const primeira = await comunidadeComConvite(dono)
    const segunda = await comunidadeComConvite(dono)
    const deOutro = await comunidadeComConvite(outroDono)
    // Fill the network 203.0.113.x.
    expect((await entrar(generateIdentity(servidor!.casa), { ip: "203.0.113.1" })).fim.t).toBe("auth.ok")

    const a = generateIdentity(servidor!.casa)
    expect((await entrar(a, { ip: "203.0.113.2", conviteDeComunidade: primeira.para(a.address) })).fim.t).toBe("auth.ok")
    // Another community, the same maker: the maker used its pass for the hour.
    const b = generateIdentity(servidor!.casa)
    expect(codigo((await entrar(b, { ip: "203.0.113.3", conviteDeComunidade: segunda.para(b.address) })).fim)).toBe(
      CODIGO_REDE_COM_MUITAS_CONTAS,
    )
    // Another maker's community passes.
    expect((await entrar(b, { ip: "203.0.113.3", conviteDeComunidade: deOutro.para(b.address) })).fim.t).toBe("auth.ok")
  })

  it("um convite sem criador conhecido (feito antes de um reinício) conta para o fundador do canal", async () => {
    const { enclave } = await levantar({ limiteDeRede: { porHora: 1, porDia: 10 } })
    const fundador = generateIdentity(servidor!.casa)
    enclave.store.registarContaNoMinuto(fundador.address, fundador.signingPublicKey, currentMinute() - 6000)
    const conviteNoCanalDe = () => {
      const canal = moradaDeSala(servidor!.casa)
      enclave.store.claimChannel(canal, fundador.address, true)
      enclave.store.subscribe(canal, fundador.address)
      const code = toBase64(crypto.getRandomValues(new Uint8Array(16)))
      const codeHash = toBase64(sha256(new TextEncoder().encode(code)))
      // Straight into the table: the gateway never saw who made it.
      enclave.store.createInvite({ codeHash, channel: canal, expiresAt: null, maxUses: null, codeKey: toBase64(chaveDaProvaDoConvite(code).publica) })
      return { para: (address: string) => ({ codeHash, prova: provarConviteNoRegisto(code, { codeHash, address }) }) }
    }
    const primeiro = conviteNoCanalDe()
    const segundo = conviteNoCanalDe()
    expect((await entrar(generateIdentity(servidor!.casa), { ip: "203.0.113.1" })).fim.t).toBe("auth.ok")
    const a = generateIdentity(servidor!.casa)
    expect((await entrar(a, { ip: "203.0.113.2", conviteDeComunidade: primeiro.para(a.address) })).fim.t).toBe("auth.ok")
    const b = generateIdentity(servidor!.casa)
    expect(codigo((await entrar(b, { ip: "203.0.113.3", conviteDeComunidade: segundo.para(b.address) })).fim)).toBe(
      CODIGO_REDE_COM_MUITAS_CONTAS,
    )
  })
})

describe("the cap on rooms per account (1.3.26)", () => {
  const WITH_ROOMS = [...TODAS, CAPABILITY_ROOM_LIMIT]
  const claimRoom = async (cliente: Cliente, channel: string, room: string) => {
    cliente.enviar({ t: "room.claim", channel, room })
    return cliente.proximoDe("room.claim.result")
  }
  const seatedChannel = (address: string) => {
    const canal = moradaDeSala(servidor!.casa)
    servidor!.enclave.store.claimChannel(canal, address, true)
    servidor!.enclave.store.subscribe(canal, address)
    return canal
  }

  it("counts up to the cap (here 2), refuses the next, and a released room frees its place", async () => {
    await levantar({ channelsPerAccount: 2 })
    const { cliente, conta } = await contaComIdade(100, WITH_ROOMS)
    expect(cliente.hello?.capabilities).toContain(CAPABILITY_ROOM_LIMIT)
    const canal = seatedChannel(conta.address)
    cliente.enviar({ t: "channel.quota" })
    expect((await cliente.proximoDe("channel.quota.result"))?.rooms).toEqual({ created: 0, max: 2 })
    expect(await claimRoom(cliente, canal, "t-1")).toMatchObject({ ok: true, rooms: { created: 1, max: 2 } })
    // Claiming the same room again does not take another place.
    expect(await claimRoom(cliente, canal, "t-1")).toMatchObject({ ok: true, rooms: { created: 1 } })
    expect(await claimRoom(cliente, canal, "t-2")).toMatchObject({ ok: true, rooms: { created: 2 } })
    expect(await claimRoom(cliente, canal, "t-3")).toMatchObject({ ok: false, refusal: "room-limit", rooms: { created: 2, max: 2 } })
    cliente.enviar({ t: "room.release", channel: canal, room: "t-1" })
    expect(await claimRoom(cliente, canal, "t-3")).toMatchObject({ ok: true, rooms: { created: 2 } })
  })

  it("an account under 72 hours has the lower new-account cap (here 1 of 3); after 72 hours, the cap for all", async () => {
    await levantar({ channelsPerAccount: 3, contaNova: { ...LIMITES, rooms: 1 } })
    const nova = await contaComIdade(30, WITH_ROOMS)
    const canal = seatedChannel(nova.conta.address)
    nova.cliente.enviar({ t: "channel.quota" })
    expect((await nova.cliente.proximoDe("channel.quota.result"))?.rooms).toEqual({ created: 0, max: 1, newAccount: true })
    expect(await claimRoom(nova.cliente, canal, "t-1")).toMatchObject({ ok: true })
    expect(await claimRoom(nova.cliente, canal, "t-2")).toMatchObject({ ok: false, refusal: "room-limit", rooms: { max: 1, newAccount: true } })
    const antiga = await contaComIdade(100, WITH_ROOMS)
    antiga.cliente.enviar({ t: "channel.quota" })
    expect((await antiga.cliente.proximoDe("channel.quota.result"))?.rooms).toEqual({ created: 0, max: 3 })
  })

  it("a room in a channel the account is not in is not counted; a stranger cannot release a room", async () => {
    await levantar({ channelsPerAccount: 1 })
    const dono = await contaComIdade(100, WITH_ROOMS)
    const estranho = await contaComIdade(100, WITH_ROOMS)
    const canal = seatedChannel(dono.conta.address)
    expect(await claimRoom(estranho.cliente, canal, "t-x")).toMatchObject({ ok: true })
    expect(servidor!.enclave.store.roomIsCounted(canal, "t-x")).toBe(false)
    expect(await claimRoom(dono.cliente, canal, "t-1")).toMatchObject({ ok: true })
    estranho.cliente.enviar({ t: "room.release", channel: canal, room: "t-1" })
    await estranho.cliente.ate()
    expect(servidor!.enclave.store.roomIsCounted(canal, "t-1")).toBe(true)
  })

  it("with the cap off, and on loopback, channel.quota says rooms null and nothing is refused", async () => {
    await levantar({ channelsPerAccount: 0 })
    const { cliente, conta } = await contaComIdade(100, WITH_ROOMS)
    const canal = seatedChannel(conta.address)
    cliente.enviar({ t: "channel.quota" })
    expect((await cliente.proximoDe("channel.quota.result"))?.rooms).toBeNull()
    for (let i = 0; i < 3; i++) expect((await claimRoom(cliente, canal, `t-${i}`))?.ok).toBe(true)
    await servidor!.fechar()
    await levantar({ channelsPerAccount: 1 })
    const local = generateIdentity(servidor!.casa)
    servidor!.enclave.store.registarContaNoMinuto(local.address, local.signingPublicKey, currentMinute() - 6000)
    const ligado = (await entrar(local, { capacidades: WITH_ROOMS })).cliente
    const deLocal = seatedChannel(local.address)
    for (let i = 0; i < 3; i++) expect((await claimRoom(ligado, deLocal, `t-${i}`))?.ok).toBe(true)
  })
})
