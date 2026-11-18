import {
  fromBase64,
  generateIdentity,
  sign,
  identityFromPrivateKey,
  moradaDeSala,
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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { sha256 } from "@noble/hashes/sha2.js"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"
import { Gateway } from "./gateway.js"

/**
 * N-01: a device outside the account's manifest no longer logs in.
 *
 * Since 1.3.16 the paired phone holds the account key. A removed phone keeps
 * it, and with it could certify a NEW device key and log in with the chain, or
 * log in with the account key alone. For an account with a manifest the
 * server now takes the manifest as the list of who logs in. The one exception
 * is pairing: the manifest is published on `pronto`, with the phone already
 * in, so a device outside it gets a short window, once per device key, and
 * only while an active device of the account has a pairing box open. In the
 * window it has no seat and cannot publish a manifest; if no manifest names it
 * by the end, it is closed as revoked. See `Gateway.JANELA_DE_EMPARELHAMENTO_MS`.
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
  dataDir = mkdtempSync(join(tmpdir(), "enclave-n01-"))
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

/** The pairing box the active device opens before the phone logs in (`emparelhar.ts`). */
async function abrirCaixa(anfitriao: TestClient): Promise<string> {
  const pairId = toBase64(sha256(crypto.getRandomValues(new Uint8Array(32)))).slice(0, 22)
  anfitriao.send({ t: "pair.open", pairId })
  await anfitriao.nextOf("pair.opened")
  return pairId
}

const espera = (ms: number) => new Promise((pronto) => setTimeout(pronto, ms))

const JANELA_DE_TESTE_MS = 400
let janelaOriginal: number
beforeEach(() => {
  janelaOriginal = Gateway.JANELA_DE_EMPARELHAMENTO_MS
  Gateway.JANELA_DE_EMPARELHAMENTO_MS = JANELA_DE_TESTE_MS
})
afterEach(() => {
  Gateway.JANELA_DE_EMPARELHAMENTO_MS = janelaOriginal
})

/** A channel the account is seated in, so a seat would show. */
async function canalDaConta(client: TestClient): Promise<string> {
  const canal = moradaDeSala(HOME)
  client.send({ t: "channel.subscribe", channels: [canal] })
  await client.sync()
  client.send({ t: "channel.send", channel: canal, kind: "application", ciphertext: "b2lh" })
  await client.nextOf("channel.event")
  return canal
}

describe("N-01: numa conta com manifesto, só entra quem está no manifesto", () => {
  it("o fantasma: um telemóvel removido certifica uma chave nova com a chave da conta, e é recusado", async () => {
    const { computador, telemovel } = conta()
    const a = await entrar(computador)
    expect((await publicar(a.client, manifesto(computador, 1, [computador, telemovel]))).ok).toBe(true)
    expect((await publicar(a.client, manifesto(computador, 2, [computador]), [telemovel])).ok).toBe(true)
    const fantasma = identityFromPrivateKey(telemovel.signingPrivateKey, HOME)
    const f = await entrar(fantasma)
    expect(f.resposta).toMatchObject({ t: "error", code: "device-revoked", fatal: true })
    await f.client.esperarFecho()
    a.client.close()
  })

  it("o login sem cadeia, só com a chave da conta, é recusado", async () => {
    const { computador } = conta()
    const a = await entrar(computador)
    expect((await publicar(a.client, manifesto(computador, 1, [computador]))).ok).toBe(true)
    const b = await TestClient.connect(gatewayUrl)
    b.send({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
    await b.nextOf("hello.ok")
    b.send({ t: "auth.begin", address: computador.address, signingKey: toBase64(computador.signingPublicKey) })
    expect(await b.next()).toMatchObject({ t: "error", code: "chain-required", fatal: true })
    await b.esperarFecho()
    a.client.close()
  })

  it("numa conta sem manifesto, o login sem cadeia continua a entrar", async () => {
    const identidade = generateIdentity(HOME)
    const b = await TestClient.connect(gatewayUrl)
    b.send({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
    await b.nextOf("hello.ok")
    b.send({ t: "auth.begin", address: identidade.address, signingKey: toBase64(identidade.signingPublicKey) })
    const desafio = await b.nextOf("auth.challenge")
    b.send({ t: "auth.finish", signature: toBase64(sign(identidade, fromBase64(desafio.nonce))) })
    expect((await b.next()).t).toBe("auth.ok")
    b.close()
  })

  it("um aparelho fora do manifesto sem caixa de emparelhamento aberta é recusado", async () => {
    const { computador, novo } = conta()
    const a = await entrar(computador)
    expect((await publicar(a.client, manifesto(computador, 1, [computador]))).ok).toBe(true)
    const c = await entrar(novo)
    expect(c.resposta).toMatchObject({ t: "error", code: "device-revoked" })
    a.client.close()
  })

  it("o emparelhamento: o aparelho novo entra na janela, sem lugares, e fica quando o manifesto o põe", async () => {
    const { computador, novo } = conta()
    const a = await entrar(computador)
    expect((await publicar(a.client, manifesto(computador, 1, [computador]))).ok).toBe(true)
    const canal = await canalDaConta(a.client)
    await abrirCaixa(a.client)

    const c = await entrar(novo)
    expect(c.resposta.t).toBe("auth.ok")
    // In the window: no seat in the account's channels, and no manifest.
    c.client.send({ t: "channel.backfill", channel: canal, afterSeq: -1, limit: 10 })
    await c.client.sync()
    c.client.send({ t: "channel.send", channel: canal, kind: "application", ciphertext: "b2lh", ref: "x" })
    const recusa = await c.client.next()
    expect(recusa.t).not.toBe("channel.event")
    expect(await publicar(c.client, manifesto(computador, 2, [computador, novo]))).toMatchObject({ ok: false, reason: "not-yours" })

    // The computer publishes it (on `pronto`): the window closes and the device stays, with its seats.
    expect((await publicar(a.client, manifesto(computador, 2, [computador, novo]))).ok).toBe(true)
    await espera(JANELA_DE_TESTE_MS * 2)
    await c.client.sync()
    expect(c.client.fechado).toBe(false)
    c.client.send({ t: "channel.backfill", channel: canal, afterSeq: -1, limit: 10 })
    expect((await c.client.nextOf("channel.backfill.page")).events.length).toBeGreaterThan(0)
    a.client.close()
    c.client.close()
  })

  it("o aparelho que não aparece no manifesto até ao fim da janela é desligado como revogado", async () => {
    const { computador, novo } = conta()
    const a = await entrar(computador)
    expect((await publicar(a.client, manifesto(computador, 1, [computador]))).ok).toBe(true)
    await abrirCaixa(a.client)
    const c = await entrar(novo)
    expect(c.resposta.t).toBe("auth.ok")
    const erro = await c.client.nextOf("error")
    expect(erro).toMatchObject({ code: "device-revoked", fatal: true })
    // Never in the manifest: not removed, so no proof that would make the client erase its vault.
    expect("manifest" in erro).toBe(false)
    await c.client.esperarFecho()
    a.client.close()
  })

  it("a janela não reabre: a mesma chave, com outra caixa aberta, já não entra", async () => {
    const { computador, novo } = conta()
    const a = await entrar(computador)
    expect((await publicar(a.client, manifesto(computador, 1, [computador]))).ok).toBe(true)
    await abrirCaixa(a.client)
    const c = await entrar(novo)
    expect(c.resposta.t).toBe("auth.ok")
    await c.client.esperarFecho()

    await abrirCaixa(a.client)
    const deNovo = await entrar(novo)
    expect(deNovo.resposta).toMatchObject({ t: "error", code: "device-revoked" })
    a.client.close()
  })

  it("dentro da mesma janela, a mesma chave volta a ligar (uma rede que caiu)", async () => {
    const { computador, novo } = conta()
    const a = await entrar(computador)
    expect((await publicar(a.client, manifesto(computador, 1, [computador]))).ok).toBe(true)
    const pairId = await abrirCaixa(a.client)
    const c = await entrar(novo)
    expect(c.resposta.t).toBe("auth.ok")
    c.client.close()
    await c.client.esperarFecho()
    // The box closed meanwhile: the window is the device's, not the box's.
    a.client.send({ t: "pair.close", pairId })
    await a.client.sync()
    const outra = await entrar(novo)
    expect(outra.resposta.t).toBe("auth.ok")
    a.client.close()
    outra.client.close()
  })

  it("uma caixa aberta por um aparelho revogado ou fora do manifesto não abre janela", async () => {
    const { computador, telemovel, novo } = conta()
    const a = await entrar(computador)
    expect((await publicar(a.client, manifesto(computador, 1, [computador]))).ok).toBe(true)
    // `telemovel` gets in through a real window and opens a box of its own while still outside.
    await abrirCaixa(a.client)
    const t = await entrar(telemovel)
    expect(t.resposta.t).toBe("auth.ok")
    a.client.close()
    await abrirCaixa(t.client)
    const c = await entrar(novo)
    expect(c.resposta).toMatchObject({ t: "error", code: "device-revoked" })
    t.client.close()
  })
})
