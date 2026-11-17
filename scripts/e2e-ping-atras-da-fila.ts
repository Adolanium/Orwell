/**
 * A live client on a slow downlink is not cut while a large history page is
 * still on its way.
 *
 *   npx tsx scripts/e2e-ping-atras-da-fila.ts
 *
 * Real server, real gateway, real sockets. The control ping leaves through the
 * same TCP socket as the data, behind what is already queued, so its pong can
 * only come back after the client has received everything in front of it. A
 * history page has no byte ceiling, and a phone on 1 Mbit/s needs minutes for
 * a channel with a video. Counted as a missed pong, that ping cut a live
 * client mid-page; the client asked for the same page again and was cut again,
 * forever.
 *
 * Two accounts in one channel. "ana" writes twelve events of 2 MB (one history
 * page of about 32 MB in base64, a channel with a 25 MB video). "bia" asks for
 * that page twice: once directly, once through a TCP proxy that limits server
 * to client to `RITMO` bytes per second. Both answer pings (the `ws` default,
 * like every browser). The beat is shortened to `BATIMENTO_MS`, so the page
 * needs many beats to drain.
 *
 * The scale matters. The kernel buffers between the server and the proxy are
 * fixed in bytes (macOS autotunes each side up to 4 MB), and `bufferedAmount`
 * does not see them. In production, 8 MB of kernel buffer at 125 kB/s drains
 * in about 64 s, well inside `PINGS_SEM_PONG_SEM_MEDIA` beats of 30 s. Here
 * the page is larger than those buffers and the rate is such that they drain
 * in a few beats, the same ratio. A page that fits entirely in the kernel
 * buffers and takes longer than `PINGS_SEM_PONG_SEM_MEDIA` beats to drain
 * (for example `BATIMENTO_MS=200 RITMO=1000000 EVENTOS=6 TAMANHO=400000`) is
 * still cut: the server cannot tell it from a silent client.
 *
 * Pass criteria:
 *  1. direct: the page arrives and the socket stays open;
 *  2. slow: the page arrives and the socket stays open;
 *  3. slow: the page took longer than `PINGS_SEM_PONG_MAXIMOS` beats, so
 *     the old rule would have cut it.
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
import { createSocket } from "node:dgram"
import { mkdtempSync, rmSync } from "node:fs"
import { connect, createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { conviteComProva } from "../apps/server/testes/convite-com-prova.js"
import { buildServer } from "../apps/server/src/app.js"
import type { ServerConfig } from "../apps/server/src/config.js"
import { Gateway } from "../apps/server/src/gateway.js"

const BATIMENTO_MS = Number(process.env.BATIMENTO_MS ?? 500)
const RITMO = Number(process.env.RITMO ?? 4_000_000)
const EVENTOS = Number(process.env.EVENTOS ?? 12)
const TAMANHO = Number(process.env.TAMANHO ?? 2_000_000)
const PRAZO_LENTO_MS = 40_000

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

  static async ligar(url: string): Promise<Cliente> {
    const socket = new WebSocket(url, { autoPong: true, maxPayload: 64 * 1024 * 1024 })
    await new Promise<void>((pronto, falhou) => {
      socket.once("open", () => pronto())
      socket.once("error", falhou)
    })
    return new Cliente(socket)
  }

  enviar(frame: ClientFrame): void {
    this.socket.send(JSON.stringify(frame))
  }

  #proximo(ms: number): Promise<ServerFrame | null> {
    const ja = this.#fila.shift()
    if (ja) return Promise.resolve(ja)
    return new Promise((pronto) => {
      this.#aEspera.push(pronto)
      setTimeout(() => pronto(null), ms)
    })
  }

  async esperar<K extends ServerFrame["t"]>(tipo: K, ms = 4_000): Promise<Extract<ServerFrame, { t: K }>> {
    for (let i = 0; i < 400; i++) {
      const frame = await this.#proximo(ms)
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

/** Client to server passes freely; server to client at `bytesPorSegundo`. */
function proxyLento(destino: number, bytesPorSegundo: number): Server {
  return createServer((cliente) => {
    const servidor = connect(destino, "127.0.0.1")
    cliente.pipe(servidor)
    const fila: Buffer[] = []
    let naFila = 0
    servidor.on("data", (dados: Buffer) => {
      fila.push(dados)
      naFila += dados.length
      if (naFila > 65_536) servidor.pause()
    })
    const passo = Math.max(1, Math.floor(bytesPorSegundo / 50))
    const relogio = setInterval(() => {
      let resta = passo
      while (resta > 0 && fila.length > 0) {
        const dados = fila[0] as Buffer
        if (dados.length <= resta) {
          cliente.write(dados)
          fila.shift()
          resta -= dados.length
          naFila -= dados.length
        } else {
          cliente.write(dados.subarray(0, resta))
          fila[0] = dados.subarray(resta)
          naFila -= resta
          resta = 0
        }
      }
      if (naFila < 65_536) servidor.resume()
    }, 20)
    const fim = (): void => {
      clearInterval(relogio)
      cliente.destroy()
      servidor.destroy()
    }
    for (const lado of [cliente, servidor]) {
      lado.on("close", fim)
      lado.on("error", fim)
    }
  })
}

const dataDir = mkdtempSync(join(tmpdir(), "orwell-ping-fila-"))
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
let proxy: Server | null = null
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
  const servidorLento = proxyLento(porto, RITMO)
  proxy = servidorLento
  await new Promise<void>((pronto) => servidorLento.listen(0, "127.0.0.1", pronto))
  const directo = `ws://127.0.0.1:${porto}/_enclave/gateway`
  const lento = `ws://127.0.0.1:${(servidorLento.address() as { port: number }).port}/_enclave/gateway`

  async function entrar(url: string): Promise<{ cliente: Cliente; morada: string }> {
    const cliente = await Cliente.ligar(url)
    const identidade = generateIdentity(casa)
    cliente.enviar({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] })
    await cliente.esperar("hello.ok")
    cliente.enviar({ t: "auth.begin", address: identidade.address, signingKey: toBase64(identidade.signingPublicKey) })
    const desafio = await cliente.esperar("auth.challenge")
    cliente.enviar({ t: "auth.finish", signature: toBase64(sign(identidade, fromBase64(desafio.nonce))) })
    await cliente.esperar("auth.ok")
    return { cliente, morada: identidade.address }
  }

  const ana = await entrar(directo)
  const canal = moradaDeSala(casa)
  ana.cliente.enviar({ t: "channel.subscribe", channels: [canal] })
  await ana.cliente.acertar()

  async function sentar(convidado: { cliente: Cliente; morada: string }): Promise<void> {
    const convite = conviteComProva()
    ana.cliente.enviar({ t: "invite.create", channel: canal, ...convite.criar, expiresAt: null, maxUses: 1 })
    await ana.cliente.esperar("invite.created")
    convidado.cliente.enviar(convite.resgate(convidado.morada))
    await ana.cliente.esperar("invite.request")
    ana.cliente.enviar({ t: "channel.send", channel: canal, kind: "welcome", ciphertext: toBase64(crypto.getRandomValues(new Uint8Array(64))), recipient: convidado.morada })
    await convidado.cliente.esperar("channel.event", 8_000)
    convidado.cliente.enviar({ t: "channel.subscribe", channels: [canal] })
    await convidado.cliente.acertar()
  }

  async function pedirPagina(url: string, prazoMs: number): Promise<{ chegouEm: number | null; bytes: number; cliente: Cliente }> {
    const bia = await entrar(url)
    await sentar(bia)
    const antes = bia.cliente.todos.length
    const desde = Date.now()
    bia.cliente.enviar({ t: "channel.backfill", channel: canal, afterSeq: -1, limit: 200 })
    let pagina: { quando: number; frame: ServerFrame } | undefined
    while (Date.now() - desde < prazoMs && bia.cliente.fechadoEm === null) {
      pagina = bia.cliente.todos.slice(antes).find((cada) => cada.frame.t === "channel.backfill.page")
      if (pagina) break
      await new Promise((pronto) => setTimeout(pronto, 50))
    }
    return { chegouEm: pagina ? pagina.quando - desde : null, bytes: pagina ? JSON.stringify(pagina.frame).length : 0, cliente: bia.cliente }
  }

  // The history: one page of EVENTOS events of TAMANHO bytes.
  for (let i = 0; i < EVENTOS; i++) {
    const bytes = new Uint8Array(TAMANHO)
    for (let o = 0; o < TAMANHO; o += 65_536) crypto.getRandomValues(bytes.subarray(o, Math.min(TAMANHO, o + 65_536)))
    ana.cliente.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: toBase64(bytes) })
    // One at a time: the upload is not what is measured.
    await ana.cliente.acertar()
  }

  const rapida = await pedirPagina(directo, 3_000)
  linha(
    rapida.chegouEm !== null && rapida.cliente.fechadoEm === null,
    `directa: página ${rapida.chegouEm !== null ? `em ${rapida.chegouEm} ms, ${rapida.bytes} bytes` : "nunca chegou"}; socket ${rapida.cliente.fechadoEm === null ? "aberto" : "fechado pelo servidor"}`,
  )
  rapida.cliente.socket.terminate()

  const devagar = await pedirPagina(lento, PRAZO_LENTO_MS)
  linha(
    devagar.chegouEm !== null && devagar.cliente.fechadoEm === null,
    `lenta (${RITMO} B/s): página ${devagar.chegouEm !== null ? `em ${devagar.chegouEm} ms, ${devagar.bytes} bytes` : "nunca chegou"}; socket ${devagar.cliente.fechadoEm === null ? "aberto" : "fechado pelo servidor"}; ${devagar.cliente.pings} pings respondidos`,
  )
  const limiteAntigo = Gateway.PINGS_SEM_PONG_MAXIMOS * BATIMENTO_MS
  linha(
    devagar.chegouEm !== null && devagar.chegouEm > limiteAntigo,
    `a página lenta levou mais do que ${Gateway.PINGS_SEM_PONG_MAXIMOS} batimentos (${limiteAntigo} ms): o cenário mede o corte`,
  )
  devagar.cliente.socket.terminate()
  ana.cliente.socket.terminate()
} catch (erro) {
  linha(false, `o guião rebentou: ${String((erro as Error)?.stack ?? erro)}`)
} finally {
  proxy?.close()
  await enclave.close()
  rmSync(dataDir, { recursive: true, force: true })
}

process.exit(falhou ? 1 : 0)
