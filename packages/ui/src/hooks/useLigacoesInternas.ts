import { useEffect, useRef } from "react"
import { lerLigacaoInterna, type LigacaoInterna } from "../lib/ligacaoInterna.js"

/**
 * Open links to this app in this window (1.3.25). See `lib/ligacaoInterna.ts`.
 *
 * One listener on the document, not an `onClick` on each link: message text
 * (`RichText`), link previews and anything else that draws an `<a>` get the
 * same rule without knowing about it. It runs in the capture phase, before
 * anything else, and only takes the click when the link is ours; any other
 * click, an external link included, is left exactly as it was.
 *
 * Plain click, Ctrl/Cmd click and the middle button all stay here: each of
 * those would open a new tab on the web (a second owner of the vault) and the
 * system browser on the desktop app (the secret in its history).
 *
 * `servidor` is the account's homeserver, or `null` before the account is open:
 * without it no link is "ours", and nothing is taken.
 */
export function useLigacoesInternas(servidor: string | null, abrir: (ligacao: LigacaoInterna) => void): void {
  // The latest `abrir`, so the listener is installed once per server and not on every render.
  const abrirRef = useRef(abrir)
  abrirRef.current = abrir

  useEffect(() => {
    if (!servidor) return
    const tratar = (evento: MouseEvent): void => {
      if (evento.defaultPrevented) return
      if (evento.type === "auxclick" && evento.button !== 1) return
      const alvo = evento.target
      if (!(alvo instanceof Element)) return
      const ancora = alvo.closest("a[href]")
      if (!(ancora instanceof HTMLAnchorElement)) return
      const ligacao = lerLigacaoInterna(ancora.href, servidor)
      if (!ligacao) return
      evento.preventDefault()
      abrirRef.current(ligacao)
    }
    document.addEventListener("click", tratar, true)
    document.addEventListener("auxclick", tratar, true)
    return () => {
      document.removeEventListener("click", tratar, true)
      document.removeEventListener("auxclick", tratar, true)
    }
  }, [servidor])
}
