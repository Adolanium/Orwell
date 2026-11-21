import { describe, expect, it } from "vitest"
import { generateIdentity, parseServerName } from "./index.js"
import {
  assinarPedidoDeLugar,
  JANELA_DA_PROVA_DO_PEDIDO_MS,
  ProvasDosPedidosDeLugar,
  verificarPedidoDeLugar,
} from "./pedido-de-lugar.js"
import { ClientFrame, ServerFrame } from "./wire.js"

/**
 * The seat request signed by the device that asks (1.3.26, I2 of the 1.3.25
 * public review). The server names the device in `channel.rejoin`; this proof is
 * what it cannot forge.
 */

const CASA = parseServerName("localhost:8448")
const CANAL = "!lagar:localhost:8448"

function aparelho() {
  const id = generateIdentity(CASA)
  return { id, publica: id.deviceSigningPublicKey, privada: id.deviceSigningPrivateKey }
}

describe("a prova do pedido de lugar", () => {
  it("verifica com a chave do aparelho que assinou, e com nenhuma outra", () => {
    const telemovel = aparelho()
    const tablet = aparelho()
    const prova = assinarPedidoDeLugar(telemovel.privada, telemovel.publica, CANAL, telemovel.id.address, 1_000)
    expect(verificarPedidoDeLugar(prova, CANAL, telemovel.id.address, telemovel.publica)).toBe(true)
    // The server names the tablet with the phone's proof: refused.
    expect(verificarPedidoDeLugar(prova, CANAL, telemovel.id.address, tablet.publica)).toBe(false)
  })

  it("não serve noutro canal, noutra conta, nem com outra hora", () => {
    const telemovel = aparelho()
    const prova = assinarPedidoDeLugar(telemovel.privada, telemovel.publica, CANAL, telemovel.id.address, 1_000)
    expect(verificarPedidoDeLugar(prova, "!adega:localhost:8448", telemovel.id.address, telemovel.publica)).toBe(false)
    expect(verificarPedidoDeLugar(prova, CANAL, "@outra:localhost:8448", telemovel.publica)).toBe(false)
    expect(verificarPedidoDeLugar({ ...prova, em: 1_001 }, CANAL, telemovel.id.address, telemovel.publica)).toBe(false)
    expect(verificarPedidoDeLugar({ ...prova, assinatura: "AAAA" }, CANAL, telemovel.id.address, telemovel.publica)).toBe(false)
  })

  it("quem recebe aceita uma vez: a repetição e a prova velha ficam de fora", () => {
    const telemovel = aparelho()
    const provas = new ProvasDosPedidosDeLugar()
    const agora = 50_000_000
    const prova = assinarPedidoDeLugar(telemovel.privada, telemovel.publica, CANAL, telemovel.id.address, agora)
    expect(provas.aceitar(undefined, CANAL, telemovel.id.address, telemovel.publica, agora)).toBe(false)
    expect(provas.aceitar(prova, CANAL, telemovel.id.address, telemovel.publica, agora)).toBe(true)
    // The server delivers the same request again.
    expect(provas.aceitar(prova, CANAL, telemovel.id.address, telemovel.publica, agora + 5_000)).toBe(false)
    // A newer request of the device passes.
    const outra = assinarPedidoDeLugar(telemovel.privada, telemovel.publica, CANAL, telemovel.id.address, agora + 60_000)
    expect(provas.aceitar(outra, CANAL, telemovel.id.address, telemovel.publica, agora + 60_000)).toBe(true)
    // Outside the window, either way, it does not.
    const velha = assinarPedidoDeLugar(telemovel.privada, telemovel.publica, "!adega:localhost:8448", telemovel.id.address, agora)
    expect(provas.aceitar(velha, "!adega:localhost:8448", telemovel.id.address, telemovel.publica, agora + JANELA_DA_PROVA_DO_PEDIDO_MS + 1)).toBe(false)
    const futura = assinarPedidoDeLugar(telemovel.privada, telemovel.publica, "!adega:localhost:8448", telemovel.id.address, agora + JANELA_DA_PROVA_DO_PEDIDO_MS + 1)
    expect(provas.aceitar(futura, "!adega:localhost:8448", telemovel.id.address, telemovel.publica, agora)).toBe(false)
  })

  it("no fio: o pedido e o channel.rejoin levam a prova, e os dois continuam válidos sem ela", () => {
    const telemovel = aparelho()
    const prova = assinarPedidoDeLugar(telemovel.privada, telemovel.publica, CANAL, telemovel.id.address, 1_000)
    expect(ClientFrame.parse({ t: "channel.rejoin.request", channel: CANAL, prova })).toEqual({ t: "channel.rejoin.request", channel: CANAL, prova })
    expect(ClientFrame.parse({ t: "channel.rejoin.request", channel: CANAL })).toEqual({ t: "channel.rejoin.request", channel: CANAL })
    const comProva = { t: "channel.rejoin", channel: CANAL, address: telemovel.id.address, device: "AAAA", prova }
    expect(ServerFrame.parse(comProva)).toEqual(comProva)
    expect(ServerFrame.safeParse({ t: "channel.rejoin", channel: CANAL, address: telemovel.id.address }).success).toBe(true)
    expect(ClientFrame.safeParse({ t: "channel.rejoin.request", channel: CANAL, prova: { em: -1, assinatura: "AAAA" } }).success).toBe(false)
  })
})
