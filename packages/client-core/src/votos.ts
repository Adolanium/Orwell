/**
 * Poll votes: which one counts, and which ones a cap may drop (hotfix 1.3.19).
 *
 * One rule for the screen (`votosDe` and `fechosDe` in the UI) and for the vault
 * (`apararEstado`). Before, the vault kept the vote with the highest `at` even when
 * it came after the poll closed, and the screen refused that vote: after a reload
 * the voter had no vote, and two devices counted differently (review of 1.3.19, I1).
 */

/** A poll vote as both folds read it. */
export interface VotoLido {
  /** The poll's message or post id. */
  alvo: string
  /** The MLS-authenticated sender, never a payload field. */
  quem: string
  /** The voter's own timestamp. A vote without one is worth 0. */
  at: number
}

/** A payload and its sender: what these rules read from a vault entry or a screen message. */
export interface EventoDeVoto {
  payload: Readonly<Record<string, unknown>>
  sender: string
}

/** The vote in a `post.reaction` with a numeric `vote`, or `null`: a thumbs-up is not a vote. */
export function lerVoto(evento: EventoDeVoto): VotoLido | null {
  const { payload } = evento
  if (payload["t"] !== "post.reaction" || typeof payload["vote"] !== "number") return null
  const alvo = payload["target"]
  if (typeof alvo !== "string" || alvo === "") return null
  return { alvo, quem: evento.sender, at: typeof payload["at"] === "number" ? payload["at"] : 0 }
}

/**
 * The poll a message or post carries: its id and deadline, or `null`.
 *
 * The same test as `votacaoDe` in the UI: a question, and at least two options.
 */
export function votacaoGuardada(payload: Readonly<Record<string, unknown>>): { id: string; closesAt?: number } | null {
  if (payload["t"] !== "message" && payload["t"] !== "post") return null
  const id = payload["id"]
  const poll = payload["poll"] as Record<string, unknown> | undefined
  if (typeof id !== "string" || id === "" || !poll || typeof poll !== "object") return null
  if (typeof poll["question"] !== "string" || poll["question"] === "") return null
  if (!Array.isArray(poll["options"]) || poll["options"].length < 2) return null
  const prazo = poll["closesAt"]
  return typeof prazo === "number" && Number.isFinite(prazo) ? { id, closesAt: prazo } : { id }
}

/**
 * When each poll closes: its deadline, or the earlier `closePoll` edit by its
 * author (or by whom `modera` accepts).
 */
export function fechosDasVotacoes<T>(
  itens: readonly T[],
  ler: (item: T) => EventoDeVoto,
  modera: (quem: string) => boolean = () => false,
): Map<string, number> {
  const autores = new Map<string, string>()
  const fechos = new Map<string, number>()
  for (const item of itens) {
    const { payload, sender } = ler(item)
    const votacao = votacaoGuardada(payload)
    if (!votacao || autores.has(votacao.id)) continue
    autores.set(votacao.id, sender)
    if (votacao.closesAt !== undefined) fechos.set(votacao.id, votacao.closesAt)
  }
  for (const item of itens) {
    const { payload, sender } = ler(item)
    const alvo = payload["target"]
    if (payload["t"] !== "edit" || payload["closePoll"] !== true || typeof alvo !== "string" || alvo === "") continue
    const autor = autores.get(alvo)
    if (autor === undefined || (autor !== sender && !modera(sender))) continue
    const quando = typeof payload["editedAt"] === "number" ? payload["editedAt"] : 0
    const actual = fechos.get(alvo)
    if (actual === undefined || quando < actual) fechos.set(alvo, quando)
  }
  return fechos
}

/**
 * The vote that counts for each (poll, voter): poll → voter → the item.
 *
 * The voter's highest `at` that is not after the poll's close (`fechos`), by the
 * vote's own timestamp, so every device with the same events counts the same. A tie
 * goes to the later item in `itens`, which the caller gives in thread order. A
 * removal (`remove`) is a vote too: it is what says "no vote".
 *
 * `podeContar`: may this voter's vote, stamped `at`, count (the 5-day rule, see
 * `idade-da-conta.ts`)? A vote refused here is out, and does not replace that
 * person's earlier vote. Absent: all count.
 */
export function votosQueContam<T>(
  itens: readonly T[],
  ler: (item: T) => EventoDeVoto,
  fechos?: ReadonlyMap<string, number>,
  podeContar?: (quem: string, at: number) => boolean,
): Map<string, Map<string, T>> {
  const porAlvo = new Map<string, Map<string, { item: T; at: number }>>()
  for (const item of itens) {
    const voto = lerVoto(ler(item))
    if (!voto) continue
    const fecho = fechos?.get(voto.alvo)
    if (fecho !== undefined && voto.at > fecho) continue
    if (podeContar && !podeContar(voto.quem, voto.at)) continue
    const porPessoa = porAlvo.get(voto.alvo) ?? new Map<string, { item: T; at: number }>()
    const conhecido = porPessoa.get(voto.quem)
    if (!conhecido || voto.at >= conhecido.at) porPessoa.set(voto.quem, { item, at: voto.at })
    porAlvo.set(voto.alvo, porPessoa)
  }
  const contam = new Map<string, Map<string, T>>()
  for (const [alvo, porPessoa] of porAlvo) contam.set(alvo, new Map([...porPessoa].map(([quem, { item }]) => [quem, item])))
  return contam
}

/**
 * What a cap may drop, and in what order (review of 1.3.19, C1).
 *
 * - `guardar`: the votes that can count. For each poll still held, the vote that counts
 *   under its deadline, and under each `closePoll` edit before it, whoever sent the edit:
 *   whether a moderator's close is accepted depends on roles this layer does not see, and
 *   keeping one extra vote per edit is cheaper than counting wrong after a reload.
 * - `orfaos`: votes whose target is not a poll held here (an invented target, or a poll
 *   that already left). They count for nothing.
 * - Every other vote is replaced (a later vote of the same person, or a vote after the close).
 *
 * A cap drops the replaced first, then the orphans, then the oldest of `guardar`.
 */
export function votosAGuardar<T>(itens: readonly T[], ler: (item: T) => EventoDeVoto): { guardar: Set<T>; orfaos: Set<T> } {
  const prazos = new Map<string, number>()
  const conhecidas = new Set<string>()
  const fechosEditados = new Map<string, number[]>()
  const votosPorAlvo = new Map<string, T[]>()
  for (const item of itens) {
    const evento = ler(item)
    const votacao = votacaoGuardada(evento.payload)
    if (votacao) {
      if (!conhecidas.has(votacao.id)) {
        conhecidas.add(votacao.id)
        if (votacao.closesAt !== undefined) prazos.set(votacao.id, votacao.closesAt)
      }
      continue
    }
    const { payload } = evento
    const alvoDoFecho = payload["target"]
    if (payload["t"] === "edit" && payload["closePoll"] === true && typeof alvoDoFecho === "string") {
      const lista = fechosEditados.get(alvoDoFecho) ?? []
      lista.push(typeof payload["editedAt"] === "number" ? payload["editedAt"] : 0)
      fechosEditados.set(alvoDoFecho, lista)
      continue
    }
    const voto = lerVoto(evento)
    if (!voto) continue
    const lista = votosPorAlvo.get(voto.alvo) ?? []
    lista.push(item)
    votosPorAlvo.set(voto.alvo, lista)
  }
  const guardar = new Set<T>()
  const orfaos = new Set<T>()
  for (const [alvo, votos] of votosPorAlvo) {
    if (!conhecidas.has(alvo)) {
      for (const item of votos) orfaos.add(item)
      continue
    }
    const prazo = prazos.get(alvo)
    const candidatos = [prazo, ...(fechosEditados.get(alvo) ?? []).filter((quando) => prazo === undefined || quando < prazo)]
    for (const fecho of candidatos) {
      const fechos = fecho === undefined ? undefined : new Map([[alvo, fecho]])
      for (const item of votosQueContam(votos, ler, fechos).get(alvo)?.values() ?? []) guardar.add(item)
    }
  }
  return { guardar, orfaos }
}
