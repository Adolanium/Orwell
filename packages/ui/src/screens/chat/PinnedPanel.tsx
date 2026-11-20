import { useEffect, useRef } from "react"
import { Avatar } from "../../components/Avatar.js"
import { Button } from "../../components/Button.js"
import type { PinnedMessage, Profile } from "../../bridge.js"
import { formatRelative, formatStamp } from "../../lib/format.js"
import { strings } from "../../strings.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/**
 * What is pinned in this room.
 *
 * A sheet anchored to the header button, dismissed like a menu, click outside
 * or Escape, and never modal: nothing here needs an answer.
 *
 * **The text you read can be the copy, not the message.** Whoever pins makes a
 * copy of the body and it travels with the pin, because the original message was
 * encrypted in an epoch that later arrivals do not have access to, and because
 * the channel history has a cap and dumps the oldest. Whoever HAS the original
 * reads that, that is what `corpoDe` does, and the copy is what remains for
 * those who do not have it. The footnote says this in words, because it is the
 * only thing here a person can understand more about: pinning keeps the text, it
 * does not keep the conversation.
 */
export function PinnedPanel({
  ancora,
  pins,
  directory,
  nameFor,
  podeDesafixar,
  corpoDe,
  onDesafixar,
  onAbrir,
  realcada = null,
  onMostrarBarra,
  onClose,
}: {
  /**
   * What counts as "inside here" for the click-outside that dismisses the sheet.
   *
   * The button that opens it is OUTSIDE it, and without this the click on it was
   * a click outside: the sheet closed on `mousedown` and the `click` after opened
   * it again. The button looked broken, pressing it closed nothing. By passing in
   * the wrapper that holds both, the button becomes a toggle again.
   */
  ancora?: React.RefObject<HTMLElement | null> | undefined
  pins: PinnedMessage[]
  directory: Map<string, Profile>
  nameFor: (address: string) => string
  /** Without the pin capability, there is no button at all, no greyed out state. */
  podeDesafixar: boolean
  /**
   * The body of the original message, if this account still has it.
   *
   * Returning nothing is the normal case and not a failure: anyone who arrived
   * in the channel later will never be able to open the message, and that is
   * exactly what the copy exists for.
   */
  corpoDe: (id: string) => string | undefined
  onDesafixar: (id: string) => void
  /**
   * Jump to the message. Since fixadas-topo the shell looks for it in the vault
   * too, and says when this device does not have it (it opens this sheet on it).
   */
  onAbrir?: ((id: string) => void) | undefined
  /** The pin this device has no message for: highlighted, in view, and plain text. */
  realcada?: string | null | undefined
  /** Present only while the room hides its pinned bar: the button that shows it again. */
  onMostrarBarra?: (() => void) | undefined
  onClose: () => void
}): React.JSX.Element {
  const folha = useRef<HTMLDivElement>(null)

  // The pin the sheet opened on comes into view: with twenty, it may be below the fold.
  useEffect(() => {
    if (!realcada) return
    const linha = folha.current?.querySelector<HTMLElement>(".pinned-row.realcada")
    linha?.scrollIntoView?.({ block: "nearest" })
  }, [realcada])

  useEffect(() => {
    const dispensar = (event: MouseEvent): void => {
      if (!(event.target instanceof Node)) return
      const dentro = ancora?.current ?? folha.current
      if (dentro?.contains(event.target)) return
      onClose()
    }
    const teclado = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("mousedown", dispensar, true)
    window.addEventListener("keydown", teclado)
    return () => {
      window.removeEventListener("mousedown", dispensar, true)
      window.removeEventListener("keydown", teclado)
    }
  }, [onClose, ancora])

  return (
    <div ref={folha} className="pinned-panel" role="dialog" aria-label={strings.chat.pinnedTitle}>
      <header className="pinned-head">
        <h2>{strings.chat.pinnedTitle}</h2>
      </header>

      {pins.length === 0 ? (
        // Those who can pin need the empty state to show how: without it the form
        // announces a feature but does not say how to use it. Those who cannot see
        // a door that does not exist, same rule as the member panel footer.
        // `podeDesafixar` owns the pin responsibility.
        <p className="pinned-empty">{podeDesafixar ? strings.chat.pinnedEmptyCanPin : strings.chat.pinnedEmpty}</p>
      ) : (
        <ul className="pinned-list">
          {/* Most recent first: what just got pinned is what gets read next. */}
          {[...pins].reverse().map((fixada) => {
            const original = corpoDe(fixada.id)
            const corpo = original ?? fixada.body
            const anexos = fixada.attachments ?? []
            // A message with only a picture is not "(no text)": the picture says what it was.
            const texto = corpo || (anexos.length > 0 ? "" : strings.chat.pinnedNoText)
            return (
              <li key={fixada.id} className={fixada.id === realcada ? "pinned-row realcada" : "pinned-row"}>
                <Avatar profile={directory.get(fixada.sender)} fallback={fixada.sender[1] ?? "?"} />
                <div className="pinned-corpo">
                  <span className="pinned-autor">
                    <NomeDePessoa nome={nameFor(fixada.sender)} endereco={fixada.sender} />
                    <time title={formatStamp(fixada.sentAt)}>{formatRelative(fixada.sentAt)}</time>
                  </span>
                  {/* The button jumps to the message (the shell also reads the
                      vault for it). The pin we already know has no message here
                      is just text: a button that leads nowhere signals that the
                      app is broken. */}
                  {onAbrir && fixada.id !== realcada ? (
                    <button type="button" className="pinned-texto" onClick={() => onAbrir(fixada.id)}>
                      {texto || anexos.map((anexo) => anexo.name).join(", ")}
                    </button>
                  ) : (
                    texto && <p className="pinned-texto">{texto}</p>
                  )}
                  {/* The attachments as the copy keeps them: a small image of the first
                      picture and the names of the files. Never the files themselves. */}
                  {anexos.length > 0 && (
                    <span className="pinned-anexos">
                      {anexos.map((anexo, indice) =>
                        anexo.thumbnail ? (
                          <img key={indice} className="pinned-miniatura" src={anexo.thumbnail} alt={anexo.name} title={anexo.name} />
                        ) : (
                          <span key={indice} className="pinned-anexo">
                            {anexo.name}
                          </span>
                        ),
                      )}
                    </span>
                  )}
                  <span className="pinned-quem">{strings.chat.pinnedBy(nameFor(fixada.pinnedBy))}</span>
                </div>
                {podeDesafixar && (
                  <Button variant="ghost" onClick={() => onDesafixar(fixada.id)}>
                    {strings.chat.messageUnpin}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {onMostrarBarra && pins.length > 0 && (
        <div className="pinned-mostrar">
          <Button variant="ghost" onClick={onMostrarBarra}>
            {strings.chat.pinnedBarShow}
          </Button>
        </div>
      )}
      <p className="pinned-note">{strings.chat.pinnedNote}</p>
    </div>
  )
}
