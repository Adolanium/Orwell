#!/usr/bin/env node
/**
 * The migration of the media from the vault to the store (design §6),
 * measured: vault size before and after, how long it takes, and what ONE vault
 * write costs before and after. And the proof that nothing is lost when the
 * process dies halfway.
 *
 *   npm run build
 *   node scripts/medir-migracao-do-cofre.mjs                        # synthetic vault
 *   IMAGEM_KB=40 node scripts/medir-migracao-do-cofre.mjs           # ~11 MB
 *   COFRE=conta.enclave FRASE='a frase' node scripts/medir-migracao-do-cofre.mjs
 *   QUEDAS=0 node scripts/medir-migracao-do-cofre.mjs               # without the crashes
 *
 * COFRE is an exported account file (the "enclave-vault" envelope) or the
 * vault file as it is on disk (with the orwv2 header), protected by a
 * passphrase. Without COFRE, the script builds a version 2 vault: CANAIS
 * channels with MENSAGENS messages in all, PCT_IMAGENS % with an image of
 * IMAGEM_KB KB (file bytes; the `inline` carries 4/3 of that), and the rest a
 * real vault has (link cards with a thumbnail, portraits in the directory, the
 * own portrait, channel icons, posts with video in `contents.videos`, and
 * attachments already evicted). The shapes are those of the frozen vault
 * `packages/client-core/testes/cofre-v2.ts`.
 *
 * It NEVER writes to disk: the vault and the store live in memory (the real
 * `Vault` and `ArmazemDeMedia`, with in-memory backends). The KDF is the real
 * one.
 *
 * The crashes: a "disk" counts the writes (the vault's and the store's). In a
 * run, the process "dies" before write number K: from then on no write reaches
 * the disk, and what stayed there is what a dead process would leave. Then a
 * NEW vault and store are opened over copies of that disk and `migrarTudo`
 * runs again. At the end, each inflated payload (the `inline`, the
 * `thumbnail`, the `poster`, the portraits, the icons and the video bytes) must
 * equal the original, byte for byte, and each reference must have its blob.
 */
import { readFileSync } from "node:fs"
import { loadavg } from "node:os"
import { webcrypto } from "node:crypto"
import {
  ArmazemDeMedia,
  ArmazemEmMemoria,
  Vault,
  base64ParaBytes,
  bytesDoMedia,
  bytesParaBase64,
  comCabecalho,
  inflarPayload,
  inflarRef,
  migrarTudo,
  newVaultContents,
  semCabecalho,
  shasReferenciados,
  unidadesPorMigrar,
} from "@enclave/client-core"
import { toBase64 } from "@enclave/protocol"
import { sha256 } from "@noble/hashes/sha2.js"
if (!globalThis.crypto) globalThis.crypto = webcrypto

const FRASE = process.env.FRASE ?? "frase-da-bancada-da-migracao"
const ESCRITAS = 9
const CANAIS = Number(process.env.CANAIS ?? 20)
const MENSAGENS = Number(process.env.MENSAGENS ?? 2_000)
const PCT_IMAGENS = Number(process.env.PCT_IMAGENS ?? 10)
const IMAGEM_KB = Number(process.env.IMAGEM_KB ?? 100)
const QUEDAS = process.env.QUEDAS !== "0"
const SEMENTE = Number(process.env.SEMENTE ?? 984)

const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`

// --- the disk that can die ---------------------------------------------------------
/** Counts the writes; before write number `morreEm`, it dies, and no write gets through anymore. */
class Disco {
  escritas = 0
  morto = false
  ultima = null
  #morreEm
  #aoMorrer
  morte
  constructor(morreEm = Number.POSITIVE_INFINITY) {
    this.#morreEm = morreEm
    this.morte = new Promise((r) => (this.#aoMorrer = r))
  }
  /** Says whether this write reaches the disk. */
  passa(tipo) {
    if (this.morto) return false
    if (this.escritas + 1 >= this.#morreEm) {
      this.morto = true
      this.ultima = tipo
      this.#aoMorrer()
      return false
    }
    this.escritas++
    this.ultima = tipo
    return true
  }
}
/** A write that does not get through: the process died, nobody ever gets an answer. */
const nunca = () => new Promise(() => {})

class CofreEmMemoria {
  bytes = null
  supportsOsProtection = false
  constructor(disco, bytes = null) {
    this.disco = disco
    this.bytes = bytes
  }
  async read() {
    return this.bytes
  }
  write(b) {
    if (!this.disco.passa("cofre")) return nunca()
    this.bytes = b
    return Promise.resolve()
  }
  async clear() {
    this.bytes = null
  }
}

/** The store backend over an `ArmazemEmMemoria`, with the writes going through the disk. */
class ArmazemNoDisco {
  constructor(disco, dentro = new ArmazemEmMemoria()) {
    this.disco = disco
    this.dentro = dentro
  }
  listar() {
    return this.dentro.listar()
  }
  ler(sha) {
    return this.dentro.ler(sha)
  }
  escrever(sha, blob, meta) {
    return this.disco.passa("blob") ? this.dentro.escrever(sha, blob, meta) : nunca()
  }
  tocar(sha, u) {
    return this.disco.passa("tocar") ? this.dentro.tocar(sha, u) : nunca()
  }
  apagar(shas) {
    return this.disco.passa("apagar") ? this.dentro.apagar(shas) : nunca()
  }
  lerTecto() {
    return this.dentro.lerTecto()
  }
  guardarTecto(b) {
    return this.disco.passa("tecto") ? this.dentro.guardarTecto(b) : nunca()
  }
  destruir() {
    return this.disco.passa("destruir") ? this.dentro.destruir() : nunca()
  }
  selar() {
    this.dentro.selar()
  }
}

/** A copy of what the store has on disk, in a new `ArmazemEmMemoria`. */
async function copiaDoArmazem(backend) {
  const novo = new ArmazemEmMemoria()
  for (const { sha, bytes, ultimoUso, classe } of await backend.listar()) {
    await novo.escrever(sha, await backend.ler(sha), { bytes, classe, ultimoUso })
  }
  const tecto = await backend.lerTecto()
  if (tecto !== null) await novo.guardarTecto(tecto)
  return novo
}

/** The migration makes no thumbnails (design §6, step 6); the fake thumbnailer only proves it is not called. */
const miniaturista = {
  chamadas: 0,
  async fazer() {
    this.chamadas++
    return null
  },
}

/** A vault open over a disk, with the store attached (as the session attaches it). */
async function abrir(bytesDoCofre, disco, dentroDoArmazem) {
  const backend = new CofreEmMemoria(disco, bytesDoCofre)
  const armazemBackend = new ArmazemNoDisco(disco, dentroDoArmazem)
  const armazem = new ArmazemDeMedia(armazemBackend, miniaturista)
  const vault = new Vault(backend)
  vault.ligarArmazem(armazem)
  await vault.unlock(FRASE)
  await vault.armazemPronto()
  return { vault, armazem, backend, armazemBackend }
}

async function msPorGravacao(vault) {
  const tempos = []
  for (let i = 0; i < ESCRITAS + 2; i++) {
    const t0 = performance.now()
    await vault.update((c) => {
      c.lastSeq["!marca:bancada.test"] = i
    })
    if (i >= 2) tempos.push(performance.now() - t0)
  }
  return mediana(tempos)
}

// --- the input vault -----------------------------------------------------------------
/** A deterministic generator (xorshift32): the same SEMENTE gives the same vault. */
function gerador(semente) {
  let x = semente >>> 0 || 1
  return () => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x
  }
}
const proximo = gerador(SEMENTE)
const be32 = (n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
/** A PNG with a real header (the dimensions can be read) and the rest random: each image is different. */
function png(largura, altura, tamanho) {
  const bytes = new Uint8Array(tamanho)
  for (let i = 0; i < tamanho; i += 4) {
    const v = proximo()
    bytes[i] = v & 0xff
    bytes[i + 1] = (v >> 8) & 0xff
    bytes[i + 2] = (v >> 16) & 0xff
    bytes[i + 3] = v >>> 24
  }
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(largura), ...be32(altura), 8, 6, 0, 0, 0], 0)
  return bytes
}
const dataUrl = (tipo, bytes) => `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`
const anexo = (name, mediaType, kind, inline) => ({ url: "", inline, key: "", nonce: "", digest: "", kind, name, mediaType, byteLength: inline.length })
const FRASES = [
  "Amanhã às nove no lagar, quem puder leva a chave do portão de baixo.",
  "Vi agora a mensagem. Concordo, mas convém confirmar com a Câmara antes de avançar.",
  "Ok",
  "Mandei o orçamento por email. Diz-me se chegou, que o anexo era grande e às vezes fica preso.",
]

/** The contents of a version 2 vault, with the shapes of the frozen vault. */
function conteudoV2() {
  const c = newVaultContents()
  c.profile.displayName = "Dono"
  c.profile.avatarDataUrl = dataUrl("image/png", png(256, 256, 12_000))
  const porCanal = Math.ceil(MENSAGENS / CANAIS)
  const cadaImagem = Math.max(1, Math.round(100 / PCT_IMAGENS))
  let n = 0
  for (let k = 0; k < CANAIS; k++) {
    const canal = `!canal${String(k).padStart(3, "0")}:casa.test`
    const lista = []
    for (let i = 0; i < porCanal && n < MENSAGENS; i++, n++) {
      const at = Date.UTC(2026, 9, 1) + n * 60_000
      const payload = { t: "message", id: `m-${k}-${String(i).padStart(6, "0")}`, sentAt: at, body: FRASES[n % FRASES.length], attachments: [], links: [], mentions: [] }
      if (n % cadaImagem === 0) {
        // The oldest in each channel had already been evicted by the 1.3.x budget.
        payload.attachments = i < 10 ? [{ evicted: true, name: `velha${n}.png`, mediaType: "image/png" }] : [anexo(`foto${n}.png`, "image/png", "image", dataUrl("image/png", png(1600, 1200, IMAGEM_KB * 1000)))]
      }
      if (n % 20 === 7) payload.links = [{ url: `https://exemplo.pt/${n}`, kind: "link", title: `cartão ${n}`, thumbnail: dataUrl("image/jpeg", png(320, 180, 12_000)) }]
      lista.push({ seq: i + 1, sender: `@pessoa${n % 7}:casa.test`, at, payload })
    }
    c.history[canal] = lista
  }
  // Two communities with a wall: a post with a photo and a video (poster, parts and the bytes in `videos`), and the icon.
  for (let k = 0; k < 2; k++) {
    const canal = `!comunidade${k}:casa.test`
    const video = png(16, 16, 300_000)
    const sha = toBase64(sha256(video))
    c.estadoDoCanal[canal] = [
      {
        seq: 10,
        sender: "@pessoa1:casa.test",
        at: 4_000,
        payload: {
          t: "post",
          id: `p-publicacao-${k}`,
          postedAt: 4_000,
          caption: "o passeio",
          media: [
            anexo("passeio.png", "image/png", "image", dataUrl("image/png", png(1200, 800, IMAGEM_KB * 1000))),
            { url: "", key: "", nonce: "", digest: "", kind: "video", name: "passeio.mp4", mediaType: "video/mp4", duration: 3, byteLength: video.length, poster: dataUrl("image/png", png(320, 240, 15_000)), partes: { n: 1, sha256: sha, bytes: video.length } },
          ],
          links: [],
          tags: [],
        },
      },
    ]
    c.videos = { ...c.videos, [sha]: { b64: bytesParaBase64(video), at: 4_000 } }
    c.spaceMeta[canal] = { at: 6_000, payload: { t: "space.meta", name: `Comunidade ${k}`, icon: anexo("icone.png", "image/png", "image", dataUrl("image/png", png(64, 64, 3_000))), updatedAt: 6_000 } }
    c.channelRooms[canal] = { geral: { at: 6_000, payload: { t: "channel.meta", room: "geral", name: "Geral", updatedAt: 6_000 } } }
  }
  // The directory: 60 profiles with a portrait.
  for (let i = 0; i < 60; i++) {
    c.directory[`@perfil${i}:casa.test`] = { at: 5_000, payload: { t: "profile", displayName: `Perfil ${i}`, avatar: anexo("avatar", "image/png", "image", dataUrl("image/png", png(128, 128, 6_000))), donations: [], updatedAt: 5_000 } }
  }
  return c
}

/** The vault file, as on disk: the account's (COFRE) or a version 2 one made here. */
async function ficheiroDeEntrada() {
  if (process.env.COFRE) {
    const bytes = new Uint8Array(readFileSync(process.env.COFRE))
    const json = semCabecalho(bytes)
    if (json === null) throw new Error("COFRE não tem o cabeçalho orwv2: não é um cofre da 1.x")
    const lido = JSON.parse(json)
    if (lido.format === "enclave-vault") {
      // An exported account file: it enters through the import door, as on screen.
      const backend = new CofreEmMemoria(new Disco())
      await new Vault(backend).importVault(bytes, FRASE)
      return { bytes: backend.bytes, origem: `${process.env.COFRE} (ficheiro de conta)` }
    }
    if (lido.protection !== "passphrase") throw new Error("COFRE está protegido pelo sistema (keychain): exporta a conta com uma frase e usa esse ficheiro")
    return { bytes, origem: `${process.env.COFRE} (cofre do disco)` }
  }
  const backend = new CofreEmMemoria(new Disco())
  const vault = new Vault(backend)
  await vault.create(FRASE, conteudoV2())
  // `create` marks `porMigrar` on contents with bytes; a version 2 vault did not have the mark.
  await vault.update((c) => {
    delete c.armazem
  })
  const ficheiro = JSON.parse(semCabecalho(backend.bytes))
  ficheiro.version = 2
  return { bytes: comCabecalho(JSON.stringify(ficheiro)), origem: `sintético (${CANAIS} canais, ${MENSAGENS} mensagens, ${PCT_IMAGENS} % com imagem de ${IMAGEM_KB} KB, semente ${SEMENTE})` }
}

// --- the proof: the inflated equals the original -----------------------------------
/** Each place with media in the vault, with the exact text that was there (the original) or the one inflated from the store (the migrated). */
async function retrato(contents, armazem) {
  const sitios = new Map()
  const payloadDe = async (p) => (armazem ? inflarPayload(contents, p, armazem) : p)
  for (const [canal, lista] of Object.entries(contents.history ?? {})) for (const e of lista) sitios.set(`h ${canal} ${e.seq}`, JSON.stringify(await payloadDe(e.payload)))
  for (const [canal, lista] of Object.entries(contents.estadoDoCanal ?? {})) for (const e of lista) sitios.set(`e ${canal} ${e.seq}`, JSON.stringify(await payloadDe(e.payload)))
  for (const [quem, p] of Object.entries(contents.directory ?? {})) sitios.set(`d ${quem}`, JSON.stringify(await payloadDe(p.payload)))
  for (const [canal, p] of Object.entries(contents.spaceMeta ?? {})) sitios.set(`s ${canal}`, JSON.stringify(await payloadDe(p.payload)))
  const { avatarDataUrl, avatarRef } = contents.profile
  sitios.set("perfil", armazem && avatarRef ? await inflarRef(contents, avatarRef, armazem) : (avatarDataUrl ?? null))
  // The videos: the bytes of each `partes.sha256`, from `contents.videos` (before) or from the store (after).
  for (const lista of Object.values(contents.estadoDoCanal ?? {})) {
    for (const e of lista) {
      for (const m of e.payload.media ?? []) {
        const sha = m.partes?.sha256
        if (!sha) continue
        const bytes = armazem && !contents.videos?.[sha] ? await bytesDoMedia(contents, sha, armazem) : contents.videos?.[sha] ? base64ParaBytes(contents.videos[sha].b64) : null
        sitios.set(`v ${sha}`, bytes ? Buffer.from(bytes).toString("base64") : null)
      }
    }
  }
  return sitios
}

/** Compares the migrated vault (inflated) with the original. */
async function conferir(original, vault, armazem) {
  const depois = await retrato(vault.contents, armazem)
  let iguais = 0
  const diferentes = []
  for (const [sitio, texto] of original) {
    if (depois.get(sitio) === texto) iguais++
    else diferentes.push(sitio)
  }
  const refs = [...shasReferenciados(vault.contents)]
  const semBlob = refs.filter((sha) => !armazem.tem(sha)).length
  const media = Object.keys(vault.contents.media ?? {})
  const orfaos = armazem.shas().filter((sha) => !Object.hasOwn(vault.contents.media ?? {}, sha)).length
  const inline = JSON.stringify(vault.contents).match(/"(inline|thumbnail|poster|avatarDataUrl)":"data:/g)?.length ?? 0
  return {
    sitios: original.size,
    iguais,
    diferentes: diferentes.slice(0, 5),
    nDiferentes: diferentes.length,
    refs: refs.length,
    semBlob,
    refsSemUso: media.length - refs.length,
    orfaos,
    bytesDeMediaNoCofre: inline,
    porMigrar: Boolean(vault.contents.armazem?.porMigrar),
    unidadesPorMigrar: unidadesPorMigrar(vault.contents).length,
    shas: new Set(refs),
  }
}

// --- correr ---------------------------------------------------------------------------
const { bytes: ficheiro, origem } = await ficheiroDeEntrada()
console.log(`Cofre: ${origem}`)
console.log(`  ficheiro antes: ${mb(ficheiro.length)} (versão ${JSON.parse(semCabecalho(ficheiro)).version})`)

// The clean migration, without crashes.
const disco = new Disco()
const limpo = await abrir(ficheiro, disco, new ArmazemEmMemoria())
const original = await retrato(limpo.vault.contents, null)
const unidades = unidadesPorMigrar(limpo.vault.contents).length
const antesMs = await msPorGravacao(limpo.vault)
const tamanhoAntes = limpo.backend.bytes.length
const escritasAntes = disco.escritas
const t0 = performance.now()
const feito = await migrarTudo(limpo.vault, limpo.armazem)
await limpo.armazem.drenar()
await limpo.vault.gravarAdiada()
const duracaoMs = performance.now() - t0
const escritasDaMigracao = disco.escritas - escritasAntes
const tamanhoDepois = limpo.backend.bytes.length
const depoisMs = await msPorGravacao(limpo.vault)
const prova = await conferir(original, limpo.vault, limpo.armazem)
const estado = limpo.armazem.estado()
console.log(`  ${unidades} unidades por migrar; ${original.size} sítios com payload ou media`)
console.log(`  migração: ${(duracaoMs / 1000).toFixed(2)} s; ${feito.unidades} unidades, ${feito.media} media, ${mb(feito.bytes)} em claro; ${escritasDaMigracao} escritas no disco (cofre e blobs)`)
console.log(`  ficheiro depois: ${mb(tamanhoDepois)} (${((tamanhoDepois / tamanhoAntes) * 100).toFixed(1)} % do de antes, ${mb(tamanhoAntes)} já gravado como 3)`)
console.log(`  armazém: ${estado.originais} originais (${mb(estado.usados)}), ${estado.minis} miniaturas (${mb(estado.usadosPelasMinis)})`)
console.log(`  uma gravação do cofre: ${antesMs.toFixed(1)} ms antes, ${depoisMs.toFixed(1)} ms depois (mediana de ${ESCRITAS})`)
console.log(`  prova: ${prova.iguais}/${prova.sitios} sítios iguais ao original; ${prova.refs} referências, ${prova.semBlob} sem blob; ${prova.bytesDeMediaNoCofre} bytes de media no cofre; porMigrar ${prova.porMigrar}; miniaturista chamado ${miniaturista.chamadas} vezes`)
const resultado = {
  origem,
  ficheiroAntes: ficheiro.length,
  tamanhoAntes,
  tamanhoDepois,
  unidades,
  duracaoMs: Math.round(duracaoMs),
  media: feito.media,
  bytesDeMedia: feito.bytes,
  msPorGravacao: { antes: Number(antesMs.toFixed(1)), depois: Number(depoisMs.toFixed(1)) },
  prova: { ...prova, shas: undefined },
  quedas: [],
}

/** A run that dies before write `k` (counted from the opening), and the resume to the end. Returns what was seen. */
async function comQuedas(pontos) {
  let bytesDoCofre = ficheiro
  let dentro = new ArmazemEmMemoria()
  const vistas = []
  for (const k of [...pontos, Number.POSITIVE_INFINITY]) {
    const d = new Disco(k)
    const r = await abrir(bytesDoCofre, d, dentro)
    const faltavam = unidadesPorMigrar(r.vault.contents).length
    const corrida = migrarTudo(r.vault, r.armazem).then(async () => {
      await r.armazem.drenar()
      await r.vault.gravarAdiada()
      return "acabou"
    })
    const fim = await Promise.race([corrida, d.morte.then(() => "morreu")])
    if (fim === "acabou") return { vistas, prova: await conferir(original, r.vault, r.armazem) }
    vistas.push({ k, faltavam, tipo: d.ultima })
    // What stayed on disk: the vault file and the blobs, copied for the next process.
    bytesDoCofre = r.backend.bytes
    dentro = await copiaDoArmazem(r.armazemBackend.dentro)
  }
  throw new Error("nunca acabou")
}

if (QUEDAS) {
  // The writes are counted from the opening; in a run with crashes there are no measured writes before.
  const N = escritasDaMigracao
  const sorteio = gerador(SEMENTE + 1)
  const fraccoes = [0.02, 0.1, 0.25, 0.33, 0.5, 0.66, 0.75, 0.9, 0.98]
  const pontos = [...new Set([1, 2, 3, ...fraccoes.map((f) => Math.round(N * f)), N - 1, N, ...Array.from({ length: 4 }, () => 1 + (sorteio() % N))])].sort((a, b) => a - b)
  console.log(`\nQuedas: a migração limpa faz ${N} escritas no disco (cofre e blobs); morre-se antes da escrita k`)
  const casos = [...pontos.map((k) => [k]), [Math.round(N * 0.2), Math.round(N * 0.2), Math.round(N * 0.3)]]
  for (const caso of casos) {
    const { vistas, prova: p } = await comQuedas(caso)
    const igual = p.nDiferentes === 0 && p.semBlob === 0 && p.shas.size === prova.shas.size && [...p.shas].every((s) => prova.shas.has(s)) && !p.porMigrar
    const linha = { quedas: vistas, iguais: `${p.iguais}/${p.sitios}`, semBlob: p.semBlob, refsSemUso: p.refsSemUso, orfaos: p.orfaos, mesmasRefsQueALimpa: p.shas.size === prova.shas.size && [...p.shas].every((s) => prova.shas.has(s)), porMigrar: p.porMigrar, ok: igual }
    resultado.quedas.push(linha)
    console.log(`  ${igual ? "ok " : "FALHA"} ${vistas.map((v) => `morre antes da escrita ${v.k} (${v.tipo}, faltavam ${v.faltavam} unidades)`).join(" → ")}: ${linha.iguais} iguais, ${p.semBlob} sem blob, ${p.refsSemUso} refs sem uso, ${p.orfaos} órfãos`)
  }
  resultado.quedasOk = resultado.quedas.every((q) => q.ok)
  console.log(`  ${resultado.quedas.filter((q) => q.ok).length}/${resultado.quedas.length} corridas com quedas acabam iguais à limpa`)
}
console.log(`carga da máquina (1, 5, 15 min): ${loadavg().map((x) => x.toFixed(1)).join(", ")}`)
console.log(JSON.stringify(resultado))
