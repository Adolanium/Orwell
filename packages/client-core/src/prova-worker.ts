/**
 * The proof of work for a new account, off the main thread (1.3.26).
 *
 * About 3 seconds on an average phone, more during a spike: on the page's own
 * thread that is a frozen screen. So each host runs it in a Web Worker: the
 * web app (`apps/web/src/prova-worker.ts`) and the desktop app's window
 * (`apps/client/src/renderer/prova-worker.ts`), three lines each, because a
 * worker comes from a file the host's bundler must know about.
 *
 * Imported from `@enclave/client-core/prova-worker`, not from the package
 * root: the worker needs the hash and nothing else, not the session or vault.
 */
import {
  LOTE_DA_PROVA,
  procurarNonce,
  progressoDaProva,
  resolverProvaDeTrabalho,
  type DesafioDeTrabalho,
  type ProvaDeTrabalho,
} from "@enclave/protocol"

/** What the worker's global scope offers: enough of `DedicatedWorkerGlobalScope`. */
export interface EscopoDaProva {
  onmessage: ((evento: { data: unknown }) => void) | null
  postMessage(mensagem: unknown): void
}

/** What the page sees of the worker: enough of `Worker`. */
export interface TrabalhadorDaProva {
  onmessage: ((evento: { data: unknown }) => void) | null
  onerror: ((evento: unknown) => void) | null
  postMessage(dados: unknown): void
  terminate(): void
}

type MensagemDaProva = { tipo: "progresso"; fraccao: number } | { tipo: "feito"; nonce: string }

/** How often the worker reports progress, in ms. */
const PROGRESSO_MS = 100

/** The worker's side: take one challenge, search, report progress, answer the nonce. */
export function servirProvaDeTrabalho(escopo: EscopoDaProva): void {
  escopo.onmessage = (evento) => {
    const desafio = evento.data as DesafioDeTrabalho
    let ultimo = 0
    for (let desde = 0; ; desde += LOTE_DA_PROVA) {
      const nonce = procurarNonce(desafio.desafio, desafio.trabalho, desde, desde + LOTE_DA_PROVA)
      if (nonce !== null) {
        escopo.postMessage({ tipo: "feito", nonce } satisfies MensagemDaProva)
        return
      }
      const agora = Date.now()
      if (agora - ultimo >= PROGRESSO_MS) {
        ultimo = agora
        escopo.postMessage({ tipo: "progresso", fraccao: progressoDaProva(desde + LOTE_DA_PROVA, desafio.trabalho) } satisfies MensagemDaProva)
      }
    }
  }
}

/**
 * The page's side: a resolver that runs each challenge in a new worker, and
 * on this thread when the host cannot start one or it fails. Same shape as
 * `ResolverDaProva` in the session.
 */
export function resolverNumTrabalhador(
  criar: () => TrabalhadorDaProva,
): (desafio: DesafioDeTrabalho, aoProgresso?: (fraccao: number) => void) => Promise<ProvaDeTrabalho> {
  return (desafio, aoProgresso) =>
    new Promise<ProvaDeTrabalho>((resolve, reject) => {
      const nestaThread = (): void => {
        resolverProvaDeTrabalho(desafio, aoProgresso ? { aoProgresso } : {}).then(resolve, reject)
      }
      let trabalhador: TrabalhadorDaProva
      try {
        trabalhador = criar()
      } catch {
        nestaThread()
        return
      }
      let acabou = false
      trabalhador.onmessage = (evento) => {
        if (acabou) return
        const mensagem = evento.data as MensagemDaProva
        if (mensagem.tipo === "progresso") {
          aoProgresso?.(mensagem.fraccao)
          return
        }
        acabou = true
        trabalhador.terminate()
        aoProgresso?.(1)
        resolve({ desafio: desafio.desafio, nonce: mensagem.nonce })
      }
      trabalhador.onerror = () => {
        if (acabou) return
        acabou = true
        trabalhador.terminate()
        nestaThread()
      }
      trabalhador.postMessage(desafio)
    })
}
