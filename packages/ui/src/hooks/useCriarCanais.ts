import { useEffect, useState } from "react"

/** What the bridge says about the channels this account created (1.3.26). Same shape as `CriarCanais` in the protocol. */
export interface CriarCanaisNaPonte {
  criados: number
  maximo: number
  contaNova: boolean
}

/**
 * The cap on channels (communities) this account may create, asked again each
 * time the connection comes up and each time the number of channels changes (a
 * channel created or left). `podeCriar` is `true` while nothing is known: an
 * older host or server, or no answer yet. The server still decides.
 */
export function useCriarCanais(
  ler: (() => Promise<CriarCanaisNaPonte | null>) | undefined,
  ligacao: string,
  quantosCanais: number,
): { quota: CriarCanaisNaPonte | null; podeCriar: boolean } {
  const [quota, setQuota] = useState<CriarCanaisNaPonte | null>(null)
  useEffect(() => {
    if (!ler || ligacao !== "online") return
    let vivo = true
    void ler()
      .then((lida) => {
        if (vivo) setQuota(lida)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [ler, ligacao, quantosCanais])
  return { quota, podeCriar: quota === null || quota.criados < quota.maximo }
}
