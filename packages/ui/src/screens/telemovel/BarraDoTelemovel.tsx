import { SetaParaTrasIcon } from "../../icons.js"
import { strings } from "../../strings.js"

/**
 * The header of a pushed screen that has no header of its own with a way
 * back (option B, 20/11/2026): the polls room, the tickets room, and the
 * screens the "Tu" tab pushes. The back arrow, the title, and under it where
 * the screen lives. A conversation draws the arrow in its own header
 * (`ChatScreen`, `onVoltar`).
 */
export function BarraDoTelemovel({
  titulo,
  contexto,
  onVoltar,
}: {
  titulo: string
  contexto?: string | undefined
  onVoltar: () => void
}): React.JSX.Element {
  return (
    <header className="barra-do-telemovel">
      <button type="button" className="topbar-voltar" aria-label={strings.telemovel.voltar} onClick={onVoltar}>
        <SetaParaTrasIcon size={22} />
      </button>
      <span className="barra-do-telemovel-titulos">
        <span className="barra-do-telemovel-titulo">{titulo}</span>
        {contexto && <span className="barra-do-telemovel-contexto">{contexto}</span>}
      </span>
    </header>
  )
}
