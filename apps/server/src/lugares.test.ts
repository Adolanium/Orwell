import { createChannel, rotateEpoch } from "@enclave/crypto"
import {
  generateIdentity,
  identityFromPrivateKey,
  moradaDeSala,
  signDeviceManifest,
  toBase64,
  type AccountIdentity,
  type ServerFrame,
} from "@enclave/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Cliente, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"
import { ContadoresDosLugares, LINHAS_DE_REGISTO_POR_MINUTO, type ContagemDosLugares } from "./lugares.js"

/**
 * Seat repairs as the server sees them (1.3.25, P4 and P8).
 *
 * P4: a claim that finds a device's pool EMPTY nudges that device. Before, only a claim
 * that spent a key package nudged, so the device that asked for a seat and had 0 keys
 * never heard it, and its seat failed with "no invite keys" until its next login.
 *
 * P8: `GET /_interno/canais`, numbers only, for loopback sockets only.
 */

let servidor: ServidorDeTeste | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await servidor?.fechar()
  servidor = undefined
})

async function levantar(): Promise<ServidorDeTeste> {
  servidor = await levantarServidor()
  return servidor
}

const pacotes = (n: number): string[] => Array.from({ length: n }, () => toBase64(crypto.getRandomValues(new Uint8Array(24))))

/** The manifest of an account, listing these devices, published by the first connection. */
async function publicarManifesto(lig: Cliente, conta: AccountIdentity, aparelhos: AccountIdentity[]): Promise<void> {
  const agora = Math.floor(Date.now() / 1000)
  lig.enviar({
    t: "manifest.publish",
    manifest: signDeviceManifest(conta.signingPrivateKey, {
      address: conta.address,
      version: 1,
      devices: aparelhos.map((a) => ({ deviceKey: a.deviceSigningPublicKey, addedAt: agora })),
      signedAt: agora,
    }),
  })
  expect((await lig.proximoDe("manifest.published")).ok).toBe(true)
  await lig.ateAoPong()
}

async function contagem(s: ServidorDeTeste, remoteAddress = "127.0.0.1", headers: Record<string, string> = {}) {
  return s.enclave.app.inject({ method: "GET", url: "/_interno/canais", remoteAddress, headers })
}

const avisos = (frames: ServerFrame[]) => frames.filter((f): f is Extract<ServerFrame, { t: "keypackage.low" }> => f.t === "keypackage.low")

describe("P4: uma reclamação que encontra a reserva vazia avisa o aparelho", () => {
  it("o pedido de lugar nomeia um aparelho com 0 chaves: esse aparelho, ligado, recebe keypackage.low", async () => {
    const s = await levantar()
    const telemovel = generateIdentity(s.casa)
    const ligT = await Cliente.ligarComCadeia(s.url, telemovel)
    await publicarManifesto(ligT, telemovel, [telemovel])
    // The login nudge (0 keys) is already read by `ligarComCadeia`'s pong. Nothing published since.
    const quemResponde = await Cliente.ligarComCadeia(s.url, generateIdentity(s.casa))
    quemResponde.enviar({
      t: "keypackage.claim",
      address: telemovel.address,
      bundle: true,
      devices: [toBase64(telemovel.deviceSigningPublicKey)],
    })
    const resposta = await quemResponde.proximoDe("keypackage.claimed")
    expect(resposta.keyPackage).toBeNull()
    expect(resposta.keyPackages).toEqual([])
    expect(avisos(await ligT.ateAoPong())).toEqual([{ t: "keypackage.low", remaining: 0 }])
    ligT.fechar()
    quemResponde.fechar()
  }, 20_000)

  it("um convite (sem `bundle`) a uma conta sem chaves também avisa os aparelhos ligados", async () => {
    const s = await levantar()
    const alvo = generateIdentity(s.casa)
    const ligA = await Cliente.ligarComCadeia(s.url, alvo)
    const quemConvida = await Cliente.ligarComCadeia(s.url, generateIdentity(s.casa))
    quemConvida.enviar({ t: "keypackage.claim", address: alvo.address, bundle: false })
    expect((await quemConvida.proximoDe("keypackage.claimed")).keyPackage).toBeNull()
    expect(avisos(await ligA.ateAoPong())).toEqual([{ t: "keypackage.low", remaining: 0 }])
    ligA.fechar()
    quemConvida.fechar()
  }, 20_000)

  it("a reclamação vazia em rajada continua travada: um só aviso na janela, e ao repor o seguinte abre", async () => {
    const s = await levantar()
    const alvo = generateIdentity(s.casa)
    const ligA = await Cliente.ligarComCadeia(s.url, alvo)
    const atacante = await Cliente.ligarComCadeia(s.url, generateIdentity(s.casa))
    for (let i = 0; i < 20; i++) atacante.enviar({ t: "keypackage.claim", address: alvo.address, bundle: false })
    for (let i = 0; i < 20; i++) await atacante.proximoDe("keypackage.claimed")
    expect(avisos(await ligA.ateAoPong())).toHaveLength(1)
    // It tops up: the window opens again at once (as for a claim that spends).
    ligA.enviar({ t: "keypackage.publish", packages: pacotes(1), replace: false })
    await ligA.ateAoPong()
    atacante.enviar({ t: "keypackage.claim", address: alvo.address, bundle: false })
    atacante.enviar({ t: "keypackage.claim", address: alvo.address, bundle: false })
    await atacante.proximoDe("keypackage.claimed")
    await atacante.proximoDe("keypackage.claimed")
    expect(avisos(await ligA.ateAoPong()).length).toBeGreaterThanOrEqual(1)
    ligA.fechar()
    atacante.fechar()
  }, 20_000)

  it("desligado no momento: o aviso chega no login seguinte, com a reserva a zero", async () => {
    const s = await levantar()
    const alvo = generateIdentity(s.casa)
    const ligA = await Cliente.ligarComCadeia(s.url, alvo)
    ligA.enviar({ t: "keypackage.publish", packages: pacotes(1), replace: true })
    await ligA.ateAoPong()
    ligA.fechar()
    await ligA.fechado()
    const outro = await Cliente.ligarComCadeia(s.url, generateIdentity(s.casa))
    outro.enviar({ t: "keypackage.claim", address: alvo.address, bundle: false })
    expect((await outro.proximoDe("keypackage.claimed")).keyPackage).not.toBeNull()
    outro.fechar()
    // The nudge comes right after auth.ok.
    const outraVez = await Cliente.ligarComCadeia(s.url, alvo)
    expect(avisos(outraVez.aoEntrar)).toEqual([{ t: "keypackage.low", remaining: 0 }])
    outraVez.fechar()
  }, 20_000)
})

describe("P8: GET /_interno/canais", () => {
  it("só responde a um socket em loopback; X-Forwarded-For não conta; nunca sob /_enclave/", async () => {
    const s = await levantar()
    const dentro = await contagem(s)
    expect(dentro.statusCode).toBe(200)
    expect(dentro.headers["cache-control"]).toBe("no-store")
    for (const remoteAddress of ["203.0.113.7", "10.0.0.2", "172.18.0.1"]) {
      expect((await contagem(s, remoteAddress)).statusCode).toBe(404)
      expect((await contagem(s, remoteAddress, { "x-forwarded-for": "127.0.0.1" })).statusCode).toBe(404)
    }
    const naRotaPublica = await s.enclave.app.inject({ method: "GET", url: "/_enclave/_interno/canais", remoteAddress: "127.0.0.1" })
    expect(naRotaPublica.statusCode).toBe(404)
  })

  it("conta pedidos de lugar, respondidos, reclamações sem chave, avisos e recusas por época, sem endereços", async () => {
    const s = await levantar()
    const linhas: string[] = []
    vi.spyOn(process.stderr, "write").mockImplementation((texto: string | Uint8Array) => {
      linhas.push(String(texto))
      return true
    })
    const pc = generateIdentity(s.casa)
    const telemovel = identityFromPrivateKey(pc.signingPrivateKey, s.casa)
    const canal = moradaDeSala(s.casa)
    const ligPc = await Cliente.ligarComCadeia(s.url, pc)
    const ligT = await Cliente.ligarComCadeia(s.url, telemovel)
    await publicarManifesto(ligPc, pc, [pc, telemovel])

    // Epoch 0 to 1 accepted, then a second commit for epoch 0: refused, `stale-epoch`.
    let grupo = await createChannel(pc, canal)
    const primeiro = await rotateEpoch(grupo)
    const ramo = await rotateEpoch(grupo)
    grupo = primeiro.session
    ligPc.enviar({ t: "channel.subscribe", channels: [canal] })
    await ligPc.ateAoPong()
    ligT.enviar({ t: "channel.subscribe", channels: [canal] })
    await ligT.ateAoPong()
    ligPc.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(primeiro.commits[0] as Uint8Array), ref: "c1" })
    await ligPc.ateAoPong()
    ligPc.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(ramo.commits[0] as Uint8Array), ref: "c2" })
    expect(await ligPc.proximoDe("channel.rejected")).toMatchObject({ reason: "stale-epoch" })

    // The phone asks for a seat; the computer claims its keys (none) and then sends a Welcome.
    ligT.enviar({ t: "channel.rejoin.request", channel: canal })
    await ligT.proximoDe("channel.rejoin.sent")
    ligPc.enviar({ t: "keypackage.claim", address: pc.address, bundle: true, devices: [toBase64(telemovel.deviceSigningPublicKey)] })
    expect((await ligPc.proximoDe("keypackage.claimed")).keyPackages).toEqual([])
    ligPc.enviar({ t: "channel.send", channel: canal, kind: "welcome", recipient: pc.address, ciphertext: toBase64(new Uint8Array(64).fill(3)), ref: "w1" })
    await ligPc.ateAoPong()
    await ligT.ateAoPong()

    const resposta = await contagem(s)
    const corpo = resposta.json() as ContagemDosLugares
    expect(corpo.v).toBe(1)
    expect(corpo.contagens.pedidos).toEqual({ ultimaHora: 1, ultimas24h: 1 })
    expect(corpo.contagens.pedidosSemOuvintes.ultimaHora).toBe(0)
    expect(corpo.contagens.respondidos).toEqual({ ultimaHora: 1, ultimas24h: 1 })
    expect(corpo.contagens.semChave).toEqual({ ultimaHora: 1, ultimas24h: 1 })
    // The claim came right after the account's seat request (1.3.26).
    expect(corpo.contagens.semChaveEmPedido).toEqual({ ultimaHora: 1, ultimas24h: 1 })
    expect(corpo.contagens.recusasPorEpoca).toEqual({ ultimaHora: 1, ultimas24h: 1 })
    // Two logins at 0 keys, and the phone after the empty claim.
    expect(corpo.contagens.avisosDeChaves.ultimaHora).toBeGreaterThanOrEqual(3)
    // Numbers only: no address, device or channel anywhere in the answer.
    for (const proibido of [pc.address, canal, toBase64(telemovel.deviceSigningPublicKey), toBase64(pc.deviceSigningPublicKey)]) {
      expect(resposta.body).not.toContain(proibido)
    }

    // One log line for the failed reseat, with no address, channel, device or IP.
    const registo = linhas.filter((l) => l.includes("reseat-failed"))
    expect(registo).toEqual(["enclave: reseat-failed: no key package (devices asked 1, served 0)\n"])
    for (const proibido of [pc.address, canal, toBase64(telemovel.deviceSigningPublicKey), "127.0.0.1"]) {
      expect(registo.join("")).not.toContain(proibido)
    }
    ligPc.fechar()
    ligT.fechar()
  }, 30_000)
})

describe("P8, mais claro (1.3.26)", () => {
  it("a mesma reclamação vazia três vezes seguidas (as tentativas do cliente) conta uma vez e escreve uma linha", async () => {
    const s = await levantar()
    const linhas: string[] = []
    vi.spyOn(process.stderr, "write").mockImplementation((texto: string | Uint8Array) => {
      linhas.push(String(texto))
      return true
    })
    const pc = generateIdentity(s.casa)
    const telemovel = identityFromPrivateKey(pc.signingPrivateKey, s.casa)
    const ligPc = await Cliente.ligarComCadeia(s.url, pc)
    await publicarManifesto(ligPc, pc, [pc, telemovel])
    for (let i = 0; i < 3; i++) {
      ligPc.enviar({ t: "keypackage.claim", address: pc.address, bundle: true, devices: [toBase64(telemovel.deviceSigningPublicKey)] })
      expect((await ligPc.proximoDe("keypackage.claimed")).keyPackages).toEqual([])
    }
    const corpo = (await contagem(s)).json() as ContagemDosLugares
    expect(corpo.contagens.semChave.ultimaHora).toBe(1)
    // Nobody asked for a seat: not the P3 kind.
    expect(corpo.contagens.semChaveEmPedido.ultimaHora).toBe(0)
    expect(linhas.filter((l) => l.includes("reseat-failed"))).toHaveLength(1)
    ligPc.fechar()
  }, 20_000)
})

describe("ContadoresDosLugares", () => {
  it("uma tentativa repetida não conta, outra reclamação sim, e só a que vem depois de um pedido da conta é `semChaveEmPedido`", () => {
    const contadores = new ContadoresDosLugares(() => {})
    const t = 90_000_000
    const de = (quem: string, alvo: string, aparelhos?: string[]) => ({ quem, alvo, aparelhos })
    contadores.semChave("reseat", 1, 0, t, de("c1", "@x", ["b", "a"]))
    contadores.semChave("reseat", 1, 0, t + 1_500, de("c1", "@x", ["a", "b"]))
    contadores.semChave("reseat", 1, 0, t + 3_000, de("c1", "@x", ["a", "b"]))
    // Another connection, another account, other devices: other claims.
    contadores.semChave("reseat", 1, 0, t + 3_000, de("c2", "@x", ["a", "b"]))
    contadores.semChave("reseat", 1, 0, t + 3_000, de("c1", "@x", ["a"]))
    contadores.semChave("convite", 0, 0, t + 3_000, de("c1", "@y"))
    // The same claim long after: a new claim.
    contadores.semChave("reseat", 1, 0, t + 3_000 + ContadoresDosLugares.REPETICAO_MS, de("c1", "@x", ["a", "b"]))
    // `@y` asks for a seat; a claim for `@y` 10 s later is the P3 kind, one 40 s later is not.
    contadores.pedido("!a", "@y", 1, t + 20_000)
    contadores.semChave("convite", 0, 0, t + 30_000, de("c3", "@y"))
    contadores.semChave("convite", 0, 0, t + 60_000, de("c4", "@y"))
    const c = contadores.contagem(Math.floor((t + 60_000) / 60_000)).contagens
    expect(c.semChave.ultimaHora).toBe(7)
    expect(c.semChaveEmPedido.ultimaHora).toBe(1)
  })


  it("janela de uma hora e de 24 horas, e o que passou das 24 horas sai", () => {
    const contadores = new ContadoresDosLugares(() => {}, 1_000)
    contadores.notar("pedidos", 1_000)
    contadores.notar("pedidos", 1_000 + 30)
    contadores.notar("pedidos", 1_000 + 61)
    expect(contadores.contagem(1_000 + 61).contagens.pedidos).toEqual({ ultimaHora: 2, ultimas24h: 3 })
    expect(contadores.contagem(1_000 + 24 * 60).contagens.pedidos).toEqual({ ultimaHora: 0, ultimas24h: 2 })
    // A new minute prunes the ones past 24 hours.
    contadores.notar("semChave", 1_000 + 24 * 60 + 100)
    expect(contadores.contagem(1_000 + 24 * 60 + 100).contagens.pedidos.ultimas24h).toBe(0)
  })

  it("um Welcome só conta como resposta a um pedido da mesma conta no mesmo canal, dentro da janela", () => {
    const contadores = new ContadoresDosLugares(() => {})
    const t = 60_000_000
    contadores.welcome("!a", "@x", t)
    contadores.pedido("!a", "@x", 2, t)
    contadores.welcome("!b", "@x", t + 1)
    contadores.welcome("!a", "@y", t + 1)
    contadores.pedido("!c", "@x", 0, t)
    contadores.welcome("!c", "@x", t + ContadoresDosLugares.JANELA_DO_PEDIDO_MS + 1)
    contadores.welcome("!a", "@x", t + 5)
    contadores.welcome("!a", "@x", t + 6)
    const c = contadores.contagem(Math.floor(t / 60_000)).contagens
    expect(c.pedidos.ultimaHora).toBe(2)
    expect(c.pedidosSemOuvintes.ultimaHora).toBe(1)
    expect(c.respondidos.ultimaHora).toBe(1)
  })

  it("as linhas de registo têm tecto por minuto, e as caladas dizem-se numa linha", () => {
    const linhas: string[] = []
    const contadores = new ContadoresDosLugares((l) => linhas.push(l))
    const t = 120_000_000
    for (let i = 0; i < LINHAS_DE_REGISTO_POR_MINUTO + 5; i++) contadores.semChave("reseat", 1, 0, t)
    expect(linhas).toHaveLength(LINHAS_DE_REGISTO_POR_MINUTO)
    contadores.semChave("convite", 0, 0, t + 60_000)
    expect(linhas).toHaveLength(LINHAS_DE_REGISTO_POR_MINUTO + 2)
    expect(linhas[LINHAS_DE_REGISTO_POR_MINUTO]).toBe(`enclave: no-key-package: 5 more in minute ${t / 60_000}, not written`)
    expect(contadores.contagem(t / 60_000 + 1).contagens.semChave.ultimaHora).toBe(LINHAS_DE_REGISTO_POR_MINUTO + 6)
  })
})

describe("stale-epoch tied to the claim before it (layer A, 21/11/2026)", () => {
  it("counts the packages served, and a stale-epoch refusal on the connection that claimed within the window, with one line and no address", () => {
    const linhas: string[] = []
    const contadores = new ContadoresDosLugares((linha) => linhas.push(linha), 1_000)
    const agora = 1_000 * 60_000
    contadores.reclamou("ligacao-a", 2, agora)
    contadores.recusaPorEpoca("ligacao-a", agora + 5_000)
    // Another connection, with no claim behind it: a plain refusal.
    contadores.recusaPorEpoca("ligacao-b", agora + 6_000)
    // The same connection, past the window: plain too.
    contadores.recusaPorEpoca("ligacao-a", agora + ContadoresDosLugares.RECUSA_DEPOIS_DE_RECLAMAR_MS + 10_000)
    const { contagens } = contadores.contagem(1_001)
    expect(contagens.pacotesServidos.ultimaHora).toBe(2)
    expect(contagens.recusasPorEpoca.ultimaHora).toBe(3)
    expect(contagens.recusasDepoisDeReclamar.ultimaHora).toBe(1)
    expect(linhas).toEqual(["enclave: stale-epoch-after-claim: commit refused 5 s after 2 key package(s) were claimed on the same connection"])
    expect(linhas.join("\n")).not.toMatch(/ligacao|@|\d+\.\d+\.\d+\.\d+/)
  })
})
