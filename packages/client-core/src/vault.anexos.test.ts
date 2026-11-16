import { describe, expect, it } from "vitest"
import { ArmazemDeMedia } from "./armazem/armazem.js"
import { ArmazemEmMemoria } from "./armazem/emMemoria.js"
import { absorverPayload } from "./armazem/referencias.js"
import { appendHistory, entryMediaBytes, newVaultContents, semBytes, type StoredChatMessage } from "./vault.js"

/**
 * What happens to a DOCUMENT stored in the vault.
 *
 * Up to version 2 the vault evicted media by budget, and the question was
 * whether a document counted. Since version 3 the vault keeps the REFERENCE and
 * the store keeps the bytes. The question becomes: **does the document count
 * as present, and does it become a reference without losing its name?**
 */

function documento(inline: string, nome = "contrato.pdf"): Record<string, unknown> {
  return {
    url: "",
    inline,
    key: "",
    nonce: "",
    digest: "",
    kind: "document",
    name: nome,
    mediaType: "application/pdf",
    byteLength: 1000,
  }
}

function entrada(seq: number, anexos: unknown[], chave: "attachments" | "media" = "attachments"): StoredChatMessage {
  return {
    channel: "!sala:s",
    seq,
    sender: "@a:s",
    at: seq,
    payload: {
      t: chave === "media" ? "post" : "message",
      id: `id-${seq}`,
      sentAt: seq,
      body: "veja isto",
      [chave]: anexos,
    },
  } as unknown as StoredChatMessage
}

const BYTES = `data:application/pdf;base64,${"A".repeat(200_000)}`

async function armazemAberto(): Promise<ArmazemDeMedia> {
  const armazem = new ArmazemDeMedia(new ArmazemEmMemoria(), null)
  await armazem.abrir()
  return armazem
}

describe("um documento no cofre", () => {
  it("PESA na contabilidade dos media, numa mensagem e numa publicação", () => {
    // `carriesBytes` looks for `inline`, and a document has it just as an image
    // does. A document that weighed zero would never be asked from a sibling.
    expect(entryMediaBytes(entrada(1, [documento(BYTES)]))).toBe(BYTES.length)
    expect(entryMediaBytes(entrada(1, [documento(BYTES)], "media"))).toBe(BYTES.length)
  })

  it("absorvido, fica uma referência com o nome, o tipo e o kind, e pesa o mesmo enquanto está presente", async () => {
    const armazem = await armazemAberto()
    const contents = newVaultContents()
    const absorvida = entrada(1, [documento(BYTES)])
    absorvida.payload = absorverPayload(contents, absorvida.payload, armazem)
    appendHistory(contents, "!sala:s", absorvida)

    const [anexo] = contents.history["!sala:s"]![0]!.payload.attachments as Record<string, unknown>[]
    expect(anexo).toMatchObject({ name: "contrato.pdf", mediaType: "application/pdf", kind: "document" })
    expect(anexo).not.toHaveProperty("inline")
    expect(typeof anexo!["ref"]).toBe("string")
    expect(semBytes(contents)).toEqual([])
    expect(entryMediaBytes(contents.history["!sala:s"]![0]!, (sha) => armazem.tem(sha), contents.media)).toBe(BYTES.length)
    // The original left the store: the reference stays, and weighs zero.
    expect(entryMediaBytes(contents.history["!sala:s"]![0]!, () => false, contents.media)).toBe(0)
  })

  it("muitos documentos grandes: o cofre já não despeja o mais antigo", () => {
    const contents = newVaultContents()
    const pedaco = `data:application/pdf;base64,${"A".repeat(1_000_000)}`
    for (let seq = 1; seq <= 5; seq++) appendHistory(contents, "!sala:s", entrada(seq, [documento(pedaco, `doc-${seq}.pdf`)]))
    const guardadas = contents.history["!sala:s"] ?? []
    expect(guardadas).toHaveLength(5)
    for (const guardada of guardadas) expect((guardada.payload.attachments as Record<string, unknown>[])[0]).not.toHaveProperty("evicted")
  })
})
