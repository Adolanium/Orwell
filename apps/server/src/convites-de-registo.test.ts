import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  CODIGO_CONVITE_DE_REGISTO_INVALIDO,
  fromBase64,
  generateIdentity,
  PROTOCOL_VERSION,
  signWithDevice,
  toBase64,
  type AccountIdentity,
  type ServerFrame,
} from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"
import { hashDoConviteDeRegisto } from "./registo.js"

/**
 * `scripts/convites-de-registo.mjs`, run for real against the database of a
 * real server in `convite` mode.
 *
 * The script writes the server's format by hand (no TypeScript imports), so the
 * proof is the round trip: a code made by the script lets a new account in on
 * the server, once. As in `guioes-operador.test.ts`, a fake `ssh` that fails is
 * first in the PATH: a script that ignored the local database would fail here
 * instead of reaching production.
 */

const RAIZ = fileURLToPath(new URL("../../../", import.meta.url))

let dir: string
let ambiente: NodeJS.ProcessEnv
let servidor: ServidorDeTeste

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "enclave-convites-"))
  const bin = join(dir, "bin")
  execFileSync("mkdir", ["-p", bin])
  writeFileSync(join(bin, "ssh"), "#!/bin/sh\necho 'ssh falso: um guiao tentou ir ao servidor' >&2\nexit 97\n")
  chmodSync(join(bin, "ssh"), 0o755)
  servidor = await levantarServidor({ registo: "convite" })
  ambiente = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: dir,
    ORWELL_BASE: servidor.baseDeDados,
    ORWELL_SSH: "ninguem@127.0.0.1",
    ORWELL_SSH_KEY: join(dir, "chave-que-nao-existe"),
  }
})

afterEach(async () => {
  await servidor.fechar()
  rmSync(dir, { recursive: true, force: true })
})

function correr(argumentos: string[], extra: NodeJS.ProcessEnv = {}): { codigo: number; saida: string } {
  const resultado = spawnSync(process.execPath, [join(RAIZ, "scripts", "convites-de-registo.mjs"), ...argumentos], {
    env: { ...ambiente, ...extra },
    encoding: "utf8",
  })
  return { codigo: resultado.status ?? -1, saida: `${resultado.stdout}${resultado.stderr}` }
}

function codigoImpresso(saida: string): string {
  const achado = /Código: ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/.exec(saida)
  if (!achado) throw new Error(`sem código na saída: ${saida}`)
  return achado[1]!
}

/** The end of a login with the chain: `auth.ok`, or the `error` that refused it. */
async function entrar(identidade: AccountIdentity, conviteDeRegisto?: string): Promise<ServerFrame> {
  const socket = new WebSocket(servidor.url)
  const fila: ServerFrame[] = []
  const esperas: ((frame: ServerFrame) => void)[] = []
  socket.on("message", (raw: Buffer) => {
    const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
    const espera = esperas.shift()
    if (espera) espera(frame)
    else fila.push(frame)
  })
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve())
    socket.once("error", reject)
  })
  const proximo = (): Promise<ServerFrame> =>
    fila.length > 0 ? Promise.resolve(fila.shift()!) : new Promise((resolve) => esperas.push(resolve))
  const enviar = (frame: unknown): void => socket.send(JSON.stringify(frame))
  enviar({ t: "hello", version: PROTOCOL_VERSION, capabilities: [] })
  await proximo()
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
  socket.close()
  return fim
}

describe("convites-de-registo.mjs", () => {
  it("criar: o código impresso deixa entrar uma conta nova no servidor, uma vez", async () => {
    const { codigo, saida } = correr(["criar"])
    expect(codigo, saida).toBe(0)
    const convite = codigoImpresso(saida)
    expect(saida).toContain("Deixa entrar 1 conta nova")
    expect((await entrar(generateIdentity(servidor.casa), convite)).t).toBe("auth.ok")
    const segunda = await entrar(generateIdentity(servidor.casa), convite)
    expect(segunda.t === "error" && segunda.code).toBe(CODIGO_CONVITE_DE_REGISTO_INVALIDO)
  })

  it("criar com --usos e --dias guarda só o hash, com a contagem e a validade", () => {
    const { codigo, saida } = correr(["criar", "--usos", "5", "--dias", "30"])
    expect(codigo, saida).toBe(0)
    const convite = codigoImpresso(saida)
    const [linha] = servidor.enclave.store.convitesDeRegisto()
    expect(linha!.hash).toBe(hashDoConviteDeRegisto(convite))
    expect(linha!.maximo).toBe(5)
    expect(linha!.usos).toBe(0)
    const dias = (linha!.expiraSegundo - Date.now() / 1000) / 86_400
    expect(dias).toBeGreaterThan(29.9)
    expect(dias).toBeLessThan(30.1)
  })

  it("listar mostra o início do hash e a contagem, nunca o código", () => {
    const convite = codigoImpresso(correr(["criar", "--usos", "2"]).saida)
    const { codigo, saida } = correr(["listar"])
    expect(codigo, saida).toBe(0)
    expect(saida).toContain(hashDoConviteDeRegisto(convite).slice(0, 12))
    expect(saida).toContain("0/2")
    expect(saida).toContain("válido")
    expect(saida).not.toContain(convite)
  })

  it("revogar pelo início do hash apaga o código, e ele deixa de entrar", async () => {
    const convite = codigoImpresso(correr(["criar"]).saida)
    const { codigo, saida } = correr(["revogar", hashDoConviteDeRegisto(convite).slice(0, 10)])
    expect(codigo, saida).toBe(0)
    expect(servidor.enclave.store.convitesDeRegisto()).toHaveLength(0)
    const fim = await entrar(generateIdentity(servidor.casa), convite)
    expect(fim.t === "error" && fim.code).toBe(CODIGO_CONVITE_DE_REGISTO_INVALIDO)
  })

  it("limpar apaga os gastos e os expirados, e deixa os válidos", async () => {
    const gasto = codigoImpresso(correr(["criar"]).saida)
    await entrar(generateIdentity(servidor.casa), gasto)
    servidor.enclave.store.criarConviteDeRegisto({ usos: 1, dias: 1, agoraSegundo: Math.floor(Date.now() / 1000) - 2 * 86_400 })
    const valido = codigoImpresso(correr(["criar"]).saida)
    const { codigo, saida } = correr(["limpar"])
    expect(codigo, saida).toBe(0)
    expect(saida).toContain("Apagados: 2")
    expect(servidor.enclave.store.convitesDeRegisto().map((linha) => linha.hash)).toEqual([hashDoConviteDeRegisto(valido)])
  })

  it("recusa argumentos errados antes de tocar na base, e sem ORWELL_BASE não faz nada", () => {
    for (const argumentos of [["criar", "--usos", "0"], ["criar", "--dias", "91"], ["criar", "--usos", "x"], ["revogar", "abc"], ["apagar"]]) {
      expect(correr(argumentos).codigo).not.toBe(0)
    }
    expect(servidor.enclave.store.convitesDeRegisto()).toHaveLength(0)
    const semBase = correr(["criar"], { ORWELL_BASE: "" })
    expect(semBase.codigo).not.toBe(0)
    expect(semBase.saida).toContain("ORWELL_BASE")
    const inexistente = correr(["listar"], { ORWELL_BASE: join(dir, "nao-existe.sqlite") })
    expect(inexistente.codigo).not.toBe(0)
  })
})
