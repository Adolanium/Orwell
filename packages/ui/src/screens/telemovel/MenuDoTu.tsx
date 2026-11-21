import { AvisosDoCarril, descricaoDoCarril } from "../../components/AvisosDoCarril.js"
import { FeedIcon, GearIcon, PersonIcon } from "../../icons.js"
import { strings } from "../../strings.js"

/** The screens the "Tu" tab pushes: the desktop rail's Profile, Feed and Settings. */
export type EcraDoTu = "perfil" | "social" | "config"

/**
 * The list of the "Tu" tab (option B, 20/11/2026).
 *
 * The desktop rail has three destinations that are about the account and not
 * about a conversation: Profile, Feed and Settings. Here they are three
 * entries, and each one pushes its screen. Under them, the account card from
 * the foot of the desktop column (`CartaoDaConta`): the face and status, the
 * bell, the microphone, the sound, and the gear. The same element, not a copy.
 */
export function MenuDoTu({
  cartao,
  comentarios,
  onAbrir,
}: {
  /** The account card, mounted by the shell (`cartaoDaConta` in `App`). */
  cartao: React.ReactNode
  /** Comments on my posts that wait for me: the Feed's pastille on the rail. */
  comentarios: number
  onAbrir: (ecra: EcraDoTu) => void
}): React.JSX.Element {
  const avisosDoMural = { id: "tu-mural", quantas: comentarios }
  const entradas: { ecra: EcraDoTu; nome: string; icone: React.JSX.Element; avisos?: typeof avisosDoMural }[] = [
    { ecra: "perfil", nome: strings.telemovel.perfil, icone: <PersonIcon size={20} /> },
    { ecra: "social", nome: strings.telemovel.mural, icone: <FeedIcon size={20} />, avisos: avisosDoMural },
    { ecra: "config", nome: strings.telemovel.definicoes, icone: <GearIcon size={20} /> },
  ]
  return (
    <section className="menu-do-tu" aria-label={strings.telemovel.tu}>
      <h1 className="menu-do-tu-titulo">{strings.telemovel.tu}</h1>
      <ul className="menu-do-tu-lista">
        {entradas.map((entrada) => (
          <li key={entrada.ecra}>
            <button
              type="button"
              className="menu-do-tu-entrada"
              aria-label={entrada.nome}
              aria-describedby={entrada.avisos ? descricaoDoCarril(entrada.avisos) : undefined}
              onClick={() => onAbrir(entrada.ecra)}
            >
              <span className="menu-do-tu-icone" aria-hidden="true">
                {entrada.icone}
                {entrada.avisos && <AvisosDoCarril {...entrada.avisos} />}
              </span>
              <span>{entrada.nome}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="menu-do-tu-cartao">{cartao}</div>
    </section>
  )
}
