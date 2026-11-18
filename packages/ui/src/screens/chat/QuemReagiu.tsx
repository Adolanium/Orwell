import { useState } from "react"
import type { FichaDeReaccao } from "@enclave/client-core"
import type { Profile } from "../../bridge.js"
import { Avatar } from "../../components/Avatar.js"
import { Modal } from "../../components/Modal.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"
import { strings } from "../../strings.js"

/**
 * Who reacted to a message, emoji by emoji, like Discord's "Reactions" sheet.
 *
 * A tab per emoji with its count, on the side; the people of the chosen one,
 * with face and name, in the order they pressed it. Opened from a chip
 * (right-click, or a long press on a phone) and from the message menu.
 *
 * Reads the chips live: a reaction that arrives while this is open shows here at
 * once. When the chosen emoji loses its last person, the first tab takes over.
 */
export function QuemReagiu({
  fichas,
  inicial,
  nameFor,
  directory,
  onClose,
}: {
  fichas: readonly FichaDeReaccao[]
  /** The emoji to open on. */
  inicial: string | null
  nameFor: (address: string) => string
  directory: ReadonlyMap<string, Profile>
  onClose: () => void
}): React.JSX.Element {
  const [escolhido, setEscolhido] = useState(inicial)
  const actual = fichas.find((ficha) => ficha.emoji === escolhido) ?? fichas[0]

  return (
    <Modal className="sheet quem-reagiu" labelledBy="quem-reagiu-titulo" onClose={onClose}>
      <h2 id="quem-reagiu-titulo">{strings.reaccoes.titulo}</h2>
      <div className="quem-reagiu-corpo">
        <div className="quem-reagiu-separadores" role="tablist" aria-orientation="vertical" aria-label={strings.reaccoes.titulo}>
          {fichas.map((ficha) => {
            const ligado = ficha.emoji === actual?.emoji
            return (
              <button
                key={ficha.emoji}
                type="button"
                role="tab"
                aria-selected={ligado}
                aria-label={strings.reaccoes.separador(ficha.emoji, ficha.quem.length)}
                tabIndex={ligado ? 0 : -1}
                className={ligado ? "quem-reagiu-separador on" : "quem-reagiu-separador"}
                onClick={() => setEscolhido(ficha.emoji)}
                onKeyDown={(event) => {
                  const passo = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0
                  if (passo === 0) return
                  event.preventDefault()
                  const aqui = fichas.findIndex((outra) => outra.emoji === ficha.emoji)
                  const seguinte = fichas[Math.max(0, Math.min(fichas.length - 1, aqui + passo))]
                  if (!seguinte) return
                  setEscolhido(seguinte.emoji)
                  const lista = event.currentTarget.parentElement
                  queueMicrotask(() => lista?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus())
                }}
              >
                <span aria-hidden="true">{ficha.emoji}</span>
                <span className="quem-reagiu-n" aria-hidden="true">
                  {ficha.quem.length}
                </span>
              </button>
            )
          })}
        </div>
        {actual && (
          <ul className="quem-reagiu-pessoas" role="tabpanel" aria-label={strings.reaccoes.lista(actual.emoji)}>
            {actual.quem.map((quem) => (
              <li key={quem} className="quem-reagiu-pessoa">
                <Avatar profile={directory.get(quem)} fallback={quem[1] ?? "?"} />
                <span className="quem-reagiu-nome">
                  <NomeDePessoa nome={nameFor(quem)} endereco={quem} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="quem-reagiu-pe">
        <button type="button" className="emoji-close" onClick={onClose}>
          {strings.reaccoes.fechar}
        </button>
      </footer>
    </Modal>
  )
}
