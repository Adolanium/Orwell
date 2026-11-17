import { friendLink } from "@enclave/client-core"

/**
 * The link to one message: `https://<server>/app/m#m=<channel>/<room>/<message>`.
 *
 * Everything that names the message lives in the FRAGMENT, which the browser
 * never sends: opening the link does not tell the server which channel or
 * which message someone is looking for, the same reason the friend link keeps
 * the address there. The link only works for people who are in the channel:
 * for anyone else it opens the app and finds nothing, and nothing leaks.
 *
 * Each part goes through `encodeURIComponent`, so a `/` inside a part never
 * splits it. An empty room is the default room.
 */
export const CAMINHO_DA_MENSAGEM = "/app/m"

export interface AlvoDaMensagem {
  channel: string
  room: string
  id: string
}

/** The link, built on the server of this account. `address` only picks the scheme and host. */
export function ligacaoDaMensagem(servidor: string, endereco: string, alvo: AlvoDaMensagem): string {
  const longa = friendLink(servidor, endereco)
  const origem = longa.slice(0, longa.indexOf("/", longa.indexOf("://") + 3))
  const partes = [alvo.channel, alvo.room, alvo.id].map(encodeURIComponent).join("/")
  return `${origem}${CAMINHO_DA_MENSAGEM}#m=${partes}`
}

/** Read the fragment (`location.hash`) of a message link. `null` if it is not one, or is malformed. */
export function lerLigacaoDaMensagem(fragmento: string): AlvoDaMensagem | null {
  if (fragmento.length > 2048 || !fragmento.startsWith("#m=")) return null
  const partes = fragmento.slice(3).split("/")
  if (partes.length !== 3) return null
  try {
    const [channel, room, id] = partes.map(decodeURIComponent) as [string, string, string]
    if (channel === "" || id === "") return null
    return { channel, room, id }
  } catch {
    return null
  }
}
