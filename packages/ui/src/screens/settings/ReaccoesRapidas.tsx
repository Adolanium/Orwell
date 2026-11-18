import { useState } from "react"
import { EmojiPicker } from "../../components/EmojiPicker.js"
import { useReaccoesRapidas } from "../../lib/emojiFrequentes.js"
import { strings } from "../../strings.js"

/**
 * The three quick reactions, in Settings: the ones the hover bar of a message and
 * the long-press menu show.
 *
 * Three slots. A slot the person filled keeps that emoji; an empty slot shows the
 * next emoji this person uses most, drawn faint so the difference reads. The
 * full Unicode set is the picker's: any emoji can take a slot.
 */
export function ReaccoesRapidas({
  escolhidas,
  onMudar,
}: {
  /** Slot by slot; an empty string is an empty slot. */
  escolhidas: readonly string[]
  onMudar: (escolhidas: string[]) => void
}): React.JSX.Element {
  const efectivas = useReaccoesRapidas()
  const [aEscolher, setAEscolher] = useState<number | null>(null)
  const mudar = (casa: number, emoji: string): void => {
    const proximas = [0, 1, 2].map((i) => escolhidas[i] ?? "")
    proximas[casa] = emoji
    // The same emoji in two slots shows once: the other slot is emptied.
    if (emoji) for (let i = 0; i < 3; i++) if (i !== casa && proximas[i] === emoji) proximas[i] = ""
    onMudar(proximas)
  }
  return (
    <section className="card settings-card">
      <h2>{strings.reaccoes.rapidasTitulo}</h2>
      <div className="rapidas-casas">
        {[0, 1, 2].map((casa) => {
          const escolhida = escolhidas[casa] ?? ""
          const mostrada = escolhida || efectivas[casa] || ""
          return (
            <span key={casa} className="rapidas-casa">
              <button
                type="button"
                className={escolhida ? "rapidas-emoji" : "rapidas-emoji automatica"}
                aria-label={strings.reaccoes.casa(casa + 1, escolhida || null)}
                onClick={() => setAEscolher(casa)}
              >
                {mostrada}
              </button>
              {escolhida && (
                <button type="button" className="rapidas-limpar" aria-label={strings.reaccoes.limparCasa(casa + 1)} onClick={() => mudar(casa, "")}>
                  ×
                </button>
              )}
            </span>
          )
        })}
      </div>
      <p className="field-note">{strings.reaccoes.rapidasNota}</p>
      {escolhidas.some(Boolean) && (
        <button type="button" className="chip" onClick={() => onMudar(["", "", ""])}>
          {strings.reaccoes.repor}
        </button>
      )}
      {aEscolher !== null && (
        <EmojiPicker
          titulo={strings.reaccoes.escolherCasa(aEscolher + 1)}
          contar={false}
          onPick={(emoji) => mudar(aEscolher, emoji)}
          onClose={() => setAEscolher(null)}
        />
      )}
    </section>
  )
}
