import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { assinarPedido } from "@enclave/client-core"
import { BUGS_POR_DIA, generateIdentity, parseServerName, ROTA_DOS_BUGS, type AccountIdentity } from "@enclave/protocol"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"
import { ArquivoDeBugs, BUGS_DIAS, type FilaDosBugs } from "./bugs.js"

/**
 * "Report a bug" (12/11/2026): `POST /_enclave/bug`, via `inject`, signed by the
 * client core as the app signs it.
 */

const SERVIDOR = "localhost:8998"
let enclave: Enclave
let dataDir: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-bugs-"))
  const config: ServerConfig = {
    serverName: parseServerName(SERVIDOR),
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

const pasta = (): string => join(dataDir, "bugs")
const ficheiros = (): string[] => (existsSync(pasta()) ? readdirSync(pasta()).filter((nome) => /^\d+\.json$/.test(nome)) : [])
const fila = (): FilaDosBugs => JSON.parse(readFileSync(join(pasta(), "fila.json"), "utf8")) as FilaDosBugs

function conta(): AccountIdentity {
  const identidade = generateIdentity(parseServerName(SERVIDOR))
  enclave.store.registerOrVerifyAccount(identidade.address, identidade.signingPublicKey)
  return identidade
}

let ipSeguinte = 1
const ipNovo = (): string => `198.51.100.${ipSeguinte++}`

const DETALHES = {
  versao: "1.3.8",
  plataforma: "web",
  sistema: "macOS 15",
  browser: "Firefox 140",
  lingua: "pt",
  erros: [{ codigo: 104, em: 1_794_000_000_000 }],
  ligacao: "online",
  sincronia: "em-dia",
}

function enviar(identidade: AccountIdentity, corpo: unknown, ip = ipNovo()) {
  return enclave.app.inject({ method: "POST", url: ROTA_DOS_BUGS, payload: assinarPedido(identidade, ROTA_DOS_BUGS, corpo) as object, remoteAddress: ip })
}

describe("comunicar um erro", () => {
  it("guarda a descrição e os detalhes, sem o endereço quando não pedem contacto", async () => {
    const ana = conta()
    const resposta = await enviar(ana, { v: 1, descricao: "O botão de enviar não responde.", detalhes: DETALHES, contacto: false })
    expect(resposta.statusCode).toBe(200)
    const [nome] = ficheiros()
    const guardado = JSON.parse(readFileSync(join(pasta(), nome!), "utf8")) as Record<string, unknown>
    expect(guardado["corpo"]).toMatchObject({ descricao: "O botão de enviar não responde.", detalhes: DETALHES })
    expect(JSON.stringify(guardado)).not.toContain(ana.address)
    expect(fila().bugs.at(-1)).toMatchObject({ comContacto: false })
    // The queue carries numbers and dates, never the description.
    expect(JSON.stringify(fila())).not.toContain("botão")
  })

  it("com 'Podem contactar-me', guarda o endereço de quem reporta", async () => {
    const bruno = conta()
    const resposta = await enviar(bruno, { v: 1, descricao: "Erro 349 ao abrir o canal.", contacto: true })
    expect(resposta.statusCode).toBe(200)
    const ultimo = fila().bugs.at(-1)!
    const guardado = JSON.parse(readFileSync(join(pasta(), `${ultimo.numero}.json`), "utf8")) as { contacto?: string }
    expect(guardado.contacto).toBe(bruno.address)
    expect(ultimo.comContacto).toBe(true)
  })

  it("recusa campos que não conhece, descrição vazia e texto acima do tecto", async () => {
    const carla = conta()
    const antes = ficheiros().length
    expect((await enviar(carla, { v: 1, descricao: "x", contacto: false, mensagens: ["olá"] })).statusCode).toBe(400)
    expect((await enviar(carla, { v: 1, descricao: "", contacto: false })).statusCode).toBe(400)
    expect((await enviar(carla, { v: 1, descricao: "a".repeat(4_001), contacto: false })).statusCode).toBe(400)
    expect((await enviar(carla, { v: 1, descricao: "x", detalhes: { ...DETALHES, canal: "!sala:x" }, contacto: false })).statusCode).toBe(400)
    expect(ficheiros().length).toBe(antes)
  })

  it("um pedido sem assinatura válida não entra", async () => {
    const dora = conta()
    const pedido = assinarPedido(dora, ROTA_DOS_BUGS, { v: 1, descricao: "x", contacto: false }) as unknown as Record<string, unknown>
    pedido["corpo"] = { v: 1, descricao: "outra coisa", contacto: false }
    const resposta = await enclave.app.inject({ method: "POST", url: ROTA_DOS_BUGS, payload: pedido, remoteAddress: ipNovo() })
    expect(resposta.statusCode).toBe(401)
  })

  it(`tem tecto de ${BUGS_POR_DIA} por dia por conta`, async () => {
    const eva = conta()
    const codigos: number[] = []
    for (let i = 0; i <= BUGS_POR_DIA; i++) codigos.push((await enviar(eva, { v: 1, descricao: `erro ${i}`, contacto: false })).statusCode)
    expect(codigos.slice(0, BUGS_POR_DIA).every((c) => c === 200)).toBe(true)
    expect(codigos.at(-1)).toBe(429)
  })
})

describe("a pasta dos bugs", () => {
  it(`apaga o que tem mais de ${BUGS_DIAS} dias e reescreve a fila`, async () => {
    const outra = mkdtempSync(join(tmpdir(), "enclave-bugs-varrer-"))
    try {
      const arquivo = new ArquivoDeBugs(outra)
      const velho = await arquivo.guardar({ v: 1, recebido: new Date(Date.now() - (BUGS_DIAS + 1) * 86_400_000).toISOString(), corpo: { v: 1, descricao: "velho", contacto: false } })
      await arquivo.guardar({ v: 1, recebido: new Date().toISOString(), corpo: { v: 1, descricao: "novo", contacto: false } })
      expect(await arquivo.varrer()).toBe(1)
      expect(existsSync(join(outra, `${velho!.numero}.json`))).toBe(false)
      const lida = JSON.parse(readFileSync(join(outra, "fila.json"), "utf8")) as FilaDosBugs
      expect(lida.bugs.map((b) => b.numero)).toEqual([2])
      // An unreadable file does not stop the sweep.
      writeFileSync(join(outra, "9.json"), "{")
      await expect(arquivo.varrer()).resolves.toBe(0)
    } finally {
      rmSync(outra, { recursive: true, force: true })
    }
  })
})
