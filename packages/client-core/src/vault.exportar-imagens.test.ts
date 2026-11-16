import { randomBytes } from "node:crypto"
import { Payload, toBase64 } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { ArmazemDeMedia } from "./armazem/armazem.js"
import { TECTO_DO_FICHEIRO_SIMPLES, fonteDeBlob, fonteDeBytes, type FonteDeBytes } from "./armazem/contentor.js"
import { ArmazemEmMemoria } from "./armazem/emMemoria.js"
import { absorverPayload, inflarRef } from "./armazem/referencias.js"
import { CABECALHO_DO_COFRE, semCabecalho } from "./cabecalhoDoCofre.js"
import { appendHistory, Vault, type RefDeMedia, type StoredPayload, type VaultBackend } from "./vault.js"

/**
 * Exporting the account with the images, by choice (Task 11b, design §9 and §13).
 *
 * Without the checkbox, the file is the usual one: only the vault, with the
 * references. With the checkbox, a container also carries the store blobs, as
 * they are (they are already encrypted with keys only the vault has). Import
 * accepts both, and only writes a blob after the passphrase opens the vault.
 */

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

const FRASE = "frase-de-viagem"
const CANAL = "!feed:s"

const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
function png(largura: number, altura: number, tamanho = 2_000): Uint8Array {
  const bytes = Uint8Array.from(randomBytes(tamanho))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(largura), ...be32(altura), 8, 6, 0, 0, 0], 0)
  return bytes
}
const dataUrl = (bytes: Uint8Array): string => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`

function mensagem(inline: string): StoredPayload {
  return Payload.parse({
    t: "message",
    id: "mensagem-0001",
    sentAt: 1,
    body: "olá",
    attachments: [{ name: "foto.png", mediaType: "image/png", byteLength: inline.length, kind: "image", inline }],
  }) as StoredPayload
}

/** An open vault, with a store attached and one image absorbed. */
async function origemComImagem() {
  const backend = new MemoryBackend()
  const vault = new Vault(backend)
  await vault.create(FRASE)
  const armazem = new ArmazemDeMedia(new ArmazemEmMemoria(), null)
  vault.ligarArmazem(armazem)
  await vault.armazemPronto()
  const imagem = png(800, 600, 5_000)
  const inline = dataUrl(imagem)
  await vault.update((c) => {
    appendHistory(c, CANAL, { seq: 1, sender: "@ana:s", at: 1, payload: absorverPayload(c, mensagem(inline), armazem) })
  })
  await armazem.drenar()
  const shas = Object.keys(vault.contents.media ?? {})
  expect(shas.length).toBeGreaterThan(0)
  return { backend, vault, armazem, imagem, inline, sha: shas[0] as string }
}

/** The destination: a device with its own account, and an in-memory store with the backend in view. */
async function destino() {
  const backend = new MemoryBackend()
  const local = new Vault(backend)
  await local.create("conta-local")
  const antes = backend.bytes
  const disco = new ArmazemEmMemoria()
  const armazem = new ArmazemDeMedia(disco, null)
  return { backend, antes, disco, armazem, vault: new Vault(backend) }
}

async function juntar(partes: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const lista: Uint8Array[] = []
  for await (const parte of partes) lista.push(parte)
  return new Uint8Array(await new Blob(lista).arrayBuffer())
}

describe("exportar a conta sem as imagens", () => {
  it("é o ficheiro de sempre: cabeçalho e o JSON do envelope, sem mediaCount nem blobs", async () => {
    const { backend, vault } = await origemComImagem()
    const ficheiro = await vault.exportVault()
    const texto = new TextDecoder().decode(ficheiro)
    expect(texto.startsWith(CABECALHO_DO_COFRE + "{")).toBe(true)
    const envelope = JSON.parse(semCabecalho(ficheiro) as string) as Record<string, unknown>
    expect(Object.keys(envelope).sort()).toEqual(["exportedAt", "format", "formatVersion", "vault"])
    // The envelope vault is the disk's, byte for byte.
    expect(envelope["vault"]).toEqual(JSON.parse(semCabecalho(backend.bytes as Uint8Array) as string))
  }, 30_000)

  it("(a) importado noutro aparelho: o cofre igual, o armazém vazio, a referência fica e a imagem está em falta", async () => {
    const { vault, sha } = await origemComImagem()
    const ficheiro = await vault.exportVault()
    const d = await destino()
    await d.vault.importVault(ficheiro, FRASE, { armazem: d.armazem })
    expect(await d.disco.listar()).toEqual([])
    await d.vault.unlock(FRASE)
    expect(d.vault.contents.media?.[sha]).toEqual(vault.contents.media?.[sha])
    await d.armazem.abrir()
    expect(await inflarRef(d.vault.contents, sha, d.armazem)).toBeNull()
  }, 30_000)
})

describe("exportar a conta com as imagens", () => {
  it("(b) os blobs chegam tal e qual, `obter` devolve os bytes, e `inflarRef` dá o inline exacto", async () => {
    const { vault, armazem, imagem, inline, sha } = await origemComImagem()
    const ficheiro = await juntar(await vault.exportarComImagens(undefined, armazem))
    const envelope = JSON.parse(new TextDecoder().decode(ficheiro.subarray(20, 20 + Number(new DataView(ficheiro.buffer).getBigUint64(12)))))
    expect(envelope.mediaCount).toBe(armazem.shas().length)
    expect(envelope.format).toBe("enclave-vault")

    const d = await destino()
    await d.vault.importVault(fonteDeBlob(new Blob([ficheiro])), FRASE, { armazem: d.armazem })
    // The blobs are the source store's, not re-encrypted.
    for (const s of armazem.shas()) {
      expect(await d.disco.ler(s)).toEqual(await armazem.lerEmBruto(s))
    }
    await d.vault.unlock(FRASE)
    await d.armazem.abrir()
    expect(await inflarRef(d.vault.contents, sha, d.armazem)).toBe(inline)
    expect(await d.armazem.obter(sha, d.vault.contents.media?.[sha] as RefDeMedia)).toEqual(imagem)
  }, 30_000)

  it("por cima de um armazém usado: o blob da conta antiga com o mesmo sha sai, e a imagem abre com a chave importada (1.3.15)", async () => {
    const { vault, armazem, imagem, sha } = await origemComImagem()
    const ficheiro = await juntar(await vault.exportarComImagens(undefined, armazem))
    const d = await destino()
    // The account that was here had the same image, under its own key (a friend's portrait, a shared channel).
    const aleatorio = (n: number) => toBase64(Uint8Array.from(randomBytes(n)))
    const daAntiga = { ...(vault.contents.media?.[sha] as RefDeMedia), k: aleatorio(32), n: aleatorio(24) }
    await d.armazem.abrir()
    d.armazem.absorver(imagem, daAntiga, sha)
    // And another blob only it had.
    const soDaAntiga = aleatorio(32)
    d.armazem.absorver(new Uint8Array([9, 9, 9]), { ...daAntiga, b: 3 }, soDaAntiga)
    await d.armazem.drenar()

    await d.vault.importVault(fonteDeBlob(new Blob([ficheiro])), FRASE, { armazem: d.armazem })

    expect(await d.disco.ler(soDaAntiga)).toBeNull()
    await d.vault.unlock(FRASE)
    await d.armazem.abrir()
    expect(await d.armazem.obter(sha, d.vault.contents.media?.[sha] as RefDeMedia)).toEqual(imagem)
  }, 30_000)

  it("só escreve os blobs que o cofre importado referencia", async () => {
    const { vault, armazem } = await origemComImagem()
    // An orphan in the source store: no reference holds it.
    const orfao = toBase64(Uint8Array.from(randomBytes(32)))
    const aleatorio = (n: number) => toBase64(Uint8Array.from(randomBytes(n)))
    armazem.absorver(new Uint8Array([1, 2, 3]), { v: 1, k: aleatorio(32), n: aleatorio(24), b: 3, t: "image/png", f: "bytes", c: "original", at: 1 }, orfao)
    await armazem.drenar()
    const ficheiro = await juntar(await vault.exportarComImagens(undefined, armazem))
    const d = await destino()
    await d.vault.importVault(ficheiro, FRASE, { armazem: d.armazem })
    const escritos = (await d.disco.listar()).map((b) => b.sha)
    expect(escritos).not.toContain(orfao)
    expect(escritos.sort()).toEqual(Object.keys(vault.contents.media ?? {}).sort())
  }, 30_000)

  it("(c) uma frase errada não escreve nada: nem o cofre nem o armazém", async () => {
    const { vault, armazem } = await origemComImagem()
    const ficheiro = await juntar(await vault.exportarComImagens(undefined, armazem))
    const d = await destino()
    await expect(d.vault.importVault(ficheiro, "frase-errada", { armazem: d.armazem })).rejects.toThrow("wrong passphrase, or the vault is damaged")
    expect(d.backend.bytes).toBe(d.antes)
    expect(await d.disco.listar()).toEqual([])
  }, 30_000)

  it("(d) um contentor cortado a meio de um blob falha e não escreve nada", async () => {
    const { vault, armazem } = await origemComImagem()
    const ficheiro = await juntar(await vault.exportarComImagens(undefined, armazem))
    const d = await destino()
    await expect(d.vault.importVault(ficheiro.subarray(0, ficheiro.length - 7), FRASE, { armazem: d.armazem })).rejects.toThrow(
      "this is not an enclave account file",
    )
    expect(d.backend.bytes).toBe(d.antes)
    expect(await d.disco.listar()).toEqual([])
  }, 30_000)

  it("sem armazém no destino, o contentor entra só com o cofre", async () => {
    const { vault, armazem, sha } = await origemComImagem()
    const ficheiro = await juntar(await vault.exportarComImagens(undefined, armazem))
    const d = await destino()
    await d.vault.importVault(ficheiro, FRASE)
    await d.vault.unlock(FRASE)
    expect(d.vault.contents.media?.[sha]).toBeDefined()
  }, 30_000)
})

/**
 * Fix, round 1: once the vault is written, an image that does not stay (disk
 * full, a file that stops being readable) never makes the import fail. The
 * import says how many got in and how many were left missing, so the screen
 * can say it ("nobody loses anything without knowing", design §13).
 */
describe("importar com as imagens: o que não fica, conta-se", () => {
  async function duasImagens() {
    const origem = await origemComImagem()
    const outra = dataUrl(png(640, 480, 3_000))
    await origem.vault.update((c) => {
      appendHistory(c, CANAL, { seq: 2, sender: "@ana:s", at: 2, payload: absorverPayload(c, { ...mensagem(outra), id: "mensagem-0002" } as StoredPayload, origem.armazem) })
    })
    await origem.armazem.drenar()
    const total = Object.keys(origem.vault.contents.media ?? {}).length
    expect(total).toBeGreaterThanOrEqual(2)
    return { ...origem, total, ficheiro: await juntar(await origem.vault.exportarComImagens(undefined, origem.armazem)) }
  }

  it("sem nada a falhar: todas entram, nenhuma em falta", async () => {
    const { ficheiro, total } = await duasImagens()
    const d = await destino()
    expect(await d.vault.importVault(ficheiro, FRASE, { armazem: d.armazem })).toEqual({ imagens: total, emFalta: 0 })
  }, 30_000)

  it("disco cheio a meio: a conta entra, e o resultado diz quantas ficaram em falta", async () => {
    const { ficheiro, total } = await duasImagens()
    const d = await destino()
    d.disco.falharProxima()
    const resultado = await d.vault.importVault(ficheiro, FRASE, { armazem: d.armazem })
    expect(resultado).toEqual({ imagens: 0, emFalta: total })
    await d.vault.unlock(FRASE)
    expect(Object.keys(d.vault.contents.media ?? {}).length).toBe(total)
  }, 30_000)

  it("o ficheiro deixa de se ler a meio dos blobs: a conta entra, e as que faltam contam-se", async () => {
    const { ficheiro, total } = await duasImagens()
    const bytes = fonteDeBytes(ficheiro)
    let leiturasDeBlobs = 0
    // The heads are read (40 bytes each); the second large blob no longer is.
    const fonte: FonteDeBytes = {
      tamanho: bytes.tamanho,
      ler: async (inicio, fim) => {
        if (fim - inicio > 100 && inicio > 20 && ++leiturasDeBlobs > 1) throw new Error("NotReadableError")
        return bytes.ler(inicio, fim)
      },
    }
    const d = await destino()
    const resultado = await d.vault.importVault(fonte, FRASE, { armazem: d.armazem })
    expect(resultado.imagens + resultado.emFalta).toBe(total)
    expect(resultado.emFalta).toBeGreaterThan(0)
    await d.vault.unlock(FRASE)
    expect(d.vault.unlocked).toBe(true)
  }, 30_000)

  it("o ficheiro simples sem imagens: zero e zero", async () => {
    const { vault } = await origemComImagem()
    const d = await destino()
    expect(await d.vault.importVault(await vault.exportVault(), FRASE, { armazem: d.armazem })).toEqual({ imagens: 0, emFalta: 0 })
  }, 30_000)
})

describe("importar: o que se lê antes da frase", () => {
  it("um ficheiro simples acima do tecto não se lê inteiro: não é de conta", async () => {
    const pedidos: number[] = []
    const fonte: FonteDeBytes = {
      tamanho: TECTO_DO_FICHEIRO_SIMPLES + 1,
      ler: async (inicio, fim) => {
        pedidos.push(fim - inicio)
        return new TextEncoder().encode("orwv2\n{").subarray(0, fim - inicio)
      },
    }
    const d = await destino()
    await expect(d.vault.importVault(fonte, FRASE, { armazem: d.armazem })).rejects.toThrow("this is not an enclave account file")
    expect(Math.max(...pedidos)).toBeLessThanOrEqual(12)
    expect(d.backend.bytes).toBe(d.antes)
  })

  it("uma leitura que falha antes da frase dá sempre a mesma frase", async () => {
    const fonte: FonteDeBytes = { tamanho: 500, ler: async () => Promise.reject(new Error("EACCES: permission denied")) }
    const d = await destino()
    await expect(d.vault.importVault(fonte, FRASE)).rejects.toThrow("this is not an enclave account file")
    expect(d.backend.bytes).toBe(d.antes)
  })
})
