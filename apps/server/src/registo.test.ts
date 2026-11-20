import {
  CODIGO_CONVITE_DE_REGISTO_EM_FALTA,
  CODIGO_CONVITE_DE_REGISTO_INVALIDO,
  CODIGO_REGISTO_FECHADO,
  fromBase64,
  generateIdentity,
  identityFromPrivateKey,
  PROTOCOL_VERSION,
  signWithDevice,
  toBase64,
  type AccountIdentity,
  type ModoDeRegisto,
  type ServerFrame,
} from "@enclave/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"
import { loadConfig } from "./config.js"
import { currentMinute } from "./db.js"

/**
 * Who may create an account (1.3.25, C2), against a real server.
 *
 * The account is registered at its first `auth.finish`. In `convite` the code
 * goes in that frame; in `fechado` nothing new gets in. Existing accounts, and
 * new devices of existing accounts, always get in.
 */

let servidor: ServidorDeTeste | undefined
afterEach(async () => {
  await servidor?.fechar()
  servidor = undefined
})

async function levantar(registo?: ModoDeRegisto): Promise<ServidorDeTeste> {
  servidor = await levantarServidor(registo ? { registo } : {})
  return servidor
}

interface Login {
  hello: Extract<ServerFrame, { t: "hello.ok" }>
  /** `auth.ok`, or the `error` that refused the login. */
  fim: ServerFrame
  /** The socket closed after the answer. */
  fechou: Promise<void>
}

/** A full login with the device chain, the way every app logs in. */
async function entrar(url: string, identidade: AccountIdentity, conviteDeRegisto?: string): Promise<Login> {
  const socket = new WebSocket(url)
  const fila: ServerFrame[] = []
  const esperas: ((frame: ServerFrame) => void)[] = []
  socket.on("message", (raw: Buffer) => {
    const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
    const espera = esperas.shift()
    if (espera) espera(frame)
    else fila.push(frame)
  })
  const fechou = new Promise<void>((resolve) => socket.once("close", () => resolve()))
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve())
    socket.once("error", reject)
  })
  const proximo = (): Promise<ServerFrame> =>
    fila.length > 0 ? Promise.resolve(fila.shift()!) : new Promise((resolve) => esperas.push(resolve))
  const enviar = (frame: unknown): void => socket.send(JSON.stringify(frame))

  enviar({ t: "hello", version: PROTOCOL_VERSION, capabilities: [] })
  const hello = (await proximo()) as Extract<ServerFrame, { t: "hello.ok" }>
  enviar({
    t: "auth.begin",
    address: identidade.address,
    signingKey: toBase64(identidade.deviceSigningPublicKey),
    accountKey: toBase64(identidade.signingPublicKey),
    deviceCert: toBase64(identidade.credential.signature),
  })
  const desafio = (await proximo()) as Extract<ServerFrame, { t: "auth.challenge" }>
  enviar({
    t: "auth.finish",
    signature: toBase64(signWithDevice(identidade, fromBase64(desafio.nonce))),
    ...(conviteDeRegisto !== undefined ? { conviteDeRegisto } : {}),
  })
  const fim = await proximo()
  if (fim.t === "auth.ok") socket.close()
  return { hello, fim, fechou }
}

function codigoDoErro(frame: ServerFrame): string | undefined {
  return frame.t === "error" ? frame.code : undefined
}

describe("ENCLAVE_REGISTO na configuração", () => {
  it("vazio ou ausente é aberto; aceita os três modos; outra coisa recusa o arranque", () => {
    expect(loadConfig({}).registo).toBe("aberto")
    expect(loadConfig({ ENCLAVE_REGISTO: "" }).registo).toBe("aberto")
    expect(loadConfig({ ENCLAVE_REGISTO: " Convite " }).registo).toBe("convite")
    expect(loadConfig({ ENCLAVE_REGISTO: "fechado" }).registo).toBe("fechado")
    expect(() => loadConfig({ ENCLAVE_REGISTO: "closed" })).toThrow(/ENCLAVE_REGISTO/)
  })
})

describe("o modo no hello.ok", () => {
  it.each(["aberto", "convite", "fechado"] as const)("anuncia %s", async (modo) => {
    const { url } = await levantar(modo)
    const { hello } = await entrar(url, generateIdentity(servidor!.casa))
    expect(hello.registo).toBe(modo)
  })

  it("sem modo na configuração, anuncia aberto", async () => {
    const { url } = await levantar()
    const { hello } = await entrar(url, generateIdentity(servidor!.casa))
    expect(hello.registo).toBe("aberto")
  })
})

describe("aberto", () => {
  it("uma conta nova entra, como antes", async () => {
    const { url, enclave } = await levantar("aberto")
    const conta = generateIdentity(servidor!.casa)
    expect((await entrar(url, conta)).fim.t).toBe("auth.ok")
    expect(enclave.store.signingKeyOf(conta.address)).toBeDefined()
  })
})

describe("fechado", () => {
  it("recusa uma conta nova com registration-closed, fecha a ligação e não a guarda", async () => {
    const { url, enclave } = await levantar("fechado")
    const conta = generateIdentity(servidor!.casa)
    const { fim, fechou } = await entrar(url, conta)
    expect(codigoDoErro(fim)).toBe(CODIGO_REGISTO_FECHADO)
    expect(fim.t === "error" && fim.fatal).toBe(true)
    await fechou
    expect(enclave.store.signingKeyOf(conta.address)).toBeUndefined()
  })

  it("um código de convite não abre um servidor fechado", async () => {
    const { url, enclave } = await levantar("fechado")
    const codigo = enclave.store.criarConviteDeRegisto({ usos: 1, dias: 7 })
    const { fim } = await entrar(url, generateIdentity(servidor!.casa), codigo)
    expect(codigoDoErro(fim)).toBe(CODIGO_REGISTO_FECHADO)
  })

  it("uma conta que já existe entra", async () => {
    const { url, enclave } = await levantar("fechado")
    const conta = generateIdentity(servidor!.casa)
    enclave.store.registerOrVerifyAccount(conta.address, conta.signingPublicKey)
    expect((await entrar(url, conta)).fim.t).toBe("auth.ok")
  })

  it("um aparelho novo de uma conta que já existe entra", async () => {
    const { url, enclave } = await levantar("fechado")
    const conta = generateIdentity(servidor!.casa)
    enclave.store.registerOrVerifyAccount(conta.address, conta.signingPublicKey)
    expect((await entrar(url, conta)).fim.t).toBe("auth.ok")
    // The same account key, another device key: the second device.
    const telemovel = identityFromPrivateKey(conta.signingPrivateKey, servidor!.casa)
    expect(toBase64(telemovel.deviceSigningPublicKey)).not.toBe(toBase64(conta.deviceSigningPublicKey))
    expect((await entrar(url, telemovel)).fim.t).toBe("auth.ok")
  })
})

describe("convite", () => {
  it("sem código, recusa com registration-invite-required e não guarda a conta", async () => {
    const { url, enclave } = await levantar("convite")
    const conta = generateIdentity(servidor!.casa)
    const { fim, fechou } = await entrar(url, conta)
    expect(codigoDoErro(fim)).toBe(CODIGO_CONVITE_DE_REGISTO_EM_FALTA)
    await fechou
    expect(enclave.store.signingKeyOf(conta.address)).toBeUndefined()
  })

  it("com um código que não existe, recusa com registration-invite-invalid", async () => {
    const { url } = await levantar("convite")
    const { fim } = await entrar(url, generateIdentity(servidor!.casa), "AAAA-BBBB-CCCC-DDDD")
    expect(codigoDoErro(fim)).toBe(CODIGO_CONVITE_DE_REGISTO_INVALIDO)
  })

  it("um código de uso único deixa entrar uma conta, e a segunda já não", async () => {
    const { url, enclave } = await levantar("convite")
    const codigo = enclave.store.criarConviteDeRegisto({ usos: 1, dias: 7 })
    const primeira = generateIdentity(servidor!.casa)
    expect((await entrar(url, primeira, codigo)).fim.t).toBe("auth.ok")
    expect(enclave.store.signingKeyOf(primeira.address)).toBeDefined()
    const segunda = generateIdentity(servidor!.casa)
    expect(codigoDoErro((await entrar(url, segunda, codigo)).fim)).toBe(CODIGO_CONVITE_DE_REGISTO_INVALIDO)
    expect(enclave.store.signingKeyOf(segunda.address)).toBeUndefined()
  })

  it("o código aceita minúsculas, espaços e traços", async () => {
    const { url, enclave } = await levantar("convite")
    const codigo = enclave.store.criarConviteDeRegisto({ usos: 1, dias: 7 })
    const escrito = ` ${codigo.toLowerCase().replaceAll("-", " ")} `
    expect((await entrar(url, generateIdentity(servidor!.casa), escrito)).fim.t).toBe("auth.ok")
  })

  it("um código com contagem deixa entrar até ao número de usos", async () => {
    const { url, enclave } = await levantar("convite")
    const codigo = enclave.store.criarConviteDeRegisto({ usos: 3, dias: 7 })
    for (let i = 0; i < 3; i++) {
      expect((await entrar(url, generateIdentity(servidor!.casa), codigo)).fim.t).toBe("auth.ok")
    }
    expect(codigoDoErro((await entrar(url, generateIdentity(servidor!.casa), codigo)).fim)).toBe(
      CODIGO_CONVITE_DE_REGISTO_INVALIDO,
    )
  })

  it("a mesma conta a entrar outra vez não gasta outro uso", async () => {
    const { url, enclave } = await levantar("convite")
    const codigo = enclave.store.criarConviteDeRegisto({ usos: 2, dias: 7 })
    const conta = generateIdentity(servidor!.casa)
    expect((await entrar(url, conta, codigo)).fim.t).toBe("auth.ok")
    expect((await entrar(url, conta, codigo)).fim.t).toBe("auth.ok")
    expect((await entrar(url, conta)).fim.t).toBe("auth.ok")
    expect((await entrar(url, generateIdentity(servidor!.casa), codigo)).fim.t).toBe("auth.ok")
  })

  it("um código expirado é recusado", async () => {
    const { url, enclave } = await levantar("convite")
    const codigo = enclave.store.criarConviteDeRegisto({ usos: 5, dias: 7, agoraSegundo: Math.floor(Date.now() / 1000) - 8 * 86_400 })
    expect(codigoDoErro((await entrar(url, generateIdentity(servidor!.casa), codigo)).fim)).toBe(
      CODIGO_CONVITE_DE_REGISTO_INVALIDO,
    )
  })

  it("o código não fica guardado em claro", async () => {
    const { enclave } = await levantar("convite")
    const codigo = enclave.store.criarConviteDeRegisto({ usos: 1, dias: 7 })
    const linhas = enclave.store.convitesDeRegisto()
    expect(linhas).toHaveLength(1)
    expect(JSON.stringify(linhas)).not.toContain(codigo.replaceAll("-", ""))
    expect(linhas[0]!.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("contas e aparelhos que já existem entram sem código", async () => {
    const { url, enclave } = await levantar("convite")
    const conta = generateIdentity(servidor!.casa)
    enclave.store.registerOrVerifyAccount(conta.address, conta.signingPublicKey)
    expect((await entrar(url, conta)).fim.t).toBe("auth.ok")
    expect((await entrar(url, identityFromPrivateKey(conta.signingPrivateKey, servidor!.casa))).fim.t).toBe("auth.ok")
  })
})

describe("o contador de contas novas (C1)", () => {
  it("conta as contas criadas na última hora e nas últimas 24 horas, sem endereços", async () => {
    const { enclave } = await levantar("aberto")
    const agora = currentMinute()
    const chave = generateIdentity(servidor!.casa).signingPublicKey
    const contas: [string, number][] = [
      ["@a:localhost", agora],
      ["@b:localhost", agora - 59],
      ["@c:localhost", agora - 60],
      ["@d:localhost", agora - 24 * 60 + 1],
      ["@e:localhost", agora - 24 * 60],
    ]
    for (const [endereco, minuto] of contas) enclave.store.registarContaNoMinuto(endereco, chave, minuto)
    const resposta = await enclave.app.inject({ method: "GET", url: "/_interno/registo", remoteAddress: "127.0.0.1" })
    expect(resposta.statusCode).toBe(200)
    const corpo = resposta.json() as Record<string, unknown>
    expect(corpo).toEqual({ v: 1, modo: "aberto", ultimaHora: 2, ultimas24h: 4, minuto: expect.any(Number) })
    expect(resposta.body).not.toContain("@")
  })

  it("só responde a quem pede do próprio aparelho", async () => {
    const { enclave } = await levantar("aberto")
    for (const remoteAddress of ["172.18.0.3", "203.0.113.9", "::ffff:10.0.0.1"]) {
      const resposta = await enclave.app.inject({ method: "GET", url: "/_interno/registo", remoteAddress })
      expect(resposta.statusCode).toBe(404)
    }
    // A forged X-Forwarded-For from a peer that is not loopback does not open it.
    const forjado = await enclave.app.inject({
      method: "GET",
      url: "/_interno/registo",
      remoteAddress: "172.18.0.3",
      headers: { "x-forwarded-for": "127.0.0.1" },
    })
    expect(forjado.statusCode).toBe(404)
    for (const remoteAddress of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      const resposta = await enclave.app.inject({ method: "GET", url: "/_interno/registo", remoteAddress })
      expect(resposta.statusCode).toBe(200)
    }
  })

  it("não está debaixo de /_enclave/, que o Caddy encaminha para fora", async () => {
    const { enclave } = await levantar("aberto")
    const resposta = await enclave.app.inject({ method: "GET", url: "/_enclave/registo", remoteAddress: "127.0.0.1" })
    expect(resposta.statusCode).toBe(404)
  })

  it("uma conta nova pelo gateway entra na contagem", async () => {
    const { url, enclave } = await levantar("aberto")
    await entrar(url, generateIdentity(servidor!.casa))
    const corpo = (await enclave.app.inject({ method: "GET", url: "/_interno/registo", remoteAddress: "127.0.0.1" })).json() as {
      ultimaHora: number
    }
    expect(corpo.ultimaHora).toBe(1)
  })
})
