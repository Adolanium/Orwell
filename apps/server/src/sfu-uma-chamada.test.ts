import {
  fromBase64,
  generateIdentity,
  identityFromPrivateKey,
  signWithDevice,
  parseServerName,
  sign,
  toBase64,
  type ClientFrame,
  type ServerFrame,
  PROTOCOL_VERSION,
  moradaDeSala,
} from "@enclave/protocol"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { conviteComProva } from "../testes/convite-com-prova.js"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"
import { RecusaDeMedia } from "./media.js"

/**
 * One call per account, as in Discord (1.3.25).
 *
 * The same account in two calls at once (the browser and the app, or two
 * devices) is what this suite forbids, on the SERVER: a modified client must
 * not be able to keep two. Whoever joins last keeps the call; the device that
 * lost it gets `sfu.scope.closed` and cannot take it back without a gesture
 * (`tomar`), which is what stops an older client from passing the call back
 * and forth with the new device.
 *
 * And what it must NOT confuse with that: the same connection asking again
 * (the resynchronisation), and the same device on a new socket (a reconnect).
 */

let HOME: ReturnType<typeof parseServerName>
let enclave: Enclave
let dataDir: string
let gatewayUrl: string

class TestClient {
  #socket: WebSocket
  #queue: ServerFrame[] = []
  #waiters: ((frame: ServerFrame) => void)[] = []
  #todos: ServerFrame[] = []

  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      this.#todos.push(frame)
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
    for (let i = 0; i < 20; i++) {
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

  get recebidos(): ServerFrame[] {
    return [...this.#todos]
  }

  close(): void {
    this.#socket.close()
  }
}

async function portoLivre(): Promise<number> {
  const { createSocket } = await import("node:dgram")
  const socket = createSocket("udp4")
  await new Promise<void>((pronto) => socket.bind(0, "127.0.0.1", pronto))
  const porto = socket.address().port
  await new Promise<void>((pronto) => socket.close(() => pronto()))
  return porto
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-sfu-uma-"))
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

async function entrar(): Promise<{ client: TestClient; address: string }> {
  const client = await TestClient.connect(gatewayUrl)
  const identity = generateIdentity(HOME)
  // With `commit-after-echo`, like today's clients: without it the server does not
  // accept the Welcome with which the host seats the others (see `sentarPorConvite`).
  client.send({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
  await client.nextOf("hello.ok")
  client.send({ t: "auth.begin", address: identity.address, signingKey: toBase64(identity.signingPublicKey) })
  const challenge = await client.nextOf("auth.challenge")
  client.send({ t: "auth.finish", signature: toBase64(sign(identity, fromBase64(challenge.nonce))) })
  await client.nextOf("auth.ok")
  return { client, address: identity.address }
}

// A new opaque address: the 1.0 server no longer creates `!<nome>`.
const novoCanal = (): string => moradaDeSala(HOME)
const ambitoDe = (nome: string): string => createHash("sha256").update(nome).digest("base64url")

async function sentarPorConvite(host: TestClient, guest: { client: TestClient; address: string }, channel: string): Promise<void> {
  // With the code proof, as 1.0 redeems (slice 6a): the hash alone does not get in.
  const convite = conviteComProva()
  host.send({ t: "invite.create", channel, ...convite.criar, expiresAt: null, maxUses: 1 })
  await host.nextOf("invite.created")
  guest.client.send(convite.resgate(guest.address))
  await host.nextOf("invite.request")
  // Redemption is a request, not a seat (INV-01): the seat comes from the
  // targeted Welcome from someone already there, which is what a member sends
  // when admitting.
  host.send({ t: "channel.send", channel, kind: "welcome", ciphertext: toBase64(crypto.getRandomValues(new Uint8Array(64))), recipient: guest.address })
  await guest.client.nextOf("channel.event")
  guest.client.send({ t: "channel.subscribe", channels: [channel] })
  await guest.client.sync()
}

const VOZ = {
  codecs: [
    {
      mimeType: "audio/opus",
      payloadType: 100,
      clockRate: 48000,
      channels: 2,
      parameters: { usedtx: 1 },
      rtcpFeedback: [],
    },
  ],
  headerExtensions: [],
  encodings: [{ ssrc: 0 }],
  rtcp: { cname: "teste" },
}


type Identidade = ReturnType<typeof generateIdentity>

/** Log in one device of an account, with the chain, as every client since August 11. */
async function ligarAparelho(identity: Identidade): Promise<TestClient> {
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
  const challenge = await client.nextOf("auth.challenge")
  client.send({ t: "auth.finish", signature: toBase64(signWithDevice(identity, fromBase64(challenge.nonce))) })
  await client.nextOf("auth.ok")
  return client
}

/**
 * An account with two devices (two device keys, one account key), both seated
 * in a new channel, and a third person in the same channel to watch the call.
 */
async function contaComDoisAparelhos(): Promise<{
  canal: string
  primeiro: TestClient
  segundo: TestClient
  terceiro: { client: TestClient; address: string }
}> {
  const conta = generateIdentity(HOME)
  const outroAparelho = identityFromPrivateKey(conta.signingPrivateKey, HOME)
  const primeiro = await ligarAparelho(conta)
  const segundo = await ligarAparelho(outroAparelho)
  const canal = novoCanal()
  primeiro.send({ t: "channel.subscribe", channels: [canal] })
  await primeiro.sync()
  segundo.send({ t: "channel.subscribe", channels: [canal] })
  await segundo.sync()
  const terceiro = await entrar()
  await sentarPorConvite(primeiro, terceiro, canal)
  return { canal, primeiro, segundo, terceiro }
}

/** Join, open the send transport, and put a voice producer on the air. */
async function entrarEFalar(client: TestClient, canal: string, escopo: string, ssrc: number, tomar = false): Promise<string> {
  client.send({ t: "sfu.scope.join", channel: canal, scope: escopo, ...(tomar ? { tomar: true } : {}) })
  await client.nextOf("sfu.scope.joined")
  client.send({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" })
  const envio = await client.nextOf("sfu.transport.created")
  client.send({ t: "sfu.produce", transport: envio.transport, kind: "audio", rtpParameters: { ...VOZ, encodings: [{ ssrc }] }, fonte: "microfone" })
  return (await client.nextOf("sfu.produced")).producer
}

const fechos = (client: TestClient): Extract<ServerFrame, { t: "sfu.scope.closed" }>[] =>
  client.recebidos.filter((frame): frame is Extract<ServerFrame, { t: "sfu.scope.closed" }> => frame.t === "sfu.scope.closed")

describe("uma chamada por conta", () => {
  it("o outro aparelho entra noutra sala: a chamada do primeiro fecha no servidor, e ele é avisado", async () => {
    const { canal, primeiro, segundo, terceiro } = await contaComDoisAparelhos()
    const salaA = ambitoDe("sala-a")
    const salaB = ambitoDe("sala-b")

    terceiro.client.send({ t: "sfu.scope.join", channel: canal, scope: salaA })
    await terceiro.client.nextOf("sfu.scope.joined")
    const produtor = await entrarEFalar(primeiro, canal, salaA, 300_001)

    segundo.send({ t: "sfu.scope.join", channel: canal, scope: salaB })
    await segundo.nextOf("sfu.scope.joined")

    const fecho = await primeiro.nextOf("sfu.scope.closed")
    expect(fecho).toMatchObject({ channel: canal, scope: salaA, reason: "noutro-aparelho", mesmaChamada: false })

    // The others in room A stop hearing the first device.
    await terceiro.client.sync()
    expect(terceiro.client.recebidos.some((frame) => frame.t === "sfu.producer.closed" && frame.producer === produtor)).toBe(true)

    // And on the server the first device is no longer in the call: no transport for it.
    primeiro.send({ t: "sfu.transport.create", channel: canal, scope: salaA, direction: "recepcao" })
    expect((await primeiro.nextOf("sfu.error")).code).toBe("fora-da-chamada")
    // The device that joined is not told anything.
    await segundo.sync()
    expect(fechos(segundo)).toEqual([])

    for (const cada of [primeiro, segundo, terceiro.client]) cada.close()
  })

  it("o outro aparelho entra na MESMA sala: o primeiro sai, e o aviso diz que a conta continua na chamada", async () => {
    const { canal, primeiro, segundo, terceiro } = await contaComDoisAparelhos()
    const sala = ambitoDe("geral")
    terceiro.client.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    await terceiro.client.nextOf("sfu.scope.joined")
    const doPrimeiro = await entrarEFalar(primeiro, canal, sala, 300_011)

    const doSegundo = await entrarEFalar(segundo, canal, sala, 300_012)
    const fecho = await primeiro.nextOf("sfu.scope.closed")
    expect(fecho).toMatchObject({ channel: canal, scope: sala, reason: "noutro-aparelho", mesmaChamada: true })

    await terceiro.client.sync()
    expect(terceiro.client.recebidos.some((frame) => frame.t === "sfu.producer.closed" && frame.producer === doPrimeiro)).toBe(true)
    // A newcomer sees ONE stream of the account, the second device's.
    const quarto = await entrar()
    await sentarPorConvite(primeiro, quarto, canal)
    quarto.client.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    const entrada = await quarto.client.nextOf("sfu.scope.joined")
    expect(entrada.producers.map((cada) => cada.id).sort()).toEqual([doSegundo].sort())

    for (const cada of [primeiro, segundo, terceiro.client, quarto.client]) cada.close()
  })

  it("o aparelho que perdeu a chamada não a retoma sozinho: sem `tomar`, noutro-aparelho; com `tomar`, retoma-a", async () => {
    const { canal, primeiro, segundo, terceiro } = await contaComDoisAparelhos()
    const sala = ambitoDe("geral")
    primeiro.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    await primeiro.nextOf("sfu.scope.joined")
    segundo.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    await segundo.nextOf("sfu.scope.joined")
    await primeiro.nextOf("sfu.scope.closed")

    // The automatic join (resynchronisation, rebuild, or any join of a 1.3.24): refused.
    primeiro.send({ t: "sfu.scope.join", channel: canal, scope: sala, ref: "auto" })
    const recusa = await primeiro.nextOf("sfu.error")
    expect(recusa).toMatchObject({ code: "noutro-aparelho", ref: "auto" })
    await segundo.sync()
    expect(fechos(segundo)).toEqual([])

    // The gesture takes the call back, and now the second device is the one told.
    primeiro.send({ t: "sfu.scope.join", channel: canal, scope: sala, tomar: true })
    await primeiro.nextOf("sfu.scope.joined")
    expect(await segundo.nextOf("sfu.scope.closed")).toMatchObject({ scope: sala, mesmaChamada: true })

    for (const cada of [primeiro, segundo, terceiro.client]) cada.close()
  })

  it("um `tomar` cuja entrada falha no motor não tira a marca: a reconstrução a seguir continua recusada", async () => {
    const { canal, primeiro, segundo, terceiro } = await contaComDoisAparelhos()
    const sala = ambitoDe("geral")
    primeiro.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    await primeiro.nextOf("sfu.scope.joined")
    segundo.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    await segundo.nextOf("sfu.scope.joined")
    await primeiro.nextOf("sfu.scope.closed")

    // The gesture comes, and the engine refuses that one entry (a full call, a worker hiccup).
    const motor = enclave.media!
    const entrar = motor.entrar.bind(motor)
    motor.entrar = async () => {
      motor.entrar = entrar
      throw new RecusaDeMedia("chamada-cheia", "esta chamada está cheia")
    }
    primeiro.send({ t: "sfu.scope.join", channel: canal, scope: sala, tomar: true, ref: "gesto" })
    expect(await primeiro.nextOf("sfu.error")).toMatchObject({ code: "chamada-cheia", ref: "gesto" })

    // The device is still not in a call, and still marked: its automatic join is refused.
    primeiro.send({ t: "sfu.scope.join", channel: canal, scope: sala, ref: "auto" })
    expect(await primeiro.nextOf("sfu.error")).toMatchObject({ code: "noutro-aparelho", ref: "auto" })
    await segundo.sync()
    expect(fechos(segundo)).toEqual([])

    for (const cada of [primeiro, segundo, terceiro.client]) cada.close()
  })

  it("a marca é do aparelho: a mesma cópia ligada de novo continua sem retomar a chamada sozinha", async () => {
    const conta = generateIdentity(HOME)
    const outroAparelho = identityFromPrivateKey(conta.signingPrivateKey, HOME)
    const primeiro = await ligarAparelho(conta)
    const segundo = await ligarAparelho(outroAparelho)
    const canal = novoCanal()
    for (const cada of [primeiro, segundo]) {
      cada.send({ t: "channel.subscribe", channels: [canal] })
      await cada.sync()
    }
    const sala = ambitoDe("geral")
    primeiro.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    await primeiro.nextOf("sfu.scope.joined")
    segundo.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    await segundo.nextOf("sfu.scope.joined")
    await primeiro.nextOf("sfu.scope.closed")

    // The first device's socket drops and it comes back on a new one: its rebuild sends a plain join.
    primeiro.close()
    const deNovo = await ligarAparelho(conta)
    deNovo.send({ t: "channel.subscribe", channels: [canal] })
    await deNovo.sync()
    deNovo.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    expect((await deNovo.nextOf("sfu.error")).code).toBe("noutro-aparelho")

    // When the other device leaves its call, the first may join again without the gesture.
    segundo.send({ t: "sfu.scope.leave", channel: canal, scope: sala })
    await segundo.sync()
    deNovo.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    await deNovo.nextOf("sfu.scope.joined")
    await segundo.sync()
    expect(fechos(segundo)).toEqual([])

    for (const cada of [segundo, deNovo]) cada.close()
  })

  it("não confunde com a reconexão do mesmo aparelho: o socket antigo larga a chamada em silêncio", async () => {
    const conta = generateIdentity(HOME)
    const antigo = await ligarAparelho(conta)
    const canal = novoCanal()
    antigo.send({ t: "channel.subscribe", channels: [canal] })
    await antigo.sync()
    const sala = ambitoDe("geral")
    antigo.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    await antigo.nextOf("sfu.scope.joined")

    // The same device (same key) on a new socket, before the server saw the old one die.
    const novo = await ligarAparelho(conta)
    novo.send({ t: "channel.subscribe", channels: [canal] })
    await novo.sync()
    novo.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    await novo.nextOf("sfu.scope.joined")

    await antigo.sync()
    expect(fechos(antigo)).toEqual([])
    // Its presence is gone all the same, and the device is not marked: joining again works.
    antigo.send({ t: "sfu.transport.create", channel: canal, scope: sala, direction: "envio" })
    expect((await antigo.nextOf("sfu.error")).code).toBe("fora-da-chamada")
    novo.close()
    antigo.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    await antigo.nextOf("sfu.scope.joined")
    antigo.close()
  })

  it("não confunde com a ressincronização: o mesmo aparelho a pedir a mesma sala não fecha nada", async () => {
    const { canal, primeiro, segundo, terceiro } = await contaComDoisAparelhos()
    const sala = ambitoDe("geral")
    const produtor = await entrarEFalar(primeiro, canal, sala, 300_021)
    terceiro.client.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    await terceiro.client.nextOf("sfu.scope.joined")

    primeiro.send({ t: "sfu.scope.join", channel: canal, scope: sala })
    const outraVez = await primeiro.nextOf("sfu.scope.joined")
    expect(outraVez.producers.map((cada) => cada.id)).toContain(produtor)
    await terceiro.client.sync()
    expect(terceiro.client.recebidos.some((frame) => frame.t === "sfu.producer.closed")).toBe(false)
    expect(fechos(primeiro)).toEqual([])

    for (const cada of [primeiro, segundo, terceiro.client]) cada.close()
  })

  it("a mesma ligação noutra sala: a sala anterior fecha no servidor, sem aviso (é o próprio cliente a mudar)", async () => {
    const { canal, primeiro, segundo, terceiro } = await contaComDoisAparelhos()
    const salaA = ambitoDe("sala-a")
    const salaB = ambitoDe("sala-b")
    terceiro.client.send({ t: "sfu.scope.join", channel: canal, scope: salaA })
    await terceiro.client.nextOf("sfu.scope.joined")
    const produtor = await entrarEFalar(primeiro, canal, salaA, 300_031)

    // A modified client that joins room B and never sends the leave of room A.
    primeiro.send({ t: "sfu.scope.join", channel: canal, scope: salaB })
    await primeiro.nextOf("sfu.scope.joined")
    await terceiro.client.sync()
    expect(terceiro.client.recebidos.some((frame) => frame.t === "sfu.producer.closed" && frame.producer === produtor)).toBe(true)
    primeiro.send({ t: "sfu.transport.create", channel: canal, scope: salaA, direction: "envio" })
    expect((await primeiro.nextOf("sfu.error")).code).toBe("fora-da-chamada")
    expect(fechos(primeiro)).toEqual([])

    for (const cada of [primeiro, segundo, terceiro.client]) cada.close()
  })
})
