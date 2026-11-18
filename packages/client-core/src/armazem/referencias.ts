import { sha256 } from "@noble/hashes/sha2.js"
import { CHAVES_DE_ANEXOS, toBase64 } from "@enclave/protocol"
import { base64ParaBytes, paraBase64Classico, type RefDeMedia, type StoredPayload, type VaultContents } from "../vault.js"
import { TECTOS_DO_ARMAZEM, type ArmazemDeMedia } from "./armazem.js"
import { dimensoesDaImagem } from "./dimensoes.js"
import { caracteresDaRef } from "../medidaDeMedia.js"

/**
 * The media references in the vault (design §2, §3 and §5).
 *
 * - **Absorb** (synchronous, inside the vault mutation): each `inline`, each
 *   link card `thumbnail` and each video `poster` moves to the store; the
 *   payload keeps `{ ref: sha }` (in an attachment, the `ref` key in place of
 *   `inline`), and `contents.media[sha]` holds the reference with the blob key.
 * - **Inflate** (asynchronous, for the network): restores the EXACT text that
 *   came, so the authorship `m` (`resumosDosAnexos`) checks out.
 * - **Collect**: deletes from the store and from `contents.media` whatever
 *   nothing references.
 *
 * The address is the SHA-256, in unpadded base64url, of the plaintext bytes
 * the blob holds. In a "bytes" reference these are the file bytes (the address
 * videos already use). In a "texto" reference (a sender that wrote
 * non-canonical base64, or a prefix with parameters) the blob holds the
 * `inline` text, and the address is that text's: two different spellings of
 * the same bytes never share a reference that only rebuilds one of them.
 */

/** Any object in a payload. */
type Registo = Record<string, unknown>

const eRegisto = (valor: unknown): valor is Registo => typeof valor === "object" && valor !== null && !Array.isArray(valor)

/** How what comes in is classified: an attachment, a portrait (or channel icon), or a thumbnail. */
type Politica = "anexo" | "retrato" | "miniatura"

/** The single-attachment fields (not lists): the profile portrait and the channel icon. */
const ANEXOS_SOLTOS = ["avatar", "icon"] as const

/** The prefix `FileReader` writes: `data:<tipo>;base64,`, without parameters. */
const PREFIXO_CANONICO = /^data:[^;,]+;base64,$/

const codificador = new TextEncoder()
const descodificador = new TextDecoder()

const enderecoDe = (bytes: Uint8Array): string => toBase64(sha256(bytes))
const aleatorio = (n: number): string => toBase64(crypto.getRandomValues(new Uint8Array(n)))

/** The prefix (up to and including the comma), the type and the bytes of a base64 data URL. Null bytes if it does not decode. */
function lerDataUrl(texto: string): { prefixo: string; tipo: string; bytes: Uint8Array | null } {
  const virgula = texto.startsWith("data:") ? texto.indexOf(",") : -1
  if (virgula < 0) return { prefixo: "", tipo: "", bytes: null }
  const prefixo = texto.slice(0, virgula + 1)
  const tipo = prefixo.slice(5, prefixo.search(/[;,]/))
  let bytes: Uint8Array | null = null
  if (prefixo.endsWith(";base64,")) {
    try {
      bytes = base64ParaBytes(texto.slice(virgula + 1))
    } catch {
      // A character outside base64: keep the text.
    }
  }
  return { prefixo, tipo, bytes }
}

/** An image up to 320 px and 40 KB is its own thumbnail (design §3). */
function propriaMiniatura(ref: Pick<RefDeMedia, "w" | "h" | "b">): boolean {
  return ref.w !== undefined && ref.h !== undefined && Math.max(ref.w, ref.h) <= TECTOS_DO_ARMAZEM.ladoDaMiniatura && ref.b <= TECTOS_DO_ARMAZEM.miniaturaMaxBytes
}

function classeDe(politica: Politica, ref: Pick<RefDeMedia, "w" | "h" | "b">): { c: RefDeMedia["c"]; propria: boolean } {
  if (politica === "miniatura" || propriaMiniatura(ref)) return { c: "mini", propria: true }
  // A small portrait never leaves: the lists and the rings need it (design §3).
  if (politica === "retrato" && ref.b <= TECTOS_DO_ARMAZEM.originalPequeno) return { c: "mini", propria: false }
  return { c: "original", propria: false }
}

/** Records the reference (if there is none yet) and hands the plaintext to the store. Returns the `sha`. */
function guardar(
  contents: VaultContents,
  armazem: ArmazemDeMedia,
  claro: Uint8Array,
  sha: string,
  forma: { f: RefDeMedia["f"]; p?: string; t: string; imagem: Uint8Array | null; w?: number; h?: number },
  politica: Politica,
): string {
  const media = (contents.media ??= {})
  const existente = media[sha]
  if (existente) {
    // Already referenced: only writes the blob again, if it left (same key, same nonce, same text: the same blob).
    armazem.absorver(claro, existente, sha)
    return sha
  }
  const ditas = forma.w !== undefined && forma.h !== undefined ? { largura: forma.w, altura: forma.h } : null
  const dimensoes = ditas ?? (forma.t.startsWith("image/") && forma.imagem ? dimensoesDaImagem(forma.imagem) : null)
  const medida = { b: claro.length, ...(dimensoes ? { w: dimensoes.largura, h: dimensoes.altura } : {}) }
  const { c, propria } = classeDe(politica, medida)
  const ref: RefDeMedia = {
    v: 1,
    k: aleatorio(32),
    n: aleatorio(24),
    b: medida.b,
    t: forma.t,
    ...(dimensoes ? { w: dimensoes.largura, h: dimensoes.altura } : {}),
    f: forma.f,
    ...(forma.p !== undefined ? { p: forma.p } : {}),
    ...(propria ? { mini: sha } : {}),
    c,
    at: Date.now(),
  }
  media[sha] = ref
  armazem.absorver(claro, ref, sha)
  return sha
}

/** Absorbs a media text (`inline`, `thumbnail`, `poster`, portrait). Returns the `sha`. */
function absorverTexto(contents: VaultContents, armazem: ArmazemDeMedia, texto: string, tipoDito: string, politica: Politica): string {
  const { prefixo, tipo, bytes } = lerDataUrl(texto)
  const t = tipoDito || tipo || "application/octet-stream"
  if (bytes && PREFIXO_CANONICO.test(prefixo) && prefixo + paraBase64Classico(bytes) === texto) {
    const sha = enderecoDe(bytes)
    const existente = contents.media?.[sha]
    // The same bytes already stored with another prefix: this one goes as text, or it would inflate with the other's prefix.
    if (!existente || (existente.f === "bytes" && existente.p === prefixo)) {
      return guardar(contents, armazem, bytes, sha, { f: "bytes", p: prefixo, t, imagem: bytes }, politica)
    }
  }
  const claro = codificador.encode(texto)
  return guardar(contents, armazem, claro, enderecoDe(claro), { f: "texto", t, imagem: bytes }, politica)
}

/** A copy of the object with key `de` replaced by `para`, in the same place (the JSON comes out as it came in). */
function trocarChave(objecto: Registo, de: string, para: string, valor: unknown): Registo {
  const novo: Registo = {}
  for (const [chave, membro] of Object.entries(objecto)) {
    if (chave === de) novo[para] = valor
    else novo[chave] = membro
  }
  return novo
}

function absorverAnexo(contents: VaultContents, armazem: ArmazemDeMedia, item: unknown, politica: Politica): unknown {
  if (!eRegisto(item) || item.evicted === true) return item
  let novo = item
  if (typeof item.inline === "string" && item.inline.length > 0 && !("ref" in item)) {
    const tipo = typeof item.mediaType === "string" ? item.mediaType : ""
    novo = trocarChave(item, "inline", "ref", absorverTexto(contents, armazem, item.inline, tipo, politica))
  }
  if (typeof novo.poster === "string" && novo.poster.length > 0) {
    novo = { ...novo, poster: { ref: absorverTexto(contents, armazem, novo.poster, "", "miniatura") } }
  }
  return novo
}

function absorverCartao(contents: VaultContents, armazem: ArmazemDeMedia, cartao: unknown): unknown {
  if (!eRegisto(cartao) || typeof cartao.thumbnail !== "string" || cartao.thumbnail.length === 0) return cartao
  return { ...cartao, thumbnail: { ref: absorverTexto(contents, armazem, cartao.thumbnail, "", "miniatura") } }
}

/**
 * Moves a payload's bytes into the store (design §5, incoming). Runs inside
 * `vault.update`: changes `contents.media` and returns a copy of the payload
 * with `{ ref }` in place of the bytes; the payload received stays as it was.
 * An item that already has `ref`, or `evicted` from an old sibling, passes
 * intact.
 */
export function absorverPayload(contents: VaultContents, payload: StoredPayload, armazem: ArmazemDeMedia): StoredPayload {
  let copia: StoredPayload | null = null
  const mudar = (chave: string, antes: unknown, depois: unknown) => {
    if (antes === depois) return
    copia ??= { ...payload }
    copia[chave] = depois
  }
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = payload[chave]
    if (!Array.isArray(lista)) continue
    const nova = lista.map((item) => absorverAnexo(contents, armazem, item, "anexo"))
    if (nova.some((item, i) => item !== lista[i])) mudar(chave, lista, nova)
  }
  const links = payload.links
  if (Array.isArray(links)) {
    const novos = links.map((cartao) => absorverCartao(contents, armazem, cartao))
    if (novos.some((cartao, i) => cartao !== links[i])) mudar("links", links, novos)
  }
  for (const chave of ANEXOS_SOLTOS) {
    const anexo = payload[chave]
    if (eRegisto(anexo)) mudar(chave, anexo, absorverAnexo(contents, armazem, anexo, "retrato"))
  }
  return copia ?? payload
}

/**
 * Absorbs the raw bytes of a video (the legacy `contents.videos`, design §6).
 * The address is the SHA-256 of the bytes, the same as `partes.sha256` in the
 * post. Returns the `sha`.
 */
export function absorverVideo(contents: VaultContents, bytes: Uint8Array, tipo: string, armazem: ArmazemDeMedia): string {
  return guardar(contents, armazem, bytes, enderecoDe(bytes), { f: "bytes", p: `data:${tipo};base64,`, t: tipo, imagem: null }, "anexo")
}

/** Absorbs the own profile portrait (`avatarDataUrl`). Returns the `sha`, for `profile.avatarRef`. */
export function absorverRetrato(contents: VaultContents, dataUrl: string, armazem: ArmazemDeMedia): string {
  return absorverTexto(contents, armazem, dataUrl, "", "retrato")
}

/** The `sha` of a `{ ref }`, or null. */
const refDe = (valor: unknown): string | null => (eRegisto(valor) && typeof valor.ref === "string" ? valor.ref : null)

/**
 * An `evicted` marker without `ref` or a poster by reference. A marker does
 * not point to bytes: a `ref` in it can only be foreign (Ruling R14). The same
 * object if it had none of this.
 */
function marcadorLimpo(item: Registo): Registo {
  if (!("ref" in item) && !("poster" in item && typeof item.poster !== "string")) return item
  const { ref: _ref, ...resto } = item
  if ("poster" in resto && typeof resto.poster !== "string") delete resto.poster
  return resto
}

/** The `sha` values a payload references directly, in field order (image thumbnails excluded). */
export function shasDoPayload(payload: StoredPayload): string[] {
  const shas: string[] = []
  const doAnexo = (item: unknown) => {
    // An `evicted` marker never references anything (R14): a `ref` in it does not hold off the collection.
    if (!eRegisto(item) || item.evicted === true) return
    for (const sha of [refDe(item), refDe(item.poster)]) if (sha) shas.push(sha)
  }
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = payload[chave]
    if (Array.isArray(lista)) lista.forEach(doAnexo)
  }
  const links = payload.links
  if (Array.isArray(links)) {
    for (const cartao of links) {
      const sha = eRegisto(cartao) ? refDe(cartao.thumbnail) : null
      if (sha) shas.push(sha)
    }
  }
  for (const chave of ANEXOS_SOLTOS) doAnexo(payload[chave])
  return shas
}

/** The `partes.sha256` of a payload's videos. */
function shasDasPartes(payload: StoredPayload | undefined): string[] {
  const shas: string[] = []
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = payload?.[chave]
    if (!Array.isArray(lista)) continue
    for (const item of lista) {
      const partes = eRegisto(item) ? item.partes : undefined
      if (eRegisto(partes) && typeof partes.sha256 === "string") shas.push(partes.sha256)
    }
  }
  return shas
}

/**
 * Everything the vault references: each channel's two lists, the directory,
 * `spaceMeta`, the rooms and the own portrait, plus each one's thumbnail, and
 * the post videos (through the parts) that have a reference. Reports never
 * have bytes.
 */
export function shasReferenciados(contents: VaultContents): Set<string> {
  const vivos = new Set<string>()
  const doPayload = (payload: StoredPayload | undefined) => {
    if (payload) for (const sha of shasDoPayload(payload)) vivos.add(sha)
  }
  for (const listas of [contents.history, contents.estadoDoCanal]) {
    for (const entradas of Object.values(listas ?? {})) {
      // `?.`: a broken entry (a `null`) stays in the vault as it is (the migration does not touch it) and does not block the collection.
      for (const entrada of entradas) {
        doPayload(entrada?.payload)
        // A post video points to its bytes through the parts (`partes.sha256`), not through `{ ref }`.
        for (const sha of shasDasPartes(entrada?.payload)) if (contents.media?.[sha]) vivos.add(sha)
      }
    }
  }
  // The archived conversation (17/11/2026): each page's blob, and the media its messages reference.
  for (const indice of Object.values(contents.arquivoDaConversa ?? {})) {
    for (const pagina of indice) {
      vivos.add(pagina.sha)
      for (const sha of pagina.media) vivos.add(sha)
    }
  }
  for (const entradas of Object.values(contents.porArquivar ?? {})) for (const entrada of entradas) doPayload(entrada?.payload)
  for (const perfil of Object.values(contents.directory ?? {})) doPayload(perfil.payload)
  for (const meta of Object.values(contents.spaceMeta ?? {})) doPayload(meta.payload)
  for (const salas of Object.values(contents.channelRooms ?? {})) for (const sala of Object.values(salas)) doPayload(sala.payload)
  if (contents.profile.avatarRef) vivos.add(contents.profile.avatarRef)
  for (const sha of [...vivos]) {
    const mini = contents.media?.[sha]?.mini
    if (mini) vivos.add(mini)
  }
  return vivos
}

/**
 * Deletes from the store and from `contents.media` whatever nothing
 * references, thumbnails and crash orphans included (design §5, collection).
 * The caller writes the vault. It runs over the whole vault: an absorption
 * whose payload has not yet entered a list would count as an orphan, so
 * absorbing and storing happen in the same mutation. Returns the deleted `sha`
 * values.
 */
export async function recolher(contents: VaultContents, armazem: ArmazemDeMedia, emVoo: ReadonlySet<string> = new Set()): Promise<string[]> {
  // `emVoo`: absorbed before the payload that references them entered the vault (a video in `preparar`): alive too.
  const vivos = shasReferenciados(contents)
  for (const sha of emVoo) vivos.add(sha)
  const mortos = new Set<string>()
  const media = contents.media ?? {}
  for (const sha of Object.keys(media)) {
    if (vivos.has(sha)) continue
    delete media[sha]
    mortos.add(sha)
  }
  for (const sha of armazem.shas()) if (!vivos.has(sha)) mortos.add(sha)
  const apagados = [...mortos]
  if (apagados.length > 0) await armazem.apagar(apagados)
  return apagados
}

/**
 * The media bytes a payload has on this device: the `b` of each reference
 * present in the store, card thumbnails, posters and each image's thumbnail
 * included (Ruling R3, lesson from 1.1.0), plus the bytes that still come as
 * text (an old sibling), at 3/4 of the base64 characters.
 */
export function bytesPresentes(contents: VaultContents, payload: StoredPayload, armazem: ArmazemDeMedia): number {
  let total = 0
  for (const sha of shasDoPayload(payload)) {
    const ref = contents.media?.[sha]
    if (!ref) continue
    if (armazem.tem(sha)) total += ref.b
    const mini = ref.mini !== undefined && ref.mini !== sha ? contents.media?.[ref.mini] : undefined
    if (mini && armazem.tem(ref.mini as string)) total += mini.b
  }
  const emTexto = (valor: unknown) => {
    if (typeof valor === "string") total += Math.floor((valor.length * 3) / 4)
  }
  const doAnexo = (item: unknown) => {
    if (!eRegisto(item) || item.evicted === true) return
    emTexto(item.inline)
    emTexto(item.poster)
  }
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = payload[chave]
    if (Array.isArray(lista)) lista.forEach(doAnexo)
  }
  const links = payload.links
  if (Array.isArray(links)) for (const cartao of links) if (eRegisto(cartao)) emTexto(cartao.thumbnail)
  for (const chave of ANEXOS_SOLTOS) doAnexo(payload[chave])
  return total
}

/**
 * The exact `inline` of a reference, or null if the reference or the blob is
 * not there. Throws "media blob is damaged" (Erro 522) if the blob does not
 * open.
 */
export async function inflarRef(contents: VaultContents, sha: string, armazem: ArmazemDeMedia): Promise<string | null> {
  const ref = contents.media?.[sha]
  if (!ref) return null
  const claro = await armazem.obter(sha, ref)
  if (!claro) return null
  return ref.f === "bytes" ? (ref.p ?? "") + paraBase64Classico(claro) : descodificador.decode(claro)
}

/**
 * Restores a payload's bytes for the network (design §5, outgoing): each
 * `{ ref }` becomes the exact `inline`, `thumbnail` or `poster` again. An
 * attachment above `maxBytes` (plaintext bytes), without a blob, or with a
 * damaged blob goes as `evicted` with the name and type, which a 1.1.x to 1.3.x
 * client already reads; a thumbnail in those conditions leaves the card or the
 * attachment. The payload received stays as it was.
 *
 * `maxCaracteres` is the page cut for a sibling (`semMediaPesada`), in `inline`
 * units (`caracteresDaRef`), the same as 1.3.2 (Ruling R11): whatever exceeds
 * it is not even read from the store. It does not cut posters, which 1.3.2 did
 * not cut either.
 */
export async function inflarPayload(
  contents: VaultContents,
  payload: StoredPayload,
  armazem: ArmazemDeMedia,
  opcoes: { maxBytes?: number; maxCaracteres?: number } = {},
): Promise<StoredPayload> {
  const texto = async (sha: string, poster = false): Promise<string | null> => {
    const ref = contents.media?.[sha]
    if (!ref || (opcoes.maxBytes !== undefined && ref.b > opcoes.maxBytes)) return null
    if (!poster && opcoes.maxCaracteres !== undefined && caracteresDaRef(ref) > opcoes.maxCaracteres) return null
    try {
      return await inflarRef(contents, sha, armazem)
    } catch {
      return null
    }
  }
  const semCampo = (objecto: Registo, campo: string): Registo => {
    const { [campo]: _tirado, ...resto } = objecto
    return resto
  }
  const inflarAnexo = async (item: unknown): Promise<unknown> => {
    if (!eRegisto(item)) return item
    // A marker is never inflated: a `ref` in it can only be foreign (R14).
    if (item.evicted === true) return marcadorLimpo(item)
    let novo = item
    const sha = refDe(item)
    if (sha) {
      const inline = await texto(sha)
      if (inline === null) {
        return { evicted: true, name: typeof item.name === "string" ? item.name : "", mediaType: typeof item.mediaType === "string" ? item.mediaType : "" }
      }
      novo = trocarChave(item, "ref", "inline", inline)
    }
    const shaDoPoster = refDe(novo.poster)
    if (shaDoPoster) {
      const poster = await texto(shaDoPoster, true)
      novo = poster === null ? semCampo(novo, "poster") : { ...novo, poster }
    }
    return novo
  }
  const inflarCartao = async (cartao: unknown): Promise<unknown> => {
    const sha = eRegisto(cartao) ? refDe(cartao.thumbnail) : null
    if (!sha) return cartao
    const thumbnail = await texto(sha)
    return thumbnail === null ? semCampo(cartao as Registo, "thumbnail") : { ...(cartao as Registo), thumbnail }
  }

  const copia: StoredPayload = { ...payload }
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = payload[chave]
    if (Array.isArray(lista)) copia[chave] = await Promise.all(lista.map(inflarAnexo))
  }
  const links = payload.links
  if (Array.isArray(links)) copia.links = await Promise.all(links.map(inflarCartao))
  for (const chave of ANEXOS_SOLTOS) {
    if (eRegisto(payload[chave])) copia[chave] = await inflarAnexo(payload[chave])
  }
  return copia
}

/**
 * Turns an original into class "mini" (Ruling R9): the AAD binds the class, so
 * the blob is re-encrypted with a new nonce, and only then does the new
 * reference enter the vault. An original no longer in the store only changes
 * its reference.
 */
async function passarAMini(contents: VaultContents, sha: string, ref: RefDeMedia, armazem: ArmazemDeMedia): Promise<void> {
  const nova: RefDeMedia = { ...ref, n: aleatorio(24), mini: sha, c: "mini" }
  if (armazem.tem(sha)) {
    try {
      if (!(await armazem.reclassificar(sha, ref, nova))) return
    } catch {
      return
    }
  }
  if (contents.media?.[sha] === ref) contents.media[sha] = nova
}

/**
 * Makes and records the permanent thumbnail of an image (design §3). Changes
 * `contents.media`; the caller writes the vault right after (a
 * reclassification has already re-encrypted the blob, and only the new
 * reference opens it).
 *
 * - Up to 320 px and 40 KB: it is its own thumbnail, and its class becomes "mini".
 * - Otherwise, the store's `Miniaturista` makes one up to 320 px, which enters
 *   as its own reference of class "mini" and goes in `ref.mini`.
 * - A format the platform cannot decode: an original up to 200 KB becomes
 *   class "mini" (it is its own thumbnail); above that it stays as it is.
 */
export async function pedirMiniatura(contents: VaultContents, sha: string, armazem: ArmazemDeMedia): Promise<void> {
  const ref = contents.media?.[sha]
  if (!ref || ref.mini !== undefined || !ref.t.startsWith("image/")) return
  if (propriaMiniatura(ref)) {
    if (ref.c === "mini") contents.media![sha] = { ...ref, mini: sha }
    else await passarAMini(contents, sha, ref, armazem)
    return
  }
  const miniaturista = armazem.miniaturista
  if (!miniaturista) return

  let claro: Uint8Array | null
  try {
    claro = await armazem.obter(sha, ref)
  } catch {
    return
  }
  const imagem = !claro ? null : ref.f === "bytes" ? claro : lerDataUrl(descodificador.decode(claro)).bytes
  if (!imagem || contents.media?.[sha] !== ref) return

  let feita: Awaited<ReturnType<typeof miniaturista.fazer>>
  try {
    feita = await miniaturista.fazer(imagem, ref.t)
  } catch {
    // A platform failure (a Worker that died) says nothing about the format: try again later.
    return
  }
  if (contents.media?.[sha] !== ref) return
  if (!feita) {
    if (ref.b <= TECTOS_DO_ARMAZEM.originalPequeno) await passarAMini(contents, sha, ref, armazem)
    return
  }
  const prefixo = `data:${feita.tipo};base64,`
  const miniSha = enderecoDe(feita.bytes)
  guardar(contents, armazem, feita.bytes, miniSha, { f: "bytes", p: prefixo, t: feita.tipo, imagem: feita.bytes, w: feita.w, h: feita.h }, "miniatura")
  contents.media![sha] = { ...ref, mini: miniSha }
}

/**
 * A portrait (or an icon) that arrived with a `sha` already stored as an
 * original attachment (Ruling R13): a portrait never leaves (design §3), so it
 * becomes class "mini" if it is small. Changes `contents.media`; the caller
 * writes the vault right after (Ruling R12: only the new reference opens the
 * re-encrypted blob). Says whether it changed.
 */
export async function promoverARetrato(contents: VaultContents, sha: string, armazem: ArmazemDeMedia): Promise<boolean> {
  const ref = contents.media?.[sha]
  if (!ref || ref.c !== "original" || classeDe("retrato", ref).c !== "mini") return false
  await passarAMini(contents, sha, ref, armazem)
  return contents.media?.[sha] !== ref
}

/** The `sha` values of a payload's portrait and icon (`avatar`, `icon`), the ones the "retrato" policy keeps. */
export function shasDosRetratos(payload: StoredPayload): string[] {
  const shas: string[] = []
  for (const chave of ANEXOS_SOLTOS) {
    const sha = refDe(payload[chave])
    if (sha) shas.push(sha)
  }
  return shas
}

/**
 * The bytes of a media item, decrypted from the store: the file's (in a
 * "texto" reference, those of the data URL inside). Null if the reference or
 * the blob is not there, or if the text is not a base64 data URL. Throws
 * "media blob is damaged" (Erro 522) if the blob does not open.
 */
export async function bytesDoMedia(contents: VaultContents, sha: string, armazem: ArmazemDeMedia): Promise<Uint8Array | null> {
  const ref = contents.media?.[sha]
  if (!ref) return null
  const claro = await armazem.obter(sha, ref)
  if (!claro) return null
  return ref.f === "bytes" ? claro : lerDataUrl(descodificador.decode(claro)).bytes
}

/**
 * A copy of the payload without media references (a tombstone arrived, design
 * §5): each attachment with `{ ref }` (or a video, through the parts) becomes
 * the `evicted` marker (the name and the type), and the thumbnails by reference
 * leave. The bytes are no longer referenced, and the collection deletes them.
 * The same object if there were none.
 */
export function semReferencias(payload: StoredPayload): StoredPayload {
  if (shasDoPayload(payload).length === 0 && shasDasPartes(payload).length === 0) return payload
  const copia: StoredPayload = { ...payload }
  const marcador = (item: unknown): unknown => {
    if (!eRegisto(item)) return item
    // A video points to its bytes through the parts: it leaves too.
    if (refDe(item) || eRegisto(item.partes)) {
      return { evicted: true, name: typeof item.name === "string" ? item.name : "", mediaType: typeof item.mediaType === "string" ? item.mediaType : "" }
    }
    if (refDe(item.poster)) {
      const { poster: _poster, ...resto } = item
      return resto
    }
    return item
  }
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = payload[chave]
    if (Array.isArray(lista)) copia[chave] = lista.map(marcador)
  }
  const links = payload.links
  if (Array.isArray(links)) {
    copia.links = links.map((cartao) => {
      if (!eRegisto(cartao) || !refDe(cartao.thumbnail)) return cartao
      const { thumbnail: _miniatura, ...resto } = cartao
      return resto
    })
  }
  for (const chave of ANEXOS_SOLTOS) if (eRegisto(payload[chave])) copia[chave] = marcador(payload[chave])
  return copia
}

/**
 * A payload with only `inline` or `evicted`, never with a reference (Ruling
 * R14 on the wire between siblings). It works both ways:
 *
 * - incoming, in a sibling's payload: a foreign `{ ref }` would point to a
 *   `sha` in this vault and inflate another media item's bytes on the way in;
 * - outgoing, when the store could not inflate (the vault locked): a 1.1.x to
 *   1.3.x sibling would draw the `ref` as an empty `img src`.
 *
 * An attachment with `ref` and no `inline` becomes `evicted`; a `ref` next to
 * an `inline` leaves; in a video (`partes`), only the `ref` leaves, and the
 * video stays. A thumbnail, a poster, a portrait or an icon that is not text
 * leaves. `avatarRef` (the own profile shape) leaves. The same payload if there
 * was none of this.
 */
export function soInlineOuEvicted(payload: StoredPayload): StoredPayload {
  let copia: StoredPayload | null = null
  const mudar = (chave: string, valor: unknown) => {
    copia ??= { ...payload }
    if (valor === undefined) delete copia[chave]
    else copia[chave] = valor
  }
  const limpar = (item: unknown): unknown => {
    if (!eRegisto(item)) return item
    if (item.evicted === true) return marcadorLimpo(item)
    let novo = item
    if ("ref" in novo) {
      const temTexto = typeof novo.inline === "string" && novo.inline.length > 0
      if (!temTexto && !eRegisto(novo.partes)) {
        return { evicted: true, name: typeof novo.name === "string" ? novo.name : "", mediaType: typeof novo.mediaType === "string" ? novo.mediaType : "" }
      }
      const { ref: _ref, ...resto } = novo
      novo = resto
    }
    if ("poster" in novo && typeof novo.poster !== "string") {
      const { poster: _poster, ...resto } = novo
      novo = resto
    }
    return novo
  }
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = payload[chave]
    if (!Array.isArray(lista)) continue
    const nova = lista.map(limpar)
    if (nova.some((item, i) => item !== lista[i])) mudar(chave, nova)
  }
  const links = payload.links
  if (Array.isArray(links)) {
    const novos = links.map((cartao) => {
      if (!eRegisto(cartao) || !("thumbnail" in cartao) || typeof cartao.thumbnail === "string") return cartao
      const { thumbnail: _miniatura, ...resto } = cartao
      return resto
    })
    if (novos.some((cartao, i) => cartao !== links[i])) mudar("links", novos)
  }
  for (const chave of ANEXOS_SOLTOS) {
    const anexo = payload[chave]
    if (anexo !== undefined && !eRegisto(anexo)) mudar(chave, undefined)
    else if (eRegisto(anexo)) {
      const limpo = limpar(anexo)
      if (limpo !== anexo) mudar(chave, limpo)
    }
  }
  if ("avatarRef" in payload) mudar("avatarRef", undefined)
  return copia ?? payload
}

/**
 * A payload as the interface reads it (Task 10, design §8): each attachment
 * with `{ ref }` (and the portrait or the icon) carries the reference
 * measurements, `w` and `h` for the reserved box, `mini` for the thumbnail and
 * `b` for the weight (R16), and `falta: true` when the original is not on this
 * device. For the bridge only: never written nor sent on the wire (the protocol
 * schema strips them, and the output to siblings swaps the item for `inline` or
 * `evicted`). The same payload if there are no references.
 */
export function paraOEcra(
  payload: StoredPayload,
  media: Readonly<Record<string, RefDeMedia>>,
  presente: (sha: string) => boolean,
): StoredPayload {
  if (shasDoPayload(payload).length === 0) return payload
  const medir = (item: unknown): unknown => {
    if (!eRegisto(item) || item.evicted === true) return item
    const sha = refDe(item)
    const ref = sha ? media[sha] : undefined
    if (!sha || !ref) return item
    return {
      ...item,
      b: ref.b,
      ...(ref.w !== undefined && ref.h !== undefined ? { w: ref.w, h: ref.h } : {}),
      ...(ref.mini !== undefined ? { mini: ref.mini } : {}),
      ...(presente(sha) ? {} : { falta: true }),
    }
  }
  const copia: StoredPayload = { ...payload }
  for (const chave of CHAVES_DE_ANEXOS) {
    const lista = payload[chave]
    if (Array.isArray(lista)) copia[chave] = lista.map(medir)
  }
  for (const chave of ANEXOS_SOLTOS) if (eRegisto(payload[chave])) copia[chave] = medir(payload[chave])
  return copia
}
