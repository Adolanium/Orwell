/**
 * Which links the window passes to the system browser.
 *
 * `setWindowOpenHandler` gets every `target="_blank"` from the interface: links
 * from messages (`RichText`) and, since November 2, 2026, a YouTube video
 * thumbnail. The address came from someone else, and `shell.openExternal`
 * opens what it's given: `file:` runs a file on this machine, a custom scheme
 * wakes another app. Only web URLs pass.
 *
 * No `electron` here, for the reason in `link-preview.ts`: so the rule is
 * tested.
 */
export function podeAbrirFora(url: string, servidorDaConta: string | null = null): boolean {
  return enderecoParaAbrirFora(url, servidorDaConta) !== null
}

/**
 * The paths of links to THIS app: invite (short, as copied and after the
 * redirect, and long), friend (the same three) and message. See
 * `lib/ligacaoInterna.ts` in the interface, which opens them in the window.
 */
const CAMINHOS_DA_APP = new Set(["/c", "/app/c", "/app/convite", "/a", "/app/a", "/app/amigo", "/app/m"])

/** A homeserver name as `URL.host` writes it: lowercase, no trailing dot, no default port. */
function hostDoServidor(servidor: string): string {
  return servidor.trim().toLowerCase().replace(/\.$/, "").replace(/:443$/, "")
}

/**
 * Whether this is a link to this app on the account's own server (1.3.25).
 *
 * Those never go to the system browser. An invite link carries a bearer
 * secret in its fragment, and the system browser would keep it in its
 * history and open a second copy of the app there. The interface takes the
 * click first and opens it in this window (`useLigacoesInternas`); this is
 * the last line, for a click that still reaches `setWindowOpenHandler`.
 * A link to another server is not ours, and goes out as before.
 */
export function eLigacaoDaPropriaApp(lido: URL, servidorDaConta: string | null): boolean {
  if (!servidorDaConta) return false
  return lido.host === hostDoServidor(servidorDaConta) && CAMINHOS_DA_APP.has(lido.pathname)
}

/**
 * The address to pass to `shell.openExternal`, or `null` if it doesn't open.
 *
 * Returns the address as `new URL()` read it (`href`), not the text from the
 * message: this way the system opens exactly what was verified, with spaces,
 * quotes and backslashes already normalized, not a second parse of the same
 * text by another parser.
 *
 * Rejects credentials in the address: in `https://www.youtube.com@mau.pt/` the
 * host is `mau.pt`, and a link from a message has no reason to bring them.
 *
 * And rejects links to this app on `servidorDaConta`: see `eLigacaoDaPropriaApp`.
 */
export function enderecoParaAbrirFora(url: string, servidorDaConta: string | null = null): string | null {
  let lido: URL
  try {
    lido = new URL(url)
  } catch {
    return null
  }
  if (lido.protocol !== "https:" && lido.protocol !== "http:") return null
  if (lido.username || lido.password || !lido.hostname) return null
  if (eLigacaoDaPropriaApp(lido, servidorDaConta)) return null
  // A pairing link never opens outside, from any server (1.3.25). The interface says why.
  if (lido.pathname === "/app/emparelhar") return null
  return lido.href
}
