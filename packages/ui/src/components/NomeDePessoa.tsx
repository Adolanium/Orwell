import { nomeVisivel } from "@enclave/client-core"
import { vemDoEndereco } from "../lib/format.js"
import { strings } from "../strings.js"

/**
 * A person's name, already resolved, drawn according to its origin.
 *
 * A chosen name comes out as is. A name derived from the address (`nomeEmFalta`)
 * comes out in italics and in secondary color, with the title "From the address",
 * so no one reads it as a name the person chose.
 *
 * A chosen name longer than 12 graphemes (written before the limit, or by another
 * client) is drawn as 12 and "…", with the whole name in the `title`. Only the
 * drawing is cut: the text the caller holds stays whole, so sentences,
 * `aria-label`, mentions and search keep using `nameFor` directly.
 */
export function NomeDePessoa({
  nome,
  endereco,
}: {
  nome: string
  /** The account whose name this is. Without it you cannot know the origin, and it comes out as a chosen name. */
  endereco?: string | null | undefined
}): React.JSX.Element {
  if (!vemDoEndereco(nome, endereco)) {
    const visivel = nomeVisivel(nome)
    return visivel !== nome ? <span title={nome}>{visivel}</span> : <>{nome}</>
  }
  /*
    Not cut: a name from the address is not a display name anybody wrote. It
    is two words of the address at most, and the second word is there to tell
    two accounts apart (`nomeEmFalta`); cutting it would undo that.
  */
  return (
    <span className="nome-do-endereco" title={strings.profile.nomeDoEndereco}>
      {nome}
    </span>
  )
}
