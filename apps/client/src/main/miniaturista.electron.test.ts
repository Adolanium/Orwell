import { describe, expect, it, vi } from "vitest"

/**
 * The real `nativeImage` path, when the test runs inside Electron. In vitest
 * under Node there is no `nativeImage`, and importing the `electron` package
 * outside it only gives the binary path (and downloads it, if missing): outside
 * Electron the module is swapped for an empty one, and the test skips, and
 * says so.
 */
vi.mock("electron", async (original) => (typeof process.versions.electron === "string" ? original() : { nativeImage: undefined }))

const electron = (await import("electron")) as { nativeImage?: typeof import("electron").nativeImage }
const nativeImage = typeof electron.nativeImage?.createFromBitmap === "function" ? electron.nativeImage : undefined
const { miniaturistaDaSecretaria } = await import("./miniaturista.js")

describe("miniaturistaDaSecretaria com o nativeImage verdadeiro", () => {
  it.skipIf(nativeImage === undefined)(
    "uma PNG de 1000 x 500 dá uma JPEG de 320 x 160 (salta fora do Electron: o vitest em Node não tem nativeImage)",
    async () => {
      const porta = nativeImage as typeof import("electron").nativeImage
      const pixeis = Buffer.alloc(1000 * 500 * 4, 0x80)
      const png = porta.createFromBitmap(pixeis, { width: 1000, height: 500 }).toPNG()
      const mini = await miniaturistaDaSecretaria(porta).fazer(new Uint8Array(png), "image/png")
      expect(mini?.tipo).toBe("image/jpeg")
      expect({ w: mini?.w, h: mini?.h }).toEqual({ w: 320, h: 160 })
      expect(mini?.bytes[0]).toBe(0xff)
      expect(mini?.bytes[1]).toBe(0xd8)
      expect(await miniaturistaDaSecretaria(porta).fazer(new Uint8Array([1, 2, 3]), "image/png")).toBeNull()
    },
  )
})
