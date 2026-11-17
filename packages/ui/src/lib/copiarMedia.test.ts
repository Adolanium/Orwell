import { afterEach, describe, expect, it, vi } from "vitest"
import type { MediaItem } from "../types.js"
import { bytesDoItem, copiarImagem, guardarMedia, temBytes } from "./copiarMedia.js"

// 1x1 PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const IMAGEM: MediaItem = { name: "foto.png", mediaType: "image/png", inline: PNG }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("bytesDoItem", () => {
  it("só devolve bytes que estão aqui, nunca um endereço de rede", () => {
    expect(bytesDoItem(IMAGEM)).toBe(PNG)
    expect(bytesDoItem({ name: "a.png", mediaType: "image/png", url: "https://x.example/a.png" })).toBeNull()
    expect(bytesDoItem({ ...IMAGEM, evicted: true })).toBeNull()
  })
})

describe("copiarImagem", () => {
  it("escreve um PNG na área de transferência sem pedir nada à rede", async () => {
    const escritos: unknown[][] = []
    class FalsoItem {
      constructor(public dados: Record<string, Promise<Blob>>) {}
    }
    vi.stubGlobal("ClipboardItem", FalsoItem)
    vi.stubGlobal("navigator", { clipboard: { write: async (itens: unknown[]) => void escritos.push(itens) } })
    const fetchEspia = vi.fn()
    vi.stubGlobal("fetch", fetchEspia)
    expect(await copiarImagem(IMAGEM)).toBe("copiada")
    const item = escritos[0]?.[0] as FalsoItem
    const blob = await item.dados["image/png"]
    expect(blob?.type).toBe("image/png")
    expect(blob?.size).toBeGreaterThan(20)
    expect(fetchEspia).not.toHaveBeenCalled()
  })

  it("diz que o browser não sabe, e que o browser recusou, em casos diferentes", async () => {
    vi.stubGlobal("navigator", {})
    expect(await copiarImagem(IMAGEM)).toBe("sem-suporte")
    vi.stubGlobal("ClipboardItem", class {})
    vi.stubGlobal("navigator", {
      clipboard: {
        write: async () => {
          throw new DOMException("no", "NotAllowedError")
        },
      },
    })
    expect(await copiarImagem(IMAGEM)).toBe("recusada")
  })
})

describe("guardarMedia", () => {
  it("num ecrã de toque com share de ficheiros, abre a folha de partilha com os bytes", async () => {
    const share = vi.fn(async () => {})
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
    vi.stubGlobal("navigator", { share, canShare: () => true })
    expect(await guardarMedia(IMAGEM)).toBe(true)
    const ficheiro = (share.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0]
    expect(ficheiro?.name).toBe("foto.png")
    expect(ficheiro?.type).toBe("image/png")
    expect(ficheiro?.size).toBeGreaterThan(20)
  })

  it("fechar a folha de partilha não é erro nem descarrega à força", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
    vi.stubGlobal("navigator", {
      share: async () => {
        throw new DOMException("x", "AbortError")
      },
      canShare: () => true,
    })
    const clique = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    expect(await guardarMedia(IMAGEM)).toBe(true)
    expect(clique).not.toHaveBeenCalled()
  })

  it("com rato, ou sem share, descarrega pelo browser", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }))
    vi.stubGlobal("navigator", {})
    URL.createObjectURL = vi.fn(() => "blob:x")
    URL.revokeObjectURL = vi.fn()
    const clique = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    expect(await guardarMedia(IMAGEM)).toBe(true)
    expect(clique).toHaveBeenCalledTimes(1)
  })

  it("sem bytes, não faz nada e di-lo", async () => {
    expect(await guardarMedia({ ...IMAGEM, evicted: true })).toBe(false)
  })
})

describe("um item guardado por referência (no armazém de media deste aparelho)", () => {
  const BYTES = Uint8Array.from(atob(PNG.slice(PNG.indexOf(",") + 1)), (c) => c.charCodeAt(0))
  const POR_REFERENCIA: MediaItem = { name: "foto.png", mediaType: "image/png", ref: "sha-1" }

  it("descarrega os bytes que o armazém devolve", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }))
    vi.stubGlobal("navigator", {})
    let gravado: Blob | null = null
    URL.createObjectURL = vi.fn((blob: Blob) => {
      gravado = blob
      return "blob:x"
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    const ler = vi.fn(async () => BYTES)
    expect(await guardarMedia(POR_REFERENCIA, ler)).toBe(true)
    expect(ler).toHaveBeenCalledWith("sha-1")
    expect((gravado as Blob | null)?.size).toBe(BYTES.length)
  })

  it("copia a imagem como PNG", async () => {
    const escritos: unknown[][] = []
    vi.stubGlobal("ClipboardItem", class {
      constructor(public dados: Record<string, Promise<Blob>>) {}
    })
    vi.stubGlobal("navigator", { clipboard: { write: async (itens: unknown[]) => void escritos.push(itens) } })
    expect(await copiarImagem(POR_REFERENCIA, async () => BYTES)).toBe("copiada")
    const blob = await (escritos[0]?.[0] as { dados: Record<string, Promise<Blob>> }).dados["image/png"]
    expect(blob?.size).toBe(BYTES.length)
  })

  it("sem os bytes no armazém, não faz nada e di-lo; sem armazém, nem há entrada", async () => {
    expect(await guardarMedia(POR_REFERENCIA, async () => null)).toBe(false)
    expect(temBytes(POR_REFERENCIA)).toBe(false)
    expect(temBytes(POR_REFERENCIA, async () => null)).toBe(true)
    expect(temBytes({ ...POR_REFERENCIA, evicted: true }, async () => null)).toBe(false)
  })
})
