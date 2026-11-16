import { randomBytes } from "node:crypto"
import { Payload } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { newVaultContents, type StoredPayload } from "../vault.js"
import { ArmazemDeMedia } from "./armazem.js"
import { ArmazemEmMemoria } from "./emMemoria.js"
import { absorverPayload, paraOEcra, soInlineOuEvicted } from "./referencias.js"

/**
 * The core → bridge → interface path (Task 10): an item with `{ ref }` carries
 * the reference measurements (`w`, `h`, `mini`, `b`) and says whether the
 * original is missing on this device, so the interface reserves the box, shows
 * the thumbnail and picks the wall copy with the photo (R16). The wire never
 * carries them.
 */

const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

function png(largura: number, altura: number, tamanho = 60_000): Uint8Array {
  const cabecalho = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(largura), ...be32(altura), 8, 6, 0, 0, 0]
  const bytes = Uint8Array.from(randomBytes(Math.max(tamanho, cabecalho.length)))
  bytes.set(cabecalho, 0)
  return bytes
}

const dataUrl = (bytes: Uint8Array): string => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`

async function absorvido() {
  const armazem = new ArmazemDeMedia(new ArmazemEmMemoria(), null, () => 1)
  await armazem.abrir()
  const contents = newVaultContents()
  const inline = dataUrl(png(1200, 900))
  const payload = Payload.parse({
    t: "message",
    id: "mensagem-0001",
    sentAt: 1,
    body: "olá",
    attachments: [{ name: "a.png", mediaType: "image/png", byteLength: inline.length, kind: "image", inline }],
  }) as StoredPayload
  // A marker from an old sibling, as the vault stores it.
  ;(payload["attachments"] as unknown[]).push({ evicted: true, name: "b.png", mediaType: "image/png" })
  const guardado = absorverPayload(contents, payload, armazem)
  return { contents, guardado }
}

describe("paraOEcra", () => {
  it("põe w, h e b da referência no item, e o resto fica", async () => {
    const { contents, guardado } = await absorvido()
    const ecra = paraOEcra(guardado, contents.media ?? {}, () => true)
    const [foto, antiga] = ecra["attachments"] as Record<string, unknown>[]
    const ref = contents.media?.[foto?.["ref"] as string]
    expect(foto).toMatchObject({ name: "a.png", w: 1200, h: 900, b: ref?.b })
    expect(foto?.["falta"]).toBeUndefined()
    expect(antiga).toEqual({ evicted: true, name: "b.png", mediaType: "image/png" })
    // The stored one did not change.
    expect((guardado["attachments"] as Record<string, unknown>[])[0]?.["w"]).toBeUndefined()
  })

  it("diz quando o original não está neste aparelho, e leva a miniatura", async () => {
    const { contents, guardado } = await absorvido()
    const sha = (guardado["attachments"] as Record<string, unknown>[])[0]?.["ref"] as string
    contents.media![sha] = { ...contents.media![sha]!, mini: "mini-sha" }
    const ecra = paraOEcra(guardado, contents.media ?? {}, (s) => s !== sha)
    expect((ecra["attachments"] as Record<string, unknown>[])[0]).toMatchObject({ mini: "mini-sha", falta: true })
  })

  it("o retrato de um perfil leva as medidas; sem referências, o mesmo payload", async () => {
    const contents = newVaultContents()
    const semNada = Payload.parse({ t: "message", id: "mensagem-0002", sentAt: 1, body: "só texto" }) as StoredPayload
    expect(paraOEcra(semNada, contents.media ?? {}, () => true)).toBe(semNada)
    contents.media = { r: { v: 1, k: "k", n: "n", b: 900, t: "image/png", w: 64, h: 64, f: "bytes", p: "data:image/png;base64,", c: "mini", at: 1 } }
    const perfil = { t: "profile", displayName: "Ana", avatar: { ref: "r", name: "avatar", mediaType: "image/png" } } as StoredPayload
    expect(paraOEcra(perfil, contents.media, () => true)["avatar"]).toMatchObject({ ref: "r", w: 64, h: 64, b: 900 })
  })

  it("o fio nunca leva as medidas: a saída para um irmão tira-as com o ref", async () => {
    const { contents, guardado } = await absorvido()
    const ecra = paraOEcra(guardado, contents.media ?? {}, () => false)
    const fio = soInlineOuEvicted(ecra)
    expect((fio["attachments"] as Record<string, unknown>[])[0]).toEqual({ evicted: true, name: "a.png", mediaType: "image/png" })
  })
})
