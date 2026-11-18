import {
  fromBase64,
  generateIdentity,
  moradaDeSala,
  parseServerName,
  PROTOCOL_VERSION,
  sign,
  toBase64,
  type ClientFrame,
  type ServerFrame,
} from "@enclave/protocol"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"
import { AMBITOS_POR_LIGACAO, type MotorDeMedia } from "./media.js"

/**
 * Races in the SFU between a request in flight and the next one, or the exit
 * (ORW-134-06, 07 and 08, external report of 17/11/2026).
 *
 * The gateway dispatches each frame with `void this.#dispatch(...)`, and the
 * engine awaits the worker on each router and transport. Anything checked
 * before that `await` and recorded after it can be crossed by a second frame,
 * or by the socket closing. Each test states the wanted behaviour against a
 * real worker, through the engine and, where the leak is the gateway's,
 * through a real socket.
 */

let HOME: ReturnType<typeof parseServerName>
let enclave: Enclave
let motor: MotorDeMedia
let dataDir: string
let gatewayUrl: string

/** A free UDP port: `sfuPort: 0` means "no SFU". See `sfu.test.ts`. */
async function portoLivre(): Promise<number> {
  const { createSocket } = await import("node:dgram")
  const socket = createSocket("udp4")
  await new Promise<void>((pronto) => socket.bind(0, "127.0.0.1", pronto))
  const porto = socket.address().port
  await new Promise<void>((pronto) => socket.close(() => pronto()))
  return porto
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-sfu-corridas-"))
  const config: ServerConfig = {
    serverName: parseServerName("localhost"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir,
    databasePath: join(dataDir, "test.sqlite"),
    sfuPort: await portoLivre(),
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
  if (!enclave.media) throw new Error("the media engine did not start")
  motor = enclave.media
  await enclave.app.listen({ host: config.bindHost, port: 0 })
  const port = (enclave.app.server.address() as { port: number }).port
  HOME = parseServerName(`localhost:${port}`)
  config.serverName = HOME
  gatewayUrl = `ws://127.0.0.1:${port}/_enclave/gateway`
})

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

const unico = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const espera = (ms: number) => new Promise((pronto) => setTimeout(pronto, ms))
const ambitoDe = (nome: string): string => createHash("sha256").update(nome).digest("base64url")

/** Poll until `condicao` holds, or the time runs out. */
async function ate(condicao: () => boolean, ms = 3000): Promise<void> {
  const fim = Date.now() + ms
  while (!condicao() && Date.now() < fim) await espera(10)
}

class TestClient {
  #socket: WebSocket
  #queue: ServerFrame[] = []
  #waiters: ((frame: ServerFrame) => void)[] = []

  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      const waiter = this.#waiters.shift()
      if (waiter) waiter(frame)
      else this.#queue.push(frame)
    })
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve())
      socket.once("error", reject)
    })
    return new TestClient(socket)
  }

  send(frame: ClientFrame): void {
    this.#socket.send(JSON.stringify(frame))
  }

  next(): Promise<ServerFrame> {
    const queued = this.#queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve) => {
      this.#waiters.push(resolve)
      setTimeout(() => resolve({ t: "error", code: "timeout", message: "no frame", fatal: false }), 4000)
    })
  }

  async nextOf<K extends ServerFrame["t"]>(kind: K): Promise<Extract<ServerFrame, { t: K }>> {
    for (let i = 0; i < 10; i++) {
      const frame = await this.next()
      if (frame.t === kind) return frame as Extract<ServerFrame, { t: K }>
      if (frame.t === "error" && frame.code === "timeout") break
    }
    throw new Error(`never received a ${kind} frame`)
  }

  async sync(): Promise<void> {
    this.send({ t: "ping" })
    await this.nextOf("pong")
  }

  close(): void {
    this.#socket.close()
  }
}

/** A logged-in account that owns a fresh channel, so it has a seat in its call. */
async function comLugar(): Promise<{ client: TestClient; canal: string }> {
  const client = await TestClient.connect(gatewayUrl)
  const identity = generateIdentity(HOME)
  client.send({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
  await client.nextOf("hello.ok")
  client.send({ t: "auth.begin", address: identity.address, signingKey: toBase64(identity.signingPublicKey) })
  const challenge = await client.nextOf("auth.challenge")
  client.send({ t: "auth.finish", signature: toBase64(sign(identity, fromBase64(challenge.nonce))) })
  await client.nextOf("auth.ok")
  const canal = moradaDeSala(HOME)
  client.send({ t: "channel.subscribe", channels: [canal] })
  await client.sync()
  return { client, canal }
}

describe("ORW-134-07: sair com uma entrada a meio", () => {
  it("no motor: depois de sair(), a entrada que estava a meio não deixa membro nem router", async () => {
    const antes = motor.ambitosAbertos
    const dono = `d07-${unico()}`
    const chave = `k07-${unico()}`
    const entrada = motor.entrar(chave, dono)
    await motor.sair(dono)
    expect(await entrada.then(() => "entrou", () => "recusada")).toBe("recusada")
    // A member would get a transport: that is the proof it was left behind.
    const t = await motor.criarTransporte(chave, dono, "recepcao").then(() => "ficou-membro", () => "fora")
    expect(t).toBe("fora")
    expect(motor.ambitosAbertos).toBe(antes)
  })

  it("no motor: sair() durante criarTransporte não deixa o transporte aberto", async () => {
    const dono = `d07t-${unico()}`
    const chave = `k07t-${unico()}`
    // Someone else stays, so the router survives and cannot close the transport for us.
    const outro = `o07t-${unico()}`
    await motor.entrar(chave, outro)
    await motor.entrar(chave, dono)
    const antes = motor.transportesAbertos
    const criacao = motor.criarTransporte(chave, dono, "envio")
    await motor.sair(dono)
    expect(await criacao.then(() => "criado", () => "recusado")).toBe("recusado")
    expect(motor.transportesAbertos).toBe(antes)
    await motor.sair(outro)
  })

  /*
   * The socket closes while the engine is still answering. Left to timing, the
   * worker usually answers first, so the test holds the engine's answer until
   * the server has dropped the connection: once with the entry already in the
   * engine (what `#drop` must cancel), once with it not yet started (what the
   * gateway must undo after the `await`).
   */
  for (const quando of ["entrada-ja-no-motor", "entrada-ainda-por-comecar"] as const) {
    it(`no gateway: a ligação que fecha com um sfu.scope.join a meio não deixa router (${quando})`, async () => {
      const antes = motor.ambitosAbertos
      const { client, canal } = await comLugar()
      let soltar!: () => void
      const portao = new Promise<void>((pronto) => (soltar = pronto))
      const original = motor.entrar.bind(motor)
      const emCurso: Promise<unknown>[] = []
      const espiao = vi.spyOn(motor, "entrar").mockImplementation((chave, dono) => {
        const resposta = (async () => {
          if (quando === "entrada-ja-no-motor") {
            const resultado = original(chave, dono)
            await portao
            return resultado
          }
          await portao
          return original(chave, dono)
        })()
        emCurso.push(resposta)
        return resposta
      })
      try {
        client.send({ t: "sfu.scope.join", channel: canal, scope: ambitoDe(unico()) })
        await ate(() => emCurso.length > 0)
        client.close()
        // Long enough for the closing handshake on loopback, and so for `#drop`.
        await espera(150)
      } finally {
        soltar()
        espiao.mockRestore()
      }
      expect(emCurso).toHaveLength(1)
      await Promise.allSettled(emCurso)
      // The gateway's continuation after the `await`, and its exit, if any.
      await espera(100)
      await ate(() => motor.ambitosAbertos === antes)
      expect(motor.ambitosAbertos).toBe(antes)
    })
  }
})

describe("ORW-134-06: tecto de âmbitos por ligação com entradas em paralelo", () => {
  it(`no máximo ${AMBITOS_POR_LIGACAO} âmbitos para uma ligação, e as recusadas não deixam router`, async () => {
    const antes = motor.ambitosAbertos
    const dono = `d06-${unico()}`
    const pedidos = Array.from({ length: 12 }, (_, i) => motor.entrar(`k06-${unico()}-${i}`, dono))
    const res = await Promise.allSettled(pedidos)
    const aceites = res.filter((r) => r.status === "fulfilled").length
    expect(aceites).toBe(AMBITOS_POR_LIGACAO)
    expect(motor.ambitosAbertos).toBe(antes + AMBITOS_POR_LIGACAO)
    await motor.sair(dono)
    expect(motor.ambitosAbertos).toBe(antes)
  })

  it("uma entrada que falha devolve o lugar", async () => {
    const dono = `d06f-${unico()}`
    const chaves = Array.from({ length: AMBITOS_POR_LIGACAO }, (_, i) => `k06f-${unico()}-${i}`)
    // Fill the cap with entries in flight, then make them all leave mid-way: they fail.
    const pedidos = chaves.map((chave) => motor.entrar(chave, dono))
    await motor.sair(dono)
    await Promise.allSettled(pedidos)
    // The seats came back: the same connection can enter again.
    await motor.entrar(`k06f-${unico()}`, dono)
    await motor.sair(dono)
  })

  it("repetir a entrada no mesmo âmbito, em paralelo, não gasta dois lugares", async () => {
    const dono = `d06r-${unico()}`
    const chave = `k06r-${unico()}`
    const outras = Array.from({ length: AMBITOS_POR_LIGACAO - 1 }, (_, i) => `k06r-${unico()}-${i}`)
    const res = await Promise.allSettled([
      motor.entrar(chave, dono),
      motor.entrar(chave, dono),
      ...outras.map((outra) => motor.entrar(outra, dono)),
    ])
    expect(res.every((r) => r.status === "fulfilled")).toBe(true)
    await motor.sair(dono)
  })
})

describe("ORW-134-08: um transporte por sentido com pedidos em paralelo", () => {
  it("dois criarTransporte de envio ao mesmo tempo: só um é aceite, e não fica nenhum a mais", async () => {
    const dono = `d08-${unico()}`
    const chave = `k08-${unico()}`
    await motor.entrar(chave, dono)
    const antes = motor.transportesAbertos
    const res = await Promise.allSettled([
      motor.criarTransporte(chave, dono, "envio"),
      motor.criarTransporte(chave, dono, "envio"),
    ])
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(motor.transportesAbertos).toBe(antes + 1)
    await motor.sair(dono)
  })

  it("um de envio e um de recepção ao mesmo tempo: os dois são aceites", async () => {
    const dono = `d08b-${unico()}`
    const chave = `k08b-${unico()}`
    await motor.entrar(chave, dono)
    const res = await Promise.allSettled([
      motor.criarTransporte(chave, dono, "envio"),
      motor.criarTransporte(chave, dono, "recepcao"),
    ])
    expect(res.every((r) => r.status === "fulfilled")).toBe(true)
    await motor.sair(dono)
  })

  it("um pedido que falha devolve a reserva do sentido", async () => {
    const dono = `d08c-${unico()}`
    const chave = `k08c-${unico()}`
    const outro = `o08c-${unico()}`
    await motor.entrar(chave, outro)
    await motor.entrar(chave, dono)
    const criacao = motor.criarTransporte(chave, dono, "envio")
    // Leave and come back while it is in flight: the first one fails.
    await motor.sairDoAmbito(dono, chave)
    await motor.entrar(chave, dono)
    expect(await criacao.then(() => "criado", () => "recusado")).toBe("recusado")
    await motor.criarTransporte(chave, dono, "envio")
    await motor.sair(dono)
    await motor.sair(outro)
  })
})
