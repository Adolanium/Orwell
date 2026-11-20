import { useEffect, useState } from "react"
import type { PinnedMessage } from "../../bridge.js"
import { CloseIcon, PinIcon, SetaBaixoIcon, SetaCimaIcon } from "../../icons.js"
import { strings } from "../../strings.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/**
 * The pinned bar at the top of the room, like Discord and Telegram (fixadas-topo, 20/11/2026).
 *
 * One line in the flow of the screen, between the header and the conversation,
 * never on top of the text: the conversation starts under it and gets shorter by
 * its height. It shows one pin at a time, the newest first (the sheet's order):
 * the small image of the first picture, who said it and the first line. With more
 * than one, the count and two arrows go through them.
 *
 * A click on the line goes to the message and then shows the next pin, as in
 * Telegram: clicking again walks the pins one by one. What "go to" does when the
 * message is not on this device is not decided here (`onAbrir`).
 *
 * The text is the original when this device has it (`corpoDe`) and the copy
 * otherwise, the same reading as `PinnedPanel`. The copy is what keeps the bar
 * full after a restart, when the message is no longer in memory.
 */
export function BarraDasFixadas({
  pins,
  nameFor,
  corpoDe,
  onAbrir,
  onEsconder,
}: {
  /** Oldest to newest, as `usePins` gives them. Never empty: the screen does not draw an empty bar. */
  pins: PinnedMessage[]
  nameFor: (address: string) => string
  corpoDe: (id: string) => string | undefined
  onAbrir: (id: string) => void
  onEsconder: () => void
}): React.JSX.Element | null {
  const total = pins.length
  const recente = pins[total - 1]?.id
  /** 0 is the newest pin. */
  const [posicao, setPosicao] = useState(0)
  // A new pin is news: the bar goes back to it. A list that got shorter keeps the place inside it.
  useEffect(() => setPosicao(0), [recente])
  const indice = Math.min(posicao, total - 1)
  const fixada = pins[total - 1 - indice]
  if (!fixada) return null

  const anexos = fixada.attachments ?? []
  const miniatura = anexos.find((anexo) => anexo.thumbnail)?.thumbnail
  const corpo = corpoDe(fixada.id) ?? fixada.body
  const primeiraLinha = corpo.split("\n").find((linha) => linha.trim() !== "")?.trim() ?? ""
  const texto = primeiraLinha || (anexos.length > 0 ? anexos.map((anexo) => anexo.name).join(", ") : strings.chat.pinnedNoText)
  const andar = (passo: number): void => setPosicao((total + indice + passo) % total)

  return (
    <section className="barra-fixadas" aria-label={strings.chat.pinnedBarRegion}>
      <button
        type="button"
        className="barra-fixadas-abrir"
        title={strings.chat.pinnedBarOpen}
        onClick={() => {
          onAbrir(fixada.id)
          if (total > 1) andar(1)
        }}
      >
        {miniatura && <img className="barra-fixadas-miniatura" src={miniatura} alt="" />}
        <span className="barra-fixadas-texto">
          <span className="barra-fixadas-rotulo">
            <PinIcon size={12} />
            {strings.chat.pinnedBarLabel}
            {total > 1 && <span className="barra-fixadas-conta">{strings.chat.pinnedBarCount(indice + 1, total)}</span>}
          </span>
          <span className="barra-fixadas-linha">
            <span className="barra-fixadas-autor">
              <NomeDePessoa nome={nameFor(fixada.sender)} endereco={fixada.sender} />
            </span>{" "}
            <span className="barra-fixadas-corpo">{texto}</span>
          </span>
        </span>
      </button>
      {total > 1 && (
        <span className="barra-fixadas-setas">
          <button
            type="button"
            className="barra-fixadas-botao"
            aria-label={strings.chat.pinnedBarPrevious}
            title={strings.chat.pinnedBarPrevious}
            onClick={() => andar(-1)}
          >
            <SetaCimaIcon size={16} />
          </button>
          <button
            type="button"
            className="barra-fixadas-botao"
            aria-label={strings.chat.pinnedBarNext}
            title={strings.chat.pinnedBarNext}
            onClick={() => andar(1)}
          >
            <SetaBaixoIcon size={16} />
          </button>
        </span>
      )}
      <button
        type="button"
        className="barra-fixadas-botao"
        aria-label={strings.chat.pinnedBarHide}
        title={strings.chat.pinnedBarHide}
        onClick={onEsconder}
      >
        <CloseIcon size={16} />
      </button>
    </section>
  )
}
