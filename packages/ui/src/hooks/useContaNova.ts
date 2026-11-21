import { useEffect, useMemo, useRef, useState } from "react"

/** What the bridge says about this account's first days (1.3.26). Same shape as `ContaNova` in the protocol. */
export interface ContaNovaNaPonte {
  ate24h: number
  ate72h: number
  intervaloAte24hS: number
  intervaloAte72hS: number
}

/**
 * This account's new-account limits, read from the bridge each time the
 * connection comes up (they come in `auth.ok`), and the phase now. The phase
 * changes on its own when the first day or the third ends.
 */
export function useContaNova(
  ler: (() => Promise<ContaNovaNaPonte | null>) | undefined,
  ligacao: string,
): { contaNova: ContaNovaNaPonte | null; fase: "24h" | "72h" | null } {
  const [contaNova, setContaNova] = useState<ContaNovaNaPonte | null>(null)
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (!ler || ligacao !== "online") return
    let vivo = true
    void ler()
      .then((lida) => {
        if (vivo) setContaNova(lida)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [ler, ligacao])
  // Wake up when the phase ends, so the notice goes away without a reload.
  useEffect(() => {
    if (!contaNova) return
    const proximo = [contaNova.ate24h, contaNova.ate72h].find((fim) => fim > Date.now())
    if (proximo === undefined) return
    const relogio = setTimeout(() => setAgora(Date.now()), Math.min(proximo - Date.now() + 1000, 2 ** 31 - 1))
    return () => clearTimeout(relogio)
  }, [contaNova, agora])
  const fase = contaNova === null ? null : agora < contaNova.ate24h ? "24h" : agora < contaNova.ate72h ? "72h" : null
  return { contaNova, fase }
}

/**
 * The authors in their first 24 hours, among these lines, in the common room
 * (1.3.26). Each author is asked once; until the answer comes, the author
 * counts as new (links stay text a moment longer, never the other way round).
 * A question that fails counts as an older account: a server that cannot say
 * does not leave every link in the room as text.
 */
export function useAutoresNovos(
  ler: ((address: string) => Promise<number | null>) | undefined,
  naSalaComum: boolean,
  linhas: readonly { sender: string }[],
): ReadonlySet<string> {
  const [respostas, setRespostas] = useState<ReadonlyMap<string, number | null>>(new Map())
  const pedidas = useRef(new Set<string>())
  // Mounted, not "this effect": an answer that arrives after new lines came in still counts.
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])
  const autores = useMemo(() => [...new Set(linhas.map((linha) => linha.sender))], [linhas])
  useEffect(() => {
    if (!ler || !naSalaComum) return
    for (const autor of autores) {
      if (pedidas.current.has(autor)) continue
      pedidas.current.add(autor)
      void ler(autor)
        .catch(() => null)
        .then((ate) => {
          if (montado.current) setRespostas((antes) => new Map(antes).set(autor, ate))
        })
    }
  }, [ler, naSalaComum, autores])
  return useMemo(() => {
    if (!ler || !naSalaComum) return new Set<string>()
    const agora = Date.now()
    return new Set(
      autores.filter((autor) => {
        if (!respostas.has(autor)) return true
        const ate = respostas.get(autor)
        return ate !== null && ate !== undefined && ate > agora
      }),
    )
  }, [ler, naSalaComum, autores, respostas])
}
