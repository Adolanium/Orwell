import {
  fromBase64,
  generateIdentity,
  parseServerName,
  PROTOCOL_VERSION,
  signWithDevice,
  toBase64,
  type ClientFrame,
  type ServerFrame,
} from "@enclave/protocol"
import { sha256 } from "@noble/hashes/sha2.js"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"
import { Gateway } from "./gateway.js"

/**
 * The deadline to log in (ORW-136-07). See `Gateway.PRAZO_DO_LOGIN_MS`.
 *
 * Shortened here to 150 ms: what is measured is the rule, not the number.
 */

let HOME: ReturnType<typeof parseServerName>
let enclave: Enclave
let dataDir: string
let gatewayUrl: string

class TestClient {
  #socket: WebSocket
  #queue: ServerFrame[] = []
  #waiters: ((frame: ServerFrame) => void)[] = []
  fechado = false
  readonly #fechou: Promise<void>

  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      const waiter = this.#waiters.shift()
      if (waiter) waiter(frame)
      else this.#queue.push(frame)
    })
    this.#fechou = new Promise((resolve) =>
      socket.once("close", () => {
        this.fechado = true
        resolve()
      }),
    )
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

  esperarFecho(): Promise<void> {
    return this.#fechou
  }

  close(): void {
    this.#socket.close()
  }
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-prazo-do-login-"))
  const config: ServerConfig = {
    serverName: parseServerName("localhost"),
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

const PRAZO_DE_TESTE_MS = 150
let prazoOriginal: number
beforeEach(() => {
  prazoOriginal = Gateway.PRAZO_DO_LOGIN_MS
  Gateway.PRAZO_DO_LOGIN_MS = PRAZO_DE_TESTE_MS
})
afterEach(() => {
  Gateway.PRAZO_DO_LOGIN_MS = prazoOriginal
})

const espera = (ms: number) => new Promise((pronto) => setTimeout(pronto, ms))

async function comHello(): Promise<TestClient> {
  const client = await TestClient.connect(gatewayUrl)
  client.send({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
  await client.nextOf("hello.ok")
  return client
}

async function login(): Promise<TestClient> {
  const identity = generateIdentity(HOME)
  const client = await comHello()
  client.send({
    t: "auth.begin",
    address: identity.address,
    signingKey: toBase64(identity.deviceSigningPublicKey),
    accountKey: toBase64(identity.signingPublicKey),
    deviceCert: toBase64(identity.credential.signature),
  })
  const desafio = await client.nextOf("auth.challenge")
  client.send({ t: "auth.finish", signature: toBase64(signWithDevice(identity, fromBase64(desafio.nonce))) })
  await client.nextOf("auth.ok")
  return client
}

describe("prazo para acabar o login (ORW-136-07)", () => {
  it("fecha a ligação que responde aos pings mas nunca faz login", async () => {
    const client = await comHello()
    // Alive the whole time: a frame every 40 ms resets nothing that matters here.
    const vivo = setInterval(() => client.send({ t: "ping" }), 40)
    try {
      await Promise.race([client.esperarFecho(), espera(PRAZO_DE_TESTE_MS * 10)])
    } finally {
      clearInterval(vivo)
    }
    expect(client.fechado).toBe(true)
  })

  it("fecha a ligação parada a meio do login, com o desafio por responder", async () => {
    const identity = generateIdentity(HOME)
    const client = await comHello()
    client.send({
      t: "auth.begin",
      address: identity.address,
      signingKey: toBase64(identity.deviceSigningPublicKey),
      accountKey: toBase64(identity.signingPublicKey),
      deviceCert: toBase64(identity.credential.signature),
    })
    await client.nextOf("auth.challenge")
    const erro = await client.nextOf("error")
    expect(erro).toMatchObject({ code: "login-timeout", fatal: true })
    await client.esperarFecho()
  })

  it("não toca na ligação que fez login a tempo", async () => {
    const client = await login()
    await espera(PRAZO_DE_TESTE_MS * 3)
    await client.sync()
    expect(client.fechado).toBe(false)
    client.close()
  })

  it("não fecha o telemóvel que espera numa caixa de emparelhamento", async () => {
    const pc = await login()
    const pairId = toBase64(sha256(crypto.getRandomValues(new Uint8Array(32)))).slice(0, 22)
    pc.send({ t: "pair.open", pairId })
    await pc.nextOf("pair.opened")
    const telemovel = await comHello()
    telemovel.send({ t: "pair.join", pairId })
    await telemovel.nextOf("pair.joined")
    await espera(PRAZO_DE_TESTE_MS * 4)
    await telemovel.sync()
    expect(telemovel.fechado).toBe(false)

    // Once the box is gone, the next period closes it.
    pc.send({ t: "pair.close", pairId })
    await Promise.race([telemovel.esperarFecho(), espera(PRAZO_DE_TESTE_MS * 10)])
    expect(telemovel.fechado).toBe(true)
    pc.close()
  })
})
