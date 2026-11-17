import type { ChatMessage } from "../types.js"
import { comEmendas } from "./format.js"
import { apurar, fechosDe, votacaoDe, votosDe, type Apuramento, type Votacao } from "./votacoes.js"
import { categoriaVisivel, type QuemVe } from "../screens/chat/categorias.js"

/** A room the person may read, for the polls page. */
export interface SalaDaPagina {
  room: string
  name: string
  /** The room is closed. A poll has no deadline of its own, so this is what "closed" means here. */
  fechada: boolean
}

export interface VotacaoListada {
  id: string
  message: ChatMessage
  votacao: Votacao
  apuramento: Apuramento
  /** The room where the message is READ (a room that no longer exists reads in the default room). */
  room: string
  nomeDaSala: string
  /** When the poll closes (deadline or closing edit), or `null`. Closed NOW is `fechoEm <= agora`, decided by the reader. */
  fechoEm: number | null
}

/**
 * Which rooms the polls page may show, and which are closed.
 *
 * **Visibility is the sidebar's, not a new rule.** Open text rooms come from the
 * groups the sidebar already filtered by `quemVe`. Closed rooms are not in those
 * groups, so the category rule is applied here with the same `categoriaVisivel`
 * (the default room, with no category, always stays). A voice or AFK room has no
 * messages to hold a poll and stays out.
 */
export function salasDaPagina(ctx: {
  abertas: { room: string; name: string; kind: string; afk?: unknown }[]
  fechadas: { room: string; name: string; kind: string; category: string; afk?: unknown }[]
  categorias: { category: string; roles: readonly string[] }[]
  quemVe: QuemVe | undefined
  nomeDaSalaPorOmissao: string
}): SalaDaPagina[] {
  const salas = new Map<string, SalaDaPagina>()
  salas.set("", { room: "", name: ctx.nomeDaSalaPorOmissao, fechada: false })
  for (const sala of ctx.abertas) {
    if (sala.kind === "text" && sala.afk === undefined && sala.room !== "") {
      salas.set(sala.room, { room: sala.room, name: sala.name, fechada: false })
    }
  }
  for (const sala of ctx.fechadas) {
    if (sala.kind !== "text" || sala.afk !== undefined || sala.room === "" || salas.has(sala.room)) continue
    const roles = ctx.categorias.find((categoria) => categoria.category === sala.category)?.roles
    if (sala.category !== "" && ctx.quemVe && !categoriaVisivel(roles, ctx.quemVe)) continue
    salas.set(sala.room, { room: sala.room, name: sala.name, fechada: true })
  }
  return [...salas.values()]
}

/**
 * Every poll of a channel that this account may see, newest first.
 *
 * Same folds as the conversation, so the page and the chat agree: edits and
 * deletions (`comEmendas`) decide which messages survive, and votes come from
 * `votosDe` / `apurar`, a table per voter and never a counter.
 *
 * `existentes` is every room that exists, hidden ones included. It decides where
 * the message is READ: the tag of a room that no longer exists falls to the
 * default room, but the tag of a room that exists and is hidden does NOT, or a
 * poll of a hidden room would leak into the default one.
 */
export function listarVotacoes(ctx: {
  messages: ChatMessage[]
  channel: string
  eu: string | null
  existentes: ReadonlySet<string>
  salas: readonly SalaDaPagina[]
  modera: (quem: string) => boolean
}): VotacaoListada[] {
  const doCanal = ctx.messages.filter((message) => message.channel === ctx.channel)
  const salas = new Map(ctx.salas.map((sala) => [sala.room, sala]))
  const fechos = fechosDe(doCanal, ctx.modera)
  const escolhas = votosDe(doCanal, fechos)
  const vivas = comEmendas(
    doCanal.filter((message) => ["message", "edit", "redact"].includes(message.payload.t)),
    { modera: ctx.modera },
  )
  const lista: VotacaoListada[] = []
  for (const message of vivas) {
    const votacao = votacaoDe(message.payload)
    const id = message.payload.id
    if (!votacao || !id || message.payload.moderada === true) continue
    const etiqueta = (message.payload as { room?: string }).room ?? ""
    const room = etiqueta !== "" && ctx.existentes.has(etiqueta) ? etiqueta : ""
    const sala = salas.get(room)
    if (!sala) continue
    lista.push({
      id,
      message,
      votacao,
      apuramento: apurar(escolhas.get(id), votacao.options.length, ctx.eu, fechos.get(id) ?? null),
      room,
      nomeDaSala: sala.name,
      fechoEm: fechos.get(id) ?? null,
    })
  }
  return lista.sort((a, b) => (b.message.payload.sentAt ?? 0) - (a.message.payload.sentAt ?? 0))
}
