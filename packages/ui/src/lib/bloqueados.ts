import type { ChatMessage } from "../types.js"
import { chaveDoDia } from "./format.js"

/**
 * What this device does with the people it blocked, in the interface (20/11/2026).
 *
 * The core already drops what a blocked person says in the places that are
 * ours alone: our direct, our wall, theirs (`#bloqueadoAqui` in the session).
 * In a shared room it lets it through on purpose: the room is a conversation
 * of other people too, and only whoever runs it removes a member. So here, on
 * this device only, and without telling anyone:
 *
 * - the messages stay in the conversation, folded into one line that can open;
 * - they never ring, never count, never go into the bell;
 * - their reactions do not count in the chips.
 *
 * Nothing leaves this device: the server does not read the content, and the
 * person does not learn that we hide them.
 */

/** A message from someone this device blocked. Never our own. */
export function deQuemBloqueei(message: ChatMessage, me: string | null, bloqueados: ReadonlySet<string>): boolean {
  return bloqueados.size > 0 && message.sender !== me && bloqueados.has(message.sender)
}

/**
 * The messages without those of blocked people: what counts and what alerts.
 * The SAME array when nothing leaves, so the memos that read it do not run again.
 */
export function semBloqueados(messages: ChatMessage[], me: string | null, bloqueados: ReadonlySet<string>): ChatMessage[] {
  if (bloqueados.size === 0) return messages
  const ficam = messages.filter((message) => !deQuemBloqueei(message, me, bloqueados))
  return ficam.length === messages.length ? messages : ficam
}

/**
 * One folded line in the conversation: where it starts, how many messages it
 * holds, and their keys (for "Show").
 */
export interface BlocoOculto {
  quantas: number
  chaves: readonly string[]
}

/**
 * The folded lines of a conversation, by index: a block where it starts,
 * `"dentro"` on the messages it swallows, `null` on lines that show.
 *
 * A block is a run of hidden messages in a row, from the same person and on
 * the same day. A new person starts a new block, so the line can say "a
 * person"; a new day starts one too, so the day heading still shows above it.
 */
export function blocosOcultos(
  messages: readonly ChatMessage[],
  oculta: (message: ChatMessage) => boolean,
  chaveDe: (message: ChatMessage) => string,
): (BlocoOculto | "dentro" | null)[] {
  const blocos: (BlocoOculto | "dentro" | null)[] = new Array<BlocoOculto | "dentro" | null>(messages.length).fill(null)
  let inicio: { indice: number; chaves: string[]; sender: string; dia: string | null } | null = null
  const fechar = (): void => {
    if (inicio) blocos[inicio.indice] = { quantas: inicio.chaves.length, chaves: inicio.chaves }
    inicio = null
  }
  messages.forEach((message, indice) => {
    if (!oculta(message)) {
      fechar()
      return
    }
    const enviada = message.payload.sentAt
    const dia = enviada !== undefined && enviada > 0 ? chaveDoDia(enviada) : null
    if (inicio && inicio.sender === message.sender && (dia === null || inicio.dia === null || dia === inicio.dia)) {
      inicio.chaves.push(chaveDe(message))
      blocos[indice] = "dentro"
      return
    }
    fechar()
    inicio = { indice, chaves: [chaveDe(message)], sender: message.sender, dia }
  })
  fechar()
  return blocos
}

/**
 * What "Show" opened, by message key. For this visit to the app only, and on
 * purpose not stored: whoever comes back tomorrow finds them folded again.
 */
const reveladas = new Set<string>()

export function estaRevelada(chave: string): boolean {
  return reveladas.has(chave)
}

export function revelar(chaves: readonly string[]): void {
  for (const chave of chaves) reveladas.add(chave)
}

/** For tests only: a new visit starts with everything folded. */
export function esquecerReveladas(): void {
  reveladas.clear()
}
