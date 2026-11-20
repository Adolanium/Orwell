import { lerCorpoDaResposta, lerCorpoDoTicket } from "@enclave/client-core"
import { strings } from "../strings.js"

/** What this helper reads from a message payload. */
interface ComCorpo {
  body?: string | undefined
  inviteReply?: { accepted: boolean } | undefined
  /** Not in `ChatMessage["payload"]` by name: read with care, it comes from another device. */
  ticket?: unknown
}

/**
 * The body of a message as the reader sees it (20/11/2026).
 *
 * Two kinds of message are acts with a body for older clients: the answer to a
 * channel invite and the change of state of a ticket. The core writes that body
 * in English (`actosEmTexto.ts` in the core). When the body is exactly that
 * text, the act is said again in the reader's language. Any other body (an
 * older message, written in Portuguese, or a body someone wrote) is shown as it
 * came.
 */
export function corpoParaMostrar(payload: ComCorpo): string {
  const corpo = payload.body ?? ""
  if (corpo === "") return corpo
  const resposta = payload.inviteReply
  if (resposta && typeof resposta.accepted === "boolean") {
    const onde = lerCorpoDaResposta(corpo, resposta.accepted)
    if (onde !== undefined) return resposta.accepted ? strings.convite.respostaAceite(onde) : strings.convite.respostaRecusada(onde)
  }
  const estado = estadoDoTicket(payload.ticket)
  if (estado) {
    const assunto = lerCorpoDoTicket(corpo, estado)
    if (assunto !== undefined) {
      if (estado === "closed") return strings.tickets.actoFechou(assunto)
      if (estado === "working") return strings.tickets.actoEmCurso(assunto)
      return strings.tickets.actoReabriu(assunto)
    }
  }
  return corpo
}

function estadoDoTicket(ticket: unknown): "open" | "working" | "closed" | undefined {
  if (typeof ticket !== "object" || ticket === null) return undefined
  const estado = (ticket as { state?: unknown }).state
  return estado === "open" || estado === "working" || estado === "closed" ? estado : undefined
}
