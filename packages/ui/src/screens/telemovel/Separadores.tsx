import { AvisosDoCarril, descricaoDoCarril, type AvisosDoCarrilProps } from "../../components/AvisosDoCarril.js"
import { ChatIcon, EnvelopeIcon, FriendsIcon, PersonIcon } from "../../icons.js"
import { strings } from "../../strings.js"

/** The four tabs of the phone layout (option B, 20/11/2026). */
export type Separador = "comunidades" | "mensagens" | "amigos" | "tu"

export const SEPARADORES: readonly Separador[] = ["comunidades", "mensagens", "amigos", "tu"]

/** The notices of one tab, without the id, which this bar gives. */
export type AvisosDoSeparador = Omit<AvisosDoCarrilProps, "id" | "activo">

const ICONES: Record<Separador, (props: { size?: number }) => React.JSX.Element> = {
  comunidades: ChatIcon,
  mensagens: EnvelopeIcon,
  amigos: FriendsIcon,
  tu: PersonIcon,
}

const nome = (separador: Separador): string => strings.telemovel[separador]

/**
 * The bar of four tabs at the bottom of the phone (option B, 20/11/2026).
 *
 * The notices are the rail's notices, with the same shapes: the pill for
 * unread, the pastille with the number for what waits for you, the red
 * glyph for a nudge, the green seal for a call. See `AvisosDoCarril`.
 *
 * Tapping the open tab again takes it back to its list: the same gesture as
 * every phone messenger. The shell decides that (`onEscolher`).
 *
 * The bar exists only while a list is on screen. A conversation hides it: the
 * shell does not draw it then.
 */
export function Separadores({
  actual,
  avisos,
  onEscolher,
}: {
  actual: Separador
  avisos: Partial<Record<Separador, AvisosDoSeparador>>
  onEscolher: (separador: Separador) => void
}): React.JSX.Element {
  return (
    <nav className="separadores" aria-label={strings.telemovel.separadores}>
      {SEPARADORES.map((separador) => {
        const Icone = ICONES[separador]
        const activo = separador === actual
        const deste: AvisosDoCarrilProps = { quantas: 0, ...avisos[separador], id: `separador-${separador}`, activo }
        return (
          <button
            key={separador}
            type="button"
            className={[
              "separador",
              activo ? "active" : "",
              deste.toque ? "tocado" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            /* The name is the tab's word only. The notices go in the description
               (`aria-describedby`), as on the rail: the tab keeps its name. */
            aria-label={nome(separador)}
            aria-current={activo ? "page" : undefined}
            aria-describedby={descricaoDoCarril(deste)}
            onClick={() => onEscolher(separador)}
          >
            <span className="separador-icone">
              <Icone size={22} />
              <AvisosDoCarril {...deste} />
            </span>
            <span className="separador-nome">{nome(separador)}</span>
          </button>
        )
      })}
    </nav>
  )
}
