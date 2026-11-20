import { afterEach, describe, expect, it, vi } from "vitest"
import { TECTOS_DO_ARMAZEM } from "@enclave/client-core"
import { LADO_DA_MINIATURA_NA_JANELA, lerMiniatura, PedidosDeMiniatura, PRAZO_DA_MINIATURA_MS } from "./miniaturas-pela-janela.js"

/**
 * The thumbnails `nativeImage` cannot make (GIF, WebP), asked of the window,
 * whose Chromium decodes them. The main process sends the bytes, the window
 * answers by `id`, and what comes back is checked here, because it comes
 * from the renderer.
 */
afterEach(() => vi.useRealTimers())

const BOA = { bytes: new Uint8Array([1, 2, 3]), tipo: "image/webp", w: 320, h: 180 }

describe("PedidosDeMiniatura", () => {
  it("envia os bytes com um id, e a resposta com esse id resolve o pedido", async () => {
    const pedidos = new PedidosDeMiniatura()
    const enviados: { id: number; bytes: Uint8Array; tipo: string }[] = []
    const promessa = pedidos.pedir((pedido) => (enviados.push(pedido), true), new Uint8Array([9]), "image/gif")
    expect(enviados).toEqual([{ id: enviados[0]!.id, bytes: new Uint8Array([9]), tipo: "image/gif" }])
    expect(pedidos.responder(enviados[0]!.id + 1, BOA)).toBe(false)
    expect(pedidos.responder(enviados[0]!.id, BOA)).toBe(true)
    await expect(promessa).resolves.toEqual(BOA)
    // Answered once: a second answer finds nothing.
    expect(pedidos.responder(enviados[0]!.id, BOA)).toBe(false)
  })

  it("a janela que não sabe descodificar responde nulo, e o nulo passa (formato desconhecido)", async () => {
    const pedidos = new PedidosDeMiniatura()
    let id = 0
    const promessa = pedidos.pedir((pedido) => ((id = pedido.id), true), new Uint8Array([9]), "image/x-nada")
    pedidos.responder(id, null)
    await expect(promessa).resolves.toBeNull()
  })

  it("sem janela, rejeita: é uma falha da plataforma, e o núcleo tenta outra vez na abertura seguinte", async () => {
    await expect(new PedidosDeMiniatura().pedir(() => false, new Uint8Array([9]), "image/gif")).rejects.toThrow()
  })

  it("uma janela que não responde (recarregou, caiu) rejeita no prazo, não fica pendurada", async () => {
    vi.useFakeTimers()
    const promessa = new PedidosDeMiniatura().pedir(() => true, new Uint8Array([9]), "image/gif")
    const apanhada = promessa.catch((erro: unknown) => erro)
    await vi.advanceTimersByTimeAsync(PRAZO_DA_MINIATURA_MS)
    expect(await apanhada).toBeInstanceOf(Error)
  })

  it("fecharTodos rejeita o que estava à espera", async () => {
    const pedidos = new PedidosDeMiniatura()
    const promessa = pedidos.pedir(() => true, new Uint8Array([9]), "image/gif")
    pedidos.fecharTodos()
    await expect(promessa).rejects.toThrow()
  })

  it("uma resposta com forma errada vale nulo", async () => {
    const pedidos = new PedidosDeMiniatura()
    let id = 0
    const promessa = pedidos.pedir((pedido) => ((id = pedido.id), true), new Uint8Array([9]), "image/gif")
    pedidos.responder(id, { ...BOA, tipo: "text/html" })
    await expect(promessa).resolves.toBeNull()
  })
})

describe("lerMiniatura: o que vem da janela", () => {
  it("aceita WebP e JPEG até 320 px", () => {
    expect(lerMiniatura(BOA)).toEqual(BOA)
    expect(lerMiniatura({ ...BOA, tipo: "image/jpeg", w: 1, h: 320 })).toEqual({ ...BOA, tipo: "image/jpeg", w: 1, h: 320 })
  })

  it("recusa outro tipo, lados fora de 1 a 320, bytes vazios ou que não são bytes", () => {
    for (const mau of [
      null,
      "x",
      { ...BOA, tipo: "image/svg+xml" },
      { ...BOA, w: 0 },
      { ...BOA, h: 321 },
      { ...BOA, w: 1.5 },
      { ...BOA, bytes: new Uint8Array() },
      { ...BOA, bytes: [1, 2, 3] },
      { ...BOA, bytes: new Uint8Array(1024 * 1024 + 1) },
    ]) {
      expect(lerMiniatura(mau)).toBeNull()
    }
  })

  it("o lado é o do armazém", () => {
    expect(LADO_DA_MINIATURA_NA_JANELA).toBe(TECTOS_DO_ARMAZEM.ladoDaMiniatura)
  })
})
