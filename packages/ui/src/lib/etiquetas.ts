import { mencaoDeCargo } from "@enclave/protocol"
import type { ChannelRole } from "../bridge.js"
import { hexDaCor } from "./roleColours.js"
import {
  CANDIDATO_TODOS,
  dobrar,
  MENTION_LIMIT,
  PALAVRAS_DE_TODOS,
  sugerirMencoes,
  type MentionCandidate,
} from "./mentions.js"

/**
 * Tags in a message (12/11/2026): roles with `@`, rooms with `#`, next to the
 * people and `@all` that `mentions.ts` already handles. The same split as there:
 * the box shows the name, the body carries the id, and the screen shows the name
 * of NOW, read from this device.
 *
 * - A role: `<@&id>` in the body, `&id` in `mentions` (see `mencaoDeCargo` in the
 *   protocol). The core checks the sender's permission and adds the reader's own
 *   address when the reader holds the role, so the rest of the app reads it as a
 *   mention of me.
 * - A room: `<#id>` in the body, nothing in `mentions`: tagging a room notifies
 *   nobody. The default room is `<#>`, its id is the empty string.
 *
 * A 1.3.7 shows these tokens as text. They say what they are, and carry no name:
 * a room name never leaves for someone who might not see the room.
 */

/** Ids a room token can carry. Rooms made by this app are `forum-word-word`. */
const ID_DE_SALA = /^[A-Za-z0-9._-]{0,64}$/

export function tokenDeSala(room: string): string {
  return `<#${room}>`
}

export function tokenDeCargo(role: string): string {
  return `<@&${role}>`
}

/** The room id inside a `<#id>` token, or `null` if this is not one. */
export function salaDoToken(token: string): string | null {
  if (!token.startsWith("<#") || !token.endsWith(">")) return null
  const id = token.slice(2, -1)
  return ID_DE_SALA.test(id) ? id : null
}

/** The role id inside a `<@&id>` token, or `null`. */
export function cargoDoToken(token: string): string | null {
  if (!token.startsWith("<@&") || !token.endsWith(">")) return null
  const id = token.slice(3, -1)
  return id.length > 0 && id.length <= 32 && !/[\s<>]/.test(id) ? id : null
}

/** Both tokens, for the text split in `RichText`. No capture group: the caller adds it. */
export const TOKENS_DE_ETIQUETA = "<@&[^\\s<>]{1,32}>|<#[A-Za-z0-9._-]{0,64}>"

/** A role, as a suggestion. */
export function candidatoDeCargo(cargo: Pick<ChannelRole, "role" | "name" | "colour" | "powers">): MentionCandidate {
  return {
    address: mencaoDeCargo(cargo.role),
    name: cargo.name,
    tipo: "cargo",
    cor: hexDaCor(cargo.colour),
    corpo: tokenDeCargo(cargo.role),
  }
}

/** A room, as a suggestion. Only rooms this account sees get here: see `App`. */
export function candidatoDeSala(sala: { room: string; name: string }): MentionCandidate {
  return { address: `#${sala.room}`, name: sala.name, tipo: "sala", corpo: tokenDeSala(sala.room), mencao: null }
}

/**
 * The `@` or `#` being typed, whichever is nearest to the cursor.
 *
 * The same three rules as `mencaoEmCurso`: glued to a letter or digit is not a tag
 * (an email, a URL anchor), a space closes it, and a colon means a full address.
 */
export function etiquetaEmCurso(
  texto: string,
  cursor: number,
): { inicio: number; procura: string; sinal: "@" | "#" } | null {
  const antes = texto.slice(0, cursor)
  const inicio = Math.max(antes.lastIndexOf("@"), antes.lastIndexOf("#"))
  if (inicio < 0) return null
  const anterior = inicio > 0 ? antes[inicio - 1] : ""
  if (anterior && /[\p{L}\p{N}]/u.test(anterior)) return null
  const procura = antes.slice(inicio + 1)
  if (/[\s:@#]/.test(procura)) return null
  return { inicio, procura, sinal: antes[inicio] === "#" ? "#" : "@" }
}

/** How many rooms `@` shows, under its "Channels" heading. `#` shows them all. */
export const SALAS_NO_ARROBA = 3

/**
 * What `@` suggests: people first, then roles, then `@all`, then rooms, like Discord.
 *
 * People first because Enter takes the first item, and an `@` followed by Enter
 * must not notify a whole role. Two roles at most, so people keep the list. The
 * rooms (17/11/2026) come last and do not take places from people: they add up to
 * `SALAS_NO_ARROBA` rows under their own heading. `#` is the full room list.
 */
export function sugerirEtiquetas(
  pessoas: readonly MentionCandidate[],
  cargos: readonly MentionCandidate[],
  procura: string,
  podeMencionarTodos: boolean,
  salas: readonly MentionCandidate[] = [],
  limite = MENTION_LIMIT,
): MentionCandidate[] {
  const alvo = dobrar(procura)
  const comTodos = podeMencionarTodos && PALAVRAS_DE_TODOS.some((palavra) => palavra.startsWith(alvo))
  const deCargo = sugerirMencoes(cargos, procura, 2)
  const reserva = deCargo.length + (comTodos ? 1 : 0)
  return [
    ...sugerirMencoes(pessoas, procura, limite - reserva),
    ...deCargo,
    ...(comTodos ? [CANDIDATO_TODOS] : []),
    ...sugerirMencoes(salas, procura, SALAS_NO_ARROBA),
  ]
}
