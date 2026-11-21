import { BlockedButton } from "../../components/BlockedButton.js"
import { AvisosDoCarril, descricaoDoCarril } from "../../components/AvisosDoCarril.js"
import { RoomIcon } from "../../components/RoomIcon.js"
import { useToqueLongo, type Ponto } from "../../hooks/useToqueLongo.js"
import { PlusIcon } from "../../icons.js"
import { strings } from "../../strings.js"

/** What waits in one community: the rail's shapes. See `AvisosDoCarril`. */
export interface AvisosDaComunidade {
  /** Mentions of this account: the pastille with the number. */
  quantas: number
  /** Unread with no mention: the pill. */
  porLer: boolean
  /** A call in a room of this community. */
  chamada: boolean
}

/**
 * The 72 px rail of communities, at the left of the Communities tab (option B,
 * 20/11/2026).
 *
 * One round face per community. Tapping it shows its channels at the right,
 * and opens nothing yet: the conversation opens when a channel is tapped.
 * The notices have the shapes of the main rail ("pílula e pastilha"): the
 * pill for unread, the pastille for mentions, the green seal for a call; the
 * open community has the tall pill.
 *
 * Long press (and right click) opens the community menu, the same one the
 * community line has on a computer (`itensDoCanal`).
 */
export function CarrilDeComunidades({
  comunidades,
  activa,
  labelFor,
  iconFor,
  oficialFor,
  avisosDe,
  onEscolher,
  onMenu,
  onNova,
  novaBloqueada,
}: {
  comunidades: readonly string[]
  activa: string | null
  labelFor: (canal: string) => string
  iconFor?: ((canal: string) => string | undefined) | undefined
  oficialFor?: ((canal: string) => boolean) | undefined
  avisosDe: (canal: string) => AvisosDaComunidade
  onEscolher: (canal: string) => void
  onMenu: (canal: string, ponto: Ponto) => void
  /** The "+" at the end. Absent when the account cannot create a channel now (1.3.26). */
  onNova?: (() => void) | undefined
  /** Why not, at the cap: the "+" stays, grey, and a tap shows this (`BlockedButton`). */
  novaBloqueada?: string | undefined
}): React.JSX.Element {
  const aoDedo = useToqueLongo()
  return (
    <nav className="carril-comunidades" aria-label={strings.telemovel.carril}>
      {comunidades.map((canal, indice) => {
        const nome = labelFor(canal)
        const activo = canal === activa
        const avisos = { ...avisosDe(canal), id: `comunidade-${indice}`, activo }
        return (
          <button
            key={canal}
            type="button"
            className={activo ? "rail-btn carril-comunidade active" : "rail-btn carril-comunidade"}
            aria-label={nome}
            aria-current={activo ? "true" : undefined}
            aria-describedby={descricaoDoCarril(avisos)}
            onClick={() => onEscolher(canal)}
            onContextMenu={(evento) => {
              evento.preventDefault()
              onMenu(canal, { x: evento.clientX, y: evento.clientY })
            }}
            {...aoDedo((ponto) => onMenu(canal, ponto))}
          >
            <RoomIcon channel={canal} label={nome} size={48} icon={iconFor?.(canal)} official={oficialFor?.(canal) ?? false} />
            <AvisosDoCarril {...avisos} />
          </button>
        )
      })}
      {!onNova && novaBloqueada && (
        <BlockedButton className="rail-btn carril-comunidade carril-nova" tip={novaBloqueada} label={strings.telemovel.novaComunidade} side="right">
          <PlusIcon size={22} />
        </BlockedButton>
      )}
      {onNova && (
        <button
          type="button"
          className="rail-btn carril-comunidade carril-nova"
          aria-label={strings.telemovel.novaComunidade}
          onClick={onNova}
        >
          <PlusIcon size={22} />
        </button>
      )}
    </nav>
  )
}
