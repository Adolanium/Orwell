import { describe, expect, it, vi } from "vitest"
import { CacheDeMedia } from "./cacheDeMedia.js"

/** A URL creator that counts: a fake browser `blob:`. */
function enderecos() {
  let n = 0
  const vivos = new Set<string>()
  return {
    vivos,
    criar: (bytes: Uint8Array) => {
      const url = `blob:teste/${++n}/${bytes.length}`
      vivos.add(url)
      return url
    },
    revogar: (url: string) => {
      vivos.delete(url)
    },
  }
}

const bytes = (n: number) => new Uint8Array(n)

describe("cacheDeMedia", () => {
  it("pede os bytes uma vez por sha, mesmo com dois pedidos ao mesmo tempo", async () => {
    const e = enderecos()
    const cache = new CacheDeMedia(1_000, e.criar, e.revogar)
    const ler = vi.fn(async () => bytes(10))
    const [a, b] = await Promise.all([cache.obter("s1", "image/png", ler), cache.obter("s1", "image/png", ler)])
    expect(a).toBe(b)
    expect(ler).toHaveBeenCalledTimes(1)
    expect(cache.ja("s1")).toBe(a)
  })

  it("nulo não fica guardado: o pedido seguinte volta a ler", async () => {
    const e = enderecos()
    const cache = new CacheDeMedia(1_000, e.criar, e.revogar)
    const ler = vi.fn(async (): Promise<Uint8Array | null> => null)
    expect(await cache.obter("s1", "image/png", ler)).toBeNull()
    ler.mockResolvedValueOnce(bytes(5))
    expect(await cache.obter("s1", "image/png", ler)).toMatch(/^blob:/)
    expect(ler).toHaveBeenCalledTimes(2)
  })

  it("revoga o mais antigo ao sair do tecto, e nunca o que está preso no ecrã", async () => {
    const e = enderecos()
    const cache = new CacheDeMedia(100, e.criar, e.revogar)
    const a = await cache.obter("a", "", async () => bytes(40))
    const b = await cache.obter("b", "", async () => bytes(40))
    cache.prender("a")
    const c = await cache.obter("c", "", async () => bytes(40))
    // 120 > 100: the oldest that is not held leaves, "b".
    expect(e.vivos.has(b!)).toBe(false)
    expect(cache.ja("b")).toBeNull()
    expect(e.vivos.has(a!)).toBe(true)
    expect(e.vivos.has(c!)).toBe(true)
    cache.soltar("a")
    await cache.obter("d", "", async () => bytes(40))
    expect(e.vivos.has(a!)).toBe(false)
  })

  it("uma leitura em curso ao esvaziar não volta a entrar, e os presos saem", async () => {
    const e = enderecos()
    const cache = new CacheDeMedia(100, e.criar, e.revogar)
    let soltarLeitura: (bytes: Uint8Array) => void = () => {}
    const emCurso = cache.obter("a", "", () => new Promise((resolver) => (soltarLeitura = resolver)))
    cache.prender("b")
    cache.esvaziar()
    soltarLeitura(bytes(5))
    expect(await emCurso).toBeNull()
    expect(cache.ja("a")).toBeNull()
    expect(e.vivos.size).toBe(0)
    // "b" is no longer held: it leaves through the ceiling like the others.
    await cache.obter("b", "", async () => bytes(60))
    await cache.obter("c", "", async () => bytes(60))
    expect(cache.ja("b")).toBeNull()
  })

  it("ainda diz se o endereço continua válido", async () => {
    const e = enderecos()
    const cache = new CacheDeMedia(1_000, e.criar, e.revogar)
    const url = await cache.obter("a", "", async () => bytes(1))
    expect(cache.ainda("a", url!)).toBe(true)
    cache.esvaziar()
    expect(cache.ainda("a", url!)).toBe(false)
  })

  it("esvaziar revoga tudo", async () => {
    const e = enderecos()
    const cache = new CacheDeMedia(1_000, e.criar, e.revogar)
    await cache.obter("a", "", async () => bytes(1))
    await cache.obter("b", "", async () => bytes(1))
    cache.esvaziar()
    expect(e.vivos.size).toBe(0)
    expect(cache.ja("a")).toBeNull()
  })
})
