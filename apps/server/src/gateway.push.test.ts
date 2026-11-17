import {
  CALAR_PARA_SEMPRE,
  CAPACIDADE_WEB_PUSH,
  fromBase64,
  generateIdentity,
  identityFromPrivateKey,
  PROTOCOL_VERSION,
  signDeviceManifest,
  toBase64,
  type ClientFrame,
  type Identity,
} from "@enclave/protocol"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { currentMinute } from "./db.js"
import { SERVICOS_DE_PUSH } from "./config.js"
import { Cliente, COMMIT_DEPOIS_DO_ECO, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"
import { ServicoDePushFalso, type AparelhoDoPush } from "../testes/servico-de-push-falso.js"

/**
 * Web Push in the gateway, with real sockets and a fake push service that
 * checks VAPID and decrypts like a browser.
 *
 * What is measured, in POSTs that reach the push service: who gets woken (the
 * devices with no socket open, of the other accounts in the channel), who does
 * not (a connected device, the sender, a muted channel, a pause, the 2-minute
 * window, the daily cap, a revoked device), and that the subscription is the
 * connection's own and only with a device key.
 */

let servidor: ServidorDeTeste
let servico: ServicoDePushFalso
let dataDir: string

beforeAll(async () => {
  servico = new ServicoDePushFalso()
  await servico.arrancar()
  servidor = await levantarServidor({
    push: { contacto: "", servicos: [...SERVICOS_DE_PUSH, "push.test"], transporte: servico.transporte },
  })
  dataDir = join(servidor.baseDeDados, "..")
  servico.chaveDoServidor = servidor.enclave.push?.chavePublica ?? null
}, 30_000)

afterAll(async () => {
  await servidor?.fechar()
  await servico?.parar()
})

/** A connection with the device chain: it has a device key, so it may subscribe. */
function entrar(identidade: Identity): Promise<Cliente> {
  return Cliente.ligarComCadeia(servidor.url, identidade)
}

function subscricao(aparelho: AparelhoDoPush, extra: Partial<Extract<ClientFrame, { t: "push.subscribe" }>> = {}): ClientFrame {
  return {
    t: "push.subscribe",
    endpoint: aparelho.endpoint,
    p256dh: toBase64(aparelho.p256dh),
    auth: toBase64(aparelho.auth),
    lingua: "pt",
    silenciados: [],
    calarAte: 0,
    ...extra,
  }
}

async function subscrever(cliente: Cliente, aparelho: AparelhoDoPush, extra: Parameters<typeof subscricao>[1] = {}) {
  cliente.enviar(subscricao(aparelho, extra))
  return cliente.proximoDe("push.subscribed")
}

let contador = 0
function canalNovo(): string {
  return `!push-${++contador}-${Math.random().toString(36).slice(2, 8)}:${servidor.casa}`
}

/** Seat accounts in a channel the way the server remembers them: a subscription row. */
function sentar(canal: string, ...contas: Identity[]): void {
  for (const conta of contas) servidor.enclave.store.subscribe(canal, conta.address)
}

/** Send one application message and wait for its echo, then for the push queue. */
async function mensagem(cliente: Cliente, canal: string, kind: "application" | "handshake" = "application"): Promise<void> {
  cliente.enviar({ t: "channel.subscribe", channels: [canal] })
  cliente.enviar({ t: "channel.send", channel: canal, kind, ciphertext: toBase64(crypto.getRandomValues(new Uint8Array(40))) })
  await cliente.proximoDe("channel.event")
  await servidor.enclave.push?.carteiro.ocioso()
}

/** Close a connection and wait until the server has dropped it. */
async function desligar(cliente: Cliente): Promise<void> {
  const antes = servidor.enclave.gateway.connectionCount
  cliente.fechar()
  await cliente.fechado()
  for (let i = 0; i < 100 && servidor.enclave.gateway.connectionCount >= antes; i++) await new Promise((r) => setTimeout(r, 10))
}

/** An account with two devices: the computer and the phone. */
function conta(): { computador: Identity; telemovel: Identity } {
  const computador = generateIdentity(servidor.casa)
  return { computador, telemovel: identityFromPrivateKey(computador.signingPrivateKey, servidor.casa) }
}

/** A phone of `b` subscribed and then closed: the case the whole feature is for. */
async function telemovelFechado(b: Identity, extra: Parameters<typeof subscricao>[1] = {}): Promise<AparelhoDoPush> {
  const aparelho = servico.novoAparelho()
  const ligacao = await entrar(b)
  expect(await subscrever(ligacao, aparelho, extra)).toMatchObject({ ok: true })
  await desligar(ligacao)
  return aparelho
}

describe("capacidade e chave", () => {
  it("hello.ok anuncia web-push, e push.key dá a chave do push.key.json", async () => {
    const a = await entrar(generateIdentity(servidor.casa))
    a.enviar({ t: "push.key.get" })
    const chave = await a.proximoDe("push.key")
    expect(chave.publicKey).toBe(toBase64(servidor.enclave.push?.chavePublica as Uint8Array))
    expect(fromBase64(chave.publicKey as string)).toHaveLength(65)
    const ficheiro = join(dataDir, "push.key.json")
    expect(existsSync(ficheiro)).toBe(true)
    expect(JSON.parse(readFileSync(ficheiro, "utf8"))).toHaveProperty("privateKey")
    a.fechar()

    const b = await Cliente.ligar(servidor.url, generateIdentity(servidor.casa))
    b.enviar({ t: "hello", version: PROTOCOL_VERSION })
    expect((await b.proximoDe("hello.ok")).capabilities).toContain(CAPACIDADE_WEB_PUSH)
    b.fechar()
  })
})

describe("push.subscribe", () => {
  it("sem chave de aparelho é recusado: no-device", async () => {
    // `Cliente.ligar` logs in with the account key only, like the operator scripts.
    const semCadeia = await Cliente.ligar(servidor.url, generateIdentity(servidor.casa))
    expect(await subscrever(semCadeia, servico.novoAparelho())).toEqual({ t: "push.subscribed", ok: false, reason: "no-device" })
    semCadeia.fechar()
  })

  it("um endpoint fora da lista é recusado, e nada chega a ser guardado", async () => {
    const { computador } = conta()
    const a = await entrar(computador)
    const aparelho = servico.novoAparelho()
    for (const endpoint of ["https://169.254.169.254/x", "https://interno.casa.pt/x", "https://push.test:8443/x"]) {
      expect(await subscrever(a, aparelho, { endpoint })).toMatchObject({ ok: false, reason: "endpoint-not-allowed" })
    }
    expect(servidor.enclave.store.pushSubscriptionsDaConta(computador.address)).toHaveLength(0)
    a.fechar()
  })

  it("um p256dh fora da curva é recusado: bad-keys", async () => {
    const { computador } = conta()
    const a = await entrar(computador)
    const mau = new Uint8Array(65).fill(9)
    mau[0] = 4
    expect(await subscrever(a, servico.novoAparelho(), { p256dh: toBase64(mau) })).toMatchObject({ ok: false, reason: "bad-keys" })
    a.fechar()
  })

  it("guarda a linha do próprio aparelho, e uma segunda subscrição substitui-a", async () => {
    const { computador } = conta()
    const a = await entrar(computador)
    const um = servico.novoAparelho()
    const dois = servico.novoAparelho()
    expect(await subscrever(a, um)).toMatchObject({ ok: true })
    expect(await subscrever(a, dois, { lingua: "en" })).toMatchObject({ ok: true })
    const linhas = servidor.enclave.store.pushSubscriptionsDaConta(computador.address)
    expect(linhas.map((l) => [l.endpoint, l.lingua, toBase64(l.deviceKey)])).toEqual([
      [dois.endpoint, "en", toBase64(computador.deviceSigningPublicKey)],
    ])
    a.fechar()
  })
})

describe("quem acorda", () => {
  it("dois aparelhos da mesma conta, um ligado e um fechado: exactamente 1 POST, ao fechado, e decifra para pt", async () => {
    const ia = generateIdentity(servidor.casa)
    const a = await entrar(ia)
    const { computador, telemovel } = conta()
    const canal = canalNovo()
    sentar(canal, ia, computador)
    const computadorLigado = await entrar(computador)
    const doComputador = servico.novoAparelho()
    expect(await subscrever(computadorLigado, doComputador)).toMatchObject({ ok: true })
    computadorLigado.enviar({ t: "channel.subscribe", channels: [canal] })
    await computadorLigado.ateAoPong()
    const doTelemovel = await telemovelFechado(telemovel)

    const antes = servico.recebidos.length
    await mensagem(a, canal)
    const novos = servico.recebidos.slice(antes)
    expect(novos.map((r) => r.id)).toEqual([doTelemovel.id])
    expect(novos[0]?.texto).toBe("pt")
    expect(servico.quantos(doComputador)).toBe(0)
    a.fechar()
    computadorLigado.fechar()
  })

  it("quem envia não se acorda a si mesmo, nem os outros aparelhos da própria conta", async () => {
    const { computador, telemovel } = conta()
    const canal = canalNovo()
    sentar(canal, computador)
    const doTelemovel = await telemovelFechado(telemovel)
    const a = await entrar(computador)
    await mensagem(a, canal)
    expect(servico.quantos(doTelemovel)).toBe(0)
    a.fechar()
  })

  it("handshake não acorda ninguém", async () => {
    const ia = generateIdentity(servidor.casa)
    const a = await entrar(ia)
    const b = generateIdentity(servidor.casa)
    const canal = canalNovo()
    sentar(canal, ia, b)
    const doTelemovel = await telemovelFechado(b)
    // A handshake that is not a commit is stored like any other frame.
    await mensagem(a, canal, "handshake").catch(() => {})
    expect(servico.quantos(doTelemovel)).toBe(0)
    a.fechar()
  })

  it("canal silenciado neste aparelho: 0", async () => {
    const ia = generateIdentity(servidor.casa)
    const a = await entrar(ia)
    const b = generateIdentity(servidor.casa)
    const canal = canalNovo()
    sentar(canal, ia, b)
    const doTelemovel = await telemovelFechado(b, { silenciados: [canal] })
    await mensagem(a, canal)
    expect(servico.quantos(doTelemovel)).toBe(0)
    a.fechar()
  })

  it("pausa (calarAte no futuro) e Ocupado (para sempre): 0; pausa passada: 1", async () => {
    const ia = generateIdentity(servidor.casa)
    const a = await entrar(ia)
    const [b, c, d] = [0, 1, 2].map(() => generateIdentity(servidor.casa)) as [Identity, Identity, Identity]
    const canal = canalNovo()
    sentar(canal, ia, b, c, d)
    const pausado = await telemovelFechado(b, { calarAte: Date.now() + 3_600_000 })
    const ocupado = await telemovelFechado(c, { calarAte: CALAR_PARA_SEMPRE })
    const passou = await telemovelFechado(d, { calarAte: Date.now() - 60_000 })
    await mensagem(a, canal)
    expect([servico.quantos(pausado), servico.quantos(ocupado), servico.quantos(passou)]).toEqual([0, 0, 1])
    a.fechar()
  })

  it("janela de 2 minutos: 3 mensagens, 1 POST; e subscrever de novo não abre a janela", async () => {
    const ia = generateIdentity(servidor.casa)
    const a = await entrar(ia)
    const b = generateIdentity(servidor.casa)
    const canal = canalNovo()
    sentar(canal, ia, b)
    const doTelemovel = await telemovelFechado(b)
    await mensagem(a, canal)
    // The phone opens, renews (the client sends push.subscribe on every connect), closes.
    const ligacao = await entrar(b)
    expect(await subscrever(ligacao, doTelemovel)).toMatchObject({ ok: true })
    await desligar(ligacao)
    await mensagem(a, canal)
    await mensagem(a, canal)
    expect(servico.quantos(doTelemovel)).toBe(1)

    // Two minutes later (the row says so), the next message wakes it again.
    const linha = servidor.enclave.store.pushSubscriptionsDaConta(b.address)[0]
    servidor.enclave.store.marcarPush(b.address, linha?.deviceKey as Uint8Array, currentMinute() - 2)
    await mensagem(a, canal)
    expect(servico.quantos(doTelemovel)).toBe(2)
    a.fechar()
  })

  it("tecto diário: depois de 200 hoje, 0", async () => {
    const ia = generateIdentity(servidor.casa)
    const a = await entrar(ia)
    const b = generateIdentity(servidor.casa)
    const canal = canalNovo()
    sentar(canal, ia, b)
    const doTelemovel = await telemovelFechado(b)
    const chave = b.deviceSigningPublicKey
    const hoje = Math.floor(currentMinute() / 1440)
    for (let i = 0; i < 200; i++) servidor.enclave.store.marcarPush(b.address, chave, currentMinute() - 2, hoje)
    expect(servidor.enclave.store.pushSubscriptionsDaConta(b.address)[0]?.pushesDia).toBe(200)
    await mensagem(a, canal)
    expect(servico.quantos(doTelemovel)).toBe(0)
    a.fechar()
  })
})

describe("limpeza", () => {
  it("revogar o aparelho apaga a linha, e a mensagem seguinte não o acorda", async () => {
    const ia = generateIdentity(servidor.casa)
    const a = await entrar(ia)
    const { computador, telemovel } = conta()
    const canal = canalNovo()
    sentar(canal, ia, computador)
    const doTelemovel = await telemovelFechado(telemovel)
    const pc = await entrar(computador)
    const manifesto = (versao: number, aparelhos: Identity[]) =>
      signDeviceManifest(computador.signingPrivateKey as Uint8Array, {
        address: computador.address,
        version: versao,
        devices: aparelhos.map((x, i) => ({ deviceKey: x.deviceSigningPublicKey, addedAt: i })),
        signedAt: versao,
      })
    pc.enviar({ t: "manifest.publish", manifest: manifesto(1, [computador, telemovel]) })
    expect((await pc.proximoDe("manifest.published")).ok).toBe(true)
    pc.enviar({ t: "manifest.publish", manifest: manifesto(2, [computador]), revoke: [toBase64(telemovel.deviceSigningPublicKey)] })
    expect((await pc.proximoDe("manifest.published")).ok).toBe(true)
    expect(servidor.enclave.store.pushSubscriptionsDaConta(computador.address)).toHaveLength(0)
    await mensagem(a, canal)
    expect(servico.quantos(doTelemovel)).toBe(0)
    a.fechar()
    pc.fechar()
  })

  it("push.unsubscribe apaga a linha do próprio aparelho, e só essa", async () => {
    const { computador, telemovel } = conta()
    const outro = await telemovelFechado(telemovel)
    const pc = await entrar(computador)
    expect(await subscrever(pc, servico.novoAparelho())).toMatchObject({ ok: true })
    pc.enviar({ t: "push.unsubscribe" })
    expect(await pc.proximoDe("push.unsubscribed")).toEqual({ t: "push.unsubscribed" })
    const restam = servidor.enclave.store.pushSubscriptionsDaConta(computador.address)
    expect(restam.map((l) => l.endpoint)).toEqual([outro.endpoint])
    pc.fechar()
  })

  it("410 do serviço de push apaga a linha", async () => {
    const ia = generateIdentity(servidor.casa)
    const a = await entrar(ia)
    const b = generateIdentity(servidor.casa)
    const canal = canalNovo()
    sentar(canal, ia, b)
    const doTelemovel = await telemovelFechado(b)
    servico.respostas.set(doTelemovel.id, [410])
    await mensagem(a, canal)
    expect(servidor.enclave.store.pushSubscriptionsDaConta(b.address)).toHaveLength(0)
    a.fechar()
  })

  it("o varrimento apaga o que expirou e o que não se renova há 90 dias", () => {
    const store = servidor.enclave.store
    const base = { p256dh: servico.novoAparelho().p256dh, auth: new Uint8Array(16), lingua: "pt" as const, silenciados: [], calarAteMinute: 0 }
    const [x, y, z] = [0, 1, 2].map(() => generateIdentity(servidor.casa)) as [Identity, Identity, Identity]
    const agora = currentMinute()
    store.putPushSubscription({ ...base, address: x.address, deviceKey: x.deviceSigningPublicKey, endpoint: "https://push.test/v1", expiresMinute: agora - 1 })
    store.putPushSubscription({ ...base, address: y.address, deviceKey: y.deviceSigningPublicKey, endpoint: "https://push.test/v2", expiresMinute: null }, agora - 91 * 1440)
    store.putPushSubscription({ ...base, address: z.address, deviceKey: z.deviceSigningPublicKey, endpoint: "https://push.test/v3", expiresMinute: agora + 60 })
    expect(store.sweepPush(agora)).toBe(2)
    expect(store.pushSubscriptionsDaConta(z.address)).toHaveLength(1)
  })
})

describe("com o push desligado", () => {
  it("não anuncia, a chave é null, e subscrever é push-off", async () => {
    const desligado = await levantarServidor()
    try {
      const cliente = await Cliente.ligar(desligado.url, generateIdentity(desligado.casa))
      cliente.enviar({ t: "hello", version: PROTOCOL_VERSION })
      expect((await cliente.proximoDe("hello.ok")).capabilities).not.toContain(CAPACIDADE_WEB_PUSH)
      cliente.enviar({ t: "push.key.get" })
      expect(await cliente.proximoDe("push.key")).toEqual({ t: "push.key", publicKey: null })
      expect(await subscrever(cliente, servico.novoAparelho())).toMatchObject({ ok: false, reason: "push-off" })
      expect(existsSync(join(desligado.baseDeDados, "..", "push.key.json"))).toBe(false)
      cliente.fechar()
    } finally {
      await desligado.fechar()
    }
  })
})
