import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react"
import { Composer } from "./Composer.js"

type Props = Omit<ComponentProps<typeof Composer>, "value" | "onChange"> & {
  /** The channel the text belongs to. */
  canal: string
  /** The draft the root keeps for `canal`: where the text starts. */
  rascunho: string
  /** Gives the text back to the root. Called only on a channel change, on send and on unmount. */
  onRascunho: (canal: string, texto: string) => void
}

/**
 * The composer with its draft held here, and not in the root (1.3.15).
 *
 * The draft used to live in `App` (`useDrafts`), and each key re-rendered the
 * whole app: the sidebar, the member list and the conversation. Now a key only
 * renders this composer. The text goes up to the root when the channel changes,
 * when a message is sent and when the composer leaves the screen, so a draft
 * still survives a channel switch.
 *
 * The composer itself stays controlled (`value`, `onChange`): only the owner of
 * the text moved.
 */
export function ComposerComRascunho({ canal, rascunho, onRascunho, onSend, ...resto }: Props): React.JSX.Element {
  const [texto, setTexto] = useState(rascunho)
  /** The channel and text on screen, and the draft it started from (to skip a needless push). */
  const vivo = useRef({ canal, texto: rascunho, inicial: rascunho })
  const devolver = useRef(onRascunho)

  useLayoutEffect(() => {
    vivo.current.texto = texto
    devolver.current = onRascunho
  })

  // Another channel: the text goes back to the root under the old channel, and the
  // new channel's draft takes its place before the paint.
  useLayoutEffect(() => {
    const antes = vivo.current
    if (antes.canal === canal) return
    if (antes.texto !== antes.inicial) devolver.current(antes.canal, antes.texto)
    vivo.current = { canal, texto: rascunho, inicial: rascunho }
    setTexto(rascunho)
    // Only the channel decides: `rascunho` changes when the push above lands in the root.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canal])

  // Leaving the screen (settings, a locked composer): the text goes back too.
  useEffect(
    () => () => {
      const { canal: c, texto: t, inicial } = vivo.current
      if (t === inicial) return
      vivo.current.inicial = t
      devolver.current(c, t)
    },
    [],
  )

  return (
    <Composer
      {...resto}
      value={texto}
      onChange={setTexto}
      onSend={(body, extras) => {
        onSend(body, extras)
        // Sent: the root forgets this channel's draft now, not on the next switch.
        vivo.current.inicial = ""
        devolver.current(canal, "")
      }}
    />
  )
}
