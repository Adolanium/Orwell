import { randomBytes } from "node:crypto"
import { Payload } from "@enclave/protocol"
import { beforeEach, describe, expect, it } from "vitest"
import { cofreV2 } from "../testes/cofre-v2.js"
import { ArmazemDeMedia } from "./armazem/armazem.js"
import { ArmazemEmMemoria } from "./armazem/emMemoria.js"
import { absorverPayload } from "./armazem/referencias.js"
import {
  appendHistory,
  entradasDoCanal,
  entryMediaBytes,
  newVaultContents,
  semBytes,
  type StoredChatMessage,
  type StoredPayload,
} from "./vault.js"

/**
 * The version 3 invariant (design §0, rule 1): the vault carries no media
 * bytes. `semBytes` gives the paths where there are still bytes; empty is the
 * invariant. The negative tests prove the detector sees each of the shapes.
 */

const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

function png(largura: number, altura: number, tamanho = 2_000): Uint8Array {
  const bytes = Uint8Array.from(randomBytes(tamanho))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(largura), ...be32(altura), 8, 6, 0, 0, 0], 0)
  return bytes
}
const dataUrl = (bytes: Uint8Array): string => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`
const anexo = (inline: string) => ({ name: "foto.png", mediaType: "image/png", byteLength: inline.length, kind: "image", inline })

function publicacao(seq: number): StoredPayload {
  return Payload.parse({
    t: "post",
    id: `p-publicacao-${String(seq).padStart(3, "0")}`,
    postedAt: seq,
    caption: "o passeio",
    media: [anexo(dataUrl(png(800, 600))), { kind: "video", name: "v.mp4", mediaType: "video/mp4", byteLength: 10, poster: dataUrl(png(320, 240, 900)) }],
    links: [{ url: "https://example.org/", kind: "video", thumbnail: dataUrl(png(320, 180, 700)) }],
    tags: [],
  }) as StoredPayload
}

const entrada = (seq: number, payload: StoredPayload): StoredChatMessage => ({ seq, sender: "@ana:s", at: seq, payload })

let armazem: ArmazemDeMedia
beforeEach(async () => {
  armazem = new ArmazemDeMedia(new ArmazemEmMemoria(), null)
  await armazem.abrir()
})

describe("semBytes: o cofre sem bytes de media", () => {
  it("depois de appendHistory de uma entrada já absorvida, não há bytes no cofre", () => {
    const contents = newVaultContents()
    appendHistory(contents, "!feed:s", entrada(1, absorverPayload(contents, publicacao(1), armazem)))
    expect(entradasDoCanal(contents, "!feed:s")).toHaveLength(1)
    expect(Object.keys(contents.media ?? {}).length).toBeGreaterThanOrEqual(3)
    expect(semBytes(contents)).toEqual([])
  })

  it("uma entrada com inline que entra sem absorver é apanhada, com o caminho", () => {
    const contents = newVaultContents()
    appendHistory(contents, "!feed:s", entrada(1, publicacao(1)))
    const caminhos = semBytes(contents)
    expect(caminhos).toContain('estadoDoCanal["!feed:s"][0].payload.media[0].inline')
    expect(caminhos).toContain('estadoDoCanal["!feed:s"][0].payload.media[1].poster')
    expect(caminhos).toContain('estadoDoCanal["!feed:s"][0].payload.links[0].thumbnail')
  })

  it("vê as cinco formas num cofre da versão 2: inline, avatarDataUrl, b64, thumbnail e poster", () => {
    const caminhos = semBytes(cofreV2())
    for (const campo of ["inline", "avatarDataUrl", "b64", "thumbnail", "poster"]) {
      expect(caminhos.some((caminho) => caminho.endsWith(`.${campo}`))).toBe(true)
    }
    // Another person's portrait and the channel icon too.
    expect(caminhos.some((caminho) => caminho.startsWith("directory") && caminho.endsWith("avatar.inline"))).toBe(true)
    expect(caminhos.some((caminho) => caminho.startsWith("spaceMeta") && caminho.endsWith("icon.inline"))).toBe(true)
    // The `evicted` marker has no bytes, and does not count.
    expect(caminhos.some((caminho) => caminho.includes('history["!directa:s"][3]'))).toBe(false)
  })

  it("um data URL num url também é bytes", () => {
    const contents = newVaultContents()
    appendHistory(contents, "!a:s", entrada(1, { t: "message", id: "m-0000000001", attachments: [{ name: "a", mediaType: "image/png", url: "data:image/png;base64,AAAA" }] }))
    expect(semBytes(contents)).toEqual(['history["!a:s"][0].payload.attachments[0].url'])
  })
})

describe("o cofre deixa de despejar", () => {
  it("mais de 40 entradas com bytes numa sala: nenhuma perde os bytes", () => {
    const contents = newVaultContents()
    for (let seq = 1; seq <= 60; seq++) {
      appendHistory(contents, "!a:s", entrada(seq, { t: "message", id: `m-${String(seq).padStart(10, "0")}`, attachments: [anexo(`data:image/png;base64,${"A".repeat(200_000)}`)] }))
    }
    const lista = entradasDoCanal(contents, "!a:s")
    expect(lista).toHaveLength(60)
    for (const guardada of lista) expect((guardada.payload.attachments as Record<string, unknown>[])[0]).not.toHaveProperty("evicted")
  })
})

describe("entryMediaBytes(entrada, presente)", () => {
  it("conta as referências presentes, miniaturas incluídas, e não as que faltam", () => {
    const contents = newVaultContents()
    const absorvida = entrada(1, absorverPayload(contents, publicacao(1), armazem))
    const tudo = entryMediaBytes(absorvida, (sha) => armazem.tem(sha), contents.media)
    expect(tudo).toBeGreaterThan(0)
    const [foto, video] = absorvida.payload.media as { ref?: string; poster?: { ref: string } }[]
    const semFoto = entryMediaBytes(absorvida, (sha) => sha !== foto?.ref, contents.media)
    expect(semFoto).toBeGreaterThan(0)
    expect(semFoto).toBeLessThan(tudo)
    // Only the poster: the video thumbnail counts (lesson from 1.1.0).
    expect(entryMediaBytes(absorvida, (sha) => sha === video?.poster?.ref, contents.media)).toBeGreaterThan(0)
    expect(entryMediaBytes(absorvida, () => false, contents.media)).toBe(0)
  })

  it("o original fora e a miniatura presente: a entrada pesa a miniatura, e vence uma cópia despejada no relato", () => {
    const contents = newVaultContents()
    const payload = { t: "message", id: "m-0000000001", attachments: [anexo(dataUrl(png(800, 600, 3_000)))] } as StoredPayload
    const absorvida = entrada(5, absorverPayload(contents, payload, armazem))
    const sha = (absorvida.payload.attachments as { ref: string }[])[0]!.ref
    // A thumbnail made later (the thumbnailer), present in the vault and in the store.
    const mini = absorverPayload(contents, { t: "message", attachments: [anexo(dataUrl(png(320, 240, 800)))] } as StoredPayload, armazem)
    const shaDaMini = (mini.attachments as { ref: string }[])[0]!.ref
    contents.media![sha]!.mini = shaDaMini
    const presente = (s: string) => s !== sha
    expect(entryMediaBytes(absorvida, presente, contents.media)).toBeGreaterThan(0)
    const despejada = entrada(5, { ...payload, attachments: [{ evicted: true, name: "foto.png", mediaType: "image/png" }] })
    expect(entryMediaBytes(absorvida, presente, contents.media)).toBeGreaterThan(entryMediaBytes(despejada, presente, contents.media))

    // In the report: the evicted stored copy is confirmed by the server copy with only the thumbnail by reference.
    const c = newVaultContents()
    c.media = contents.media
    appendHistory(c, "!a:s", { ...despejada, relatada: true })
    appendHistory(c, "!a:s", absorvida)
    const ficou = entradasDoCanal(c, "!a:s")
    expect(ficou).toHaveLength(1)
    expect((ficou[0]!.payload.attachments as Record<string, unknown>[])[0]).toHaveProperty("ref", sha)
  })

  it("na unidade do inline: a referência presente pesa o que o inline pesaria", () => {
    const contents = newVaultContents()
    const payload = { t: "message", id: "m-0000000001", attachments: [anexo(dataUrl(png(800, 600, 3_000)))] } as StoredPayload
    const crua = entrada(1, payload)
    const absorvida = entrada(1, absorverPayload(contents, payload, armazem))
    expect(entryMediaBytes(absorvida, () => true, contents.media)).toBe(entryMediaBytes(crua))
  })

  it("continua a contar o inline que ainda exista, e o poster em texto", () => {
    const video = { kind: "video", name: "v.mp4", mediaType: "video/mp4", byteLength: 10, poster: "data:image/png;base64,AAAA" }
    expect(entryMediaBytes(entrada(1, { t: "post", id: "p-0000000001", media: [video] }))).toBe(video.poster.length)
  })
})
