import {
  APARELHOS_POR_CONTA,
  CAPACIDADE_APARELHOS,
  ClientFrame,
  generateDeviceKey,
  generateIdentity,
  identityFromPrivateKey,
  parseServerName,
  signDeviceManifest,
  toBase64,
  verifyDeviceManifest,
  type DeviceManifestWire,
  type ServerFrame,
} from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import {
  ERRO_CONTA_CHEIA_NO_IMPORTAR,
  ERRO_FICHEIRO_DE_APARELHO_REVOGADO,
  ERRO_PASSAGEM_RECUSADA,
  TRAMAS_DA_PASSAGEM,
  fazerPassagem,
  type PedidoDePassagem,
  type SocketDaPassagem,
} from "./passagem.js"

/**
 * The handover connection of an imported account file (`passagem.ts`), against a
 * scripted server. What these hold: the only frames that leave are hello, login,
 * read the manifest and publish it (with the new key ADDED, never one taken out);
 * never `assumirPosse`; a full account and a removed device refuse with their own
 * sentence; and the socket always closes.
 */

const CASA = parseServerName("localhost")

/** A scripted server over a fake socket. `aoReceber` answers each client frame. */
class ServidorFalso implements SocketDaPassagem {
  readyState = 0
  enviadas: ClientFrame[] = []
  fechou = false
  #ouvintes = new Map<string, ((evento: { data: unknown }) => void)[]>()

  constructor(readonly aoReceber: (frame: ClientFrame, servidor: ServidorFalso) => void) {
    queueMicrotask(() => {
      this.readyState = 1
      this.#emitir("open")
    })
  }

  addEventListener(tipo: string, ouvinte: (evento: { data: unknown }) => void): void {
    this.#ouvintes.set(tipo, [...(this.#ouvintes.get(tipo) ?? []), ouvinte])
  }

  send(texto: string): void {
    // Every frame must parse as a client frame of the protocol: nothing made up here.
    const frame = ClientFrame.parse(JSON.parse(texto))
    this.enviadas.push(frame)
    queueMicrotask(() => this.aoReceber(frame, this))
  }

  responder(frame: ServerFrame): void {
    this.#emitir("message", { data: JSON.stringify(frame) })
  }

  close(): void {
    if (this.fechou) return
    this.fechou = true
    this.readyState = 3
    this.#emitir("close")
  }

  #emitir(tipo: string, evento: { data: unknown } = { data: undefined }): void {
    for (const ouvinte of this.#ouvintes.get(tipo) ?? []) ouvinte(evento)
  }
}

interface Cenario {
  capacidades?: string[]
  manifesto: DeviceManifestWire | null
  /** The answer to `manifest.publish`, by attempt. Default: accept. */
  veredicto?: (tentativa: number, manifest: DeviceManifestWire) => Extract<ServerFrame, { t: "manifest.published" }>
  /** Close the login with this error, after `auth.finish`. */
  erroNoLogin?: Extract<ServerFrame, { t: "error" }>
  /** Push this to the connection right after `auth.ok`, like the server does (`keypackage.low`). */
  depoisDoLogin?: ServerFrame[]
}

function conta(aparelhosExtra = 0) {
  const raiz = generateIdentity(CASA)
  const antigo = identityFromPrivateKey(raiz.signingPrivateKey, CASA)
  const outros = Array.from({ length: aparelhosExtra }, () => identityFromPrivateKey(raiz.signingPrivateKey, CASA))
  const nova = generateDeviceKey()
  const pedido: PedidoDePassagem = {
    address: antigo.address,
    homeserver: "localhost",
    chaveDaConta: raiz.signingPrivateKey.slice(),
    chaveDoAparelhoAntigo: antigo.deviceSigningPrivateKey.slice(),
    posse: 2,
    chaveNova: nova.publicKey,
    versaoVista: 3,
  }
  const manifesto = (version: number, aparelhos = [antigo, ...outros]) =>
    signDeviceManifest(raiz.signingPrivateKey, {
      address: antigo.address,
      version,
      devices: aparelhos.map((aparelho, i) => ({ deviceKey: aparelho.deviceSigningPublicKey, addedAt: 100 + i })),
      signedAt: 100,
    })
  return { raiz, antigo, outros, nova, pedido, manifesto }
}

function correr(pedido: PedidoDePassagem, cenario: Cenario) {
  let tentativa = 0
  let publicado: DeviceManifestWire | null = cenario.manifesto
  const servidor = new ServidorFalso((frame, s) => {
    switch (frame.t) {
      case "hello":
        s.responder({ t: "hello.ok", version: 1, server: CASA, capabilities: cenario.capacidades ?? [CAPACIDADE_APARELHOS], retentionDays: 30 } as ServerFrame)
        return
      case "auth.begin":
        s.responder({ t: "auth.challenge", nonce: toBase64(new Uint8Array(32).fill(7)) })
        return
      case "auth.finish":
        if (cenario.erroNoLogin) {
          s.responder(cenario.erroNoLogin)
          s.close()
          return
        }
        s.responder({ t: "auth.ok", address: pedido.address, posse: 2 })
        for (const extra of cenario.depoisDoLogin ?? []) s.responder(extra)
        return
      case "manifest.get":
        s.responder({ t: "manifest.result", address: frame.address, manifest: publicado })
        return
      case "manifest.publish": {
        const veredicto = cenario.veredicto?.(tentativa++, frame.manifest) ?? {
          t: "manifest.published" as const,
          address: frame.manifest.address,
          version: frame.manifest.version,
          ok: true,
        }
        if (veredicto.ok) publicado = frame.manifest
        s.responder(veredicto)
        return
      }
      default:
        throw new Error(`the handover sent ${frame.t}`)
    }
  })
  const resultado = fazerPassagem(pedido, { url: "ws://falso", abrir: () => servidor, prazoMs: 2_000, agora: () => 500_000 })
  return { servidor, resultado, publicado: () => publicado }
}

function tiposEnviados(servidor: ServidorFalso): string[] {
  return servidor.enviadas.map((frame) => frame.t)
}

describe("a ligação de passagem", () => {
  it("só lê e publica o manifesto, com a chave nova acrescentada, e fecha", async () => {
    const { pedido, manifesto, antigo, outros, nova } = conta(1)
    const { servidor, resultado, publicado } = correr(pedido, {
      manifesto: manifesto(4),
      depoisDoLogin: [{ t: "keypackage.low", remaining: 0 }],
    })
    expect(await resultado).toEqual({ versao: 5 })
    expect(tiposEnviados(servidor)).toEqual(["hello", "auth.begin", "auth.finish", "manifest.get", "manifest.publish"])
    for (const t of tiposEnviados(servidor)) expect(TRAMAS_DA_PASSAGEM.has(t as ClientFrame["t"])).toBe(true)
    expect(servidor.fechou).toBe(true)

    // The login is the OLD device's, with its generation, and never asks for possession.
    const begin = servidor.enviadas.find((frame) => frame.t === "auth.begin")
    expect(begin).toMatchObject({ signingKey: toBase64(antigo.deviceSigningPublicKey), address: antigo.address })
    const finish = servidor.enviadas.find((frame) => frame.t === "auth.finish")
    expect(finish).toMatchObject({ posse: 2 })
    expect(finish).not.toHaveProperty("assumirPosse")
    // The hello promises nothing: no signals, no live manifest, no encrypted vault.
    expect(servidor.enviadas[0]).not.toHaveProperty("capabilities")

    // Everyone stays, in their order, and the new key comes last. Signed by the account.
    const novo = publicado()!
    expect(verifyDeviceManifest(novo).ok).toBe(true)
    expect(novo.devices.map((device) => device.deviceKey)).toEqual([
      toBase64(antigo.deviceSigningPublicKey),
      toBase64(outros[0]!.deviceSigningPublicKey),
      toBase64(nova.publicKey),
    ])
    expect(novo.devices.slice(0, 2).map((device) => device.addedAt)).toEqual([100, 101])
  })

  it("nunca manda trama de canal, de chaves, de sframe ou de sinal: a porta de saída recusa", async () => {
    const { pedido, manifesto } = conta()
    const { servidor, resultado } = correr(pedido, { manifesto: manifesto(4) })
    await resultado
    const proibidas = [
      "channel.subscribe",
      "channel.send",
      "channel.backfill",
      "channel.sinal",
      "keypackage.publish",
      "keypackage.claim",
      "welcome.resync",
      "channel.rejoin.request",
      "presence.set",
      "cofre.put",
    ]
    for (const t of proibidas) {
      expect(TRAMAS_DA_PASSAGEM.has(t as ClientFrame["t"])).toBe(false)
      expect(tiposEnviados(servidor)).not.toContain(t)
    }
    expect([...TRAMAS_DA_PASSAGEM].sort()).toEqual(["auth.begin", "auth.finish", "hello", "manifest.get", "manifest.publish"])
  })

  it("conta cheia: recusa com a frase própria e não publica nada", async () => {
    const { pedido, manifesto } = conta(APARELHOS_POR_CONTA - 1)
    const { servidor, resultado } = correr(pedido, { manifesto: manifesto(4) })
    await expect(resultado).rejects.toThrow(ERRO_CONTA_CHEIA_NO_IMPORTAR)
    expect(tiposEnviados(servidor)).not.toContain("manifest.publish")
    expect(servidor.fechou).toBe(true)
  })

  it("o aparelho do ficheiro já saiu da conta: o servidor recusa o login, e a frase diz isso", async () => {
    const { pedido, manifesto } = conta()
    const { servidor, resultado } = correr(pedido, {
      manifesto: manifesto(4),
      erroNoLogin: { t: "error", code: "device-revoked", message: "this device was removed from the account", fatal: true },
    })
    await expect(resultado).rejects.toThrow(ERRO_FICHEIRO_DE_APARELHO_REVOGADO)
    expect(tiposEnviados(servidor)).toEqual(["hello", "auth.begin", "auth.finish"])
  })

  it("o aparelho do ficheiro já não está no manifesto: recusa sem publicar", async () => {
    const { pedido, manifesto, outros } = conta(1)
    const { servidor, resultado } = correr(pedido, { manifesto: manifesto(4, outros) })
    await expect(resultado).rejects.toThrow(ERRO_FICHEIRO_DE_APARELHO_REVOGADO)
    expect(tiposEnviados(servidor)).not.toContain("manifest.publish")
  })

  it("o servidor diz not-yours (N-01): é o mesmo que um aparelho tirado", async () => {
    const { pedido, manifesto } = conta()
    const { resultado } = correr(pedido, {
      manifesto: manifesto(4),
      veredicto: (_t, m) => ({ t: "manifest.published", address: m.address, version: m.version, ok: false, reason: "not-yours" }),
    })
    await expect(resultado).rejects.toThrow(ERRO_FICHEIRO_DE_APARELHO_REVOGADO)
  })

  it("stale-version: lê outra vez e publica por cima da versão nova", async () => {
    const { pedido, manifesto } = conta()
    const { servidor, resultado } = correr(pedido, {
      manifesto: manifesto(4),
      veredicto: (tentativa, m) =>
        tentativa === 0
          ? { t: "manifest.published", address: m.address, version: m.version, ok: false, reason: "stale-version" }
          : { t: "manifest.published", address: m.address, version: m.version, ok: true },
    })
    expect(await resultado).toEqual({ versao: 5 })
    expect(tiposEnviados(servidor).filter((t) => t === "manifest.get")).toHaveLength(2)
  })

  it("já lá está a chave nova (um importar que publicou e depois falhou): não publica outra vez", async () => {
    const { pedido, antigo, raiz } = conta()
    const comANova = signDeviceManifest(raiz.signingPrivateKey, {
      address: antigo.address,
      version: 6,
      devices: [
        { deviceKey: antigo.deviceSigningPublicKey, addedAt: 1 },
        { deviceKey: pedido.chaveNova, addedAt: 2 },
      ],
      signedAt: 2,
    })
    const { servidor, resultado } = correr(pedido, { manifesto: comANova })
    expect(await resultado).toEqual({ versao: 6 })
    expect(tiposEnviados(servidor)).not.toContain("manifest.publish")
  })

  it("um manifesto mais velho do que o que o ficheiro viu não serve de base", async () => {
    const { pedido, manifesto } = conta()
    const { servidor, resultado } = correr(pedido, { manifesto: manifesto(2) })
    await expect(resultado).rejects.toThrow(ERRO_PASSAGEM_RECUSADA)
    expect(tiposEnviados(servidor)).not.toContain("manifest.publish")
  })

  it("um manifesto que não verifica não serve de base", async () => {
    const { pedido, manifesto } = conta()
    const estragado = { ...manifesto(4), version: 9 }
    const { resultado } = correr(pedido, { manifesto: estragado })
    await expect(resultado).rejects.toThrow(ERRO_PASSAGEM_RECUSADA)
  })

  it("conta sem manifesto e ficheiro que nunca viu um: publica o primeiro, com os dois aparelhos", async () => {
    const { pedido, antigo, nova } = conta()
    const { resultado, publicado } = correr({ ...pedido, versaoVista: undefined }, { manifesto: null })
    expect(await resultado).toEqual({ versao: 1 })
    expect(publicado()!.devices.map((device) => device.deviceKey)).toEqual([
      toBase64(antigo.deviceSigningPublicKey),
      toBase64(nova.publicKey),
    ])
  })

  it("servidor sem manifestos: não entra com a chave antiga, nem publica", async () => {
    const { pedido } = conta()
    const { servidor, resultado } = correr(pedido, { manifesto: null, capacidades: [] })
    expect(await resultado).toEqual({ versao: null })
    expect(tiposEnviados(servidor)).toEqual(["hello"])
    expect(servidor.fechou).toBe(true)
  })

  it("sem resposta: falha com o prazo e fecha o socket", async () => {
    const { pedido } = conta()
    const servidor = new ServidorFalso(() => {})
    await expect(fazerPassagem(pedido, { url: "ws://falso", abrir: () => servidor, prazoMs: 50 })).rejects.toThrow(
      "the server did not answer in time",
    )
    expect(servidor.fechou).toBe(true)
  })
})
