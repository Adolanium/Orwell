import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ nativeImage: undefined }))

const { miniaturistaDaSecretaria } = await import("./miniaturista.js")

/**
 * The desktop thumbnailer, with a fake `nativeImage` that records what it is
 * asked: outside Electron there is no `nativeImage` to decode.
 */

interface Pedido {
  redimensionar: { width?: number; height?: number; quality?: string }[]
  jpeg: number[]
}

function nativeImageFalso(largura: number, altura: number, vazia = false) {
  const pedido: Pedido = { redimensionar: [], jpeg: [] }
  const imagem = (w: number, h: number) => ({
    isEmpty: () => vazia,
    getSize: () => ({ width: w, height: h }),
    resize: (opcoes: { width?: number; height?: number; quality?: string }) => {
      pedido.redimensionar.push(opcoes)
      const escala = opcoes.width !== undefined ? opcoes.width / w : (opcoes.height as number) / h
      return imagem(Math.round(w * escala), Math.round(h * escala))
    },
    toJPEG: (qualidade: number) => {
      pedido.jpeg.push(qualidade)
      return Buffer.from([w % 256, h % 256])
    },
  })
  return { porta: { createFromBuffer: () => imagem(largura, altura) }, pedido }
}

describe("miniaturistaDaSecretaria", () => {
  it("faz JPEG a 80 com o lado maior a 320 px", async () => {
    const { porta, pedido } = nativeImageFalso(1600, 1200)
    const mini = await miniaturistaDaSecretaria(porta).fazer(new Uint8Array([1]), "image/png")
    expect(mini).toEqual({ bytes: new Uint8Array([320 % 256, 240]), tipo: "image/jpeg", w: 320, h: 240 })
    expect(pedido.redimensionar).toEqual([{ width: 320, height: 240, quality: "good" }])
    expect(pedido.jpeg).toEqual([80])
  })

  it("um retrato ao alto leva a altura a 320", async () => {
    const { porta } = nativeImageFalso(600, 1200)
    const mini = await miniaturistaDaSecretaria(porta).fazer(new Uint8Array([1]), "image/jpeg")
    expect({ w: mini?.w, h: mini?.h }).toEqual({ w: 160, h: 320 })
  })

  it("uma imagem pequena não aumenta nem se redimensiona", async () => {
    const { porta, pedido } = nativeImageFalso(200, 100)
    const mini = await miniaturistaDaSecretaria(porta).fazer(new Uint8Array([1]), "image/jpeg")
    expect({ w: mini?.w, h: mini?.h }).toEqual({ w: 200, h: 100 })
    expect(pedido.redimensionar).toEqual([])
  })

  it("um formato que o nativeImage não descodifica dá nulo", async () => {
    const { porta, pedido } = nativeImageFalso(0, 0, true)
    expect(await miniaturistaDaSecretaria(porta).fazer(new Uint8Array([1]), "image/avif")).toBeNull()
    expect(pedido.jpeg).toEqual([])
  })

  it("um tipo que não é imagem dá nulo sem descodificar; um erro do nativeImage também", async () => {
    let chamadas = 0
    const porta = {
      createFromBuffer: () => {
        chamadas++
        throw new Error("morto")
      },
    }
    expect(await miniaturistaDaSecretaria(porta).fazer(new Uint8Array([1]), "application/pdf")).toBeNull()
    expect(chamadas).toBe(0)
    expect(await miniaturistaDaSecretaria(porta).fazer(new Uint8Array([1]), "image/png")).toBeNull()
    expect(chamadas).toBe(1)
  })

  it("sem nativeImage (fora do Electron) dá nulo", async () => {
    expect(await miniaturistaDaSecretaria(undefined).fazer(new Uint8Array([1]), "image/png")).toBeNull()
  })
})

/**
 * What `nativeImage` does not decode (GIF and WebP, on every system: measured
 * in Electron 43 on macOS), the window does. Before 1.3.25 such an image had
 * no thumbnail on the desktop: a GIF, or a photo the composer had recoded to
 * WebP, above 200 KB showed an empty box while its original loaded, and
 * nothing at all once the store had pushed the original out.
 */
describe("miniaturistaDaSecretaria, com a janela para o que o nativeImage não descodifica", () => {
  const DA_JANELA = { bytes: new Uint8Array([7]), tipo: "image/webp", w: 320, h: 200 }

  it("um GIF que o nativeImage não lê vai à janela, e a miniatura é a dela", async () => {
    const { porta } = nativeImageFalso(0, 0, true)
    const naJanela = vi.fn(async () => DA_JANELA)
    const mini = await miniaturistaDaSecretaria(porta, naJanela).fazer(new Uint8Array([1, 2]), "image/gif")
    expect(mini).toEqual(DA_JANELA)
    expect(naJanela).toHaveBeenCalledWith(new Uint8Array([1, 2]), "image/gif")
  })

  it("uma PNG que o nativeImage lê não vai à janela", async () => {
    const { porta } = nativeImageFalso(1600, 1200)
    const naJanela = vi.fn(async () => DA_JANELA)
    const mini = await miniaturistaDaSecretaria(porta, naJanela).fazer(new Uint8Array([1]), "image/png")
    expect(mini?.tipo).toBe("image/jpeg")
    expect(naJanela).not.toHaveBeenCalled()
  })

  it("sem janela, rejeita, para o núcleo tentar outra vez (nulo seria «formato desconhecido» para sempre)", async () => {
    const { porta } = nativeImageFalso(0, 0, true)
    const naJanela = vi.fn(async () => {
      throw new Error("sem janela")
    })
    await expect(miniaturistaDaSecretaria(porta, naJanela).fazer(new Uint8Array([1]), "image/webp")).rejects.toThrow()
  })

  it("a janela que também não descodifica dá nulo", async () => {
    const { porta } = nativeImageFalso(0, 0, true)
    expect(await miniaturistaDaSecretaria(porta, async () => null).fazer(new Uint8Array([1]), "image/avif")).toBeNull()
  })
})
