import { randomBytes } from "node:crypto"
import { Payload, resumosDosAnexos } from "@enclave/protocol"
import { beforeEach, describe, expect, it } from "vitest"
import { newVaultContents, paraBase64Classico, type StoredPayload, type VaultContents } from "../vault.js"
import { ArmazemDeMedia, TECTOS_DO_ARMAZEM, type Miniaturista } from "./armazem.js"
import { ArmazemEmMemoria } from "./emMemoria.js"
import {
  absorverPayload,
  absorverRetrato,
  bytesPresentes,
  inflarPayload,
  inflarRef,
  pedirMiniatura,
  recolher,
  shasDoPayload,
  shasReferenciados,
} from "./referencias.js"

/**
 * The media references in the vault: absorb the bytes into the store, inflate
 * back the EXACT `inline` the authorship signed, and collect what nobody
 * references. The payloads are born from the protocol schema
 * (`Payload.parse`), as they arrive from the wire; the contents are born from
 * `newVaultContents()`.
 */

let relogio = 0
const agora = () => relogio

beforeEach(() => {
  relogio = 1_000_000
})

const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

/** A PNG with a real header (the dimensions) and `tamanho` bytes in all. */
function png(largura: number, altura: number, tamanho = 2_000): Uint8Array {
  const cabecalho = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(largura), ...be32(altura), 8, 6, 0, 0, 0]
  const bytes = Uint8Array.from(randomBytes(Math.max(tamanho, cabecalho.length)))
  bytes.set(cabecalho, 0)
  return bytes
}

/** The data URL as `FileReader` writes it: classic base64 with padding. */
const dataUrl = (tipo: string, bytes: Uint8Array): string => `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`

function anexo(nome: string, inline: string, mediaType = "image/png") {
  return { name: nome, mediaType, byteLength: inline.length, kind: "image", inline }
}

function mensagem(anexos: unknown[], id = "mensagem-0001"): StoredPayload {
  return Payload.parse({ t: "message", id, sentAt: 1, body: "olá", attachments: anexos }) as StoredPayload
}

function perfil(avatar?: unknown): StoredPayload {
  return Payload.parse({ t: "profile", displayName: "Ana", donations: [], updatedAt: 1, avatar }) as StoredPayload
}

async function armazemAberto(miniaturista: Miniaturista | null = null) {
  const armazem = new ArmazemDeMedia(new ArmazemEmMemoria(), miniaturista, agora)
  await armazem.abrir()
  return armazem
}

const lista = (payload: StoredPayload, chave: string) => payload[chave] as Record<string, unknown>[]

/** A fake, marked thumbnail; "nulo" plays a format the platform cannot decode. */
const marca = Uint8Array.from([0x52, 0x49, 0x46, 0x46])
const miniaturista = (resposta: "faz" | "nulo"): Miniaturista => ({
  async fazer(bytes) {
    if (resposta === "nulo") return null
    const mini = png(320, 240, 5_000)
    mini.set(marca, 100)
    mini.set(bytes.subarray(0, 8), 200)
    return { bytes: mini, tipo: "image/webp", w: 320, h: 240 }
  },
})

describe("paraBase64Classico", () => {
  it("escreve o que o Buffer (e o FileReader) escrevem, com enchimento", () => {
    for (let n = 0; n < 8; n++) {
      const bytes = Uint8Array.from(randomBytes(n))
      expect(paraBase64Classico(bytes)).toBe(Buffer.from(bytes).toString("base64"))
    }
    const grande = Uint8Array.from(randomBytes(100_001))
    expect(paraBase64Classico(grande)).toBe(Buffer.from(grande).toString("base64"))
  })
})

describe("absorverPayload", () => {
  it("(a) troca os dois inline por ref e regista duas referências com w e h", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    const original = mensagem([anexo("a.png", dataUrl("image/png", png(1000, 800))), anexo("b.png", dataUrl("image/png", png(640, 480)))])

    const absorvido = absorverPayload(contents, original, armazem)

    const itens = lista(absorvido, "attachments")
    expect(itens).toHaveLength(2)
    for (const item of itens) {
      expect(item.inline).toBeUndefined()
      expect(typeof item.ref).toBe("string")
      expect(item.name).toMatch(/\.png$/)
      expect(item.byteLength).toBeGreaterThan(0)
      expect(armazem.tem(item.ref as string)).toBe(true)
    }
    const refs = Object.values(contents.media ?? {})
    expect(refs).toHaveLength(2)
    expect(refs.map((r) => [r.w, r.h])).toEqual([
      [1000, 800],
      [640, 480],
    ])
    expect(refs.every((r) => r.f === "bytes" && r.p === "data:image/png;base64," && r.c === "original" && r.t === "image/png")).toBe(true)
    // The original did not change: whoever held it still sees the bytes.
    expect(typeof lista(original, "attachments")[0]?.inline).toBe("string")
  })

  it("(b) o mesmo retrato em dois perfis dá uma referência só", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    const retrato = dataUrl("image/png", png(400, 400, 30_000))

    const um = absorverPayload(contents, perfil({ name: "a.png", mediaType: "image/png", byteLength: 1, kind: "image", inline: retrato }), armazem)
    const dois = absorverPayload(contents, perfil({ name: "a.png", mediaType: "image/png", byteLength: 1, kind: "image", inline: retrato }), armazem)
    const proprio = absorverRetrato(contents, retrato, armazem)

    expect(Object.keys(contents.media ?? {})).toHaveLength(1)
    expect(shasDoPayload(um)).toEqual([proprio])
    expect(shasDoPayload(dois)).toEqual([proprio])
    // A small portrait never leaves through the ceiling.
    expect(contents.media?.[proprio]?.c).toBe("mini")
  })

  it("(f) as miniaturas dos cartões de link e os posters de vídeo absorvem-se como classe mini", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    const miniatura = dataUrl("image/jpeg", png(320, 180, 8_000))
    const poster = dataUrl("image/webp", png(320, 180, 9_000))
    const original = Payload.parse({
      t: "post",
      id: "publicacao-01",
      postedAt: 1,
      caption: "vê isto",
      media: [{ name: "v.mp4", mediaType: "video/mp4", byteLength: 5_000_000, kind: "video", poster }],
      links: [{ url: "https://exemplo.pt/", title: "Exemplo", thumbnail: miniatura }],
    }) as StoredPayload

    const absorvido = absorverPayload(contents, original, armazem)

    const cartao = lista(absorvido, "links")[0] as Record<string, unknown>
    const video = lista(absorvido, "media")[0] as Record<string, unknown>
    const shaDaMiniatura = (cartao.thumbnail as { ref: string }).ref
    const shaDoPoster = (video.poster as { ref: string }).ref
    expect(contents.media?.[shaDaMiniatura]?.c).toBe("mini")
    expect(contents.media?.[shaDoPoster]?.c).toBe("mini")
    expect(armazem.estado().minis).toBe(2)
    expect(shasDoPayload(absorvido).sort()).toEqual([shaDaMiniatura, shaDoPoster].sort())

    expect(await inflarPayload(contents, absorvido, armazem)).toEqual(original)
  })

  it("(h) um item já com ref ou evicted passa intacto", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    const absorvido = absorverPayload(contents, mensagem([anexo("a.png", dataUrl("image/png", png(10, 10)))]), armazem)
    const despejado = { evicted: true, name: "velho.png", mediaType: "image/png" }
    const misto = { ...absorvido, attachments: [...lista(absorvido, "attachments"), despejado] }
    const antes = structuredClone(contents.media)

    const outraVez = absorverPayload(contents, misto, armazem)

    expect(outraVez).toEqual(misto)
    expect(contents.media).toEqual(antes)
  })

  it("uma imagem até 320 px e 40 KB é a sua própria miniatura logo ao absorver", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    const absorvido = absorverPayload(contents, mensagem([anexo("p.png", dataUrl("image/png", png(300, 200, 20_000)))]), armazem)
    const [sha] = shasDoPayload(absorvido)
    expect(contents.media?.[sha as string]).toMatchObject({ c: "mini", mini: sha })
  })
})

describe("inflarPayload", () => {
  it("(c) devolve o inline byte a byte: base64 sem enchimento, prefixo com charset, e o canónico", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    // 1001 bytes: classic base64 ends in "==", and without padding it is no longer canonical.
    const bytes = png(500, 500, 1_001)
    const classico = Buffer.from(bytes).toString("base64")
    const semEnchimento = `data:image/png;base64,${classico.replace(/=+$/, "")}`
    const comCharset = `data:image/png;charset=x;base64,${classico}`
    const canonico = `data:image/png;base64,${classico}`
    const original = mensagem([anexo("1.png", semEnchimento), anexo("2.png", comCharset), anexo("3.png", canonico)])

    const absorvido = absorverPayload(contents, original, armazem)
    const shas = shasDoPayload(absorvido)
    expect(shas.map((sha) => contents.media?.[sha]?.f)).toEqual(["texto", "texto", "bytes"])

    const inflado = await inflarPayload(contents, absorvido, armazem)
    const inlines = lista(inflado, "attachments").map((item) => item.inline)
    expect(inlines).toEqual([semEnchimento, comCharset, canonico])
    expect(inflado).toEqual(original)
    expect(JSON.stringify(inflado)).toBe(JSON.stringify(original))
    for (const [i, sha] of shas.entries()) expect(await inflarRef(contents, sha, armazem)).toBe(inlines[i])
  })

  it("(d) os resumos que a autoria assina são os mesmos depois de dar a volta", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    const bytes = png(800, 600, 3_002)
    const original = mensagem([
      anexo("a.png", dataUrl("image/png", bytes)),
      anexo("b.png", `data:image/png;base64,${Buffer.from(bytes).toString("base64").replace(/=+$/, "")}`),
    ])
    const retrato = perfil({ name: "r.png", mediaType: "image/png", byteLength: 1, kind: "image", inline: dataUrl("image/png", png(200, 200)) })

    for (const payload of [original, retrato]) {
      const inflado = await inflarPayload(contents, absorverPayload(contents, payload, armazem), armazem)
      expect(resumosDosAnexos(inflado)).toEqual(resumosDosAnexos(payload))
    }
  })

  it("(e) acima de maxBytes o item vai como evicted, com nome e tipo", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    const pequeno = dataUrl("image/png", png(100, 100, 1_000))
    const original = mensagem([anexo("pequeno.png", pequeno), anexo("grande.png", dataUrl("image/png", png(2000, 2000, 60_000)))])
    const absorvido = absorverPayload(contents, original, armazem)

    const inflado = await inflarPayload(contents, absorvido, armazem, { maxBytes: 48 * 1024 })

    const [a, b] = lista(inflado, "attachments")
    expect(a?.inline).toBe(pequeno)
    expect(b).toEqual({ evicted: true, name: "grande.png", mediaType: "image/png" })
  })

  it("um blob que já não está vai como evicted, e um cartão fica sem miniatura", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    const original = Payload.parse({
      t: "post",
      id: "publicacao-02",
      postedAt: 1,
      caption: "",
      media: [anexo("a.png", dataUrl("image/png", png(1000, 1000)))],
      links: [{ url: "https://exemplo.pt/", thumbnail: dataUrl("image/png", png(32, 32)) }],
    }) as StoredPayload
    const absorvido = absorverPayload(contents, original, armazem)
    await armazem.apagar(shasDoPayload(absorvido))

    const inflado = await inflarPayload(contents, absorvido, armazem)

    expect(lista(inflado, "media")[0]).toEqual({ evicted: true, name: "a.png", mediaType: "image/png" })
    expect(lista(inflado, "links")[0]).toEqual({ url: "https://exemplo.pt/", kind: "link" })
    expect(await inflarRef(contents, shasDoPayload(absorvido)[0] as string, armazem)).toBeNull()
  })
})

describe("recolher", () => {
  it("(g) apaga o que nenhuma entrada referencia, órfãos incluídos, e deixa o resto", async () => {
    const armazem = await armazemAberto(miniaturista("faz"))
    const contents: VaultContents = newVaultContents()
    const fica = absorverPayload(contents, mensagem([anexo("fica.png", dataUrl("image/png", png(900, 900)))], "mensagem-fica"), armazem)
    const sai = absorverPayload(contents, mensagem([anexo("sai.png", dataUrl("image/png", png(901, 901)))], "mensagem-sai"), armazem)
    const doDiretorio = absorverPayload(contents, perfil({ name: "r.png", mediaType: "image/png", byteLength: 1, kind: "image", inline: dataUrl("image/png", png(64, 64)) }), armazem)
    contents.history.canal = [{ seq: 1, sender: "@a:x", at: 1, payload: fica }]
    contents.directory["@b:x"] = { at: 1, payload: doDiretorio }
    contents.profile.avatarRef = absorverRetrato(contents, dataUrl("image/png", png(128, 128)), armazem)
    // An orphan from a crash: the blob entered the store and the vault never wrote it.
    const orfao = newVaultContents()
    const [shaDoOrfao] = shasDoPayload(absorverPayload(orfao, mensagem([anexo("o.png", dataUrl("image/png", png(77, 77)))]), armazem))

    const [shaQueFica] = shasDoPayload(fica)
    const [shaQueSai] = shasDoPayload(sai)
    await pedirMiniatura(contents, shaQueFica as string, armazem)
    const referenciados = shasReferenciados(contents)
    expect(referenciados.has(shaQueFica as string)).toBe(true)
    expect(referenciados.has(contents.profile.avatarRef)).toBe(true)

    const apagados = await recolher(contents, armazem)

    expect(apagados.sort()).toEqual([shaQueSai, shaDoOrfao].sort())
    expect(armazem.tem(shaQueSai as string)).toBe(false)
    expect(armazem.tem(shaDoOrfao as string)).toBe(false)
    expect(contents.media?.[shaQueSai as string]).toBeUndefined()
    for (const sha of referenciados) {
      expect(armazem.tem(sha)).toBe(true)
      expect(contents.media?.[sha]).toBeDefined()
    }
    expect(await recolher(contents, armazem)).toEqual([])
  })
})

describe("bytesPresentes", () => {
  it("conta todas as referências presentes, miniaturas dos cartões e posters incluídos", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    const imagem = png(1000, 1000, 10_000)
    const miniatura = png(32, 32, 1_000)
    const poster = png(320, 180, 2_000)
    const absorvido = absorverPayload(
      contents,
      Payload.parse({
        t: "post",
        id: "publicacao-03",
        postedAt: 1,
        caption: "",
        media: [anexo("a.png", dataUrl("image/png", imagem)), { name: "v.mp4", mediaType: "video/mp4", byteLength: 9, kind: "video", poster: dataUrl("image/png", poster) }],
        links: [{ url: "https://exemplo.pt/", thumbnail: dataUrl("image/png", miniatura) }],
      }) as StoredPayload,
      armazem,
    )

    expect(bytesPresentes(contents, absorvido, armazem)).toBe(10_000 + 1_000 + 2_000)
    const cartao = lista(absorvido, "links")[0] as { thumbnail: { ref: string } }
    await armazem.apagar([cartao.thumbnail.ref])
    expect(bytesPresentes(contents, absorvido, armazem)).toBe(10_000 + 2_000)
  })
})

describe("pedirMiniatura", () => {
  it("(i) faz a miniatura e regista-a como mini ao lado do original", async () => {
    const armazem = await armazemAberto(miniaturista("faz"))
    const contents = newVaultContents()
    const [sha] = shasDoPayload(absorverPayload(contents, mensagem([anexo("a.png", dataUrl("image/png", png(1600, 1200, 300_000)))]), armazem))

    await pedirMiniatura(contents, sha as string, armazem)

    const ref = contents.media?.[sha as string]
    expect(ref?.c).toBe("original")
    const miniSha = ref?.mini as string
    expect(miniSha).toBeDefined()
    expect(miniSha).not.toBe(sha)
    expect(contents.media?.[miniSha]).toMatchObject({ c: "mini", t: "image/webp", w: 320, h: 240, f: "bytes", p: "data:image/webp;base64," })
    expect(armazem.tem(miniSha)).toBe(true)
    expect((await inflarRef(contents, miniSha, armazem))?.startsWith("data:image/webp;base64,")).toBe(true)
  })

  it("(i) um original até 200 KB sem miniatura passa a classe mini, abre com a referência nova e nunca sai pelo tecto", async () => {
    const armazem = await armazemAberto(miniaturista("nulo"))
    const contents = newVaultContents()
    const inline = dataUrl("image/avif", png(1600, 1200, 150_000))
    const absorvido = absorverPayload(contents, mensagem([anexo("a.avif", inline, "image/avif")]), armazem)
    const [sha] = shasDoPayload(absorvido)
    const [grande] = shasDoPayload(absorverPayload(contents, mensagem([anexo("g.avif", dataUrl("image/avif", png(1600, 1200, 250_000)), "image/avif")]), armazem))
    const antes = { ...contents.media?.[sha as string] }

    await pedirMiniatura(contents, sha as string, armazem)
    await pedirMiniatura(contents, grande as string, armazem)
    await armazem.drenar()

    const ref = contents.media?.[sha as string]
    expect(ref?.c).toBe("mini")
    expect(ref?.n).not.toBe(antes.n)
    expect(contents.media?.[grande as string]?.c).toBe("original")
    expect(armazem.estado()).toMatchObject({ minis: 1, originais: 1 })
    expect(await inflarRef(contents, sha as string, armazem)).toBe(inline)

    relogio += TECTOS_DO_ARMAZEM.protegidoMs + 1
    await armazem.definirTecto(1)
    await armazem.drenar()
    expect(armazem.tem(sha as string)).toBe(true)
    expect(armazem.tem(grande as string)).toBe(false)
    expect((await inflarPayload(contents, absorvido, armazem)).attachments).toEqual(lista(mensagem([anexo("a.avif", inline, "image/avif")]), "attachments"))
  })
})

describe("recolher com os em voo", () => {
  it("um media absorvido antes de o payload entrar no cofre não sai se está em voo", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    const bytes = png(500, 500, 3_000)
    absorverPayload(contents, mensagem([anexo("a.png", dataUrl("image/png", bytes))]), armazem)
    const [sha] = Object.keys(contents.media ?? {})
    await armazem.drenar()
    expect(await recolher(contents, armazem, new Set([sha!]))).toEqual([])
    expect(contents.media?.[sha!]).toBeDefined()
    expect(await recolher(contents, armazem)).toEqual([sha])
  })
})
