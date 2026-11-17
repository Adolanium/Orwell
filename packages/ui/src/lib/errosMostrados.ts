import { ERROS_NO_BUG_MAX, type ErroMostrado } from "@enclave/protocol"

/**
 * The last "Erro NNN" codes this window showed, with the time (12/11/2026).
 *
 * For "Report a bug": the code and the hour, never the sentence or its detail. A
 * sentence can carry a name or an address in its detail; the code cannot.
 * In memory only, lost when the window closes.
 *
 * The same code again within `REPETIDO_MS` counts once: a screen that redraws
 * the same error does not fill the list with one event.
 */
const REPETIDO_MS = 2_000
const mostrados: ErroMostrado[] = []

export function registarErroMostrado(codigo: number, em = Date.now()): void {
  if (!Number.isInteger(codigo) || codigo < 100 || codigo > 999) return
  const ultimo = mostrados.at(-1)
  if (ultimo && ultimo.codigo === codigo && em - ultimo.em < REPETIDO_MS) return
  mostrados.push({ codigo, em })
  if (mostrados.length > ERROS_NO_BUG_MAX) mostrados.splice(0, mostrados.length - ERROS_NO_BUG_MAX)
}

/** A copy, oldest first. */
export function errosMostrados(): ErroMostrado[] {
  return mostrados.map((erro) => ({ ...erro }))
}

/** For tests. */
export function esquecerErrosMostrados(): void {
  mostrados.length = 0
}
