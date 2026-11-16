import { describe, expect, it } from "vitest"
import { cofreV2 } from "../../testes/cofre-v2.js"
import { comCabecalho, semCabecalho } from "../cabecalhoDoCofre.js"
import { base64ParaBytes, semBytes, Vault, type StoredChatMessage, type VaultBackend, type VaultContents } from "../vault.js"
import { ArmazemDeMedia } from "./armazem.js"
import { ArmazemEmMemoria } from "./emMemoria.js"
import { migrarTudo, unidadesPorMigrar } from "./migracao.js"
import { inflarPayload, inflarRef, recolher, shasReferenciados } from "./referencias.js"

/**
 * The migration of media from the vault to the store (design §6): one unit at a
 * time, resumable, and losing nothing even if it crashes halfway. The input
 * vault is the frozen version 2 one (`testes/cofre-v2.ts`), written to disk as
 * version 2 so `#adopt` marks it `porMigrar`.
 *
 * What is always proven: the inflated bytes of each media item are the
 * originals, and each reference the WRITTEN vault has points to a blob the
 * store disk already has.
 */

const DIRECTA = "!directa:s"
const COMUNIDADE = "!comunidade:s"

/** The vault disk, with the system key (no Argon2id) and writes that can be refused. */
class Disco implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = true
  recusaEscritas = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    if (this.recusaEscritas) throw new Error("vault storage is full")
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
  async wrapKey(key: Uint8Array): Promise<Uint8Array> {
    return key
  }
  async unwrapKey(wrapped: Uint8Array): Promise<Uint8Array> {
    return wrapped
  }
}

/** The store disk, with writes that can be held forever (the process dies before the disk sees them). */
class DiscoDoArmazem extends ArmazemEmMemoria {
  prender = false
  override async escrever(sha: string, blob: Uint8Array, meta: { bytes: number; classe: "original" | "mini"; ultimoUso: number }): Promise<void> {
    if (this.prender) return new Promise<void>(() => {})
    return super.escrever(sha, blob, meta)
  }
}

/** A disk with the version 2 vault inside. `mexer` changes the vault before writing it. */
async function discoDaVersao2(mexer?: (contents: VaultContents) => void): Promise<Disco> {
  const disco = new Disco()
  const inicial = cofreV2()
  mexer?.(inicial)
  await new Vault(disco).create(null, inicial)
  const ficheiro = JSON.parse(semCabecalho(disco.bytes as Uint8Array) as string) as Record<string, unknown>
  disco.bytes = comCabecalho(JSON.stringify({ ...ficheiro, version: 2 }))
  return disco
}

/** Open the vault and the store, like a session starting (after a crash, this is it). */
async function abrir(disco: Disco, discoDoArmazem: DiscoDoArmazem): Promise<{ vault: Vault; armazem: ArmazemDeMedia }> {
  const vault = new Vault(disco)
  await vault.unlock()
  const armazem = new ArmazemDeMedia(discoDoArmazem, null)
  await armazem.abrir()
  return { vault, armazem }
}

/** Each media item of the original vault, inflated from the migrated vault, gives the same bytes. An entry still with bytes too. */
async function conferirBytes(contents: VaultContents, armazem: ArmazemDeMedia, original: VaultContents = cofreV2()): Promise<void> {
  for (const listas of ["history", "estadoDoCanal"] as const) {
    for (const [canal, entradas] of Object.entries(original[listas])) {
      for (const [indice, entrada] of entradas.entries()) {
        if (!entrada) continue
        const migrada = contents[listas][canal]?.[indice] as StoredChatMessage
        expect(await inflarPayload(contents, migrada.payload, armazem)).toEqual(entrada.payload)
      }
    }
  }
  for (const [conta, perfil] of Object.entries(original.directory)) {
    expect(await inflarPayload(contents, contents.directory[conta]!.payload, armazem)).toEqual(perfil.payload)
  }
  for (const [canal, meta] of Object.entries(original.spaceMeta)) {
    expect(await inflarPayload(contents, contents.spaceMeta[canal]!.payload, armazem)).toEqual(meta.payload)
  }
  for (const [canal, salas] of Object.entries(original.channelRooms)) {
    for (const [sala, meta] of Object.entries(salas)) {
      expect(await inflarPayload(contents, contents.channelRooms[canal]![sala]!.payload, armazem)).toEqual(meta.payload)
    }
  }
  if (contents.profile.avatarRef) {
    const { avatarDataUrl, ...resto } = original.profile
    const { avatarRef, ...restoMigrado } = contents.profile
    expect(restoMigrado).toEqual(resto)
    expect(await inflarRef(contents, avatarRef as string, armazem)).toBe(avatarDataUrl)
  } else {
    expect(contents.profile).toEqual(original.profile)
  }
  for (const [sha, video] of Object.entries(original.videos ?? {})) {
    const ainda = contents.videos?.[sha]
    if (ainda) {
      expect(ainda).toEqual(video)
      continue
    }
    expect(await armazem.obter(sha, contents.media![sha]!)).toEqual(base64ParaBytes(video.b64))
  }
}

/** Every reference of the WRITTEN vault has its blob on the store disk: nothing is lost if the process dies now. */
async function conferirDisco(disco: Disco, discoDoArmazem: DiscoDoArmazem): Promise<void> {
  const vault = new Vault(disco)
  await vault.unlock()
  const contents = vault.contents
  for (const sha of shasReferenciados(contents)) expect(await discoDoArmazem.ler(sha), sha).not.toBeNull()
  // And each media item still inflates to the original bytes, with the store the disk has.
  const armazem = new ArmazemDeMedia(discoDoArmazem, null)
  await armazem.abrir()
  await conferirBytes(contents, armazem)
}

/** The vault without the random keys of the references: two vaults migrated in different runs are compared this way. */
function semChaves(contents: VaultContents): unknown {
  const copia = JSON.parse(JSON.stringify(contents)) as VaultContents
  for (const ref of Object.values(copia.media ?? {})) {
    const solta = ref as Partial<typeof ref>
    delete solta.k
    delete solta.n
    delete solta.at
  }
  return copia
}

async function migradoDeUmaVez(): Promise<{ contents: VaultContents; discoDoArmazem: DiscoDoArmazem }> {
  const disco = await discoDaVersao2()
  const discoDoArmazem = new DiscoDoArmazem()
  const { vault, armazem } = await abrir(disco, discoDoArmazem)
  await migrarTudo(vault, armazem, {})
  await armazem.drenar()
  const reaberto = await abrir(disco, discoDoArmazem)
  return { contents: reaberto.vault.contents, discoDoArmazem }
}

async function shasDoDisco(discoDoArmazem: DiscoDoArmazem): Promise<string[]> {
  return (await discoDoArmazem.listar()).map(({ sha }) => sha).sort()
}

describe("migrarTudo: os media do cofre da versão 2 passam para o armazém", () => {
  it("as unidades: cada canal, o diretório, os canais, o perfil e os vídeos", async () => {
    const { vault } = await abrir(await discoDaVersao2(), new DiscoDoArmazem())
    expect(unidadesPorMigrar(vault.contents)).toEqual([`canal:${DIRECTA}`, `canal:${COMUNIDADE}`, "diretorio", "canais", "perfil", "videos"])
  })

  it("(a) migra o cofre inteiro: semBytes fica vazio, nada mais muda, e os bytes inflados são os originais", async () => {
    const disco = await discoDaVersao2()
    const discoDoArmazem = new DiscoDoArmazem()
    const { vault, armazem } = await abrir(disco, discoDoArmazem)
    expect(semBytes(vault.contents).length).toBeGreaterThan(0)

    const feito = await migrarTudo(vault, armazem, {})
    expect(feito.unidades).toBe(6)
    // The photo, the pdf, the card thumbnail, the post photo and poster, Bruno's portrait, the icon, the own portrait and the video.
    expect(feito.media).toBe(9)
    expect(feito.bytes).toBeGreaterThan(20_000)

    const { vault: reaberto, armazem: armazemReaberto } = await abrir(disco, discoDoArmazem)
    const contents = reaberto.contents
    expect(semBytes(contents)).toEqual([])
    expect(contents.armazem).toBeUndefined()
    expect(contents.videos).toBeUndefined()
    await conferirBytes(contents, armazemReaberto)
    // No orphans or duplicates: the store has exactly what the vault references.
    expect(await shasDoDisco(discoDoArmazem)).toEqual([...shasReferenciados(contents)].sort())
    expect(Object.keys(contents.media ?? {}).sort()).toEqual([...shasReferenciados(contents)].sort())

    // The rest of the vault stays as it was.
    const antes = cofreV2()
    for (const chave of ["groups", "lastSeq", "notifications", "homeserver"] as const) expect(contents[chave]).toEqual(antes[chave])
  })

  it("(b) interrompida depois da 2.ª unidade, a corrida seguinte acaba igual a (a) e sem duplicados", async () => {
    const disco = await discoDaVersao2()
    const discoDoArmazem = new DiscoDoArmazem()
    const { vault, armazem } = await abrir(disco, discoDoArmazem)
    let passos = 0
    await expect(
      migrarTudo(vault, armazem, {
        passo: async () => {
          if (++passos === 2) throw new Error("a sessão fechou")
        },
      }),
    ).rejects.toThrow("a sessão fechou")
    await conferirDisco(disco, discoDoArmazem)

    const segunda = await abrir(disco, discoDoArmazem)
    expect(segunda.vault.contents.armazem?.migracao?.feitos).toEqual([`canal:${DIRECTA}`, `canal:${COMUNIDADE}`])
    expect(unidadesPorMigrar(segunda.vault.contents)).toEqual(["diretorio", "canais", "perfil", "videos"])
    const feito = await migrarTudo(segunda.vault, segunda.armazem, {})
    expect(feito.unidades).toBe(4)
    await segunda.armazem.drenar()

    const final = await abrir(disco, discoDoArmazem)
    const deUmaVez = await migradoDeUmaVez()
    expect(semChaves(final.vault.contents)).toEqual(semChaves(deUmaVez.contents))
    expect(await shasDoDisco(discoDoArmazem)).toEqual(await shasDoDisco(deUmaVez.discoDoArmazem))
    expect(await shasDoDisco(discoDoArmazem)).toEqual([...shasReferenciados(final.vault.contents)].sort())
    await conferirBytes(final.vault.contents, final.armazem)
  })

  it("(b) a meio de uma unidade: o blob escrito e o cofre por gravar (queda), a corrida seguinte não perde nem duplica", async () => {
    const disco = await discoDaVersao2()
    const discoDoArmazem = new DiscoDoArmazem()
    const { vault, armazem } = await abrir(disco, discoDoArmazem)
    // The 1st unit is written; then the vault disk refuses: the 2nd unit's blobs reach the store and the vault does not.
    await expect(
      migrarTudo(vault, armazem, {
        passo: async () => {
          disco.recusaEscritas = true
        },
      }),
    ).rejects.toThrow("vault storage is full")
    await armazem.drenar()
    disco.recusaEscritas = false
    await conferirDisco(disco, discoDoArmazem)

    const segunda = await abrir(disco, discoDoArmazem)
    expect(segunda.vault.contents.armazem?.migracao?.feitos).toEqual([`canal:${DIRECTA}`])
    // The 2nd unit's blobs stayed on disk with no written reference: orphans.
    expect((await shasDoDisco(discoDoArmazem)).length).toBeGreaterThan(shasReferenciados(segunda.vault.contents).size)
    await migrarTudo(segunda.vault, segunda.armazem, {})
    await segunda.armazem.drenar()

    const final = await abrir(disco, discoDoArmazem)
    expect(semBytes(final.vault.contents)).toEqual([])
    await conferirBytes(final.vault.contents, final.armazem)
    expect(await shasDoDisco(discoDoArmazem)).toEqual([...shasReferenciados(final.vault.contents)].sort())
  })

  it("(b) a meio de uma unidade: o blob por escrever (queda), o cofre gravado nunca aponta para ele", async () => {
    const disco = await discoDaVersao2()
    const discoDoArmazem = new DiscoDoArmazem()
    const { vault, armazem } = await abrir(disco, discoDoArmazem)
    let passos = 0
    // The 1st unit finishes; in the 2nd, the store writes never reach the disk (the process dies with them in the queue).
    const corrida = migrarTudo(vault, armazem, {
      passo: async () => {
        if (++passos === 1) discoDoArmazem.prender = true
      },
    })
    void corrida.catch(() => {})
    await new Promise((resolver) => setTimeout(resolver, 50))
    // The written vault can still go to disk (a deferred write, another door of the session): it never carries the 2nd unit.
    await vault.update(() => {})
    await conferirDisco(disco, discoDoArmazem)
    const visto = new Vault(disco)
    await visto.unlock()
    expect(visto.contents.estadoDoCanal[COMUNIDADE]).toEqual(cofreV2().estadoDoCanal[COMUNIDADE])

    discoDoArmazem.prender = false
    const segunda = await abrir(disco, discoDoArmazem)
    await migrarTudo(segunda.vault, segunda.armazem, {})
    await segunda.armazem.drenar()
    const final = await abrir(disco, discoDoArmazem)
    expect(semBytes(final.vault.contents)).toEqual([])
    await conferirBytes(final.vault.contents, final.armazem)
    expect(await shasDoDisco(discoDoArmazem)).toEqual([...shasReferenciados(final.vault.contents)].sort())
  })

  it("um blob cuja escrita falha deixa os bytes originais no cofre, e a corrida seguinte acaba", async () => {
    const disco = await discoDaVersao2()
    const discoDoArmazem = new DiscoDoArmazem()
    const { vault, armazem } = await abrir(disco, discoDoArmazem)
    // The 1st write is the direct conversation photo.
    discoDoArmazem.falharProxima(new Error("media store failed"))
    const feito = await migrarTudo(vault, armazem, {})
    expect(feito.unidades).toBe(5)
    await armazem.drenar()
    await conferirDisco(disco, discoDoArmazem)

    const segunda = await abrir(disco, discoDoArmazem)
    const contents = segunda.vault.contents
    expect(contents.armazem?.porMigrar).toBe(true)
    expect(unidadesPorMigrar(contents)).toEqual([`canal:${DIRECTA}`])
    expect(semBytes(contents)).toEqual([`history["${DIRECTA}"][0].payload.attachments[0].inline`])
    expect(contents.history[DIRECTA]![0]).toEqual(cofreV2().history[DIRECTA]![0])

    await migrarTudo(segunda.vault, segunda.armazem, {})
    await segunda.armazem.drenar()
    const final = await abrir(disco, discoDoArmazem)
    expect(semBytes(final.vault.contents)).toEqual([])
    expect(final.vault.contents.armazem).toBeUndefined()
    await conferirBytes(final.vault.contents, final.armazem)
  })

  it("(c) um canal com uma entrada null fica como está, e os outros migram", async () => {
    const ESTRAGADO = "!estragado:s"
    const disco = await discoDaVersao2((contents) => {
      contents.history[ESTRAGADO] = [structuredClone(contents.history[DIRECTA]![0]!), null as unknown as StoredChatMessage]
    })
    const discoDoArmazem = new DiscoDoArmazem()
    const { vault, armazem } = await abrir(disco, discoDoArmazem)
    const feito = await migrarTudo(vault, armazem, {})
    expect(feito.unidades).toBe(6)
    await armazem.drenar()

    const { vault: reaberto, armazem: armazemReaberto } = await abrir(disco, discoDoArmazem)
    const contents = reaberto.contents
    expect(contents.history[ESTRAGADO]).toEqual([cofreV2().history[DIRECTA]![0], null])
    expect(semBytes(contents)).toEqual([`history["${ESTRAGADO}"][0].payload.attachments[0].inline`])
    expect(unidadesPorMigrar(contents)).toEqual([`canal:${ESTRAGADO}`])
    await conferirBytes(contents, armazemReaberto)
    await conferirDisco(disco, discoDoArmazem)
  })

  it("(d) correr duas vezes não muda nada", async () => {
    const disco = await discoDaVersao2()
    const discoDoArmazem = new DiscoDoArmazem()
    const { vault, armazem } = await abrir(disco, discoDoArmazem)
    await migrarTudo(vault, armazem, {})
    await armazem.drenar()
    const antes = JSON.stringify(vault.contents)
    const blobsAntes = await shasDoDisco(discoDoArmazem)

    expect(await migrarTudo(vault, armazem, {})).toEqual({ unidades: 0, media: 0, bytes: 0 })
    const outra = await abrir(disco, discoDoArmazem)
    expect(await migrarTudo(outra.vault, outra.armazem, {})).toEqual({ unidades: 0, media: 0, bytes: 0 })
    await outra.armazem.drenar()
    expect(JSON.stringify(vault.contents)).toBe(antes)
    expect(JSON.stringify(outra.vault.contents)).toBe(antes)
    expect(await shasDoDisco(discoDoArmazem)).toEqual(blobsAntes)
  })

  it("(e) contents.videos[sha] passa para o mesmo sha, com as partes da publicação intactas, e a recolha não o apaga", async () => {
    const original = cofreV2()
    const [sha, video] = Object.entries(original.videos ?? {})[0]!
    const { contents, discoDoArmazem } = await migradoDeUmaVez()
    const publicacao = (lista: StoredChatMessage[] | undefined) => (lista?.[0]?.payload.media as Record<string, unknown>[])[1]!

    expect(contents.videos).toBeUndefined()
    expect(publicacao(contents.estadoDoCanal[COMUNIDADE]).partes).toEqual(publicacao(original.estadoDoCanal[COMUNIDADE]).partes)
    expect((publicacao(contents.estadoDoCanal[COMUNIDADE]).partes as { sha256: string }).sha256).toBe(sha)
    expect(contents.media?.[sha]).toMatchObject({ t: "video/mp4", b: base64ParaBytes(video.b64).length, c: "original" })

    const armazem = new ArmazemDeMedia(discoDoArmazem, null)
    await armazem.abrir()
    expect(await armazem.obter(sha, contents.media![sha]!)).toEqual(base64ParaBytes(video.b64))
    // The video is referenced by the post parts: the collection does not delete it.
    expect(shasReferenciados(contents).has(sha)).toBe(true)
    expect(await recolher(contents, armazem)).toEqual([])
  })
})
