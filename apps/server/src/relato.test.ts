import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { assinarPedido } from "@enclave/client-core"
import {
  generateIdentity,
  parseServerName,
  ROTA_DO_RELATO,
  ROTAS_DA_DENUNCIA,
  type AccountIdentity,
} from "@enclave/protocol"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"
import {
  dataDoFicheiro,
  enderecoCurto,
  JanelaDeUmaHora,
  lerCorpoDoRelato,
  RELATO_MAX_BYTES,
  RELATOS_POR_HORA,
  RELATOS_POR_HORA_POR_IP,
  varrerRelatos,
} from "./relato.js"

/**
 * "Send log" (phase 4 of the 0.9 settings): `POST /_enclave/relato`.
 *
 * Via `inject`, no port needed: the route is HTTP and requires no network.
 * Real identities, signed by the client core, as the app sends them.
 */

let enclave: Enclave
let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-relato-"))
  const config: ServerConfig = {
    serverName: parseServerName("localhost:8999"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir,
    databasePath: join(dataDir, "test.sqlite"),
    sfuPort: 0,
    sfuAnnouncedIp: "",
    retentionDays: 30,
    allowlist: [],
    turnUrls: [],
    turnSecret: "",
    turnTtl: 600,
    communityMode: false,
    commonRoom: "",
  }
  enclave = await buildServer(config)
}, 30_000)

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

function enviar(corpo: unknown, ip = "203.0.113.1") {
  return enclave.app.inject({ method: "POST", url: ROTA_DO_RELATO, payload: corpo as object, remoteAddress: ip })
}

/** A real account on this server: logged in once, so the server knows its key. */
function conta(): AccountIdentity {
  const identidade = generateIdentity(parseServerName("localhost:8999"))
  enclave.store.registerOrVerifyAccount(identidade.address, identidade.signingPublicKey)
  return identidade
}

/** The request the 1.3.15 app sends: signed by the device, the address in the signature. */
function assinado(identidade: AccountIdentity, corpo: unknown, agora = Date.now()) {
  return assinarPedido(identidade, ROTA_DO_RELATO, corpo, agora)
}

const pasta = (): string => join(dataDir, "relatos")
const ficheiroDe = (identidade: AccountIdentity): string =>
  join(pasta(), `${dataDoFicheiro(new Date())}-${enderecoCurto(identidade.address)}.txt`)

describe("POST /_enclave/relato", () => {
  it("guarda o registo assinado em relatos/<data>-<endereço curto>.txt, com o endereço e a versão", async () => {
    const ana = conta()
    const resposta = await enviar(assinado(ana, { versao: "0.9.2", texto: "linha 1\nlinha 2" }))
    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toEqual({ ok: true })
    const guardado = readFileSync(ficheiroDe(ana), "utf8")
    expect(guardado).toContain(ana.address)
    expect(guardado).toContain("versão 0.9.2")
    expect(guardado).toContain("linha 1\nlinha 2")
    // The IP is used for the cap only, never written.
    expect(guardado).not.toContain("203.0.113.1")
  })

  it("dois registos no mesmo dia juntam-se no mesmo ficheiro, um a seguir ao outro", async () => {
    const bea = conta()
    await enviar(assinado(bea, { versao: "0.9.2", texto: "primeiro" }), "203.0.113.2")
    await enviar(assinado(bea, { versao: "0.9.2", texto: "segundo" }), "203.0.113.2")
    const guardado = readFileSync(ficheiroDe(bea), "utf8")
    expect(guardado.indexOf("primeiro")).toBeLessThan(guardado.indexOf("segundo"))
  })

  it("o pedido sem assinatura de um cliente antigo leva 401 e não guarda nada", async () => {
    const antes = readdirSync(pasta()).length
    const resposta = await enviar({ endereco: "@ana:localhost:8999", versao: "1.3.7", texto: "x" }, "203.0.113.9")
    expect(resposta.statusCode).toBe(401)
    expect(resposta.json()).toEqual({ error: "unauthorized" })
    expect(readdirSync(pasta()).length).toBe(antes)
  })

  it("recusa a conta que nunca entrou, a assinatura alterada e o pedido repetido", async () => {
    const estranha = generateIdentity(parseServerName("localhost:8999"))
    expect((await enviar(assinado(estranha, { versao: "0.9.2", texto: "x" }), "203.0.113.10")).statusCode).toBe(401)

    const gil = conta()
    const pedido = assinado(gil, { versao: "0.9.2", texto: "verdadeiro" })
    const alterado = { ...pedido, corpo: { versao: "0.9.2", texto: "alterado" } }
    expect((await enviar(alterado, "203.0.113.10")).statusCode).toBe(401)
    expect((await enviar(pedido, "203.0.113.10")).statusCode).toBe(200)
    expect((await enviar(pedido, "203.0.113.10")).statusCode).toBe(401)
    expect(readFileSync(ficheiroDe(gil), "utf8")).not.toContain("alterado")
  })

  it("o relógio do aparelho errado leva 401 com stale-request", async () => {
    const rui = conta()
    const resposta = await enviar(assinado(rui, { versao: "0.9.2", texto: "x" }, Date.now() - 20 * 60_000), "203.0.113.11")
    expect(resposta.statusCode).toBe(401)
    expect(resposta.json()).toEqual({ error: "stale-request" })
  })

  it("a assinatura de outra rota não serve aqui", async () => {
    const eva = conta()
    const pedido = assinarPedido(eva, ROTAS_DA_DENUNCIA.revisao, { versao: "0.9.2", texto: "x" })
    expect((await enviar(pedido, "203.0.113.12")).statusCode).toBe(401)
  })

  it("recusa o corpo que não é um registo: versão estranha, texto vazio", async () => {
    const ivo = conta()
    for (const corpo of [{ versao: "../../etc", texto: "x" }, { versao: "0.9.2", texto: "" }, { texto: "x" }]) {
      expect((await enviar(assinado(ivo, corpo), "203.0.113.3")).statusCode).toBe(400)
    }
  })

  it("recusa acima de 64 kB de texto", async () => {
    const luz = conta()
    const resposta = await enviar(assinado(luz, { versao: "0.9.2", texto: "a".repeat(RELATO_MAX_BYTES + 1) }), "203.0.113.4")
    expect(resposta.statusCode).toBe(413)
    expect(readdirSync(pasta()).some((nome) => nome.endsWith(`-${enderecoCurto(luz.address)}.txt`))).toBe(false)
  })

  it("10 por hora por endereço; o 11.º leva 429", async () => {
    const tom = conta()
    for (let i = 0; i < RELATOS_POR_HORA; i += 1) {
      // A different IP per request: what we measure here is the per-address cap.
      expect((await enviar(assinado(tom, { versao: "0.9.2", texto: `n${i}` }), `198.51.100.${i}`)).statusCode).toBe(200)
    }
    const decimo = await enviar(assinado(tom, { versao: "0.9.2", texto: "a mais" }), "198.51.100.200")
    expect(decimo.statusCode).toBe(429)
  })

  it("um IP com muitas contas também pára ao 31.º", async () => {
    const codigos: number[] = []
    for (let i = 0; i < RELATOS_POR_HORA_POR_IP + 1; i += 1) {
      codigos.push((await enviar(assinado(conta(), { versao: "0.9.2", texto: "x" }), "192.0.2.77")).statusCode)
    }
    expect(codigos.slice(0, RELATOS_POR_HORA_POR_IP).every((codigo) => codigo === 200)).toBe(true)
    expect(codigos[RELATOS_POR_HORA_POR_IP]).toBe(429)
  })
})

describe("as peças da rota", () => {
  it("o endereço curto é seguro para um nome de ficheiro", () => {
    expect(enderecoCurto("@Duarte:orwell.pt")).toBe("duarte")
    expect(enderecoCurto("@../../x:orwell.pt")).toBe("______x")
    expect(enderecoCurto("@:orwell.pt")).toBe("anonimo")
  })

  it("a janela de uma hora esquece o que tem mais de uma hora", () => {
    const janela = new JanelaDeUmaHora(2)
    expect(janela.tentar("a", 0)).toBe(true)
    expect(janela.tentar("a", 1)).toBe(true)
    expect(janela.tentar("a", 2)).toBe(false)
    expect(janela.tentar("a", 3_600_001)).toBe(true)
  })

  it("lerCorpoDoRelato aceita só o que a app manda", () => {
    expect(lerCorpoDoRelato({ versao: "0.9.2-beta.1", texto: "x" })).not.toBeNull()
    expect(lerCorpoDoRelato(null)).toBeNull()
    expect(lerCorpoDoRelato("texto")).toBeNull()
  })

  it("o varrimento apaga os registos com mais de 30 dias e deixa os outros", async () => {
    const aqui = mkdtempSync(join(tmpdir(), "enclave-relato-varre-"))
    mkdirSync(aqui, { recursive: true })
    writeFileSync(join(aqui, "2026-01-01-velho.txt"), "x")
    writeFileSync(join(aqui, "2026-10-27-novo.txt"), "x")
    const antigo = (Date.now() - 31 * 24 * 3_600_000) / 1000
    utimesSync(join(aqui, "2026-01-01-velho.txt"), antigo, antigo)
    expect(await varrerRelatos(aqui)).toBe(1)
    expect(readdirSync(aqui)).toEqual(["2026-10-27-novo.txt"])
    rmSync(aqui, { recursive: true, force: true })
  })
})
