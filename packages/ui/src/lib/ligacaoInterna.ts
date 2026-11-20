import {
  formatShortInviteLink,
  INVITE_PATH,
  PAIR_PATH,
  parseInviteLink,
  parseShortInviteLink,
  sameHomeserver,
  SHORT_INVITE_PATH,
} from "@enclave/client-core"
import type { ConviteLido } from "./conviteDeArranque.js"
import { CAMINHO_DA_MENSAGEM, lerLigacaoDaMensagem, type AlvoDaMensagem } from "./ligacaoDaMensagem.js"
import { CAMINHO_CURTO_DO_AMIGO, eCaminhoDeAmigo, lerLigacaoDeAmigo } from "./ligacaoDeAmigo.js"

/**
 * A link to this app, clicked inside this app (1.3.25).
 *
 * Invite (`/c#…`, `/app/c#…`, `/app/convite#…`), friend (`/a#…`, `/app/a#…`,
 * `/app/amigo#…`) and message (`/app/m#…`) links on the account's OWN server
 * open in the window that is already here. Before, a link in a message went
 * out by `target="_blank"`: the installed app sent it to the system browser,
 * which put the invite secret in that browser's history and opened a second
 * copy of the app there; the web opened another tab, which is a second owner
 * of the same vault ("one owner per browser").
 *
 * The flows are the ones that already exist: the startup invite, the startup
 * friend link and the message link. Only the way in is new. The fragment is
 * read here, on this device, and never sent anywhere: nothing navigates, so
 * the address bar, the history and the server see nothing.
 *
 * Everything else, a link to another server included, is not ours to open and
 * returns `null`: the caller leaves the click alone and it goes out as before.
 */
export type LigacaoInterna =
  | { tipo: "convite"; convite: ConviteLido }
  /** The short link, in the core's canonical form, to resolve after the gate. */
  | { tipo: "convite-curto"; curta: string }
  | { tipo: "convite-invalido" }
  | { tipo: "amigo"; address: string }
  | { tipo: "amigo-invalido" }
  | { tipo: "mensagem"; alvo: AlvoDaMensagem }
  /** Our message path with a fragment that does not read: handled here, and it does nothing. */
  | { tipo: "mensagem-invalida" }
  /**
   * A pairing link, on ANY server: it never opens, here or outside. Whoever
   * opens it joins the pairing box of someone else's account, and a link in
   * a conversation is how that secret gets to the wrong device.
   */
  | { tipo: "emparelhamento" }

/** The path copied for short invites. Caddy redirects it to `SHORT_INVITE_PATH`. */
const CAMINHO_CURTO_DO_CONVITE = "/c"

/** The same cap as the core's parsers, before any parsing. */
const TECTO = 2048

/**
 * What a clicked `href` is, for an account on `servidor`, or `null` to let it go.
 *
 * `href` is the anchor's resolved address (`HTMLAnchorElement.href`). The
 * server is compared the way the core compares homeservers (`sameHomeserver`:
 * case, trailing dot, default port). A link on our server with one of these
 * paths but a fragment that does not read is still ours: it becomes the same
 * "invalid link" notice the startup path gives, and does not leak to a browser.
 */
export function lerLigacaoInterna(href: string, servidor: string): LigacaoInterna | null {
  if (href.length > TECTO || !servidor) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  // Credentials in the address: the host after the `@` is what counts, and a link from us never has them.
  if (url.username || url.password) return null
  // Before the server check: a pairing link from another server is just as dangerous to open.
  if (url.pathname === PAIR_PATH) return { tipo: "emparelhamento" }
  if (!sameHomeserver(url.host, servidor)) return null

  const caminho = url.pathname
  if (caminho === SHORT_INVITE_PATH || caminho === CAMINHO_CURTO_DO_CONVITE) {
    const lida = parseShortInviteLink(href)
    return lida
      ? { tipo: "convite-curto", curta: formatShortInviteLink(lida.server, lida.codigoCurto, lida.code) }
      : { tipo: "convite-invalido" }
  }
  if (caminho === INVITE_PATH) {
    const convite = parseInviteLink(href)
    return convite ? { tipo: "convite", convite } : { tipo: "convite-invalido" }
  }
  if (eCaminhoDeAmigo(caminho) || caminho === CAMINHO_CURTO_DO_AMIGO) {
    const amigo = lerLigacaoDeAmigo(href)
    return amigo ? { tipo: "amigo", address: amigo.address } : { tipo: "amigo-invalido" }
  }
  if (caminho === CAMINHO_DA_MENSAGEM) {
    const alvo = url.search ? null : lerLigacaoDaMensagem(url.hash)
    /*
      A message link that does not read does nothing, like one to a channel
      this account is not in (`useLigacaoDeMensagem`): there is nothing to say
      about it, and sending it to a browser would only open a second app.
    */
    return alvo ? { tipo: "mensagem", alvo } : { tipo: "mensagem-invalida" }
  }
  return null
}
