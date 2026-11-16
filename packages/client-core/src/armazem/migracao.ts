import { base64ParaBytes, type StoredChatMessage, type StoredPayload, type StoredPeerProfile, type Vault, type VaultContents } from "../vault.js"
import type { ArmazemDeMedia } from "./armazem.js"
import { absorverPayload, absorverRetrato, absorverVideo, shasDoPayload } from "./referencias.js"

/**
 * The migration of the media of a version 2 vault (or a version 3 one still
 * `porMigrar`) to the store (design §6). Once, one unit at a time, resumable,
 * and losing nothing even if the process dies halfway.
 *
 * Units: `canal:<id>` (the channel's two lists), `diretorio`, `canais`
 * (`spaceMeta` and the rooms), `perfil` (the own portrait) and `videos` (the
 * legacy `contents.videos`). The finished ones go in `armazem.migracao.feitos`.
 *
 * **The order that loses nothing.** The store writes in the background, and the
 * vault is written whole. If the vault wrote `{ ref }` before the blob reached
 * the disk, a crash in that window would leave the reference without bytes. So
 * each unit runs in two phases:
 *
 * 1. **Rehearsal**: absorbs into a copy of the unit's lists. The blobs go to the
 *    queue; the references (with each blob's key) enter `contents.media` at
 *    once, in a deferred write. No payload points to them yet. Then it waits
 *    for the queue (`drenar`).
 * 2. **Apply**, in a single `vault.update`: absorbs again, now into the vault.
 *    The references are already there, and the store already has the blobs:
 *    nothing is encrypted again. A payload only swaps its bytes for `{ ref }` if
 *    ALL its new blobs were on disk at the end of the queue. A blob whose write
 *    failed leaves the payload with the original bytes, and the unit is not
 *    done.
 *
 * A crash in the rehearsal leaves blobs on disk with no written reference (the
 * key died with the process). The next run deletes them first (`apagarOrfaos`)
 * and absorbs again. A crash after writing the reference and before the blob
 * leaves a reference no payload uses: the next run rewrites the blob with the
 * same key. The address is the content: repeating never duplicates.
 *
 * Thumbnails are not made here: they are made later, in the background
 * (design §6, step 6).
 */

/** The result of migrating one unit. */
export interface MigracaoDaUnidade {
  /** The unit has no media bytes left to move. */
  completa: boolean
  /** Some payload (or the portrait, or a video) became a reference. */
  mudou: boolean
  /** The `sha` values this unit now references. */
  shas: string[]
}

const PREFIXO_DO_CANAL = "canal:"

/** The units left, in migration order. Empty if the vault is not `porMigrar`. */
export function unidadesPorMigrar(contents: VaultContents): string[] {
  if (!contents.armazem?.porMigrar) return []
  const feitos = new Set(contents.armazem.migracao?.feitos ?? [])
  const canais = new Set([...Object.keys(contents.history ?? {}), ...Object.keys(contents.estadoDoCanal ?? {})])
  const todas = [...[...canais].map((canal) => PREFIXO_DO_CANAL + canal), "diretorio", "canais", "perfil", "videos"]
  return todas.filter((unidade) => !feitos.has(unidade))
}

/**
 * Migrates one unit (synchronous, inside a vault mutation). A payload only
 * becomes `{ ref }` if each of its new blobs is `guardado` (by default, in the
 * store inventory); otherwise it keeps the bytes, and the unit is not complete.
 * The lists are swapped at the end: an entry that cannot be read (a `null`)
 * throws, and the unit stays as it was (the references that already entered
 * `contents.media` are left unused, and the collection deletes them).
 */
export function migrarUnidade(
  contents: VaultContents,
  unidade: string,
  armazem: ArmazemDeMedia,
  guardado: (sha: string) => boolean = (sha) => armazem.tem(sha),
): MigracaoDaUnidade {
  const estado: MigracaoDaUnidade = { completa: true, mudou: false, shas: [] }

  const payload = (antes: StoredPayload): StoredPayload => {
    const depois = absorverPayload(contents, antes, armazem)
    if (depois === antes) return antes
    const tinha = new Set(shasDoPayload(antes))
    const novos = shasDoPayload(depois).filter((sha) => !tinha.has(sha))
    if (!novos.every(guardado)) {
      estado.completa = false
      return antes
    }
    estado.mudou = true
    estado.shas.push(...novos)
    return depois
  }
  const entradas = (lista: StoredChatMessage[]): StoredChatMessage[] => {
    const nova = lista.map((entrada) => {
      const migrado = payload(entrada.payload)
      return migrado === entrada.payload ? entrada : { ...entrada, payload: migrado }
    })
    return nova.some((entrada, i) => entrada !== lista[i]) ? nova : lista
  }
  const perfis = (mapa: Record<string, StoredPeerProfile>): Record<string, StoredPeerProfile> | null => {
    let novo: Record<string, StoredPeerProfile> | null = null
    for (const [chave, perfil] of Object.entries(mapa)) {
      const migrado = payload(perfil.payload)
      if (migrado !== perfil.payload) (novo ??= { ...mapa })[chave] = { ...perfil, payload: migrado }
    }
    return novo
  }

  if (unidade.startsWith(PREFIXO_DO_CANAL)) {
    const canal = unidade.slice(PREFIXO_DO_CANAL.length)
    const conversa = contents.history?.[canal]
    const livro = contents.estadoDoCanal?.[canal]
    const novaConversa = conversa && entradas(conversa)
    const novoLivro = livro && entradas(livro)
    if (novaConversa && novaConversa !== conversa) contents.history[canal] = novaConversa
    if (novoLivro && novoLivro !== livro) contents.estadoDoCanal[canal] = novoLivro
  } else if (unidade === "diretorio") {
    const novo = perfis(contents.directory)
    if (novo) Object.assign(contents.directory, novo)
  } else if (unidade === "canais") {
    const metas = perfis(contents.spaceMeta)
    const salas: Record<string, Record<string, StoredPeerProfile>> = {}
    for (const [canal, mapa] of Object.entries(contents.channelRooms)) {
      const novo = perfis(mapa)
      if (novo) salas[canal] = novo
    }
    if (metas) Object.assign(contents.spaceMeta, metas)
    Object.assign(contents.channelRooms, salas)
  } else if (unidade === "perfil") {
    const { avatarDataUrl, ...resto } = contents.profile
    if (avatarDataUrl) {
      const sha = absorverRetrato(contents, avatarDataUrl, armazem)
      if (guardado(sha)) {
        contents.profile = { ...resto, avatarRef: sha }
        estado.mudou = true
        estado.shas.push(sha)
      } else {
        estado.completa = false
      }
    }
  } else if (unidade === "videos") {
    const videos = contents.videos ?? {}
    const tipos = tiposDosVideos(contents)
    let ficam: Record<string, (typeof videos)[string]> | null = null
    for (const [sha, video] of Object.entries(videos)) {
      let absorvido: string | null = null
      try {
        absorvido = absorverVideo(contents, base64ParaBytes(video.b64), tipos.get(sha) ?? "video/mp4", armazem)
      } catch {
        // A damaged base64: the video stays as it is.
      }
      // An address that does not match (damaged bytes) also stays: the post parts would never open it.
      if (absorvido !== sha || !guardado(sha)) {
        estado.completa = false
        continue
      }
      ficam ??= { ...videos }
      delete ficam[sha]
      estado.mudou = true
      estado.shas.push(sha)
    }
    if (ficam) contents.videos = ficam
  }
  return estado
}

/** The MIME type of each video, as given by the post that has it in its parts. */
function tiposDosVideos(contents: VaultContents): Map<string, string> {
  const tipos = new Map<string, string>()
  for (const listas of [contents.history, contents.estadoDoCanal]) {
    for (const entradas of Object.values(listas ?? {})) {
      for (const entrada of entradas) {
        const media = entrada?.payload?.media
        if (!Array.isArray(media)) continue
        for (const item of media as Record<string, unknown>[]) {
          const partes = item?.partes as { sha256?: unknown } | undefined
          if (typeof partes?.sha256 === "string" && typeof item.mediaType === "string") tipos.set(partes.sha256, item.mediaType)
        }
      }
    }
  }
  return tipos
}

/**
 * A copy of the vault lists where the rehearsal can swap entries without
 * touching the vault. `media` is the SAME object: the new references enter the
 * vault at once (unused), so a live absorption of the same bytes uses the same
 * key.
 */
function rascunhoDe(contents: VaultContents): VaultContents {
  contents.media ??= {}
  return {
    ...contents,
    history: { ...contents.history },
    estadoDoCanal: { ...contents.estadoDoCanal },
    directory: { ...contents.directory },
    spaceMeta: { ...contents.spaceMeta },
    channelRooms: { ...contents.channelRooms },
    profile: { ...contents.profile },
    ...(contents.videos ? { videos: { ...contents.videos } } : {}),
  }
}

/**
 * Blobs in the store with no reference in the vault: from a run that crashed
 * between writing the blob and writing the reference. The key died with it,
 * and the blob never opens again; deleting it lets the absorption write it
 * again.
 */
async function apagarOrfaos(contents: VaultContents, armazem: ArmazemDeMedia): Promise<void> {
  const conhecidas = contents.media ?? {}
  const orfaos = armazem.shas().filter((sha) => !Object.hasOwn(conhecidas, sha))
  if (orfaos.length > 0) await armazem.apagar(orfaos)
}

/**
 * Migrates the whole vault, one unit at a time (one `vault.update` per unit
 * with media; a unit without media is only marked, in a deferred write).
 * `opcoes.passo` runs after each unit (to yield to the page; if it throws, the
 * migration stops and resumes in the next run). At the end, with nothing left
 * to migrate, it removes `porMigrar`, `migracao` and `videos`.
 *
 * Returns the units done in this run, the media that moved (distinct `sha`)
 * and their plaintext bytes.
 */
export async function migrarTudo(
  vault: Vault,
  armazem: ArmazemDeMedia,
  opcoes: { passo?: () => Promise<void> } = {},
): Promise<{ unidades: number; media: number; bytes: number }> {
  const feito = { unidades: 0, media: 0, bytes: 0 }
  if (!vault.contents.armazem?.porMigrar) return feito
  await apagarOrfaos(vault.contents, armazem)

  const contados = new Set<string>()
  const tentadas = new Set<string>()
  for (;;) {
    const unidade = unidadesPorMigrar(vault.contents).find((u) => !tentadas.has(u))
    if (unidade === undefined) break
    tentadas.add(unidade)

    // The mutations run inside the vault calls; the result comes out through here.
    const visto: { ensaio?: MigracaoDaUnidade; aplicado?: MigracaoDaUnidade } = {}
    try {
      // The mutation runs now; the deferred write carries only unused references.
      void vault.updateEmBreve((contents) => {
        visto.ensaio = migrarUnidade(rascunhoDe(contents), unidade, armazem)
      }).catch(() => {})
    } catch {
      // An entry that cannot be read: the unit stays as it is, and the others go on.
    }

    if (visto.ensaio) {
      await armazem.drenar()
      const guardados = new Set(armazem.shas())
      const aplicar = (contents: VaultContents) => {
        try {
          visto.aplicado = migrarUnidade(contents, unidade, armazem, (sha) => guardados.has(sha))
        } catch {
          return
        }
        if (!visto.aplicado.completa) return
        const marca = (contents.armazem ??= {})
        marca.migracao ??= { comecou: Date.now(), feitos: [] }
        marca.migracao.feitos.push(unidade)
      }
      if (visto.ensaio.mudou) await vault.update(aplicar)
      else void vault.updateEmBreve(aplicar).catch(() => {})

      if (visto.aplicado?.completa) feito.unidades++
      for (const sha of visto.aplicado?.shas ?? []) {
        if (contados.has(sha)) continue
        contados.add(sha)
        feito.media++
        feito.bytes += vault.contents.media?.[sha]?.b ?? 0
      }
    }
    await opcoes.passo?.()
  }

  if (unidadesPorMigrar(vault.contents).length === 0) {
    await vault.update((contents) => {
      if (!contents.armazem?.porMigrar || unidadesPorMigrar(contents).length > 0) return
      // A video that entered `contents.videos` after the videos unit: it is left for the next run.
      if (Object.keys(contents.videos ?? {}).length > 0) {
        contents.armazem.migracao!.feitos = contents.armazem.migracao!.feitos.filter((u) => u !== "videos")
        return
      }
      delete contents.videos
      delete contents.armazem
    })
  }
  return feito
}
