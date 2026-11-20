import { describe, expect, it, vi } from "vitest"
import { servirMiniaturasAoAnfitriao, type AnfitriaoDasMiniaturas } from "./miniaturas.js"

/**
 * The window's side of `main/miniaturas-pela-janela.ts`: a request from the
 * main process comes with `{ id, bytes, tipo }`, the window makes the
 * thumbnail with the web's code (`createImageBitmap`, which decodes GIF and
 * WebP), and answers with the same `id`.
 */
function anfitriao() {
  let ouvinte: ((carga: unknown) => void) | null = null
  const respostas: [unknown, unknown][] = []
  const host: AnfitriaoDasMiniaturas = {
    miniatura: {
      responder: async (id, mini) => {
        respostas.push([id, mini])
      },
    },
    on: {
      miniaturaPedido: (handler) => {
        ouvinte = handler
        return () => (ouvinte = null)
      },
    },
  }
  return { host, respostas, pedir: (carga: unknown) => ouvinte?.(carga) }
}

describe("servirMiniaturasAoAnfitriao", () => {
  it("faz a miniatura dos bytes pedidos e responde com o mesmo id", async () => {
    const { host, respostas, pedir } = anfitriao()
    const mini = { bytes: new Uint8Array([5]), tipo: "image/webp", w: 320, h: 240 }
    const fazer = vi.fn(async () => mini)
    servirMiniaturasAoAnfitriao(host, fazer)
    pedir({ id: 7, bytes: new Uint8Array([1, 2]), tipo: "image/gif" })
    await vi.waitFor(() => expect(respostas).toEqual([[7, mini]]))
    expect(fazer).toHaveBeenCalledWith(new Uint8Array([1, 2]), "image/gif")
  })

  it("o que não descodifica responde nulo, e uma falha também", async () => {
    const { host, respostas, pedir } = anfitriao()
    servirMiniaturasAoAnfitriao(host, async () => {
      throw new Error("x")
    })
    pedir({ id: 8, bytes: new Uint8Array([1]), tipo: "image/webp" })
    await vi.waitFor(() => expect(respostas).toEqual([[8, null]]))
  })

  it("um pedido com forma errada não se responde nem se faz", async () => {
    const { host, respostas, pedir } = anfitriao()
    const fazer = vi.fn(async () => null)
    servirMiniaturasAoAnfitriao(host, fazer)
    pedir({ id: "9", bytes: new Uint8Array([1]), tipo: "image/gif" })
    pedir({ id: 9, bytes: [1], tipo: "image/gif" })
    pedir(null)
    await new Promise((r) => setTimeout(r, 0))
    expect(fazer).not.toHaveBeenCalled()
    expect(respostas).toEqual([])
  })

  it("um preload antigo, sem o canal, não liga nada", () => {
    expect(() => servirMiniaturasAoAnfitriao({ on: {} }, vi.fn())).not.toThrow()
  })
})
