import { Session, Vault } from "@enclave/client-core"
import type { ModoDeRegisto } from "@enclave/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { CofreEmMemoria, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/**
 * The registration rule (1.3.25) from the app's side: a real `Session`
 * against a real server. What the gate reads: the mode before the vault
 * (`sondarRegisto`), the code it sets (`definirConviteDeRegisto`), and the
 * sentence `connect()` throws when the server refuses the new account, with no
 * reconnect loop behind it.
 */

let servidor: ServidorDeTeste | undefined
afterEach(async () => {
  await servidor?.fechar()
  servidor = undefined
})

async function levantar(registo: ModoDeRegisto, extra: { versaoMinimaDoCliente?: string } = {}): Promise<ServidorDeTeste> {
  servidor = await levantarServidor({ registo, ...extra })
  return servidor
}

async function sessaoNova(casa: string, versaoDaApp = "1.3.25"): Promise<Session> {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault, { versaoDaApp })
  await session.createIdentity(casa)
  return session
}

describe("sondarRegisto", () => {
  it.each(["aberto", "convite", "fechado"] as const)("lê %s do hello.ok, sem conta", async (modo) => {
    const { casa } = await levantar(modo)
    const vault = new Vault(new CofreEmMemoria())
    const session = new Session(vault, { versaoDaApp: "1.3.25" })
    expect(await session.sondarRegisto(casa)).toBe(modo)
  })

  it("leva a versão da app: um servidor com versão mínima responde", async () => {
    const { casa } = await levantar("convite", { versaoMinimaDoCliente: "1.0.0" })
    const session = new Session(new Vault(new CofreEmMemoria()), { versaoDaApp: "1.3.25" })
    expect(await session.sondarRegisto(casa)).toBe("convite")
  })

  it("uma app abaixo da versão mínima ouve versao-antiga, antes de haver cofre (21/11/2026)", async () => {
    const { casa } = await levantar("aberto", { versaoMinimaDoCliente: "9.0.0" })
    const session = new Session(new Vault(new CofreEmMemoria()), { versaoDaApp: "1.3.25" })
    expect(await session.sondarRegisto(casa)).toBe("versao-antiga")
    // And the proof-of-work challenge asks nothing of a server that refuses the version.
    expect(await session.desafioDeRegisto(casa)).toBeNull()
  })

  it("devolve null quando não há servidor", async () => {
    const session = new Session(new Vault(new CofreEmMemoria()), { versaoDaApp: "1.3.25" })
    expect(await session.sondarRegisto("localhost:1", 2000)).toBeNull()
  })
})

describe("connect() de uma conta nova", () => {
  it("fechado: rejeita com a frase, fica desligada e não volta a tentar", async () => {
    const { casa, enclave } = await levantar("fechado")
    const session = await sessaoNova(casa)
    await expect(session.connect()).rejects.toThrow("this server does not accept new accounts")
    expect(session.registoDoServidor).toBe("fechado")
    expect(session.connection).toBe("offline")
    // The backoff's first retry is under a second: none comes.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(session.connection).toBe("offline")
    expect(enclave.gateway.connectionCount).toBe(0)
    expect(enclave.store.signingKeyOf(session.identity.address)).toBeUndefined()
  })

  it("convite sem código: pede o código; com um código errado: diz que não é válido", async () => {
    const { casa } = await levantar("convite")
    const session = await sessaoNova(casa)
    await expect(session.connect()).rejects.toThrow("this server needs a registration invite")
    session.definirConviteDeRegisto("AAAA-BBBB-CCCC-DDDD")
    await expect(session.connect()).rejects.toThrow("the registration invite is not valid")
    expect(session.connection).toBe("offline")
  })

  it("convite com um código válido: entra, e a conta passa a existir", async () => {
    const { casa, enclave } = await levantar("convite")
    const codigo = enclave.store.criarConviteDeRegisto({ usos: 1, dias: 7 })
    const session = await sessaoNova(casa)
    await expect(session.connect()).rejects.toThrow("this server needs a registration invite")
    session.definirConviteDeRegisto(` ${codigo.toLowerCase()} `)
    await session.connect()
    expect(session.connection).toBe("online")
    expect(session.registoDoServidor).toBe("convite")
    expect(enclave.store.signingKeyOf(session.identity.address)).toBeDefined()
    // A reconnect of the account that now exists needs no code, and spends nothing.
    session.disconnect()
    session.definirConviteDeRegisto(null)
    await session.connect()
    expect(session.connection).toBe("online")
    expect(enclave.store.convitesDeRegisto()[0]!.usos).toBe(1)
    session.disconnect()
  })

  it("aberto: entra como antes", async () => {
    const { casa } = await levantar("aberto")
    const session = await sessaoNova(casa)
    await session.connect()
    expect(session.connection).toBe("online")
    expect(session.registoDoServidor).toBe("aberto")
    session.disconnect()
  })
})
