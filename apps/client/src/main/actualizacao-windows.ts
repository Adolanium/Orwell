/**
 * Self-update on Windows, without a commercial certificate, and without giving
 * the server the power to execute code.
 *
 * ## What changed from `actualizacao.ts`
 *
 * The header of `actualizacao.ts` explains why unsigned `electron-updater` is
 * dangerous: on Windows its verification turns off by itself, and what's left
 * is a hash served by the SAME server that serves the installer. Whoever gained
 * write access to `orwell.pt` could execute anything on all machines.
 *
 * This file removes that lever from the server with our own key:
 *
 *  - the Ed25519 private key lives on the owner's Mac and NEVER goes to the
 *    server;
 *  - the public key lives inside this app (`chave-de-actualizacoes.ts`);
 *  - the manifest (`actualizacao-windows.json`) states the version, name, size,
 *    and SHA-512 of the installer, and it's signed by the private key.
 *
 * The server can serve whatever it wants. What it can't do is write a signature
 * the public key accepts, and without it nothing downloads and nothing runs.
 *
 * ## The order of checks, and why this one
 *
 *  1. the manifest is well-formed (version, name, size, and hashes correct);
 *  2. the signature validates with the embedded key. BEFORE downloading: a fake
 *     manifest doesn't waste anyone's bandwidth;
 *  3. the signed version is GREATER than installed. A properly signed old
 *     version can't downgrade anyone;
 *  4. the download stops at the first byte over the signed size;
 *  5. at the end, the file's size and SHA-512 must match the signed ones.
 *
 * Only if everything passes does the installer run. Anything else (no network,
 * server down, bad signature, deadline expired) ends the same way: the app
 * falls back to its current version, logs a code for "Send report", and the new
 * version notice on login remains as a fallback.
 *
 * ## When it runs
 *
 * Only at startup, only on Windows and only in the packaged app, BEFORE the
 * main window exists. That's what guarantees it never updates mid-call: there's
 * no session, no vault open, no call.
 *
 * ## Public, and not at once (1.3.20)
 *
 * The signature proves the manifest came from our key. It cannot prove the
 * key was not stolen, or used under pressure, by someone who also holds the
 * GitHub account. Two more checks make sure that even then an update can be
 * neither secret nor immediate:
 *
 *  6. transparency: the very bytes of the signed manifest must be the asset
 *     `actualizacao-windows.json` of the GitHub release `v<version>` of the
 *     public repository, downloaded from `github.com` (and GitHub's own
 *     redirect to its asset host), never from orwell.pt. Compared as raw bytes
 *     (SHA-256). Only the asset: no API, no `published_at`;
 *  7. a wait counted on THIS device: from the first time this device saw this
 *     manifest (these bytes) published there (`actualizacao-vista.json` in
 *     `userData`: version, hash, when). 72 hours, 24 for a manifest signed
 *     `urgente`, never less. A release's own date proves nothing: a repository
 *     kept private and opened at the last minute still shows an old date (the
 *     review of 18/11/2026, C2, option A). Before
 *     installing, the asset is fetched again and must still be the same.
 *
 * A different hash, an asset gone, or a clock that went back before the
 * recorded moment: the wait starts again. GitHub unreachable: the app starts
 * the version it has, and the record stays. The time is the device's own clock:
 * whoever moves their own clock only fools themselves.
 *
 * ## Ask first, or install by itself (1.3.20)
 *
 * The person chooses, in Settings, per device: "Ask first" (the default) or
 * "Automatically". Asking comes AFTER every check above that needs no
 * download (manifest, signature, a greater version): a fake or old manifest
 * never reaches the question. "Later" starts the version installed and
 * downloads nothing; the new version notice on login stays as it is.
 * "Install" is the path below, unchanged. The choice is kept in `userData`
 * (`actualizacoes.json`), because it is read here, before any window.
 *
 * ## All-users install (Program Files)
 *
 * Today's installer always installs per-user (`recursos/installer.nsh`).
 * Whoever installed as all-users updates too (approved by owner Nov 3, 2026):
 * the same search, same download, same three checks, and ONLY THEN the screen
 * says Windows will ask for permission, and a UAC window appears. "Yes": the
 * installer runs elevated and overwrites the Program Files install. "No": falls
 * back to its current version with code `uac-recusado`.
 *
 * No `electron` inside here, for the reason of `actualizacao.ts`, `sfu.ts`,
 * and `ecra.ts`: the ports are passed as parameters, and this is tested
 * without window and without network. `index.ts` connects them to the real ones.
 */
import type { spawn } from "node:child_process"
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { maisRecente } from "./actualizacao.js"

/**
 * Where to read the manifest from. Constant, for the same reason as
 * `ENDERECO_DA_VERSAO`: the response picks a version and file INSIDE this
 * folder, and nothing else.
 *
 * The name must match exactly with `NOME_DO_MANIFESTO_WINDOWS` in
 * `scripts/publicar-instaladores.mjs`, which is what writes it.
 */
export const ENDERECO_DA_ACTUALIZACAO_WINDOWS = "https://orwell.pt/transferencias/actualizacao-windows.json"

/** The folder from where the installer is downloaded. The name comes from the
 *  manifest, but the folder doesn't: a manifest can't redirect the app to
 *  another server. */
const PASTA_DAS_DESCARGAS = "https://orwell.pt/transferencias/"

/** Check `PREFIXO_DA_ASSINATURA_WINDOWS` in `scripts/instaladores.mjs`. They must be
 *  the same; the test that signs with one and verifies with the other proves it. */
export const PREFIXO_DA_ASSINATURA = "orwell-actualizacao-windows-v1"

/** The public repository whose releases make an update public. A constant:
 *  the manifest cannot point the check somewhere else. Its name never changes
 *  (a renamed account or repository frees the name for anyone to take). */
export const REPOSITORIO_PUBLICO = "magnuslab-sudo/Orwell"
/** The manifest as published in that release. Built here, from the version only. */
export const NOME_DO_MANIFESTO_NA_RELEASE = "actualizacao-windows.json"
export const enderecoDoManifestoNaRelease = (versao: string): string =>
  `https://github.com/${REPOSITORIO_PUBLICO}/releases/download/v${versao}/${NOME_DO_MANIFESTO_NA_RELEASE}`
/** How long this device must have seen the manifest public before it installs, in hours. */
export const ESPERA_HORAS = 72
/** The floor for a signed `urgente` manifest. Never less. */
export const ESPERA_URGENTE_HORAS = 24

/** The timeouts. The check is short because whoever opens the app is waiting;
 *  download only starts if there's a new version, and then what matters is it doesn't stop. */
export interface Prazos {
  verificacaoMs: number
  /** The manifest from GitHub. */
  transparenciaMs: number
  semDadosMs: number
  descargaMs: number
}

export const PRAZOS: Readonly<Prazos> = {
  /** The entire manifest, from the request to the last byte. */
  verificacaoMs: 8_000,
  transparenciaMs: 8_000,
  /** No new byte during this window: the download gives up. */
  semDadosMs: 30_000,
  /** The cap on the entire download. A ~100 MB installer over a slow connection fits;
   *  a stalled connection doesn't hold startup hostage forever. */
  descargaMs: 15 * 60_000,
}

/** A manifest is a few hundred bytes. */
const MANIFESTO_MAX_BYTES = 16_384
/** No Orwell installer comes close to this (today's has ~100 MB). A signed
 *  size above this is a mistake, and we reject it. */
const INSTALADOR_MAX_BYTES = 512 * 1024 * 1024

const VERSAO = /^\d+\.\d+\.\d+$/
const SHA512 = /^[0-9a-f]{128}$/
/** A simple filename: no slashes, no `..`, no spaces. That's what
 *  `artifactName` in `electron-builder.yml` produces. */
const NOME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.exe$/
/** 64 bytes of Ed25519 in base64 are 88 characters. */
const ASSINATURA = /^[A-Za-z0-9+/]{86}==$/

/** What the manifest says after validation. */
export interface ManifestoWindows {
  versao: string
  ficheiro: string
  bytes: number
  sha512: string
  assinatura: string
  /** Signed: a fix that may install after 24 hours instead of 72. */
  urgente?: true
}

/**
 * The diagnostic codes, one per outcome.
 *
 * They go to "Send report" (see `useAvisoDeVersao` in the UI) and to
 * stderr. They are stable names, not phrases: whoever reads a report needs to know
 * WHAT happened, and phrases change every time someone rewrites them.
 */
export type CodigoDaActualizacao =
  | "em-dia"
  | "sem-manifesto"
  | "sem-rede"
  | "manifesto-recusado"
  | "assinatura-errada"
  | "descarga-falhou"
  | "descarga-parada"
  | "tamanho-errado"
  | "soma-errada"
  | "uac-recusado"
  | "instalador-falhou"
  | "arranque-falhou"
  | "a-instalar"
  /** "Ask first", and the person said "Later": nothing was downloaded. */
  | "adiada"
  /** GitHub could not be reached: no install, the record stays. */
  | "transparencia-inacessivel"
  /** No manifest in a release of this version on GitHub: no install, the wait starts again. */
  | "transparencia-em-falta"
  /** GitHub's manifest is not the one orwell.pt served (or too big): no install, the wait starts again. */
  | "transparencia-diferente"
  /** Seen public, but not yet for 72 hours (24 if urgent) on this device. */
  | "em-espera"

/** The message being signed. See `mensagemDaActualizacaoWindows` in the script. */
export function mensagemDaActualizacao(m: Pick<ManifestoWindows, "versao" | "ficheiro" | "bytes" | "sha512" | "urgente">): string {
  const linhas = [PREFIXO_DA_ASSINATURA, `versao=${m.versao}`, `ficheiro=${m.ficheiro}`, `bytes=${m.bytes}`, `sha512=${m.sha512}`]
  // Only when set, so every manifest signed before 1.3.20 keeps its message.
  if (m.urgente) linhas.push("urgente=1")
  return linhas.join("\n")
}

/** The manifest, validated field by field, or `null`. Nothing passes here without the
 *  right shape: it comes from a server that could be compromised. */
export function lerManifestoWindows(cru: unknown): ManifestoWindows | null {
  if (!cru || typeof cru !== "object") return null
  const d = cru as Record<string, unknown>
  if (typeof d.versao !== "string" || !VERSAO.test(d.versao)) return null
  if (typeof d.ficheiro !== "string" || !NOME.test(d.ficheiro)) return null
  if (typeof d.bytes !== "number" || !Number.isSafeInteger(d.bytes) || d.bytes <= 0 || d.bytes > INSTALADOR_MAX_BYTES)
    return null
  if (typeof d.sha512 !== "string" || !SHA512.test(d.sha512)) return null
  if (typeof d.assinatura !== "string" || !ASSINATURA.test(d.assinatura)) return null
  if (d.urgente !== undefined && typeof d.urgente !== "boolean") return null
  return {
    versao: d.versao,
    ficheiro: d.ficheiro,
    bytes: d.bytes,
    sha512: d.sha512,
    assinatura: d.assinatura,
    ...(d.urgente === true ? { urgente: true as const } : {}),
  }
}

/** The public key, as written (`x` from an Ed25519 JWK). */
export function chavePublicaDe(x: string): KeyObject {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" })
}

/**
 * Does the manifest signature match the embedded key?
 *
 * **Never throws.** A corrupted key or a nonsensical signature is the same
 * as a wrong signature: we don't install.
 */
export function assinaturaValida(manifesto: ManifestoWindows, chave: KeyObject): boolean {
  try {
    return verify(
      null,
      Buffer.from(mensagemDaActualizacao(manifesto), "utf8"),
      chave,
      Buffer.from(manifesto.assinatura, "base64"),
    )
  } catch {
    return false
  }
}

/** What the splash screen shows. The UI only draws this. */
export type EstadoDoEcra =
  | { fase: "a-procurar" }
  | { fase: "a-descarregar"; versao: string; recebidos: number; total: number }
  | { fase: "a-pedir-autorizacao"; versao: string }
  | { fase: "a-instalar"; versao: string }

/** The user's answer to the UAC dialog. */
export type RespostaDoUac = "aceite" | "recusado"

export interface PortasDoArranque {
  /** This app's version (`app.getVersion()`). */
  instalada: string
  /** The update key. `index.ts` ALWAYS passes the built-in one; tests
   *  pass a test one, and that's the only reason it's a parameter. */
  chave: KeyObject
  /** Where the installer is downloaded. Deleted and recreated on each download. */
  pasta: string
  /** The splash screen. */
  mostrar: (estado: EstadoDoEcra) => void
  /**
   * Can we run the install without admin?
   *
   * Yes if the app is installed per-user: then it runs `instalar`.
   * No in an all-users install (in `Program Files`): then it runs
   * `instalarComAdministrador`, which prompts for UAC once, and only after the
   * installer is downloaded and verified.
   */
  semAdministrador: () => boolean | Promise<boolean>
  /** Runs the verified installer. Resolves when it starts; throws if it fails.
   *  The app exits after (via `index.ts`). */
  instalar: (caminho: string) => Promise<void>
  /**
   * Runs the verified installer as admin (via UAC dialog). Resolves
   * to `aceite` when it starts elevated, or to `recusado` when the user says "No";
   * throws if it can't ask. See `lancarComAdministrador`.
   */
  instalarComAdministrador: (caminho: string) => Promise<RespostaDoUac>
  buscar?: typeof fetch
  prazos?: Partial<Prazos>
  /** The timeout clock, so tests don't wait 30 seconds. */
  agora?: () => number
  /**
   * The person's choice for this device (`lerModoGuardado`). Missing is
   * "perguntar": a new version is never installed without asking unless the
   * person chose so.
   */
  modo?: ModoDeActualizacao
  /**
   * Asks whether to install this version now. Called only with "perguntar",
   * and only for a manifest that passed every check. Missing, with
   * "perguntar", reads as "mais-tarde": no question, no install.
   */
  perguntar?: (versao: string) => Promise<RespostaDaPergunta>
  /**
   * When this device first saw a manifest public on GitHub
   * (`actualizacao-vista.json`). `ler` returns `null` for nothing or junk
   * (`lerVista`). Missing, nothing is ever recorded, so nothing ever installs.
   */
  vista?: { ler: () => Promise<Vista | null>; gravar: (vista: Vista | null) => Promise<void> }
}

/** This device saw this manifest (`hash`, SHA-256 of its bytes) on GitHub at `vistoEm`. */
export interface Vista {
  versao: string
  hash: string
  vistoEm: number
}

/** The file in `userData` that keeps it. */
export const FICHEIRO_DA_VISTA = "actualizacao-vista.json"

/** The stored record, validated: anything else reads as "never seen". */
export function lerVista(texto: string | null): Vista | null {
  if (!texto) return null
  try {
    const d = JSON.parse(texto) as Record<string, unknown> | null
    if (!d || typeof d !== "object") return null
    if (typeof d.versao !== "string" || !VERSAO.test(d.versao)) return null
    if (typeof d.hash !== "string" || !/^[0-9a-f]{64}$/.test(d.hash)) return null
    if (typeof d.vistoEm !== "number" || !Number.isFinite(d.vistoEm) || d.vistoEm <= 0) return null
    return { versao: d.versao, hash: d.hash, vistoEm: d.vistoEm }
  } catch {
    return null
  }
}

export function escreverVista(vista: Vista): string {
  return `${JSON.stringify(vista)}\n`
}

/** How this device takes a new version: ask first (the default), or by itself. */
export type ModoDeActualizacao = "perguntar" | "automaticamente"
export const MODO_POR_OMISSAO: ModoDeActualizacao = "perguntar"
/** The answer to "A new version is ready". */
export type RespostaDaPergunta = "instalar" | "mais-tarde"

/** The file in `userData` that keeps the choice. */
export const FICHEIRO_DO_MODO = "actualizacoes.json"

/** Anything that is not a known mode reads as the default: ask. */
export function modoValido(valor: unknown): ModoDeActualizacao {
  return valor === "automaticamente" ? "automaticamente" : MODO_POR_OMISSAO
}

/** The stored file, tolerant: missing or junk is "perguntar". */
export function lerModoGuardado(texto: string | null): ModoDeActualizacao {
  if (!texto) return MODO_POR_OMISSAO
  try {
    return modoValido((JSON.parse(texto) as { modo?: unknown } | null)?.modo)
  } catch {
    return MODO_POR_OMISSAO
  }
}

export function escreverModo(modo: ModoDeActualizacao): string {
  return `${JSON.stringify({ modo })}\n`
}

/**
 * The question's words, in the app's language: English until the person
 * chooses (the rule of `arrancarLingua`), so anything but "pt" is English.
 * Short active sentences (STE100). Button 0 installs, button 1 is "Later",
 * and "Later" is also what closing the box means.
 */
export function textosDaPergunta(versao: string, lingua: string | null): {
  titulo: string
  mensagem: string
  detalhe: string
  botoes: [string, string]
} {
  return lingua === "pt"
    ? {
        titulo: "Orwell",
        mensagem: `Há uma versão nova: ${versao}.`,
        detalhe: "Instalar agora? A app fecha e abre de novo. Com \"Mais tarde\", abre a versão que tens.",
        botoes: ["Instalar", "Mais tarde"],
      }
    : {
        titulo: "Orwell",
        mensagem: `A new version is ready: ${versao}.`,
        detalhe: "Install it now? The app closes and opens again. \"Later\" opens the version you have.",
        botoes: ["Install", "Later"],
      }
}

export type ResultadoDoArranque =
  | {
      accao: "entrar"
      codigo: Exclude<CodigoDaActualizacao, "a-instalar">
      versao?: string
      detalhe?: string
      /** With `em-espera`: from when it may install (ms), for the login notice. */
      instalaEm?: number
    }
  | { accao: "sair"; codigo: "a-instalar"; versao: string }

/** Headers for a request that doesn't need to identify itself or its origin. */
const PEDIDO_ANONIMO = { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" } as const

type Procura =
  | { codigo: "em-dia" | "sem-manifesto" | "sem-rede" | "manifesto-recusado" | "assinatura-errada"; versao?: string }
  | { codigo: "ha"; manifesto: ManifestoWindows; bytes: Uint8Array }

/**
 * The body, up to `max` bytes, or `null` if it is bigger. The declared length
 * is checked before reading, and the stream is cut at the first byte over: a
 * server cannot make the app hold more than `max` in memory.
 */
async function lerComTecto(resposta: Response, max: number): Promise<Uint8Array | null> {
  if (Number(resposta.headers.get("content-length") ?? 0) > max) return null
  if (!resposta.body) return new Uint8Array(0)
  const leitor = resposta.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await leitor.cancel().catch(() => {})
      return null
    }
    partes.push(value)
  }
  const tudo = new Uint8Array(total)
  let em = 0
  for (const parte of partes) {
    tudo.set(parte, em)
    em += parte.byteLength
  }
  return tudo
}

/** Fetch the manifest and decide if there's a new version. Never throws. */
async function procurar(portas: PortasDoArranque, buscar: typeof fetch, prazoMs: number): Promise<Procura> {
  const controlo = new AbortController()
  const prazo = setTimeout(() => controlo.abort(), prazoMs)
  try {
    const resposta = await buscar(ENDERECO_DA_ACTUALIZACAO_WINDOWS, { ...PEDIDO_ANONIMO, signal: controlo.signal })
    // 404 is normal before the first signed release; we mention it
    // separately so it doesn't look like a failure in the log.
    if (resposta.status === 404) return { codigo: "sem-manifesto" }
    if (!resposta.ok) return { codigo: "manifesto-recusado" }
    // The raw bytes, kept: they are what GitHub's copy must match. Decoded only
    // afterwards, and strictly: a byte that is not UTF-8 refuses the manifest.
    const bytes = await lerComTecto(resposta, MANIFESTO_MAX_BYTES)
    if (!bytes) return { codigo: "manifesto-recusado" }

    let cru: unknown
    try {
      cru = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    } catch {
      return { codigo: "manifesto-recusado" }
    }
    const manifesto = lerManifestoWindows(cru)
    if (!manifesto) return { codigo: "manifesto-recusado" }
    // Check the signature before the version: a fake manifest with an old
    // version is also fake, and the log should say so.
    if (!assinaturaValida(manifesto, portas.chave)) return { codigo: "assinatura-errada", versao: manifesto.versao }
    if (!maisRecente(manifesto.versao, portas.instalada)) return { codigo: "em-dia", versao: manifesto.versao }
    return { codigo: "ha", manifesto, bytes }
  } catch {
    // No network, DNS failure, cert rejected, timeout: all the same to the
    // user launching the app.
    return { codigo: "sem-rede" }
  } finally {
    clearTimeout(prazo)
  }
}

type NoGithub = { ok: true } | { ok: false; codigo: "transparencia-inacessivel" | "transparencia-em-falta" | "transparencia-diferente" }

const sha256 = (dados: Uint8Array): string => createHash("sha256").update(dados).digest("hex")

/**
 * Is this exact manifest the asset of the GitHub release of its version?
 * Never throws.
 *
 * One request, to an address built here from the version, on `github.com`;
 * GitHub answers with a redirect to its own asset host, under TLS. The body is
 * capped before it is read, and compared as raw bytes with what orwell.pt
 * served.
 */
async function noGithub(manifesto: ManifestoWindows, servido: Uint8Array, buscar: typeof fetch, prazoMs: number): Promise<NoGithub> {
  const controlo = new AbortController()
  const prazo = setTimeout(() => controlo.abort(), prazoMs)
  try {
    const resposta = await buscar(enderecoDoManifestoNaRelease(manifesto.versao), { ...PEDIDO_ANONIMO, signal: controlo.signal })
    if (resposta.status === 404) return { ok: false, codigo: "transparencia-em-falta" }
    if (!resposta.ok) return { ok: false, codigo: "transparencia-inacessivel" }
    const publicado = await lerComTecto(resposta, MANIFESTO_MAX_BYTES)
    if (!publicado || sha256(publicado) !== sha256(servido)) return { ok: false, codigo: "transparencia-diferente" }
    return { ok: true }
  } catch {
    return { ok: false, codigo: "transparencia-inacessivel" }
  } finally {
    clearTimeout(prazo)
  }
}

type Descarga = { ok: true; caminho: string } | { ok: false; codigo: "descarga-falhou" | "descarga-parada" | "tamanho-errado" | "soma-errada" }

/**
 * Download the installer and verify it against the signed version.
 *
 * SHA-512 is calculated AS we write, not re-read from disk after: same result
 * without reading 100 MB twice. The file is only marked good after it closes,
 * with size and checksum verified.
 */
async function descarregar(
  portas: PortasDoArranque,
  manifesto: ManifestoWindows,
  buscar: typeof fetch,
  prazos: Prazos,
): Promise<Descarga> {
  const agora = portas.agora ?? Date.now
  // Deleted and recreated: a leftover from a previous download is never
  // confused with this one, and the disk doesn't accumulate installers.
  await rm(portas.pasta, { recursive: true, force: true })
  await mkdir(portas.pasta, { recursive: true })
  const caminho = join(portas.pasta, manifesto.ficheiro)

  const controlo = new AbortController()
  const inicio = agora()
  let ultimoByte = agora()
  let porque: "descarga-falhou" | "descarga-parada" | "tamanho-errado" = "descarga-falhou"
  // Watches both timeouts. One interval, not one `setTimeout` per chunk:
  // that would spawn a timer per millisecond.
  const vigia = setInterval(() => {
    const t = agora()
    if (t - ultimoByte > prazos.semDadosMs || t - inicio > prazos.descargaMs) {
      porque = "descarga-parada"
      controlo.abort()
    }
  }, 250)

  const soma = createHash("sha512")
  let recebidos = 0
  const escrita = createWriteStream(caminho, { flags: "wx" })
  // A write error (full disk) arrives as an event; we save it for the end.
  let erroDeEscrita: Error | null = null
  escrita.on("error", (erro) => {
    erroDeEscrita = erro
    controlo.abort()
  })

  try {
    const url = PASTA_DAS_DESCARGAS + encodeURIComponent(manifesto.ficheiro)
    const resposta = await buscar(url, { ...PEDIDO_ANONIMO, signal: controlo.signal })
    if (!resposta.ok || !resposta.body) return { ok: false, codigo: "descarga-falhou" }

    const leitor = resposta.body.getReader()
    portas.mostrar({ fase: "a-descarregar", versao: manifesto.versao, recebidos: 0, total: manifesto.bytes })
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      recebidos += value.byteLength
      ultimoByte = agora()
      // One extra byte is no longer the signed file. Stop here, not after
      // a server sends gigabytes.
      if (recebidos > manifesto.bytes) {
        porque = "tamanho-errado"
        controlo.abort()
        await leitor.cancel().catch(() => {})
        return { ok: false, codigo: "tamanho-errado" }
      }
      soma.update(value)
      if (!escrita.write(value)) await new Promise<void>((pronto) => escrita.once("drain", pronto))
      portas.mostrar({ fase: "a-descarregar", versao: manifesto.versao, recebidos, total: manifesto.bytes })
    }
    await new Promise<void>((fechado, falhou) => {
      escrita.once("error", falhou)
      escrita.end(() => fechado())
    })
    if (erroDeEscrita) return { ok: false, codigo: "descarga-falhou" }

    // Verified on disk too: what runs is the file, not memory.
    const noDisco = (await stat(caminho)).size
    if (recebidos !== manifesto.bytes || noDisco !== manifesto.bytes) return { ok: false, codigo: "tamanho-errado" }
    if (soma.digest("hex") !== manifesto.sha512) return { ok: false, codigo: "soma-errada" }
    return { ok: true, caminho }
  } catch {
    return { ok: false, codigo: porque }
  } finally {
    clearInterval(vigia)
    if (!escrita.closed) escrita.destroy()
  }
}

/** The SHA-512 of a file on disk, read in a stream. */
async function sha512DoFicheiro(caminho: string): Promise<string> {
  const soma = createHash("sha512")
  for await (const pedaco of createReadStream(caminho)) soma.update(pedaco as Buffer)
  return soma.digest("hex")
}

/**
 * The entire startup: check, download, verify, install. Never throws.
 *
 * Returns `sair` only when the verified installer has started; the caller
 * then closes the app, and the installer (NSIS with `--force-run`) opens
 * the new version. Everything else returns `entrar` with the outcome code.
 */
export async function arranqueComActualizacao(portas: PortasDoArranque): Promise<ResultadoDoArranque> {
  const buscar = portas.buscar ?? fetch
  const prazos = { ...PRAZOS, ...portas.prazos }

  try {
    portas.mostrar({ fase: "a-procurar" })
    const procura = await procurar(portas, buscar, prazos.verificacaoMs)
    if (procura.codigo !== "ha") {
      return { accao: "entrar", codigo: procura.codigo, ...(procura.versao ? { versao: procura.versao } : {}) }
    }
    const { manifesto } = procura
    const versao = manifesto.versao
    const agora = portas.agora ?? Date.now

    // Public, and seen long enough by this device: before any question or
    // download, in both modes.
    const publico = await noGithub(manifesto, procura.bytes, buscar, prazos.transparenciaMs)
    if (!publico.ok) {
      // Gone or different: whatever was seen no longer counts. Unreachable: keep it.
      if (publico.codigo !== "transparencia-inacessivel") await portas.vista?.gravar(null)
      return { accao: "entrar", codigo: publico.codigo, versao }
    }
    const hash = sha256(procura.bytes)
    const espera = (manifesto.urgente ? ESPERA_URGENTE_HORAS : ESPERA_HORAS) * 3_600_000
    const vista = portas.vista ? await portas.vista.ler() : null
    const t = agora()
    // Never seen, another version or other bytes, or a clock that went back
    // before the record: this is the first time, and the wait starts now.
    if (!vista || vista.versao !== versao || vista.hash !== hash || t < vista.vistoEm) {
      await portas.vista?.gravar({ versao, hash, vistoEm: t })
      return { accao: "entrar", codigo: "em-espera", versao, instalaEm: t + espera }
    }
    if (t - vista.vistoEm < espera) return { accao: "entrar", codigo: "em-espera", versao, instalaEm: vista.vistoEm + espera }

    // The wait is over: still there, still the same, right before going on.
    const aindaPublico = await noGithub(manifesto, procura.bytes, buscar, prazos.transparenciaMs)
    if (!aindaPublico.ok) {
      if (aindaPublico.codigo !== "transparencia-inacessivel") await portas.vista?.gravar(null)
      return { accao: "entrar", codigo: aindaPublico.codigo, versao }
    }

    // Ask first (the default): only now, after the manifest, the signature and
    // the version have passed. "Later" downloads nothing.
    if ((portas.modo ?? MODO_POR_OMISSAO) === "perguntar") {
      const resposta = portas.perguntar ? await portas.perguntar(manifesto.versao) : "mais-tarde"
      if (resposta !== "instalar") return { accao: "entrar", codigo: "adiada", versao: manifesto.versao }
    }

    // Ask before download, answer after: UAC shows when the file is
    // already on disk and verified, never before.
    const semAdministrador = await portas.semAdministrador()

    const descarga = await descarregar(portas, manifesto, buscar, prazos)
    if (!descarga.ok) {
      await rm(portas.pasta, { recursive: true, force: true }).catch(() => {})
      return { accao: "entrar", codigo: descarga.codigo, versao: manifesto.versao }
    }

    /*
      Checked again immediately before it runs (review M5): the file waited in
      the user's temp folder, where another program of the same user can
      write, and for an all-users install the next step gives it admin rights.
    */
    const aindaOMesmo = async (): Promise<boolean> => {
      if ((await sha512DoFicheiro(descarga.caminho)) === manifesto.sha512) return true
      await rm(portas.pasta, { recursive: true, force: true }).catch(() => {})
      return false
    }

    try {
      if (semAdministrador) {
        portas.mostrar({ fase: "a-instalar", versao: manifesto.versao })
        if (!(await aindaOMesmo())) return { accao: "entrar", codigo: "soma-errada", versao: manifesto.versao }
        await portas.instalar(descarga.caminho)
      } else {
        // The message before the UAC window: whoever sees it knows where it comes from.
        portas.mostrar({ fase: "a-pedir-autorizacao", versao: manifesto.versao })
        if (!(await aindaOMesmo())) return { accao: "entrar", codigo: "soma-errada", versao: manifesto.versao }
        const resposta = await portas.instalarComAdministrador(descarga.caminho)
        // Said "No": they enter with the version they have. We ask again on the
        // next startup, because the new version is still there.
        if (resposta === "recusado") return { accao: "entrar", codigo: "uac-recusado", versao: manifesto.versao }
        portas.mostrar({ fase: "a-instalar", versao: manifesto.versao })
      }
    } catch (erro) {
      return {
        accao: "entrar",
        codigo: "instalador-falhou",
        versao: manifesto.versao,
        detalhe: (erro as Error)?.message?.slice(0, 120) ?? "",
      }
    }
    return { accao: "sair", codigo: "a-instalar", versao: manifesto.versao }
  } catch (erro) {
    // A folder without permissions, a full disk: the app runs anyway.
    return { accao: "entrar", codigo: "descarga-falhou", detalhe: (erro as Error)?.message?.slice(0, 120) ?? "" }
  }
}

/**
 * Is the folder inside `Program Files`? There the installation is "for all", and
 * updating required admin.
 *
 * Without `path.win32` on purpose: the variables come from the Windows environment and
 * are compared as text, case-insensitive, with a trailing slash so that
 * `C:\Program Files Extra` doesn't match `C:\Program Files`.
 */
export function dentroDosProgramas(pasta: string, ambiente: Record<string, string | undefined>): boolean {
  const alvo = pasta.toLowerCase().replace(/[\\/]+$/, "") + "\\"
  return ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
    .map((nome) => ambiente[nome])
    .filter((valor): valor is string => typeof valor === "string" && valor.length > 0)
    .some((raiz) => alvo.startsWith(raiz.toLowerCase().replace(/[\\/]+$/, "") + "\\"))
}

const CODIGOS: ReadonlySet<string> = new Set<CodigoDaActualizacao>([
  "em-dia",
  "sem-manifesto",
  "sem-rede",
  "manifesto-recusado",
  "assinatura-errada",
  "descarga-falhou",
  "descarga-parada",
  "tamanho-errado",
  "soma-errada",
  "uac-recusado",
  "instalador-falhou",
  "arranque-falhou",
  "a-instalar",
  "adiada",
  "transparencia-inacessivel",
  "transparencia-em-falta",
  "transparencia-diferente",
  "em-espera",
])

/** What the interface receives for "Send log". */
export interface DiagnosticoDoArranque {
  quando: number
  codigo: CodigoDaActualizacao
  versao?: string
  /** With `em-espera`: from when the version may install (ms). The login notice says it. */
  instalaEm?: number
}

/** The file of the last startup, validated. An unknown code or a version without proper
 *  version format won't pass: this goes on someone's screen. */
export function lerDiagnosticoDoArranque(cru: unknown): DiagnosticoDoArranque | null {
  if (!cru || typeof cru !== "object") return null
  const d = cru as Record<string, unknown>
  if (typeof d.quando !== "number" || !Number.isFinite(d.quando)) return null
  if (typeof d.codigo !== "string" || !CODIGOS.has(d.codigo)) return null
  const versao = typeof d.versao === "string" && VERSAO.test(d.versao) ? d.versao : undefined
  const instalaEm = typeof d.instalaEm === "number" && Number.isFinite(d.instalaEm) && d.instalaEm > 0 ? d.instalaEm : undefined
  return {
    quando: d.quando,
    codigo: d.codigo as CodigoDaActualizacao,
    ...(versao ? { versao } : {}),
    ...(instalaEm !== undefined ? { instalaEm } : {}),
  }
}

/**
 * Run startup and always save the outcome. Never throw.
 *
 * `arranqueComActualizacao` no longer throws, but what's around it can
 * throw: the embedded key, the screen window. Before, an exception there skipped
 * saving, and "Send log" would have no lines, which is when it's most needed. Here
 * an exception becomes `arranque-falhou`, and it saves.
 *
 * `gravar` also cannot break startup: a full disk loses the log, and the
 * app runs anyway.
 */
export async function arranqueComDiagnostico(
  correr: () => Promise<ResultadoDoArranque>,
  gravar: (registo: DiagnosticoDoArranque) => Promise<void>,
  agora: () => number = Date.now,
): Promise<ResultadoDoArranque> {
  let resultado: ResultadoDoArranque
  try {
    resultado = await correr()
  } catch (erro) {
    resultado = { accao: "entrar", codigo: "arranque-falhou", detalhe: (erro as Error)?.message?.slice(0, 120) ?? "" }
  }
  const registo: DiagnosticoDoArranque = {
    quando: agora(),
    codigo: resultado.codigo,
    ...(resultado.versao ? { versao: resultado.versao } : {}),
    ...(resultado.accao === "entrar" && resultado.instalaEm !== undefined ? { instalaEm: resultado.instalaEm } : {}),
  }
  try {
    await gravar(registo)
  } catch {
    // No log this time. That's not a reason to skip opening.
  }
  return resultado
}

/**
 * The NSIS installer arguments on update. The same ones that
 * `electron-updater` uses for the same installer:
 *
 *  - `--updated`: it's an update. The installer saves the data, waits for
 *    the running version to exit (and closes it if it doesn't) and deletes nothing;
 *  - `/S`: silent, with no page asking anything;
 *  - `--force-run`: opens the app at the end. In silent mode, without this, it
 *    wouldn't open, and the user would stare at a blank screen.
 *
 * Without `/D=`: the installer reads the previous installation folder from the
 * Windows registry (`InstallLocation`), and that's where it writes.
 */
export const ARGUMENTOS_DO_INSTALADOR: readonly string[] = ["--updated", "/S", "--force-run"]

/**
 * The same, on an all-users installation (Program Files), plus `/allusers`.
 *
 * The electron-builder NSIS decides the mode in `.onInit` (`initMultiUser`):
 * it reads `InstallLocation` from HKLM and HKCU. Only HKLM: for all, in the HKLM
 * folder. Both, or neither: per-user, and two copies would end up. The
 * `/allusers` settles it: the mode is "for all" and the folder is HKLM's.
 *
 * It also doesn't depend on who approves the UAC. If it's another account (an
 * admin typing their password), the installer's HKCU is that account's, and only
 * HKLM stays the same.
 *
 * The `--force-run` still works with the elevated installer: NSIS opens the
 * app with `StdUtils.ExecShellAsUser`, as the session user and WITHOUT
 * admin.
 */
export const ARGUMENTOS_DO_INSTALADOR_PARA_TODOS: readonly string[] = [...ARGUMENTOS_DO_INSTALADOR, "/allusers"]

/**
 * Start the installer disconnected from this app, which exits next.
 *
 * Resolves on the `spawn` event (the process exists) and rejects on `error` (the file
 * won't run). `detached` and `unref` because the installer must survive the exit
 * of whoever launched it: it's the one that waits for it to swap files.
 */
export function lancarInstalador(comando: string, argumentos: readonly string[], lancar: typeof spawn): Promise<void> {
  return new Promise<void>((arrancou, falhou) => {
    const filho = lancar(comando, [...argumentos], { detached: true, stdio: "ignore" })
    filho.once("error", falhou)
    filho.once("spawn", () => {
      filho.unref()
      arrancou()
    })
  })
}

/**
 * The PowerShell exit code when the user clicks "No" on the UAC prompt.
 *
 * Windows returns `ERROR_CANCELLED` (1223) to `ShellExecuteEx`. The number is the
 * same in any Windows language, unlike the error message. That's why
 * we check the number.
 */
export const SAIDA_DO_UAC_RECUSADO = 23

/** Only letters, numbers and `/`, `-`, `=`: the arguments go into a PowerShell
 *  string between single quotes, and nothing here can close the quote. */
const ARGUMENTO_SEGURO = /^[A-Za-z0-9/=-]+$/

/**
 * The PowerShell snippet that asks for UAC and launches the installer.
 *
 * `Process.Start` with `UseShellExecute` and the `runas` verb, not
 * `Start-Process -Verb RunAs`. Both call the same `ShellExecuteEx`, but
 * `Start-Process` in Windows PowerShell 5.1 wraps the denial in a new error,
 * with only the translated message, and the 1223 gets lost. Here the `Win32Exception`
 * arrives whole, inside the PowerShell exception.
 *
 * The installer path does NOT go into the string: it goes through the environment
 * variable `ORWELL_INSTALADOR`. No quotes to escape, no path that becomes code.
 */
export function guiaoDeElevacao(argumentos: readonly string[]): string {
  for (const argumento of argumentos) {
    if (!ARGUMENTO_SEGURO.test(argumento)) throw new Error("argumento recusado", { cause: argumento })
  }
  return [
    "$ErrorActionPreference = 'Stop'",
    "$p = New-Object System.Diagnostics.ProcessStartInfo",
    "$p.FileName = $env:ORWELL_INSTALADOR",
    `$p.Arguments = '${argumentos.join(" ")}'`,
    "$p.UseShellExecute = $true",
    "$p.Verb = 'runas'",
    "try {",
    "  [void][System.Diagnostics.Process]::Start($p)",
    "  exit 0",
    "} catch {",
    "  $e = $_.Exception",
    "  while ($e -ne $null) {",
    `    if ($e -is [System.ComponentModel.Win32Exception] -and $e.NativeErrorCode -eq 1223) { exit ${SAIDA_DO_UAC_RECUSADO} }`,
    "    $e = $e.InnerException",
    "  }",
    "  exit 1",
    "}",
  ].join("\n")
}

/** The arguments to `powershell.exe`. `-EncodedCommand` takes the script in
 *  UTF-16LE and base64: it passes whole, and the command line doesn't touch it. */
export function argumentosDoPowershell(guiao: string): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-EncodedCommand",
    Buffer.from(guiao, "utf16le").toString("base64"),
  ]
}

/**
 * Launch the installer verified with admin: a UAC prompt.
 *
 * Because PowerShell is asking, not the app:
 *
 *  - Electron doesn't request elevation. Its `shell` opens files with the
 *    "open" verb and accepts no other;
 *  - Node's `spawn` uses `CreateProcess`, which never shows UAC. The
 *    installer would start without admin and NSIS would ask for UAC itself,
 *    without telling us the answer. On "No", everything closed: the app had
 *    already exited, and the installer exited too;
 *  - Windows PowerShell 5.1 comes on all Windows 10 and 11, calls
 *    `ShellExecuteEx` with `runas`, and returns the answer in an exit code.
 *
 * It waits for PowerShell to finish, not the installer: `Process.Start` returns
 * as soon as the elevated installer exists. Only then does the app exit.
 *
 * `powershell` is the full path (in `System32`), not a name looked up in
 * PATH: a PATH folder with open write access doesn't choose what runs here.
 */
export function lancarComAdministrador(
  caminho: string,
  argumentos: readonly string[],
  lancar: typeof spawn,
  powershell: string,
  ambiente: NodeJS.ProcessEnv = process.env,
): Promise<RespostaDoUac> {
  const guiao = guiaoDeElevacao(argumentos)
  return new Promise<RespostaDoUac>((respondeu, falhou) => {
    const filho = lancar(powershell, argumentosDoPowershell(guiao), {
      stdio: "ignore",
      windowsHide: true,
      env: { ...ambiente, ORWELL_INSTALADOR: caminho },
    })
    filho.once("error", falhou)
    filho.once("exit", (codigo) => {
      if (codigo === 0) respondeu("aceite")
      else if (codigo === SAIDA_DO_UAC_RECUSADO) respondeu("recusado")
      else falhou(new Error("powershell saiu sem sucesso", { cause: codigo ?? "um sinal" }))
    })
  })
}
