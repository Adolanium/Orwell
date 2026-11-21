import {
  CAPACIDADE_MANIFESTO_AO_VIVO,
  generateIdentity,
  identityFromPrivateKey,
  PROTOCOL_VERSION,
  signDeviceManifest,
  toBase64,
  type Identity,
} from "@enclave/protocol"
import { WebSocket } from "ws"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Cliente, COMMIT_DEPOIS_DO_ECO, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/**
 * `CAPACIDADE_MANIFESTO_AO_VIVO` (1.3.26): after a manifest the server accepts,
 * the OTHER live connections of the account that announced the capability get
 * it at once, as an unasked `manifest.result`. A connection that did not announce
 * it gets nothing it did not ask for.
 */

let servidor: ServidorDeTeste
const abertos: Cliente[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  for (const cliente of abertos.splice(0)) cliente.fechar()
})

afterAll(async () => {
  await servidor?.fechar()
})

function aparelhosDaConta(n: number): Identity[] {
  const conta = generateIdentity(servidor.casa)
  return Array.from({ length: n }, () => identityFromPrivateKey(conta.signingPrivateKey, servidor.casa))
}

function manifesto(aparelhos: readonly Identity[], version: number) {
  const primeiro = aparelhos[0]!
  if (!primeiro.signingPrivateKey) throw new Error("sem chave de conta")
  return signDeviceManifest(primeiro.signingPrivateKey, {
    address: primeiro.address,
    version,
    devices: aparelhos.map((aparelho) => ({ deviceKey: aparelho.deviceSigningPublicKey, addedAt: 1 })),
    signedAt: 1,
  })
}

describe("manifesto ao vivo", () => {
  it("o servidor anuncia a capacidade no hello.ok", async () => {
    const socket = new WebSocket(servidor.url)
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve())
      socket.once("error", reject)
    })
    const ola = new Promise<{ capabilities: string[] }>((resolve) =>
      socket.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString("utf8")) as { capabilities: string[] })),
    )
    socket.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION }))
    expect((await ola).capabilities).toContain(CAPACIDADE_MANIFESTO_AO_VIVO)
    socket.close()
  })

  it("chega às outras ligações da conta que o pediram, e só a essas", async () => {
    const [a, b, c, d] = aparelhosDaConta(4)
    const publicadora = await Cliente.ligarComCadeia(servidor.url, a!)
    abertos.push(publicadora)
    publicadora.enviar({ t: "manifest.publish", manifest: manifesto([a!, b!, c!], 1) })
    expect((await publicadora.proximoDe("manifest.published")).ok).toBe(true)

    const comCapacidade = await Cliente.ligarComCadeia(servidor.url, b!, {
      capacidades: [COMMIT_DEPOIS_DO_ECO, CAPACIDADE_MANIFESTO_AO_VIVO],
    })
    const semCapacidade = await Cliente.ligarComCadeia(servidor.url, c!)
    abertos.push(comCapacidade, semCapacidade)

    const novo = manifesto([a!, b!, c!, d!], 2)
    publicadora.enviar({ t: "manifest.publish", manifest: novo })
    expect((await publicadora.proximoDe("manifest.published")).ok).toBe(true)

    const chegou = await comCapacidade.proximoDe("manifest.result")
    expect(chegou.address).toBe(a!.address)
    expect(chegou.manifest?.version).toBe(2)
    expect(chegou.manifest?.signature).toBe(novo.signature)
    // The one that did not ask gets nothing; the publisher only its verdict.
    expect((await semCapacidade.ateAoPong()).filter((frame) => frame.t === "manifest.result")).toEqual([])
    expect((await publicadora.ateAoPong()).filter((frame) => frame.t === "manifest.result")).toEqual([])
  })

  it("um manifesto recusado não vai a ninguém", async () => {
    const [a, b] = aparelhosDaConta(2)
    const publicadora = await Cliente.ligarComCadeia(servidor.url, a!)
    abertos.push(publicadora)
    publicadora.enviar({ t: "manifest.publish", manifest: manifesto([a!, b!], 1) })
    expect((await publicadora.proximoDe("manifest.published")).ok).toBe(true)
    const ouvinte = await Cliente.ligarComCadeia(servidor.url, b!, {
      capacidades: [COMMIT_DEPOIS_DO_ECO, CAPACIDADE_MANIFESTO_AO_VIVO],
    })
    abertos.push(ouvinte)
    // The same version again: `stale-version`, nothing stored, nothing sent.
    publicadora.enviar({ t: "manifest.publish", manifest: manifesto([a!, b!], 1) })
    expect((await publicadora.proximoDe("manifest.published")).ok).toBe(false)
    expect((await ouvinte.ateAoPong()).filter((frame) => frame.t === "manifest.result")).toEqual([])
  })

  it("um aparelho que o manifesto tira não o recebe: recebe só o device-revoked, com a prova", async () => {
    const [a, b] = aparelhosDaConta(2)
    const publicadora = await Cliente.ligarComCadeia(servidor.url, a!)
    abertos.push(publicadora)
    publicadora.enviar({ t: "manifest.publish", manifest: manifesto([a!, b!], 1) })
    expect((await publicadora.proximoDe("manifest.published")).ok).toBe(true)
    const tirado = await Cliente.ligarComCadeia(servidor.url, b!, {
      capacidades: [COMMIT_DEPOIS_DO_ECO, CAPACIDADE_MANIFESTO_AO_VIVO],
    })
    abertos.push(tirado)
    publicadora.enviar({ t: "manifest.publish", manifest: manifesto([a!], 2), revoke: [toBase64(b!.deviceSigningPublicKey)] })
    expect((await publicadora.proximoDe("manifest.published")).ok).toBe(true)
    const primeiro = await tirado.proximo()
    expect(primeiro.t).toBe("error")
    expect(primeiro.t === "error" && primeiro.code).toBe("device-revoked")
  })
})
