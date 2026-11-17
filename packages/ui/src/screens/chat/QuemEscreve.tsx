import { memo, useMemo, type ComponentProps } from "react"
import type { EnclaveBridge } from "../../bridge.js"
import { useTyping } from "../../hooks/useTyping.js"
import { strings } from "../../strings.js"
import { ComposerComRascunho } from "./ComposerComRascunho.js"

/**
 * "Who is typing", a strip held by the composer (1.3.16.1).
 *
 * It used to live at the bottom of the conversation's scroller, stuck there
 * with `sticky`: it rode along with the scroll, and each signal
 * re-rendered the whole chat screen, conversation included. Now it is part of
 * the composer, like in Discord: outside the list, never scrolled, and the
 * paragraph is always there with its height reserved, so a name coming and
 * going changes text and never layout.
 *
 * Above the box, not below: on a phone the keyboard covers what is under the
 * focused field.
 *
 * `aria-live="polite"`, not "assertive": it is a courtesy, not a banner.
 */
export const FaixaQuemEscreve = memo(function FaixaQuemEscreve({ nomes }: { nomes: readonly string[] }): React.JSX.Element {
  return (
    <p className="chat-a-escrever" aria-live="polite">
      {nomes.length > 0 && (
        <>
          <span className="typing-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="chat-a-escrever-texto">{strings.chat.typing([...nomes])}</span>
        </>
      )}
    </p>
  )
})

type Props = Omit<ComponentProps<typeof ComposerComRascunho>, "onTyping" | "faixa"> & {
  bridge: EnclaveBridge
  /** The open room: a signal from another room of the same channel is not shown here. */
  sala: string
  /** The common room: our own signal goes out less often. See `useTyping`. */
  salaGrande: boolean
  /** The name for an address: an indicator with `@ana:servidor` does not read well. */
  nomeDe: (endereco: string) => string
}

/**
 * The composer with the typing signal, both ends.
 *
 * `useTyping` lives here and not in `ChatScreen` so that a signal arriving
 * renders only this composer, which already renders on every key. In the
 * screen it re-rendered the conversation and the member list each time someone
 * else started a sentence. Leaving the conversation still clears the state, as
 * it did there: this component leaves with it.
 */
export function CaixaComQuemEscreve({ bridge, sala, salaGrande, nomeDe, onSend, ...resto }: Props): React.JSX.Element {
  const { typists, noteTyping, stopTyping } = useTyping(bridge, resto.canal || null, sala, resto.eu ?? null, resto.connection, salaGrande)
  const nomes = useMemo(() => typists.map(nomeDe), [typists, nomeDe])
  return (
    <ComposerComRascunho
      {...resto}
      onTyping={noteTyping}
      faixa={<FaixaQuemEscreve nomes={nomes} />}
      onSend={(body, extras) => {
        onSend(body, extras)
        // The sentence ended. No "stopped typing" signal goes out, the deadline
        // handles that on the other side. This reopens the burst so the next
        // sentence signals again without waiting for the interval.
        stopTyping()
      }}
    />
  )
}
