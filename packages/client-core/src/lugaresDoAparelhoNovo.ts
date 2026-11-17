/**
 * The seats a paired device asks for on its own (12/11/2026).
 *
 * A paired phone gets into each channel when the main device seats it
 * (`Session.#assentarAparelho` at pairing, `#assentarAparelhosEmFalta` after).
 * When that failed with the main device off, the phone held the channel's
 * history (the main device had passed it) but no group: the channel was not
 * on its list and it could not send there, until the main device came back.
 *
 * Now the channels of the history plan without a group here become seats to
 * ask (`lugaresPorPedir`), and the members of the channel answer: a member
 * that sees a device of the asking account missing from its tree, and listed
 * in the account's signed manifest, adds THAT device and removes nobody
 * (`Session.#answerRejoinAgora`). The wait before the first request leaves the
 * main device its turn, so the two do not race for the same seat.
 *
 * Pure: the session reads and writes the vault, this decides.
 */

/** A seat to ask, as the vault keeps it (`lugaresPorPedir`). */
export interface LugarPedido {
  desde: number
  tentativas: number
  proxima: number
}

/** Before the first request: the main device seats within seconds when it is on. */
export const ESPERA_PELO_PRINCIPAL_MS = 2 * 60_000

/**
 * The longest gap between two requests for the same seat. It was six hours:
 * a phone that asked while nobody was online waited up to six hours after
 * someone came back.
 */
export const PEDIDO_DE_LUGAR_MAX_MS = 30 * 60_000

/** One minute, two, four, up to `PEDIDO_DE_LUGAR_MAX_MS`. */
export function proximoPedidoDeLugar(tentativas: number, agora: number): number {
  return agora + Math.min(60_000 * 2 ** Math.min(tentativas, 20), PEDIDO_DE_LUGAR_MAX_MS)
}

/** The seats to add for the channels of a history plan. Only the new ones: what is already asked keeps its clock. */
export function lugaresDoHistorico(entrada: {
  canaisDoPlano: readonly string[]
  temGrupo: (canal: string) => boolean
  salaComum: string | null
  canalDaConta: string
  /** Channels the account left (or was removed from), with the time. */
  arquivados: Readonly<Record<string, number>> | undefined
  jaPedidos: Readonly<Record<string, unknown>> | undefined
  agora: number
}): Record<string, LugarPedido> {
  const novos: Record<string, LugarPedido> = {}
  for (const canal of entrada.canaisDoPlano) {
    if (canal === entrada.salaComum || canal === entrada.canalDaConta) continue
    if (entrada.temGrupo(canal)) continue
    if (entrada.arquivados?.[canal] !== undefined) continue
    if (entrada.jaPedidos?.[canal] !== undefined) continue
    novos[canal] = { desde: entrada.agora, tentativas: 0, proxima: entrada.agora + ESPERA_PELO_PRINCIPAL_MS }
  }
  return novos
}
