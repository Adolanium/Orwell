import { parentPort } from "node:worker_threads"
import { servirSelo, type EscopoDoSelo, type PedidoDeSelo } from "@enclave/client-core/selo-worker"

/**
 * The vault seal in a worker thread of the main process.
 *
 * On the desktop the core runs in the main process, and the main process is
 * also what answers the window's synchronous reads: while it sealed the whole
 * vault (XChaCha20 and base64 in JS), the window waited. The seal runs here;
 * the main process only takes the JSON snapshot. Built as its own entry
 * (`out/main/selo.cjs`, see `electron.vite.config.ts`).
 */
const porta = parentPort
if (porta) {
  const escopo: EscopoDoSelo = {
    onmessage: null,
    postMessage: (mensagem, transferir) => porta.postMessage(mensagem, (transferir ?? []) as ArrayBuffer[]),
  }
  servirSelo(escopo)
  porta.on("message", (data: PedidoDeSelo) => escopo.onmessage?.({ data }))
}
