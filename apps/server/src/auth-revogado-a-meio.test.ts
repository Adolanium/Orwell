import {
  fromBase64,
  generateIdentity,
  identityFromPrivateKey,
  parseServerName,
  PROTOCOL_VERSION,
  signDeviceManifest,
  signWithDevice,
  toBase64,
  type ClientFrame,
  type ServerFrame,
} from "@enclave/protocol"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"

/**
 * A device revoked BETWEEN `auth.begin` and `auth.finish` (ORW-134-01).
 *
 * `#beginAuth` rejects a revoked device before it issues a challenge. Until
 * 1.3.19 that was the only check: a device that asked for its challenge while
 * still approved, and finished after the account revoked it, got `auth.ok`. The
 * publication did not reach it either, because it closes only connections with
 * an `address`, and a pending one has none yet. Two locks close it: the
 * publication drops the pending challenges of the devices it revokes, and
 * `#finishAuth` checks the revocation again, right before `auth.ok`. What must
 * keep working: a device that is not yet in the manifest (the phone before
 * `pronto`) finishes its login across a publication that does not name it.
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
  dataDir = mkdtempSync(join(tmpdir(), "enclave-auth-revogado-"))
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

type Identidade = ReturnType<typeof generateIdentity>

/** Join with the chain: this is how every client has joined since August 11. */
async function entrar(identity: Identidade): Promise<{ client: TestClient; resposta: ServerFrame }> {
  const client = await TestClient.connect(gatewayUrl)
  client.send({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
  await client.nextOf("hello.ok")
  client.send({
    t: "auth.begin",
    address: identity.address,
    signingKey: toBase64(identity.deviceSigningPublicKey),
    accountKey: toBase64(identity.signingPublicKey),
    deviceCert: toBase64(identity.credential.signature),
  })
  const challenge = await client.next()
  if (challenge.t !== "auth.challenge") return { client, resposta: challenge }
  client.send({ t: "auth.finish", signature: toBase64(signWithDevice(identity, fromBase64(challenge.nonce))) })
  return { client, resposta: await client.next() }
}

function manifesto(conta: Identidade, version: number, aparelhos: Identidade[]) {
  return signDeviceManifest(conta.signingPrivateKey, {
    address: conta.address,
    version,
    devices: aparelhos.map((a, i) => ({ deviceKey: a.deviceSigningPublicKey, addedAt: i })),
    signedAt: version,
  })
}

/** Publish, revoking `revogar` (the `revoke` list); without it, this is what 0.5.7 sends. */
async function publicar(client: TestClient, wire: ReturnType<typeof manifesto>, revogar?: Identidade[]) {
  client.send({
    t: "manifest.publish",
    manifest: wire,
    ...(revogar ? { revoke: revogar.map((a) => toBase64(a.deviceSigningPublicKey)) } : {}),
  })
  return client.nextOf("manifest.published")
}

/** Three devices of the same account: the computer (with the key), the phone, and a third one to pair. */
function conta(): { computador: Identidade; telemovel: Identidade; novo: Identidade } {
  const computador = generateIdentity(HOME)
  return {
    computador,
    telemovel: identityFromPrivateKey(computador.signingPrivateKey, HOME),
    novo: identityFromPrivateKey(computador.signingPrivateKey, HOME),
  }
}


/** `hello` and `auth.begin` with the chain, stopping at the challenge. */
async function pedirDesafio(identity: Identidade): Promise<{ client: TestClient; nonce: string }> {
  const client = await TestClient.connect(gatewayUrl)
  client.send({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
  await client.nextOf("hello.ok")
  client.send({
    t: "auth.begin",
    address: identity.address,
    signingKey: toBase64(identity.deviceSigningPublicKey),
    accountKey: toBase64(identity.signingPublicKey),
    deviceCert: toBase64(identity.credential.signature),
  })
  const desafio = await client.next()
  if (desafio.t !== "auth.challenge") throw new Error(`expected auth.challenge, got ${JSON.stringify(desafio)}`)
  return { client, nonce: desafio.nonce }
}

function terminar(client: TestClient, identity: Identidade, nonce: string): void {
  client.send({ t: "auth.finish", signature: toBase64(signWithDevice(identity, fromBase64(nonce))) })
}

describe("aparelho revogado entre auth.begin e auth.finish (ORW-134-01)", () => {
  it("a publicação que o revoga fecha também o desafio pendente", async () => {
    const { computador, telemovel } = conta()
    const a = await entrar(computador)
    expect(a.resposta.t).toBe("auth.ok")
    expect((await publicar(a.client, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)

    // The phone asks for its challenge while it is still approved.
    const b = await pedirDesafio(telemovel)

    expect((await publicar(a.client, manifesto(computador, 2, [computador]), [telemovel])).ok).toBe(true)
    expect(await b.client.next()).toMatchObject({ t: "error", code: "device-revoked", fatal: true })
    await b.client.esperarFecho()
    a.client.close()
  })

  it("o auth.finish volta a verificar a revogação, mesmo que a publicação não tenha fechado a ligação", async () => {
    const { computador, telemovel } = conta()
    const a = await entrar(computador)
    expect(a.resposta.t).toBe("auth.ok")
    expect((await publicar(a.client, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)

    const b = await pedirDesafio(telemovel)

    // The revocation lands in the store without passing through this gateway's
    // `manifest.publish` (the other lock), so only `#finishAuth` is left to see it.
    const revogacao = enclave.store.putDeviceManifest(manifesto(computador, 2, [computador]), [
      toBase64(telemovel.deviceSigningPublicKey),
    ])
    expect(revogacao.ok).toBe(true)
    expect(enclave.store.isDeviceRevoked(computador.address, telemovel.deviceSigningPublicKey)).toBe(true)
    await b.client.sync()
    expect(b.client.fechado).toBe(false)

    terminar(b.client, telemovel, b.nonce)
    expect(await b.client.next()).toMatchObject({ t: "error", code: "device-revoked", fatal: true })
    await b.client.esperarFecho()
    a.client.close()
  })

  it("um aparelho ainda fora do manifesto acaba o login através de uma publicação que não o revoga", async () => {
    const { computador, telemovel, novo } = conta()
    const a = await entrar(computador)
    expect(a.resposta.t).toBe("auth.ok")
    expect((await publicar(a.client, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)

    // The device being paired is in no manifest yet.
    const c = await pedirDesafio(novo)
    expect((await publicar(a.client, manifesto(computador, 2, [computador]), [telemovel])).ok).toBe(true)
    await c.client.sync()
    expect(c.client.fechado).toBe(false)

    terminar(c.client, novo, c.nonce)
    expect(await c.client.nextOf("auth.ok")).toMatchObject({ address: computador.address })
    a.client.close()
    c.client.close()
  })
})
