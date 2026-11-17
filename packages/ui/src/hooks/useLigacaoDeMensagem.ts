import { useEffect } from "react"
import { lerLigacaoDaMensagem, type AlvoDaMensagem } from "../lib/ligacaoDaMensagem.js"

/**
 * Open the message a link points to (`/app/m#m=<channel>/<room>/<id>`).
 *
 * Runs when the app is ready and every time the fragment changes (a link opened
 * in a tab that already has the app). `abrir` returns whether it found the
 * channel: a link to a channel this account is not in stays untouched, with no
 * message, no error and nothing said about the channel. Once handled, the
 * fragment is removed so a reload does not jump again.
 *
 * `pronto` is false until the account is unlocked and the channel list is known:
 * before that, "not found" would only mean "not loaded yet".
 */
export function useLigacaoDeMensagem(pronto: boolean, abrir: (alvo: AlvoDaMensagem) => boolean): void {
  useEffect(() => {
    if (!pronto) return
    const tentar = (): void => {
      const alvo = lerLigacaoDaMensagem(location.hash)
      if (!alvo || !abrir(alvo)) return
      history.replaceState(null, "", location.pathname + location.search)
    }
    tentar()
    window.addEventListener("hashchange", tentar)
    return () => window.removeEventListener("hashchange", tentar)
  }, [pronto, abrir])
}
