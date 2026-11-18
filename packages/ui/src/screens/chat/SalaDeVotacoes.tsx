import { useId, useState } from "react"
import { Votacao } from "../../components/Votacao.js"
import { Button } from "../../components/Button.js"
import { formatarDataEHora } from "../../lib/format.js"
import { useAgora } from "../../hooks/useAgora.js"
import type { VotacaoListada } from "../../lib/listarVotacoes.js"
import type { ChatMessage } from "../../types.js"
import { strings } from "../../strings.js"

type Separador = "abertas" | "fechadas"

/**
 * The screen of a polls room: polls as cards, and no conversation.
 *
 * It takes the place of the chat in the same slot as the ticket board. A poll is still an
 * encrypted message of this room, sent and received by the same protocol; what is gone is
 * the conversation around it. The cards are the ones of the chat (`Votacao`), with voting on.
 *
 * **"Closed" is the real close of the poll**: its deadline passed, or its author or a
 * moderator closed it (`fechosDe`). That is read against this device's clock only to decide
 * the tab; the count itself never depends on it.
 *
 * Who may create one is decided by the caller (`onNova` absent means this account cannot
 * write in the room, read-only rooms and roles included): without it the button does not
 * appear, the house rule, and a sentence says why.
 */
export function SalaDeVotacoes({
  nome,
  votacoes,
  nameFor,
  onVotar,
  podeFechar,
  onFechar,
  onNova,
  podeEliminar = () => false,
  onEliminar,
}: {
  nome: string
  votacoes: VotacaoListada[]
  nameFor: (address: string) => string
  onVotar?: ((message: ChatMessage, opcao: number) => void) | undefined
  /** Can this account close this poll? Its author, or whoever moderates. */
  podeFechar: (votacao: VotacaoListada) => boolean
  onFechar: (votacao: VotacaoListada) => void
  onNova?: (() => void) | undefined
  /** Can this account delete this poll? Its author, or whoever moderates (1.3.21). Absent: nobody. */
  podeEliminar?: ((votacao: VotacaoListada) => boolean) | undefined
  /** Delete the poll: the caller confirms and sends the message tombstone. */
  onEliminar?: ((votacao: VotacaoListada) => void) | undefined
}): React.JSX.Element {
  const [separador, setSeparador] = useState<Separador>("abertas")
  const id = useId()
  // Wakes the screen when the next deadline passes, so a poll moves tab by itself.
  const agora = useAgora(votacoes.map((votacao) => votacao.fechoEm))
  const estaFechada = (votacao: VotacaoListada): boolean => votacao.fechoEm !== null && votacao.fechoEm <= agora
  const abertas = votacoes.filter((votacao) => !estaFechada(votacao))
  const fechadas = votacoes.filter(estaFechada)
  const mostradas = separador === "abertas" ? abertas : fechadas

  return (
    <section className="votacoes-pagina" aria-label={nome}>
      {/* Full width of the main area (no member column in this room); the content keeps a readable
          width in the middle, so the result bars never stretch across a 2560 px monitor. */}
      <div className="votacoes-pagina-miolo">
      <header className="votacoes-pagina-topo">
        <h2>{nome}</h2>
        {onNova && (
          <Button variant="primary" type="button" onClick={onNova}>
            {strings.salaDeVotacoes.nova}
          </Button>
        )}
      </header>
      {!onNova && <p className="hint">{strings.salaDeVotacoes.soLeitura}</p>}

      <div className="votacoes-pagina-separadores" role="tablist" aria-label={strings.salaDeVotacoes.separadores}>
        {(
          [
            ["abertas", strings.salaDeVotacoes.abertas, abertas.length],
            ["fechadas", strings.salaDeVotacoes.fechadas, fechadas.length],
          ] as const
        ).map(([qual, texto, quantas]) => (
          <button
            key={qual}
            type="button"
            role="tab"
            id={`${id}-${qual}`}
            aria-selected={separador === qual}
            aria-controls={`${id}-lista`}
            className={separador === qual ? "votacoes-separador activo" : "votacoes-separador"}
            onClick={() => setSeparador(qual)}
          >
            {texto} <span className="votacoes-contagem">{quantas}</span>
          </button>
        ))}
      </div>

      <div id={`${id}-lista`} role="tabpanel" aria-labelledby={`${id}-${separador}`} className="votacoes-pagina-lista">
        {mostradas.length === 0 ? (
          <p className="hint votacoes-pagina-vazia">
            {separador === "abertas" ? strings.salaDeVotacoes.semAbertas : strings.salaDeVotacoes.semFechadas}
          </p>
        ) : (
          <ul>
            {mostradas.map((votacao) => (
              <li key={votacao.id} className="votacoes-pagina-cartao">
                <Votacao
                  votacao={votacao.votacao}
                  apuramento={votacao.apuramento}
                  nameFor={nameFor}
                  {...(onVotar ? { onVote: (opcao: number) => onVotar(votacao.message, opcao) } : {})}
                />
                <p className="votacoes-pagina-meta">
                  {strings.salaDeVotacoes.deQuem(
                    nameFor(votacao.message.sender),
                    formatarDataEHora(votacao.message.payload.sentAt),
                  )}
                </p>
                {((!estaFechada(votacao) && podeFechar(votacao)) || (onEliminar && podeEliminar(votacao))) && (
                  <div className="votacoes-pagina-accoes">
                    {!estaFechada(votacao) && podeFechar(votacao) && (
                      <Button variant="ghost" type="button" onClick={() => onFechar(votacao)}>
                        {strings.votacao.fechar}
                      </Button>
                    )}
                    {onEliminar && podeEliminar(votacao) && (
                      <Button variant="danger" type="button" onClick={() => onEliminar(votacao)}>
                        {strings.votacao.eliminar}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </section>
  )
}
