import { Worker } from "node:worker_threads"
import type { TrabalhadorDoSelo } from "@enclave/client-core/selo-worker"

/**
 * A worker thread, in the shape `seladorNoWorker` asks for: the same shape as a
 * browser Worker (`postMessage`, `onmessage`, `onerror`, `terminate`).
 *
 * `unref`: the thread never keeps the app alive on its own; a quit with a seal
 * in flight writes synchronously anyway (`shutdown`).
 */
export function trabalhadorDoSelo(caminho: string): TrabalhadorDoSelo {
  const trabalhador = new Worker(caminho)
  const adaptado: TrabalhadorDoSelo = {
    onmessage: null,
    onerror: null,
    postMessage: (mensagem, transferir) => trabalhador.postMessage(mensagem, transferir as ArrayBuffer[]),
    terminate: () => void trabalhador.terminate(),
  }
  trabalhador.on("message", (data) => adaptado.onmessage?.({ data }))
  trabalhador.on("error", (erro) => adaptado.onerror?.(erro))
  trabalhador.unref()
  return adaptado
}
