import { describe, expect, it, vi } from "vitest"
import { generateIdentity, mensagemDoPedido, parseServerName, PedidoAssinado, fromBase64, verify } from "@enclave/protocol"
import { enviarRelato, origemDoServidorDe } from "./relato.js"

describe("enviarRelato", () => {
  const ana = generateIdentity(parseServerName("orwell.pt"))
  const relato = { versao: "0.9.2", texto: "registo" }

  it("manda um pedido assinado por este aparelho para a rota do servidor da conta", async () => {
    const buscar = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await expect(enviarRelato(origemDoServidorDe(ana.address), ana, relato, buscar as typeof fetch)).resolves.toEqual({ ok: true })
    const [url, init] = buscar.mock.calls[0]!
    expect(url).toBe("https://orwell.pt/_enclave/relato")
    expect(init).toEqual(expect.objectContaining({ method: "POST", credentials: "omit" }))
    const pedido = PedidoAssinado.parse(JSON.parse(init!.body as string))
    expect(pedido.endereco).toBe(ana.address)
    expect(pedido.rota).toBe("/_enclave/relato")
    expect(pedido.corpo).toEqual(relato)
    // The signature is real: the device key verifies it over the canonical message.
    const { as, v: _v, ...assinado } = pedido
    expect(verify(fromBase64(pedido.aparelho), mensagemDoPedido(assinado), fromBase64(as))).toBe(true)
  })

  it("http só no loopback", () => {
    expect(origemDoServidorDe("@a:localhost:8448")).toBe("http://localhost:8448")
    expect(origemDoServidorDe("@a:127.0.0.1:8448")).toBe("http://127.0.0.1:8448")
    expect(origemDoServidorDe("@a:orwell.pt")).toBe("https://orwell.pt")
  })

  it("cada falha tem a sua chave: sem rede, tecto, relógio, recusa", async () => {
    const com = (resposta: () => Promise<Response>) => vi.fn(resposta) as unknown as typeof fetch
    await expect(enviarRelato("https://x", ana, relato, com(async () => Promise.reject(new TypeError("offline"))))).rejects.toThrow(
      "could not reach the homeserver",
    )
    await expect(enviarRelato("https://x", ana, relato, com(async () => new Response("", { status: 429 })))).rejects.toThrow(
      "too many logs sent",
    )
    await expect(
      enviarRelato("https://x", ana, relato, com(async () => new Response(JSON.stringify({ error: "stale-request" }), { status: 401 }))),
    ).rejects.toThrow("the device clock is off")
    await expect(
      enviarRelato("https://x", ana, relato, com(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }))),
    ).rejects.toThrow("the server did not take the log")
    await expect(enviarRelato("https://x", ana, relato, com(async () => new Response("", { status: 400 })))).rejects.toThrow(
      "the server did not take the log",
    )
  })
})
