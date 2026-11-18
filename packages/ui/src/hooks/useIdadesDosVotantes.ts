import { useEffect, useRef, useState } from "react"

/** What the bridge answers for one account: the rule from the server's capability, and the signed age. */
export type IdadeLida = { regra: boolean; criadaEm: number | null }

/** The least a message needs to say who voted where. */
type Linha = { channel: string; sender: string; payload: { t: string } }

/** How long after a request with no answer the hook asks again. */
export const REPETIR_IDADES_MS = 5_000

/**
 * The 5-day rule (17/11/2026): only accounts created 5 days ago or more vote,
 * by the age their homeserver signs (`idade-da-conta.ts`). Each voter of the
 * open channel, and this account, is asked once; until the answer comes, that
 * vote is out of the count. A server that does not sign ages turns the rule off
 * (`regra: false`), and every vote counts, as in 1.3.16.
 *
 * Only online (review of 1.3.18, C1): before `hello.ok` the server's
 * capabilities are not known, and an answer then said "unknown" for good. A
 * request the bridge rejects (no answer yet: offline, reconnecting, a timeout)
 * is asked again, when the connection comes back or a while later; only a real
 * answer is kept.
 */
export function useIdadesDosVotantes({
  ler,
  active,
  address,
  messages,
  connection,
}: {
  ler: ((address: string) => Promise<IdadeLida>) | undefined
  active: string | null
  address: string | null
  messages: readonly Linha[]
  connection: string
}): { idades: ReadonlyMap<string, number | null>; regraDaIdade: boolean | null } {
  const [idades, setIdades] = useState<ReadonlyMap<string, number | null>>(new Map())
  const [regraDaIdade, setRegraDaIdade] = useState<boolean | null>(null)
  const pedidas = useRef(new Set<string>())
  /** Bumped a while after a request got no answer, so the effect asks again. */
  const [repetir, setRepetir] = useState(0)
  useEffect(() => {
    if (!ler || !active || connection !== "online") return
    let tentarDeNovo: ReturnType<typeof setTimeout> | undefined
    const quem = new Set<string>(address ? [address] : [])
    for (const message of messages) {
      if (message.channel !== active || message.payload.t !== "post.reaction") continue
      if (typeof (message.payload as { vote?: unknown }).vote === "number") quem.add(message.sender)
    }
    const pedidos: Promise<readonly [string, IdadeLida] | null>[] = []
    for (const conta of quem) {
      if (pedidas.current.has(conta)) continue
      pedidas.current.add(conta)
      pedidos.push(
        ler(conta).then(
          (lida) => [conta, lida] as const,
          () => {
            pedidas.current.delete(conta)
            tentarDeNovo ??= setTimeout(() => setRepetir((n) => n + 1), REPETIR_IDADES_MS)
            return null
          },
        ),
      )
    }
    // One state change for the whole batch (M8): a poll with a hundred voters used to
    // redraw the shell and count the votes a hundred times as the answers came in.
    if (pedidos.length > 0) {
      void Promise.all(pedidos).then((lidas) => {
        const respostas = lidas.filter((lida) => lida !== null)
        if (respostas.length === 0) return
        setRegraDaIdade(respostas.at(-1)![1].regra)
        setIdades((antes) => {
          const depois = new Map(antes)
          for (const [conta, { criadaEm }] of respostas) depois.set(conta, criadaEm)
          return depois
        })
      })
    }
    return () => clearTimeout(tentarDeNovo)
  }, [ler, messages, active, address, connection, repetir])
  return { idades, regraDaIdade }
}
