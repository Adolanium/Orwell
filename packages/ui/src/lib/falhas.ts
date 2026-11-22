import { recordDiagnostic } from "./diagnostics.js"
import { VERSAO_DA_APP } from "./versao.js"

/**
 * Crashes and stray errors, written to the diagnostic log (1.3.27).
 *
 * The black screen of 1.3.26 left nothing behind: no line said what threw, in
 * which version, or whether the sync was running. Now the crash card
 * (`ErrorBoundary`), `window.onerror` and `unhandledrejection` each write one
 * line: the message, a short stack, the version and the sync state.
 *
 * Mechanics only, like the rest of the log. The message passes through
 * `semDadosPessoais` (addresses, channels, links, e-mails and long tokens
 * leave), the stack keeps only file, line and column, and no payload or
 * message text is ever read. A crash of the screen is also kept in
 * `localStorage`, one line, until the next start writes it to the log: the
 * person presses Reload, and the cause would die with the tab.
 */

/** What is syncing now. The hooks that follow the sync say it here. */
const aSincronizarAgora = new Set<FonteDaSincronia>()

export type FonteDaSincronia = "history" | "recovery"

export function marcarSincronia(fonte: FonteDaSincronia, activa: boolean): void {
  if (activa) aSincronizarAgora.add(fonte)
  else aSincronizarAgora.delete(fonte)
}

/** `history,recovery`, or `no`. */
export function estadoDaSincronia(): string {
  return aSincronizarAgora.size === 0 ? "no" : [...aSincronizarAgora].sort().join(",")
}

const MENSAGEM_MAX = 160
const QUADROS_MAX = 6

/**
 * The text of an error, without what could name a person: account and
 * channel addresses, links, e-mails and long tokens (keys, digests) become
 * placeholders. Then cut short.
 */
export function semDadosPessoais(texto: string): string {
  return texto
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"')]+/gi, "<url>")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/[@!#][^\s:"']{1,255}:[^\s"')]+/g, "<address>")
    .replace(/[A-Za-z0-9+/_=-]{24,}/g, "<token>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MENSAGEM_MAX)
}

/**
 * The stack as `file:line:col` frames, newest first, at most six. The file is
 * only the last part of the path: the bundle name says the build, the host
 * and the query say nothing useful.
 */
export function stackMinificada(stack: string | undefined): string {
  if (!stack) return ""
  const quadros: string[] = []
  for (const linha of stack.split("\n")) {
    const achado = /([^/\\\s()@]+?\.(?:js|mjs|ts|tsx|jsx))(?:\?[^:\s)]*)?:(\d+):(\d+)/.exec(linha)
    if (!achado) continue
    quadros.push(`${achado[1]}:${achado[2]}:${achado[3]}`)
    if (quadros.length >= QUADROS_MAX) break
  }
  return quadros.join(" < ")
}

/** The first component names of React's component stack: where in the tree it threw. */
function componentes(pilha: string | null | undefined): string {
  if (!pilha) return ""
  const nomes: string[] = []
  for (const linha of pilha.split("\n")) {
    const nome = /^\s*(?:at|in)\s+([A-Za-z_$][\w$]*)/.exec(linha)?.[1]
    if (nome) nomes.push(nome)
    if (nomes.length >= 4) break
  }
  return nomes.join(">")
}

export type OrigemDaFalha = "screen-crash" | "uncaught-error" | "unhandled-rejection"

/** The same error again within this time counts once: React and the window can report one throw twice. */
const REPETIDA_MS = 2_000
let ultima: { chave: string; em: number } | null = null

const CHAVE_GUARDADA = "orwell.ultimaFalha"
let lastCrash = ""

/**
 * The last screen crash, for "Report a bug" on the crash card. Someone in a crash
 * loop never reaches Settings to send the log, and the report's details carry
 * only codes: this is the one way their stack gets out. No personal data
 * (`semDadosPessoais`), and the person reads it in the box before sending it.
 */
export function crashForReport(): string {
  return lastCrash === "" ? "" : `screen-crash ${lastCrash}`
}

function armazenamento(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

/** The log line for an error. Never throws: this runs while something else already failed. */
export function registarFalha(origem: OrigemDaFalha, erro: unknown, pilhaDeComponentes?: string | null, agora = Date.now()): void {
  try {
    const comoErro = erro instanceof Error ? erro : null
    const nome = comoErro?.name ?? typeof erro
    const mensagem = semDadosPessoais(comoErro ? comoErro.message : typeof erro === "string" ? erro : "")
    const chave = `${origem}|${nome}|${mensagem}`
    if (ultima && ultima.chave === chave && agora - ultima.em < REPETIDA_MS) return
    ultima = { chave, em: agora }
    const partes = [`v=${VERSAO_DA_APP}`, `sync=${estadoDaSincronia()}`, `msg="${nome}: ${mensagem}"`]
    const stack = stackMinificada(comoErro?.stack)
    if (stack) partes.push(`stack=${stack}`)
    const onde = componentes(pilhaDeComponentes)
    if (onde) partes.push(`in=${onde}`)
    const detail = partes.join(" ")
    // A JSON error quotes what it could not read, and that can be somebody's text: cut at the first quote.
    if (origem === "screen-crash") lastCrash = detail.replace(mensagem, () => mensagem.replace(/".*$/, "…"))
    recordDiagnostic({ at: agora, kind: "error", code: origem, detail })
    if (origem === "screen-crash") armazenamento()?.setItem(CHAVE_GUARDADA, JSON.stringify({ at: agora, code: origem, detail }))
  } catch {
    // The log is help, not a second failure.
  }
}

let instalada: (() => void) | null = null

/**
 * Listens to `error` and `unhandledrejection` on the window, once per page,
 * and writes the screen crash kept before the last reload. Returns how to stop
 * (for tests).
 */
export function capturarErrosGlobais(alvo: Window = window): () => void {
  if (instalada) return instalada
  try {
    const guardada = armazenamento()?.getItem(CHAVE_GUARDADA)
    if (guardada) {
      armazenamento()?.removeItem(CHAVE_GUARDADA)
      const linha = JSON.parse(guardada) as { at?: unknown; code?: unknown; detail?: unknown }
      if (typeof linha.at === "number" && typeof linha.detail === "string") {
        recordDiagnostic({ at: linha.at, kind: "error", code: "screen-crash", detail: linha.detail.slice(0, 600), outcome: "before-reload" })
      }
    }
  } catch {
    // A damaged line is dropped.
  }
  const aoErro = (evento: ErrorEvent): void => registarFalha("uncaught-error", evento.error ?? evento.message)
  const aoRecusar = (evento: PromiseRejectionEvent): void => registarFalha("unhandled-rejection", evento.reason)
  alvo.addEventListener("error", aoErro)
  alvo.addEventListener("unhandledrejection", aoRecusar)
  instalada = () => {
    alvo.removeEventListener("error", aoErro)
    alvo.removeEventListener("unhandledrejection", aoRecusar)
    instalada = null
  }
  return instalada
}

/** For tests. */
export function esquecerFalhas(): void {
  ultima = null
  lastCrash = ""
  aSincronizarAgora.clear()
  armazenamento()?.removeItem(CHAVE_GUARDADA)
}
