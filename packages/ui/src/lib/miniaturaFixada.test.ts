import { describe, expect, it, vi } from "vitest"
import type { CompressDeps } from "./images.js"
import { miniaturaParaFixar } from "./miniaturaFixada.js"

/**
 * The pin's thumbnail, from an image the vault already holds.
 *
 * Since the media store (13/11), an image the vault absorbed reaches the
 * screen as `{ ref, mini }`, not as an `inline` data URL. The pin read only
 * `inline`: pinning any image from before this session gave just the file
 * name. Now the bytes come from the store (`bridge.media.bytes`), the
 * thumbnail first.
 */
const deps: CompressDeps = {
  decode: async () => ({ width: 100, height: 80 }),
  createCanvas: () =>
    ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => undefined }),
      toDataURL: (tipo?: string) => `data:${tipo ?? "image/png"};base64,AAAA`,
    }) as unknown as HTMLCanvasElement,
  draw: () => undefined,
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

describe("miniaturaParaFixar com uma imagem guardada no armazém", () => {
  it("uma imagem { ref, mini } lê os bytes da miniatura e dá uma imagem pequena", async () => {
    const ler = vi.fn(async () => PNG)
    const feita = await miniaturaParaFixar([{ ref: "sha-original", mini: "sha-mini", mediaType: "image/webp" }], deps, ler)
    expect(ler).toHaveBeenCalledWith("sha-mini")
    expect(feita).toMatch(/^data:image\//)
  })

  it("sem miniatura própria, lê o original", async () => {
    const ler = vi.fn(async () => PNG)
    await miniaturaParaFixar([{ ref: "sha-original", mediaType: "image/png" }], deps, ler)
    expect(ler).toHaveBeenCalledWith("sha-original")
  })

  it("um vídeo com cartaz { ref } lê o cartaz", async () => {
    const ler = vi.fn(async () => PNG)
    const feita = await miniaturaParaFixar([{ mediaType: "video/mp4", poster: { ref: "sha-cartaz" } }], deps, ler)
    expect(ler).toHaveBeenCalledWith("sha-cartaz")
    expect(feita).toMatch(/^data:image\//)
  })

  it("bytes que não chegam (fora do aparelho) dão só o nome, como antes", async () => {
    expect(await miniaturaParaFixar([{ ref: "sha", mediaType: "image/png" }], deps, async () => null)).toBeUndefined()
  })

  it("sem ponte do armazém, uma { ref } dá só o nome", async () => {
    expect(await miniaturaParaFixar([{ ref: "sha", mediaType: "image/png" }], deps)).toBeUndefined()
  })

  it("o inline em data: continua como antes, sem ler o armazém", async () => {
    const ler = vi.fn(async () => PNG)
    const feita = await miniaturaParaFixar([{ inline: "data:image/png;base64,iVBORw0KGgo=", mediaType: "image/png" }], deps, ler)
    expect(feita).toMatch(/^data:image\//)
    expect(ler).not.toHaveBeenCalled()
  })
})
