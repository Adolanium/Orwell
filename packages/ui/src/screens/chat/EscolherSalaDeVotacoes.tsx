import { Button } from "../../components/Button.js"
import { RoomGlyph } from "../../components/SidebarIcons.js"
import { strings } from "../../strings.js"

/**
 * What the "Polls" row of a community opens when there is no single polls room to go to.
 *
 * Several polls rooms: a list to choose from. None: whoever may create rooms sees the way to create
 * one, and everyone else sees one plain sentence saying there are no polls yet. With exactly
 * one the caller goes straight to it and this never shows.
 */
export function EscolherSalaDeVotacoes({
  salas,
  podeCriar,
  onAbrir,
  onCriar,
  onVoltar,
}: {
  salas: { room: string; name: string }[]
  podeCriar: boolean
  onAbrir: (room: string) => void
  onCriar: () => void
  onVoltar: () => void
}): React.JSX.Element {
  return (
    <section className="votacoes-pagina" aria-label={strings.salaDeVotacoes.escolherTitulo}>
      <div className="votacoes-pagina-miolo">
      <header className="votacoes-pagina-topo">
        <h2>{strings.salaDeVotacoes.escolherTitulo}</h2>
        <Button variant="ghost" type="button" onClick={onVoltar}>
          {strings.salaDeVotacoes.voltar}
        </Button>
      </header>
      {salas.length > 0 ? (
        <>
          <p className="hint">{strings.salaDeVotacoes.escolher}</p>
          <ul className="votacoes-escolha">
            {salas.map((sala) => (
              <li key={sala.room}>
                <button type="button" className="votacoes-escolha-sala" onClick={() => onAbrir(sala.room)}>
                  <RoomGlyph kind="text" layout="polls" size={16} />
                  <span>{sala.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p>{strings.salaDeVotacoes.semSalas}</p>
          {podeCriar ? (
            <Button variant="primary" type="button" onClick={onCriar}>
              {strings.salaDeVotacoes.criarSala}
            </Button>
          ) : (
            <p className="hint">{strings.salaDeVotacoes.semSalasLead}</p>
          )}
        </>
      )}
      </div>
    </section>
  )
}
