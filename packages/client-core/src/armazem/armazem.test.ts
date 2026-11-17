import { randomBytes } from "node:crypto"
import { fromBase64, toBase64 } from "@enclave/protocol"
import { beforeEach, describe, expect, it } from "vitest"
import { ArmazemDeMedia, TECTOS_DO_ARMAZEM, type EventoDoArmazem } from "./armazem.js"
import { decifrarBlob } from "./blob.js"
import { ArmazemEmMemoria } from "./emMemoria.js"
import type { RefDeMedia } from "./tipos.js"

/**
 * The media store on the device: synchronous inventory, background writes, a
 * ceiling for originals only, LRU by last use, and thumbnails that never leave.
 * The clock is injected, so the LRU and the 60 s protection are proven without
 * waiting.
 *
 * Each blob is 22 bytes larger than the plaintext (6 for the header, 16 for the
 * tag): a 1000-byte plaintext takes 1022 in the store.
 */
const TEXTO = 1000
const BLOB = TEXTO + 22
const SEGUNDO = 1000

let relogio = 0
const agora = () => relogio

function media(c: RefDeMedia["c"] = "original", tamanho = TEXTO) {
  const bytes = Uint8Array.from(randomBytes(tamanho))
  const ref: RefDeMedia = {
    v: 1,
    k: toBase64(Uint8Array.from(randomBytes(32))),
    n: toBase64(Uint8Array.from(randomBytes(24))),
    b: tamanho,
    t: "image/png",
    f: "bytes",
    p: "data:image/png;base64,",
    c,
    at: relogio,
  }
  const sha = toBase64(Uint8Array.from(randomBytes(32)))
  return { bytes, ref, sha }
}

async function aberto(backend = new ArmazemEmMemoria()) {
  const armazem = new ArmazemDeMedia(backend, null, agora)
  const eventos: EventoDoArmazem[] = []
  armazem.aoMudar((e) => eventos.push(e))
  await armazem.abrir()
  return { armazem, backend, eventos }
}

beforeEach(() => {
  relogio = 1_000_000
})

describe("os valores do armazém", () => {
  it("são os do desenho", () => {
    expect(TECTOS_DO_ARMAZEM).toEqual({
      omissao: 500_000_000,
      opcoes: [250_000_000, 500_000_000, 1_000_000_000, 2_000_000_000, 0],
      ladoDaMiniatura: 320,
      miniaturaMaxBytes: 40_000,
      originalPequeno: 200_000,
      protegidoMs: 60_000,
      folgaDaQuota: 50_000_000,
    })
  })
})

describe("abrir e trancar", () => {
  it("antes de abrir, tem diz sempre false, mesmo com o blob no disco", async () => {
    const { armazem: primeiro, backend } = await aberto()
    const m = media()
    primeiro.absorver(m.bytes, m.ref, m.sha)
    await primeiro.drenar()

    const segundo = new ArmazemDeMedia(backend, null, agora)
    expect(segundo.tem(m.sha)).toBe(false)
    expect(await segundo.obter(m.sha, m.ref)).toBeNull()
    await segundo.abrir()
    expect(segundo.tem(m.sha)).toBe(true)
    expect(await segundo.obter(m.sha, m.ref)).toEqual(m.bytes)
  })

  it("absorver antes de abrir não guarda e emite falhou", async () => {
    const backend = new ArmazemEmMemoria()
    const armazem = new ArmazemDeMedia(backend, null, agora)
    const eventos: EventoDoArmazem[] = []
    armazem.aoMudar((e) => eventos.push(e))
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    expect(eventos).toEqual([{ sha: m.sha, estado: "falhou", erro: "media store failed" }])
    expect(await backend.ler(m.sha)).toBeNull()
  })

  it("abre com o tecto por omissão, e com o tecto guardado no backend", async () => {
    const { armazem, backend } = await aberto()
    expect(armazem.estado().tecto).toBe(500_000_000)
    await armazem.definirTecto(1_000_000_000)
    expect(await backend.lerTecto()).toBe(1_000_000_000)
    const outro = new ArmazemDeMedia(backend, null, agora)
    await outro.abrir()
    expect(outro.estado().tecto).toBe(1_000_000_000)
  })

  it("trancar faz tem false e obter null; o disco fica, e volta ao abrir", async () => {
    const { armazem, backend } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    armazem.trancar()
    expect(armazem.tem(m.sha)).toBe(false)
    expect(await armazem.obter(m.sha, m.ref)).toBeNull()
    expect(await backend.ler(m.sha)).not.toBeNull()
    await armazem.abrir()
    expect(await armazem.obter(m.sha, m.ref)).toEqual(m.bytes)
  })

  it("trancar com uma escrita na fila: a escrita já não vai ao disco (o backend pode ser de outra conta)", async () => {
    const { armazem, backend, eventos } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    armazem.trancar()
    await armazem.drenar()
    expect(armazem.tem(m.sha)).toBe(false)
    expect(await backend.ler(m.sha)).toBeNull()
    expect(eventos).toEqual([])
  })

  it("drenar antes de trancar leva a escrita ao disco", async () => {
    const { armazem, backend } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    armazem.trancar()
    expect(await backend.ler(m.sha)).not.toBeNull()
  })
})

describe("absorver e obter", () => {
  it("absorver marca o sha já, e obter devolve os bytes antes e depois da escrita", async () => {
    const { armazem, eventos } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    expect(armazem.tem(m.sha)).toBe(true)
    expect(await armazem.obter(m.sha, m.ref)).toEqual(m.bytes)
    await armazem.drenar()
    expect(eventos).toEqual([{ sha: m.sha, estado: "guardado" }])
    expect(await armazem.obter(m.sha, m.ref)).toEqual(m.bytes)
  })

  it("o disco só tem o blob cifrado, com o cabeçalho orwm1", async () => {
    const { armazem, backend } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    const blob = await backend.ler(m.sha)
    expect(new TextDecoder().decode(blob!.subarray(0, 6))).toBe("orwm1\n")
    expect(Buffer.from(blob!).indexOf(Buffer.from(m.bytes.subarray(0, 64)))).toBe(-1)
  })

  it("absorver o mesmo sha duas vezes escreve uma vez", async () => {
    const { armazem, eventos } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    expect(eventos).toEqual([{ sha: m.sha, estado: "guardado" }])
  })

  it("obter de um sha que não está dá null", async () => {
    const { armazem } = await aberto()
    const m = media()
    expect(await armazem.obter(m.sha, m.ref)).toBeNull()
  })

  it("obter com a chave errada lança media blob is damaged", async () => {
    const { armazem } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    const outra = { ...m.ref, k: toBase64(Uint8Array.from(randomBytes(32))) }
    await expect(armazem.obter(m.sha, outra)).rejects.toThrow("media blob is damaged")
  })

  it("obter com uma chave que nem é base64 lança media blob is damaged", async () => {
    const { armazem } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    await expect(armazem.obter(m.sha, { ...m.ref, k: "não é base64!" })).rejects.toThrow("media blob is damaged")
    // Since 1.3.15 a blob that does not open leaves the store (see "um blob que não abre"): it comes back to try the nonce.
    await armazem.drenar()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    await expect(armazem.obter(m.sha, { ...m.ref, n: "%%%" })).rejects.toThrow("media blob is damaged")
  })

  it("um blob que desapareceu do disco sai do inventário ao obter", async () => {
    const { armazem, backend } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    await backend.apagar([m.sha])
    expect(await armazem.obter(m.sha, m.ref)).toBeNull()
    expect(armazem.tem(m.sha)).toBe(false)
  })

  it("apagar tira do inventário e do disco, e emite saiu", async () => {
    const { armazem, backend, eventos } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    await armazem.apagar([m.sha])
    expect(armazem.tem(m.sha)).toBe(false)
    expect(await backend.ler(m.sha)).toBeNull()
    expect(eventos.at(-1)).toEqual({ sha: m.sha, estado: "saiu" })
  })
})

describe("o tecto e o LRU", () => {
  /** Three originals that fit in a 3100 ceiling; the fourth no longer does. */
  async function tresQueCabem() {
    const aberto_ = await aberto()
    await aberto_.armazem.definirTecto(3100)
    const [a, b, c] = [media(), media(), media()]
    for (const m of [a, b, c]) {
      aberto_.armazem.absorver(m.bytes, m.ref, m.sha)
      relogio += SEGUNDO
    }
    await aberto_.armazem.drenar()
    relogio += 100 * SEGUNDO
    return { ...aberto_, a, b, c }
  }

  it("faz sair o menos usado primeiro", async () => {
    const { armazem, backend, eventos, a, b, c } = await tresQueCabem()
    expect(await armazem.obter(a.sha, a.ref)).toEqual(a.bytes)
    relogio += SEGUNDO
    const d = media()
    armazem.absorver(d.bytes, d.ref, d.sha)
    await armazem.drenar()

    expect(armazem.tem(b.sha)).toBe(false)
    expect(await backend.ler(b.sha)).toBeNull()
    expect(eventos).toContainEqual({ sha: b.sha, estado: "saiu" })
    for (const m of [a, c, d]) expect(armazem.tem(m.sha)).toBe(true)
    expect(armazem.estado().usados).toBe(3 * BLOB)
  })

  it("o último uso fica no backend, e o LRU respeita-o depois de reabrir", async () => {
    const { armazem, backend, a, b, c } = await tresQueCabem()
    await armazem.obter(a.sha, a.ref)
    await armazem.drenar()
    armazem.trancar()
    await armazem.abrir()
    const d = media()
    armazem.absorver(d.bytes, d.ref, d.sha)
    await armazem.drenar()
    expect(armazem.tem(a.sha)).toBe(true)
    expect(armazem.tem(b.sha)).toBe(false)
    expect(armazem.tem(c.sha)).toBe(true)
    expect(await backend.ler(b.sha)).toBeNull()
  })

  it("nunca faz sair um fixado", async () => {
    const { armazem, a, b } = await tresQueCabem()
    armazem.fixar(a.sha)
    const d = media()
    armazem.absorver(d.bytes, d.ref, d.sha)
    await armazem.drenar()
    expect(armazem.tem(a.sha)).toBe(true)
    expect(armazem.tem(b.sha)).toBe(false)
  })

  it("fixar conta: duas vistas do mesmo sha precisam de dois soltar", async () => {
    const { armazem, a, b } = await tresQueCabem()
    armazem.fixar(a.sha)
    armazem.fixar(a.sha)
    armazem.soltar(a.sha)
    const d = media()
    armazem.absorver(d.bytes, d.ref, d.sha)
    await armazem.drenar()
    expect(armazem.tem(a.sha)).toBe(true)
    expect(armazem.tem(b.sha)).toBe(false)

    armazem.soltar(a.sha)
    relogio += 100 * SEGUNDO
    const e = media()
    armazem.absorver(e.bytes, e.ref, e.sha)
    await armazem.drenar()
    expect(armazem.tem(a.sha)).toBe(false)
  })

  it("nunca faz sair um escrito há menos de 60 s", async () => {
    const { armazem } = await aberto()
    await armazem.definirTecto(3100)
    const [a, b, c, d] = [media(), media(), media(), media()]
    for (const m of [a, b, c, d]) {
      armazem.absorver(m.bytes, m.ref, m.sha)
      relogio += SEGUNDO
    }
    await armazem.drenar()
    for (const m of [a, b, c, d]) expect(armazem.tem(m.sha)).toBe(true)
    expect(armazem.estado().usados).toBe(4 * BLOB)

    // a turned 60 s: it can now leave; b, c and d not yet.
    relogio = 1_000_000 + TECTOS_DO_ARMAZEM.protegidoMs
    const e = media()
    armazem.absorver(e.bytes, e.ref, e.sha)
    await armazem.drenar()
    expect(armazem.tem(a.sha)).toBe(false)
    for (const m of [b, c, d, e]) expect(armazem.tem(m.sha)).toBe(true)
  })

  it("uma miniatura nunca sai, e não conta para o tecto", async () => {
    const { armazem } = await aberto()
    await armazem.definirTecto(3100)
    const minis = Array.from({ length: 10 }, () => media("mini"))
    for (const m of minis) armazem.absorver(m.bytes, m.ref, m.sha)
    relogio += SEGUNDO
    const originais = Array.from({ length: 4 }, () => media())
    for (const m of originais) armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    relogio += 100 * SEGUNDO
    const outro = media()
    armazem.absorver(outro.bytes, outro.ref, outro.sha)
    await armazem.drenar()

    for (const m of minis) expect(armazem.tem(m.sha)).toBe(true)
    const estado = armazem.estado()
    expect(estado.minis).toBe(10)
    expect(estado.originais).toBe(3)
    expect(estado.usados).toBe(3 * BLOB)
  })

  it("um original maior do que o tecto não entra, emite falhou e fica em falta", async () => {
    const { armazem, backend, eventos } = await aberto()
    await armazem.definirTecto(3100)
    const grande = media("original", 4000)
    armazem.absorver(grande.bytes, grande.ref, grande.sha)
    expect(armazem.tem(grande.sha)).toBe(false)
    await armazem.drenar()
    expect(eventos).toEqual([{ sha: grande.sha, estado: "falhou", erro: "media store is full" }])
    expect(await backend.ler(grande.sha)).toBeNull()
    expect(armazem.estado().emFalta).toBe(1)
  })

  it("uma miniatura maior do que o tecto entra na mesma", async () => {
    const { armazem } = await aberto()
    await armazem.definirTecto(3100)
    const mini = media("mini", 4000)
    armazem.absorver(mini.bytes, mini.ref, mini.sha)
    await armazem.drenar()
    expect(armazem.tem(mini.sha)).toBe(true)
  })

  it("definirTecto(0) é sem tecto: não despeja nada", async () => {
    const { armazem, backend } = await aberto()
    await armazem.definirTecto(0)
    const muitos = Array.from({ length: 20 }, () => media())
    for (const m of muitos) armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    relogio += 100 * SEGUNDO
    const mais = media("original", 50_000)
    armazem.absorver(mais.bytes, mais.ref, mais.sha)
    await armazem.drenar()
    for (const m of [...muitos, mais]) expect(armazem.tem(m.sha)).toBe(true)
    expect(await backend.lerTecto()).toBe(0)
  })

  it("baixar o tecto despeja o que passa, logo", async () => {
    const { armazem, a, b, c } = await tresQueCabem()
    await armazem.definirTecto(2100)
    expect(armazem.tem(a.sha)).toBe(false)
    expect(armazem.tem(b.sha)).toBe(true)
    expect(armazem.tem(c.sha)).toBe(true)
  })

  it("um tecto negativo ou que não é número não se aceita", async () => {
    const { armazem } = await aberto()
    await expect(armazem.definirTecto(-1)).rejects.toThrow()
    await expect(armazem.definirTecto(Number.NaN)).rejects.toThrow()
    expect(armazem.estado().tecto).toBe(500_000_000)
  })
})

describe("as escritas que falham", () => {
  it("uma escrita falhada tira o sha do inventário e emite falhou", async () => {
    const { armazem, backend, eventos } = await aberto()
    backend.falharProxima()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    expect(armazem.tem(m.sha)).toBe(true)
    await armazem.drenar()
    expect(armazem.tem(m.sha)).toBe(false)
    expect(eventos).toEqual([{ sha: m.sha, estado: "falhou", erro: "media store is full" }])
    expect(armazem.estado().emFalta).toBe(1)

    // The next one already goes through, and the same sha comes back when it arrives again.
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    expect(armazem.tem(m.sha)).toBe(true)
    expect(armazem.estado().emFalta).toBe(0)
  })

  it("um erro desconhecido do backend chega como media store failed", async () => {
    const { armazem, backend, eventos } = await aberto()
    backend.falharProxima(new Error("EIO: i/o error"))
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    expect(eventos).toEqual([{ sha: m.sha, estado: "falhou", erro: "media store failed" }])
  })

  it("uma chave que nem é base64 não guarda e emite media store failed", async () => {
    const { armazem, eventos } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, { ...m.ref, k: "não é base64!" }, m.sha)
    await armazem.drenar()
    expect(armazem.tem(m.sha)).toBe(false)
    expect(eventos).toEqual([{ sha: m.sha, estado: "falhou", erro: "media store failed" }])
  })

  it("o backend cheio rejeita com media store is full", async () => {
    const backend = new ArmazemEmMemoria({ quota: 1500 })
    const m = media()
    await backend.escrever(m.sha, new Uint8Array(1000), { bytes: 1000, classe: "original", ultimoUso: 0 })
    await expect(
      backend.escrever(media().sha, new Uint8Array(1000), { bytes: 1000, classe: "original", ultimoUso: 0 }),
    ).rejects.toThrow("media store is full")

    const { armazem, eventos } = await aberto(backend)
    const n = media()
    armazem.absorver(n.bytes, n.ref, n.sha)
    await armazem.drenar()
    expect(armazem.tem(n.sha)).toBe(false)
    expect(eventos).toEqual([{ sha: n.sha, estado: "falhou", erro: "media store is full" }])
  })

  it("um backend selado recusa escritas", async () => {
    const { armazem, backend, eventos } = await aberto()
    backend.selar()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    expect(armazem.tem(m.sha)).toBe(false)
    expect(eventos).toEqual([{ sha: m.sha, estado: "falhou", erro: "media store failed" }])
  })
})

describe("o estado", () => {
  it("conta originais, minis, usados e o que está em falta", async () => {
    const { armazem } = await aberto()
    const [o1, o2] = [media(), media("original", 2000)]
    const [m1, m2, m3] = [media("mini"), media("mini"), media("mini")]
    for (const m of [o1, o2, m1, m2, m3]) armazem.absorver(m.bytes, m.ref, m.sha)
    expect(armazem.estado()).toEqual({ tecto: 500_000_000, usados: BLOB + 2022, usadosPelasMinis: 3 * BLOB, originais: 2, minis: 3, tectoEfectivo: 500_000_000, emFalta: 0 })
    await armazem.drenar()
    expect(armazem.estado()).toEqual({ tecto: 500_000_000, usados: BLOB + 2022, usadosPelasMinis: 3 * BLOB, originais: 2, minis: 3, tectoEfectivo: 500_000_000, emFalta: 0 })
  })

  it("o inventário reaberto conta o mesmo", async () => {
    const { armazem, backend } = await aberto()
    for (const m of [media(), media("mini")]) armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    const outro = new ArmazemDeMedia(backend, null, agora)
    await outro.abrir()
    expect(outro.estado()).toEqual({ tecto: 500_000_000, usados: BLOB, usadosPelasMinis: BLOB, originais: 1, minis: 1, tectoEfectivo: 500_000_000, emFalta: 0 })
  })
})

describe("reclassificar", () => {
  const comNonceNovo = (ref: RefDeMedia, c: RefDeMedia["c"]): RefDeMedia => ({ ...ref, c, n: toBase64(Uint8Array.from(randomBytes(24))) })

  it("recifra o blob com a classe nova: abre com a referência nova, não com a velha, e sai do tecto", async () => {
    const { armazem, backend } = await aberto()
    const { bytes, ref, sha } = media("original")
    armazem.absorver(bytes, ref, sha)
    const nova = comNonceNovo(ref, "mini")

    expect(await armazem.reclassificar(sha, ref, nova)).toBe(true)
    await armazem.drenar()

    expect(await armazem.obter(sha, nova)).toEqual(bytes)
    // The old reference no longer opens the blob on disk. Checked on the disk itself: `obter` with a
    // reference that does not open the blob now drops it (1.3.15, see "um blob que não abre").
    const noDisco = await backend.ler(sha)
    expect(() => decifrarBlob(noDisco!, fromBase64(ref.k), fromBase64(ref.n), sha, ref.c)).toThrow()
    expect(armazem.estado()).toMatchObject({ originais: 0, minis: 1, usadosPelasMinis: BLOB })
    expect(await backend.listar()).toEqual([expect.objectContaining({ sha, classe: "mini" })])

    relogio += 61 * SEGUNDO
    await armazem.definirTecto(1)
    expect(armazem.tem(sha)).toBe(true)

    const outro = new ArmazemDeMedia(backend, null, agora)
    await outro.abrir()
    expect(await outro.obter(sha, nova)).toEqual(bytes)
  })

  it("funciona com a escrita ainda na fila", async () => {
    const { armazem } = await aberto()
    const { bytes, ref, sha } = media("original")
    armazem.absorver(bytes, ref, sha)
    const nova = comNonceNovo(ref, "mini")
    expect(await armazem.reclassificar(sha, ref, nova)).toBe(true)
    expect(await armazem.obter(sha, nova)).toEqual(bytes)
    await armazem.drenar()
    expect(await armazem.obter(sha, nova)).toEqual(bytes)
  })

  it("recusa a mesma chave com o mesmo nonce, e diz false a um sha que não está", async () => {
    const { armazem } = await aberto()
    const { bytes, ref, sha } = media("original")
    armazem.absorver(bytes, ref, sha)
    await expect(armazem.reclassificar(sha, ref, { ...ref, c: "mini" })).rejects.toThrow(RangeError)
    expect(await armazem.reclassificar("outro", ref, comNonceNovo(ref, "mini"))).toBe(false)
  })
})

describe("shas", () => {
  it("lista o inventário, com o que ainda está na fila", async () => {
    const { armazem } = await aberto()
    const a = media()
    const b = media("mini")
    armazem.absorver(a.bytes, a.ref, a.sha)
    armazem.absorver(b.bytes, b.ref, b.sha)
    expect(armazem.shas().sort()).toEqual([a.sha, b.sha].sort())
    armazem.trancar()
    expect(armazem.shas()).toEqual([])
  })
})

describe("selar (Ruling R17)", () => {
  it("um armazém selado lê o que tem, e não escreve, não apaga, não reclassifica nem destrói", async () => {
    const { armazem, backend } = await aberto()
    const a = media()
    armazem.absorver(a.bytes, a.ref, a.sha)
    await armazem.drenar()
    armazem.selar()
    expect(armazem.selado).toBe(true)
    const b = media()
    armazem.absorver(b.bytes, b.ref, b.sha)
    await armazem.apagar([a.sha])
    await armazem.drenar()
    expect(armazem.tem(b.sha)).toBe(false)
    expect(await backend.ler(b.sha)).toBeNull()
    expect(await armazem.obter(a.sha, a.ref)).toEqual(a.bytes)
    const nova = { ...a.ref, n: toBase64(Uint8Array.from(randomBytes(24))), c: "mini" as const }
    expect(await armazem.reclassificar(a.sha, a.ref, nova)).toBe(false)
    await armazem.destruir()
    expect(await backend.ler(a.sha)).not.toBeNull()
  })
})

describe("libertar (Libertar espaço)", () => {
  it("tira todos os originais não fixados, mesmo os recentes; os fixados e as miniaturas ficam", async () => {
    const { armazem, backend, eventos } = await aberto()
    const [a, b, fixo] = [media(), media(), media()]
    const mini = media("mini")
    for (const m of [a, b, fixo, mini]) armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    const c = media()
    // Still in the queue: it leaves too, and never reaches the disk afterwards.
    armazem.absorver(c.bytes, c.ref, c.sha)
    armazem.fixar(fixo.sha)

    await armazem.libertar()
    await armazem.drenar()

    for (const m of [a, b, c]) {
      expect(armazem.tem(m.sha)).toBe(false)
      expect(await backend.ler(m.sha)).toBeNull()
      expect(eventos).toContainEqual({ sha: m.sha, estado: "saiu" })
    }
    expect(armazem.tem(fixo.sha)).toBe(true)
    expect(armazem.tem(mini.sha)).toBe(true)
    expect(await backend.ler(mini.sha)).not.toBeNull()
    expect(armazem.estado()).toMatchObject({ usados: BLOB, originais: 1, minis: 1, emFalta: 3 })
  })

  it("selado ou fechado, não tira nada", async () => {
    const { armazem, backend } = await aberto()
    const a = media()
    armazem.absorver(a.bytes, a.ref, a.sha)
    await armazem.drenar()
    armazem.selar()
    await armazem.libertar()
    expect(armazem.tem(a.sha)).toBe(true)
    expect(await backend.ler(a.sha)).not.toBeNull()
    armazem.trancar()
    await expect(armazem.libertar()).resolves.toBeUndefined()
  })
})

describe("a quota da plataforma (o browser)", () => {
  function comQuota(quota: number | null) {
    return Object.assign(new ArmazemEmMemoria(), { quota: async () => quota })
  }

  it("uma quota menor do que o tecto: o tecto efectivo é a quota menos 50 MB", async () => {
    const { armazem } = await aberto(comQuota(300_000_000))
    expect(armazem.estado()).toMatchObject({ tecto: 500_000_000, tectoEfectivo: 250_000_000 })
    await armazem.definirTecto(0)
    expect(armazem.estado()).toMatchObject({ tecto: 0, tectoEfectivo: 250_000_000 })
    await armazem.definirTecto(250_000_000)
    expect(armazem.estado()).toMatchObject({ tecto: 250_000_000, tectoEfectivo: 250_000_000 })
  })

  it("uma quota maior, ou nenhuma: o tecto efectivo é o escolhido", async () => {
    expect((await aberto(comQuota(10_000_000_000))).armazem.estado().tectoEfectivo).toBe(500_000_000)
    expect((await aberto(comQuota(null))).armazem.estado().tectoEfectivo).toBe(500_000_000)
    const { armazem } = await aberto(comQuota(null))
    await armazem.definirTecto(0)
    expect(armazem.estado().tectoEfectivo).toBe(0)
  })

  it("o tecto efectivo despeja como o escolhido, e um original maior do que ele não entra", async () => {
    const quota = TECTOS_DO_ARMAZEM.folgaDaQuota + 3100
    const { armazem, eventos } = await aberto(comQuota(quota))
    expect(armazem.estado().tectoEfectivo).toBe(3100)
    const [a, b, c] = [media(), media(), media()]
    for (const m of [a, b, c]) {
      armazem.absorver(m.bytes, m.ref, m.sha)
      relogio += SEGUNDO
    }
    await armazem.drenar()
    relogio += 100 * SEGUNDO
    const d = media()
    armazem.absorver(d.bytes, d.ref, d.sha)
    await armazem.drenar()
    expect(armazem.tem(a.sha)).toBe(false)
    expect(eventos).toContainEqual({ sha: a.sha, estado: "saiu" })
    const grande = media("original", 4000)
    armazem.absorver(grande.bytes, grande.ref, grande.sha)
    await armazem.drenar()
    expect(eventos).toContainEqual({ sha: grande.sha, estado: "falhou", erro: "media store is full" })
  })

  it("uma quota abaixo da folga não vira sem tecto", async () => {
    const { armazem } = await aberto(comQuota(10_000_000))
    expect(armazem.estado().tectoEfectivo).toBe(1)
  })
})

describe("um blob que não abre com a referência (1.3.15)", () => {
  /** The same sha, the same bytes, another key: what another account (or an import over an old store) leaves on disk. */
  const comOutraChave = (ref: RefDeMedia): RefDeMedia => ({
    ...ref,
    k: toBase64(Uint8Array.from(randomBytes(32))),
    n: toBase64(Uint8Array.from(randomBytes(24))),
  })

  it("obter lança, tira o sha do inventário e apaga o blob, e o Trazer seguinte reescreve-o com a chave certa", async () => {
    const { armazem, backend } = await aberto()
    const { bytes, ref, sha } = media("original")
    const alheia = comOutraChave(ref)
    armazem.absorver(bytes, alheia, sha)
    await armazem.drenar()

    await expect(armazem.obter(sha, ref)).rejects.toThrow("media blob is damaged")
    expect(armazem.tem(sha)).toBe(false)
    await armazem.drenar()
    expect(await backend.ler(sha)).toBeNull()
    expect(armazem.estado().emFalta).toBe(1)

    // "Fetch" brings the bytes again: the absorption writes them, with this account's key.
    armazem.absorver(bytes, ref, sha)
    await armazem.drenar()
    expect(await armazem.obter(sha, ref)).toEqual(bytes)
    // And it survives a reopen: the inventory comes from the disk.
    const outro = new ArmazemDeMedia(backend, null, agora)
    await outro.abrir()
    expect(await outro.obter(sha, ref)).toEqual(bytes)
  })

  it("reclassificar com um blob que não abre também o tira, e não escreve nada", async () => {
    const { armazem, backend } = await aberto()
    const { bytes, ref, sha } = media("original")
    armazem.absorver(bytes, comOutraChave(ref), sha)
    await armazem.drenar()
    const nova = { ...ref, c: "mini" as const, n: toBase64(Uint8Array.from(randomBytes(24))) }

    await expect(armazem.reclassificar(sha, ref, nova)).rejects.toThrow("media blob is damaged")
    await armazem.drenar()
    expect(armazem.tem(sha)).toBe(false)
    expect(await backend.ler(sha)).toBeNull()
  })

  it("uma referência velha a meio de uma reclassificação não apaga o blob novo", async () => {
    const { armazem } = await aberto()
    const { bytes, ref, sha } = media("original")
    armazem.absorver(bytes, ref, sha)
    await armazem.drenar()
    const nova = { ...ref, c: "mini" as const, n: toBase64(Uint8Array.from(randomBytes(24))) }
    // The reader took the reference just before the class changed.
    const leitura = armazem.obter(sha, ref)
    const reclassificada = armazem.reclassificar(sha, ref, nova)
    await leitura.catch(() => null)
    expect(await reclassificada).toBe(true)
    await armazem.drenar()
    expect(await armazem.obter(sha, nova)).toEqual(bytes)
  })

  it("selado, não apaga nada: só lança", async () => {
    const { armazem, backend } = await aberto()
    const { bytes, ref, sha } = media("original")
    armazem.absorver(bytes, comOutraChave(ref), sha)
    await armazem.drenar()
    armazem.selar()
    await expect(armazem.obter(sha, ref)).rejects.toThrow("media blob is damaged")
    await armazem.drenar()
    expect(await backend.ler(sha)).not.toBeNull()
  })

  it("trancado a meio de substituir um blob, a segunda metade (escrever) já não toca no disco", async () => {
    let abrirApagar!: () => void
    const portao = new Promise<void>((r) => (abrirApagar = r))
    class Lento extends ArmazemEmMemoria {
      escritasDepois = 0
      trancado = false
      override async apagar(shas: readonly string[]): Promise<void> {
        await portao
        return super.apagar(shas)
      }
      override async escrever(...a: Parameters<ArmazemEmMemoria["escrever"]>): Promise<void> {
        if (this.trancado) this.escritasDepois++
        return super.escrever(...a)
      }
    }
    const backend = new Lento()
    const { armazem } = await aberto(backend)
    const { bytes, ref, sha } = media("original")
    armazem.absorver(bytes, ref, sha)
    await armazem.drenar()
    const nova = { ...ref, c: "mini" as const, n: toBase64(Uint8Array.from(randomBytes(24))) }
    const reclassificada = armazem.reclassificar(sha, ref, nova)
    // Switch account on the desktop: the store locks, and the folder underneath changes.
    await new Promise((r) => setTimeout(r, 10))
    armazem.trancar()
    backend.trancado = true
    abrirApagar()
    await reclassificada.catch(() => false)
    await armazem.drenar()
    expect(backend.escritasDepois).toBe(0)
  })
})
describe("reclassificar espera pelo disco (1.3.15)", () => {
  it("só devolve true quando o blob novo já está no disco", async () => {
    let abrir!: () => void
    let portao: Promise<void> = Promise.resolve()
    class Lento extends ArmazemEmMemoria {
      override async escrever(...a: Parameters<ArmazemEmMemoria["escrever"]>): Promise<void> {
        await portao
        return super.escrever(...a)
      }
    }
    const backend = new Lento()
    const { armazem } = await aberto(backend)
    const { bytes, ref, sha } = media("original")
    armazem.absorver(bytes, ref, sha)
    await armazem.drenar()
    portao = new Promise<void>((r) => (abrir = r))
    const nova = { ...ref, c: "mini" as const, n: toBase64(Uint8Array.from(randomBytes(24))) }

    let resolvida = false
    const reclassificada = armazem.reclassificar(sha, ref, nova).then((v) => {
      resolvida = true
      return v
    })
    await new Promise((r) => setTimeout(r, 20))
    // The disk still has the old blob: the new reference must not be handed out yet.
    expect(resolvida).toBe(false)
    abrir()
    expect(await reclassificada).toBe(true)
    const noDisco = await backend.ler(sha)
    expect(decifrarBlob(noDisco!, fromBase64(nova.k), fromBase64(nova.n), sha, nova.c)).toEqual(bytes)
  })
})

/*
  Return from a minimized window: decrypting a 1 MB photo is
  ~150 ms on a slow laptop, on the thread that draws, right when the channel
  opens. With a `decifrador` (a Worker in the web app) the store hands the blob
  over and awaits the bytes; without one, it decrypts here, as before.
*/
describe("o decifrador fora da thread", () => {
  it("obter usa o decifrador quando existe, e os bytes são os mesmos", async () => {
    const { armazem } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    const { decifrarBlob } = await import("./blob.js")
    let chamadas = 0
    armazem.decifrador = async (blob, k, n, sha, classe) => {
      chamadas++
      return decifrarBlob(blob, k, n, sha, classe)
    }
    expect(await armazem.obter(m.sha, m.ref)).toEqual(m.bytes)
    expect(chamadas).toBe(1)
  })

  it("um decifrador que pára não apaga um blob bom: abre-se aqui", async () => {
    // A blob that does not open is deleted from disk; a Worker that stopped says nothing about the blob.
    const { armazem, backend } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, m.ref, m.sha)
    await armazem.drenar()
    armazem.decifrador = async () => {
      throw new Error("worker stopped")
    }
    expect(await armazem.obter(m.sha, m.ref)).toEqual(m.bytes)
    await armazem.drenar()
    expect(armazem.tem(m.sha)).toBe(true)
    expect(await backend.ler(m.sha)).not.toBeNull()
  })

  it("um decifrador que falha com um blob que não abre dá o mesmo erro de blob estragado", async () => {
    const { armazem } = await aberto()
    const m = media()
    armazem.absorver(m.bytes, { ...m.ref, k: toBase64(Uint8Array.from(randomBytes(32))) }, m.sha)
    await armazem.drenar()
    armazem.decifrador = async () => {
      throw new Error("worker stopped")
    }
    await expect(armazem.obter(m.sha, m.ref)).rejects.toThrow("media blob is damaged")
    expect(armazem.tem(m.sha)).toBe(false)
  })
})
