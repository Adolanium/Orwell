import { strings } from "../strings.js"

/**
 * The names rooms are born with, shown in the language of who reads (20/11/2026).
 *
 * A channel is born with rooms named by the core, in the language of whoever
 * created it (`Session.salasIniciais`), and before 1.3.25 always in Portuguese.
 * The common channel keeps Portuguese names on purpose (see
 * `SALAS_DO_CANAL_COMUM` in the core). The default room is "geral" in the
 * protocol (`DEFAULT_ROOM`), and that value does not change: both ends need it.
 *
 * So when a room still has its ORIGIN name, exactly as born, the screen says it
 * in the reader's language. A name someone wrote is shown as written. This is
 * only for drawing: what is published keeps the stored name.
 */
type Origem = keyof typeof strings.rooms.nomesDeOrigem

const ORIGENS: Readonly<Record<string, Origem>> = {
  "anúncios": "anuncios",
  announcements: "anuncios",
  conversa: "conversa",
  chat: "conversa",
  voz: "voz",
  voice: "voz",
  "apresentações": "apresentacoes",
  introductions: "apresentacoes",
  avarias: "avarias",
  bugs: "avarias",
}

/** The name of a room as the screen shows it. `room` is the identifier ("" is the default room). */
export function nomeDaSalaNoEcra(room: string, nome: string): string {
  if (room === "" && (nome === "geral" || nome === "general")) return strings.rooms.nomesDeOrigem.geral
  const origem = Object.hasOwn(ORIGENS, nome) ? ORIGENS[nome] : undefined
  return origem ? strings.rooms.nomesDeOrigem[origem] : nome
}
