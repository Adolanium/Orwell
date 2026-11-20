import type { TicketState } from "@enclave/protocol"

/**
 * The text of the messages that are acts: the answer to a channel invite, and
 * the change of state of a ticket (20/11/2026).
 *
 * These messages carry their act as structure (`inviteReply`, `ticket`), and a
 * body for whoever cannot draw the structure (an older client). The body used
 * to be written in Portuguese by the sender, and so a German reader saw
 * Portuguese. The core has no catalog: it writes the body in English, the
 * default language, and the interface shows the act in the language of WHO
 * READS, when the body is exactly the one written here
 * (`lerCorpoDaResposta`, `lerCorpoDoTicket`).
 *
 * A body that is not one of these (an older message, written in Portuguese)
 * is shown as it came: it is what the sender wrote, and the history does not
 * change under the person who read it.
 */

/** Who the answer is about: the channel name in quotes, or its address. */
export function corpoDaRespostaAoConvite(onde: string, aceite: boolean): string {
  return aceite ? `I accepted the invitation to ${onde}.` : `I will not join ${onde} for now.`
}

/** The place in an answer body this core wrote, or nothing. */
export function lerCorpoDaResposta(corpo: string, aceite: boolean): string | undefined {
  const forma = aceite ? /^I accepted the invitation to (.+)\.$/s : /^I will not join (.+) for now\.$/s
  return forma.exec(corpo)?.[1]
}

/** The subject in quotes, or nothing for a ticket without one. */
export function corpoDoActoDoTicket(estado: TicketState, assunto: string): string {
  const onde = assunto ? `the ticket "${assunto}"` : "this ticket"
  if (estado === "closed") return `Closed ${onde}.`
  if (estado === "working") return `Moved ${onde} to in progress.`
  return `Reopened ${onde}.`
}

/**
 * The subject in a ticket body this core wrote: `""` for a ticket without one,
 * nothing when the body is not one of these.
 */
export function lerCorpoDoTicket(corpo: string, estado: TicketState): string | undefined {
  const verbo = estado === "closed" ? "Closed" : estado === "working" ? "Moved" : "Reopened"
  const fim = estado === "working" ? " to in progress." : "."
  if (corpo === `${verbo} this ticket${fim}`) return ""
  const inicio = `${verbo} the ticket "`
  const fecho = `"${fim}`
  if (!corpo.startsWith(inicio) || !corpo.endsWith(fecho) || corpo.length < inicio.length + fecho.length) return undefined
  return corpo.slice(inicio.length, corpo.length - fecho.length)
}
