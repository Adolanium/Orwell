import { generateIdentity, moradaDeSala, TAMANHO_MAXIMO_DO_KEY_PACKAGE, toBase64 } from "@enclave/protocol"
import { generateKeyPackages } from "@enclave/crypto"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  Cliente,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"
import { conviteComProva, type ConviteComProva } from "../testes/convite-com-prova.js"
import { Gateway } from "./gateway.js"

/**
 * INV-02 (external audit on 1.1.0, addendum of 3/11/2026): redeeming invites
 * amplified traffic without a cap.
 *
 * `invite.redeem` had no rate limit (`create`, `resolve` and the seal did), the
 * `keyPackage` had only the frame cap (12 MiB), and each redeem was broadcast
 * to all subscribers of the channel. With `max_uses NULL` you could redeem
 * endlessly: 12 MiB per frame, times the connected members, and a `#send`
 * that did not check each connection's queue.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const clientes: Cliente[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterEach(() => {
  desligarContas(abertas.splice(0))
  for (const c of clientes.splice(0)) c.fechar()
})
afterAll(async () => {
  await servidor?.fechar()
})

async function ligar(): Promise<{ cliente: Cliente; identidade: ReturnType<typeof generateIdentity> }> {
  const identidade = generateIdentity(servidor.casa)
  const cliente = await Cliente.ligar(servidor.url, identidade)
  clientes.push(cliente)
  return { cliente, identidade }
}

/** A channel owned by `dono`, with one frame, and an invite with no use limit. */
async function canalComConvite(dono: Cliente): Promise<{ canal: string; convite: ConviteComProva }> {
  const canal = moradaDeSala(servidor.casa)
  dono.enviar({ t: "channel.subscribe", channels: [canal] })
  dono.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: toBase64(new Uint8Array(16)) })
  await dono.proximoDe("channel.event")
  const convite = conviteComProva()
  dono.enviar({ t: "invite.create", channel: canal, ...convite.criar, expiresAt: null, maxUses: null })
  await dono.proximoDe("invite.created")
  return { canal, convite }
}

async function pacoteDe(identidade: ReturnType<typeof generateIdentity>): Promise<string> {
  const [pacote] = await generateKeyPackages(identidade, 1)
  if (!pacote) throw new Error("sem key package")
  return toBase64(pacote.wire)
}

const usosDe = (canal: string): number => servidor.enclave.store.listInvites(canal)[0]?.uses ?? -1

describe("INV-02: o tamanho e a forma do keyPackage", () => {
  it("o tecto cobre com folga o key package mais largo de uma conta a sério (aparelho com cadeia, X-Wing)", async () => {
    const [conta] = (await contasDeTeste(servidor, ["Ana"])) as [ContaDeTeste]
    abertas.push(conta)
    const tamanhos: number[] = []
    for (let i = 0; i < 10; i++) {
      const [pacote] = await generateKeyPackages(conta.session.loadIdentity(), 1)
      tamanhos.push(pacote?.wire.length ?? 0)
    }
    const maior = Math.max(...tamanhos)
    // Measured on 4/11/2026: ~2.9 KB. The cap is close to three times that.
    expect(maior).toBeGreaterThan(2_000)
    expect(maior * 2).toBeLessThan(TAMANHO_MAXIMO_DO_KEY_PACKAGE)
  }, 60_000)

  it("um keyPackage acima do tecto é recusado antes de gastar um uso, e não chega aos membros", async () => {
    const { cliente: dono } = await ligar()
    const { canal, convite } = await canalComConvite(dono)
    const { cliente: quem, identidade } = await ligar()
    const gordo = toBase64(crypto.getRandomValues(new Uint8Array(TAMANHO_MAXIMO_DO_KEY_PACKAGE + 1)))
    quem.enviar(convite.resgate(identidade.address, gordo))
    expect((await quem.ateAoPong()).some((f) => f.t === "error" && f.code === "bad-frame")).toBe(true)
    expect((await dono.ateAoPong()).filter((f) => f.t === "invite.request")).toEqual([])
    expect(usosDe(canal)).toBe(0)
  })

  it("um keyPackage que não é um key package MLS é recusado antes de gastar um uso", async () => {
    const { cliente: dono } = await ligar()
    const { canal, convite } = await canalComConvite(dono)
    const { cliente: quem, identidade } = await ligar()
    quem.enviar(convite.resgate(identidade.address, toBase64(crypto.getRandomValues(new Uint8Array(512)))))
    expect((await quem.ateAoPong()).some((f) => f.t === "error" && f.code === "bad-frame")).toBe(true)
    expect((await dono.ateAoPong()).filter((f) => f.t === "invite.request")).toEqual([])
    expect(usosDe(canal)).toBe(0)
  })

  it("um key package verdadeiro passa, e chega aos membros", async () => {
    const { cliente: dono } = await ligar()
    const { canal, convite } = await canalComConvite(dono)
    const { cliente: quem, identidade } = await ligar()
    quem.enviar(convite.resgate(identidade.address, await pacoteDe(identidade)))
    expect((await dono.proximoDe("invite.request")).address).toBe(identidade.address)
    expect(usosDe(canal)).toBe(1)
  })
})

describe("INV-02: os tectos de ritmo do resgate", () => {
  it("por conta: acima de RESGATES_POR_MINUTO, invite.rejected rate-limited, sem gastar usos", async () => {
    const { cliente: dono } = await ligar()
    const { canal, convite } = await canalComConvite(dono)
    const { cliente: quem, identidade } = await ligar()
    const pacote = await pacoteDe(identidade)
    // A different invite per redeem, so deduplication does not come into play.
    const outros: { canal: string; convite: ConviteComProva }[] = []
    for (let i = 0; i < Gateway.RESGATES_POR_MINUTO; i++) outros.push(await canalComConvite(dono))
    for (const { convite: c } of outros) quem.enviar(c.resgate(identidade.address, pacote))
    await quem.ateAoPong()
    quem.enviar(convite.resgate(identidade.address, pacote))
    expect(await quem.ateAoPong()).toContainEqual({ t: "invite.rejected", reason: "rate-limited" })
    expect(usosDe(canal)).toBe(0)
  }, 60_000)

  it("por convite: acima de RESGATES_POR_CONVITE_POR_MINUTO contas diferentes, rate-limited", async () => {
    const { cliente: dono } = await ligar()
    const { canal, convite } = await canalComConvite(dono)
    for (let i = 0; i < Gateway.RESGATES_POR_CONVITE_POR_MINUTO; i++) {
      const { cliente, identidade } = await ligar()
      cliente.enviar(convite.resgate(identidade.address, await pacoteDe(identidade)))
      await cliente.ateAoPong()
    }
    const { cliente: ultimo, identidade } = await ligar()
    ultimo.enviar(convite.resgate(identidade.address, await pacoteDe(identidade)))
    expect(await ultimo.ateAoPong()).toContainEqual({ t: "invite.rejected", reason: "rate-limited" })
    expect(usosDe(canal)).toBe(Gateway.RESGATES_POR_CONVITE_POR_MINUTO)
  }, 60_000)

  it("por canal e no servidor inteiro, com os tectos baixados para o teste", async () => {
    const porCanal = Gateway.RESGATES_POR_CANAL_POR_MINUTO
    const global = Gateway.RESGATES_DO_SERVIDOR_POR_MINUTO
    try {
      Gateway.RESGATES_POR_CANAL_POR_MINUTO = 2
      const { cliente: dono } = await ligar()
      const { canal, convite } = await canalComConvite(dono)
      const segundo = conviteComProva()
      dono.enviar({ t: "invite.create", channel: canal, ...segundo.criar, expiresAt: null, maxUses: null })
      await dono.proximoDe("invite.created")
      const respostas = []
      for (const c of [convite, segundo, segundo]) {
        const { cliente, identidade } = await ligar()
        cliente.enviar(c.resgate(identidade.address, await pacoteDe(identidade)))
        respostas.push(await cliente.ateAoPong())
      }
      expect(respostas[2]).toContainEqual({ t: "invite.rejected", reason: "rate-limited" })

      Gateway.RESGATES_POR_CANAL_POR_MINUTO = porCanal
      Gateway.RESGATES_DO_SERVIDOR_POR_MINUTO = 0
      const { cliente: outroDono } = await ligar()
      const outro = await canalComConvite(outroDono)
      const { cliente, identidade } = await ligar()
      cliente.enviar(outro.convite.resgate(identidade.address, await pacoteDe(identidade)))
      expect(await cliente.ateAoPong()).toContainEqual({ t: "invite.rejected", reason: "rate-limited" })
      expect(usosDe(outro.canal)).toBe(0)
    } finally {
      Gateway.RESGATES_POR_CANAL_POR_MINUTO = porCanal
      Gateway.RESGATES_DO_SERVIDOR_POR_MINUTO = global
    }
  }, 60_000)
})

describe("INV-02: um pedido pendente repetido não se difunde outra vez", () => {
  it("a mesma conta a resgatar o mesmo canal duas vezes, com membros ligados: um pedido só, um uso só", async () => {
    const { cliente: dono } = await ligar()
    const { canal, convite } = await canalComConvite(dono)
    const { cliente: quem, identidade } = await ligar()
    quem.enviar(convite.resgate(identidade.address, await pacoteDe(identidade)))
    await quem.ateAoPong()
    quem.enviar(convite.resgate(identidade.address, await pacoteDe(identidade)))
    await quem.ateAoPong()
    expect((await dono.ateAoPong()).filter((f) => f.t === "invite.request")).toHaveLength(1)
    expect(usosDe(canal)).toBe(1)
  })

  it("se o primeiro pedido não chegou a ninguém, o segundo passa: é a maneira de tentar outra vez", async () => {
    const { cliente: dono, identidade: idDono } = await ligar()
    const { canal, convite } = await canalComConvite(dono)
    dono.fechar()
    await dono.fechado()
    const { cliente: quem, identidade } = await ligar()
    quem.enviar(convite.resgate(identidade.address, await pacoteDe(identidade)))
    await quem.ateAoPong()
    // The owner returns, and only now is there someone listening.
    const deVolta = await Cliente.ligar(servidor.url, idDono)
    clientes.push(deVolta)
    deVolta.enviar({ t: "channel.subscribe", channels: [canal] })
    await deVolta.ateAoPong()
    quem.enviar(convite.resgate(identidade.address, await pacoteDe(identidade)))
    await quem.ateAoPong()
    expect((await deVolta.ateAoPong()).filter((f) => f.t === "invite.request")).toHaveLength(1)
    expect(usosDe(canal)).toBe(2)
  })
})

describe("INV-02: a fila de cada ligação tem tecto", () => {
  it("quem não lê é desligado quando a fila passa o tecto; quem lê recebe tudo, e quem caiu recupera pelo histórico", async () => {
    const tecto = Gateway.FILA_MAXIMA_BYTES
    Gateway.FILA_MAXIMA_BYTES = 16 * 1024 * 1024
    try {
      const { cliente: dono } = await ligar()
      const canal = moradaDeSala(servidor.casa)
      dono.enviar({ t: "channel.subscribe", channels: [canal] })
      await dono.ateAoPong()

      // Two members, seated by the owner's targeted Welcome.
      const membros = []
      for (let i = 0; i < 2; i++) {
        const { cliente, identidade } = await ligar()
        dono.enviar({ t: "channel.send", channel: canal, kind: "welcome", ciphertext: toBase64(new Uint8Array(32)), recipient: identidade.address })
        await cliente.proximoDe("channel.event")
        cliente.enviar({ t: "channel.subscribe", channels: [canal] })
        await cliente.ateAoPong()
        membros.push({ cliente, identidade })
      }
      const [lento, atento] = membros as [(typeof membros)[number], (typeof membros)[number]]
      lento.cliente.pausarLeitura()

      /*
        64 frames of 1 MiB, each one sent when the reader has the previous one.
        The non-reader's queue holds what the kernel did not absorb (on
        loopback, ~24 MiB of 64 on macOS, less on Linux), past the test cap of
        16 MiB; the production cap is 64 MiB.

        Not in a burst, as it was until 1.3.19: the server and the readers
        share this process's event loop, and on a slow CI runner the READER's
        queue passed 16 MiB too, so the server cut it, and the test failed
        with "nunca chegou um channel.event" (1.3.15 to 1.3.18). Measured on
        18/11/2026 with the process on the efficiency cores (`taskpolicy -b`):
        the burst failed 4 of 4, with two or three connections cut. In
        lockstep, the reader's queue is one frame, and what is measured is the
        rule alone: whoever reads gets everything, whoever does not is cut.
      */
      const fechou = lento.cliente.fechado()
      const recebidas: number[] = []
      for (let i = 0; i < 64; i++) {
        dono.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: toBase64(new Uint8Array(768 * 1024).fill(i)), ref: `r${i}` })
        recebidas.push((await atento.cliente.proximoDe("channel.event")).seq)
      }
      expect(recebidas).toHaveLength(64)
      // Closed by the server, and counted. The client only finds out when it reads again.
      const metricas = servidor.enclave.gateway.metricasDosEnvios()
      expect([metricas.actual, ...metricas.anteriores].reduce((soma, m) => soma + m.lentas, 0)).toBeGreaterThanOrEqual(1)
      lento.cliente.retomarLeitura()
      await Promise.race([fechou, new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error("o lento não foi desligado")), 10_000))])

      // The slow one returns and reads everything through history, which is the recovery path.
      const deVolta = await Cliente.ligar(servidor.url, lento.identidade)
      clientes.push(deVolta)
      // In pages of 8 MiB: one page of 64 MiB took longer than the harness waits for a frame on a slow machine.
      let aplicacoes = 0
      let depois = -1
      for (let volta = 0; volta < 20 && aplicacoes < 64; volta++) {
        deVolta.enviar({ t: "channel.backfill", channel: canal, afterSeq: depois, limit: 8 })
        const pagina = await deVolta.proximoDe("channel.backfill.page")
        if (pagina.events.length === 0) break
        aplicacoes += pagina.events.filter((e) => e.kind === "application").length
        depois = Math.max(...pagina.events.map((e) => e.seq))
      }
      expect(aplicacoes).toBe(64)
    } finally {
      Gateway.FILA_MAXIMA_BYTES = tecto
    }
  }, 120_000)
})
