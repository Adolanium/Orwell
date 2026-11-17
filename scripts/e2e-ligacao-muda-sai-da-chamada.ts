/**
 * A connection that stops answering leaves the call after two control pings;
 * a good one never leaves.
 *
 *   npx tsx scripts/e2e-ligacao-muda-sai-da-chamada.ts
 *
 * Real server, real gateway, real mediasoup worker, real sockets. No browser:
 * what is measured is the server side of the locked-screen case. A phone whose
 * page the system suspended answers nothing, and its TCP connection can stay up
 * for minutes. Before `Gateway.PINGS_SEM_PONG_MAXIMOS` the server kept it, and
 * the person's producer stayed in everyone's call.
 *
 * Three accounts in one channel, all in the same call, two of them producing:
 *  - "boa": answers pings (the `ws` default, like every browser);
 *  - "muda": `autoPong: false`, the suspended page;
 *  - "ouvinte": answers pings, and records what the server tells it.
 *
 * The beat is shortened to `BATIMENTO_MS` below. Pass criteria:
 *  1. "ouvinte" gets `sfu.producer.closed` for the producer of "muda", after
 *     exactly two unanswered pings and before the fourth beat;
 *  2. "muda" sees its socket closed by the server;
 *  3. over 25 beats, the producer of "boa" never closes and its socket stays open.
 *
 * Exits 0 on pass, 1 on fail, with one line per criterion.
 */
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
import { createSocket } from "node:dgram"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { conviteComProva } from "../apps/server/testes/convite-com-prova.js"
import { buildServer } from "../apps/server/src/app.js"
import type { ServerConfig } from "../apps/server/src/config.js"
import { Gateway } from "../apps/server/src/gateway.js"

const BATIMENTO_MS = 200

class Cliente {
  readonly todos: { quando: number; frame: ServerFrame }[] = []
  readonly #fila: ServerFrame[] = []
  readonly #aEspera: ((frame: ServerFrame | null) => void)[] = []
  pings = 0
  fechadoEm: number | null = null

  constructor(readonly socket: WebSocket) {
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      this.todos.push({ quando: Date.now(), frame })
      const esperando = this.#aEspera.shift()
      if (esperando) esperando(frame)
      else this.#fila.push(frame)
    })
    socket.on("ping", () => this.pings++)
    socket.on("close", () => (this.fechadoEm = Date.now()))
  }

  static async ligar(url: string, opcoes: { autoPong: boolean }): Promise<Cliente> {
    const socket = new WebSocket(url, { autoPong: opcoes.autoPong })
    await new Promise<void>((pronto, falhou) => {
      socket.once("open", () => pronto())
      socket.once("error", falhou)
    })
    return new Cliente(socket)
  }

  enviar(frame: ClientFrame): void {
    this.socket.send(JSON.stringify(frame))
  }

  #proximo(): Promise<ServerFrame | null> {
    const ja = this.#fila.shift()
    if (ja) return Promise.resolve(ja)
    return new Promise((pronto) => {
      this.#aEspera.push(pronto)
      setTimeout(() => pronto(null), 4_000)
    })
  }

  async esperar<K extends ServerFrame["t"]>(tipo: K): Promise<Extract<ServerFrame, { t: K }>> {
    for (let i = 0; i < 20; i++) {
      const frame = await this.#proximo()
      if (!frame) break
      if (frame.t === tipo) return frame as Extract<ServerFrame, { t: K }>
    }
    throw new Error(`nunca chegou ${tipo}`)
  }

  async acertar(): Promise<void> {
    this.enviar({ t: "ping" })
    await this.esperar("pong")
  }
}

async function portoUdpLivre(): Promise<number> {
  const socket = createSocket("udp4")
  await new Promise<void>((pronto) => socket.bind(0, "127.0.0.1", pronto))
  const porto = socket.address().port
  await new Promise<void>((pronto) => socket.close(() => pronto()))
  return porto
}

const dataDir = mkdtempSync(join(tmpdir(), "orwell-ligacao-muda-"))
const config: ServerConfig = {
  serverName: parseServerName("localhost"),
  bindHost: "127.0.0.1",
  bindPort: 0,
  dataDir,
  databasePath: join(dataDir, "teste.sqlite"),
  sfuPort: await portoUdpLivre(),
  sfuAnnouncedIp: "",
  retentionDays: 30,
  allowlist: [],
  turnUrls: [],
  turnSecret: "",
  turnTtl: 600,
  communityMode: false,
  commonRoom: "",
}

Gateway.BATIMENTO_MS = BATIMENTO_MS
const enclave = await buildServer(config)
let falhou = false
const linha = (ok: boolean, texto: string): void => {
  if (!ok) falhou = true
  console.log(`${ok ? "OK   " : "FALHA"} ${texto}`)
}

try {
  await enclave.app.listen({ host: config.bindHost, port: 0 })
  const porto = (enclave.app.server.address() as { port: number }).port
  const casa = parseServerName(`localhost:${porto}`)
  config.serverName = casa
  const url = `ws://127.0.0.1:${porto}/_enclave/gateway`

  async function entrar(autoPong: boolean): Promise<{ cliente: Cliente; morada: string }> {
    const cliente = await Cliente.ligar(url, { autoPong })
    const identidade = generateIdentity(casa)
    cliente.enviar({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
    await cliente.esperar("hello.ok")
    cliente.enviar({ t: "auth.begin", address: identidade.address, signingKey: toBase64(identidade.signingPublicKey) })
    const desafio = await cliente.esperar("auth.challenge")
    cliente.enviar({ t: "auth.finish", signature: toBase64(sign(identidade, fromBase64(desafio.nonce))) })
    await cliente.esperar("auth.ok")
    return { cliente, morada: identidade.address }
  }

  async function sentar(dono: Cliente, convidado: { cliente: Cliente; morada: string }, canal: string): Promise<void> {
    const convite = conviteComProva()
    dono.enviar({ t: "invite.create", channel: canal, ...convite.criar, expiresAt: null, maxUses: 1 })
    await dono.esperar("invite.created")
    convidado.cliente.enviar(convite.resgate(convidado.morada))
    await dono.esperar("invite.request")
    dono.enviar({ t: "channel.send", channel: canal, kind: "welcome", ciphertext: toBase64(crypto.getRandomValues(new Uint8Array(64))), recipient: convidado.morada })
    await convidado.cliente.esperar("channel.event")
    convidado.cliente.enviar({ t: "channel.subscribe", channels: [canal] })
    await convidado.cliente.acertar()
  }

  async function produzir(cliente: Cliente, canal: string, ambito: string, ssrc: number): Promise<string> {
    cliente.enviar({ t: "sfu.transport.create", channel: canal, scope: ambito, direction: "envio" })
    const transporte = await cliente.esperar("sfu.transport.created")
    cliente.enviar({
      t: "sfu.produce",
      transport: transporte.transport,
      kind: "audio",
      rtpParameters: {
        codecs: [{ mimeType: "audio/opus", payloadType: 100, clockRate: 48000, channels: 2, parameters: {}, rtcpFeedback: [] }],
        headerExtensions: [],
        encodings: [{ ssrc }],
        rtcp: { cname: `e2e-${ssrc}` },
      },
    })
    return (await cliente.esperar("sfu.produced")).producer
  }

  const boa = await entrar(true)
  const muda = await entrar(false)
  const ouvinte = await entrar(true)
  const canal = moradaDeSala(casa)
  const ambito = createHash("sha256").update("geral").digest("base64url")

  boa.cliente.enviar({ t: "channel.subscribe", channels: [canal] })
  await boa.cliente.acertar()
  await sentar(boa.cliente, muda, canal)
  await sentar(boa.cliente, ouvinte, canal)
  for (const quem of [boa, muda, ouvinte]) {
    quem.cliente.enviar({ t: "sfu.scope.join", channel: canal, scope: ambito })
    await quem.cliente.esperar("sfu.scope.joined")
  }
  const produtorBom = await produzir(boa.cliente, canal, ambito, 111)
  // The silent one produces while it can still talk: setup is not what is measured.
  const produtorMudo = await produzir(muda.cliente, canal, ambito, 222)
  const desde = Date.now()

  // 25 beats: plenty for the silent one to fall, and for the good one to prove it stays.
  await new Promise((pronto) => setTimeout(pronto, 25 * BATIMENTO_MS))

  const fechos = ouvinte.cliente.todos.filter((cada) => cada.frame.t === "sfu.producer.closed")
  const fechoDoMudo = fechos.find((cada) => (cada.frame as { producer: string }).producer === produtorMudo)
  const fechoDoBom = fechos.find((cada) => (cada.frame as { producer: string }).producer === produtorBom)
  const aposMs = fechoDoMudo ? fechoDoMudo.quando - desde : null

  linha(
    fechoDoMudo !== undefined && aposMs !== null && aposMs < 4 * BATIMENTO_MS,
    `a ligação muda sai da chamada: sfu.producer.closed ao fim de ${aposMs ?? "nunca"} ms (batimento ${BATIMENTO_MS} ms, limite ${4 * BATIMENTO_MS} ms)`,
  )
  linha(muda.cliente.pings === Gateway.PINGS_SEM_PONG_MAXIMOS, `a ligação muda recebeu ${muda.cliente.pings} pings sem responder (esperado ${Gateway.PINGS_SEM_PONG_MAXIMOS})`)
  linha(muda.cliente.fechadoEm !== null, "o servidor fechou o socket da ligação muda")
  linha(fechoDoBom === undefined, "o fluxo da ligação boa nunca fechou")
  linha(
    boa.cliente.socket.readyState === WebSocket.OPEN && boa.cliente.fechadoEm === null && boa.cliente.pings >= 20,
    `a ligação boa continua aberta, ${boa.cliente.pings} pings respondidos`,
  )
  linha(ouvinte.cliente.socket.readyState === WebSocket.OPEN, "o ouvinte continua aberto")

  for (const quem of [boa, muda, ouvinte]) quem.cliente.socket.terminate()
} catch (erro) {
  linha(false, `o guião rebentou: ${String((erro as Error)?.stack ?? erro)}`)
} finally {
  await enclave.close()
  rmSync(dataDir, { recursive: true, force: true })
}

process.exit(falhou ? 1 : 0)
