import { strings } from "../strings.js"

/**
 * The notices on one rail button (option A, "pill and pastille", 20/11/2026).
 *
 * Every notice has its own SHAPE, so colour is never the only difference:
 *
 * - **Unread, nobody waiting for you** (`porLer`): a short pill on the left
 *   edge, with no number. The same pill that grows on hover and stands tall
 *   on the open destination, so it reads as "something here", not as a count.
 * - **Waiting for you** (`quantas`): the pastille with the number, in the
 *   brand, at the bottom right. Mentions in Communities, direct messages and
 *   requests in Friends, comments on my posts in Feed. See `lib/porAtender.ts`.
 * - **A nudge not seen yet** (`toque`): a red outline on the button and a red
 *   pastille with the vibration glyph, in the number's place. The nudge is
 *   more urgent than a count, and the count comes back when it is seen. Its
 *   words come from whoever knows the sender (`strings.rail.cotoveladaPorVer`),
 *   so the sentence has one source and names the person.
 * - **A call in progress here** (`chamada`): a green seal at the top right,
 *   with the voice bars. It sits opposite the number, so the two never cover
 *   each other.
 *
 * **Above nine the pastille says "9+", and that is size, not style.** The
 * pastille sits on the button's corner; three digits would push it out of the
 * 60 px column on a phone. The words say the full number.
 *
 * **The drawing is hidden from screen readers, and the words are not.** The
 * button keeps its name ("Friends" whatever arrived) and points
 * `aria-describedby` at one `.sr-only` span with every sentence. A
 * description is read from the TEXT of the element it points to, which is why
 * it is a span and not an `aria-label` on the drawing.
 *
 * The open destination draws no pill: its own pill already stands 40 px tall.
 */
export interface AvisosDoCarrilProps {
  /** The id of the words, for the button's `aria-describedby`. */
  id: string
  /** What waits for this account here. Zero draws nothing. */
  quantas: number
  /** Something unread with no number: the pill. */
  porLer?: boolean
  /** This is the destination on screen. */
  activo?: boolean
  /**
   * A nudge not seen yet, in words ("Carla nudged you."): present draws the
   * outline and the glyph. The event lives in `useCotoveladaPorVer`.
   */
  toque?: string | undefined
  /** A call is in progress in a conversation of this destination. */
  chamada?: boolean
}

/** The class of the rail button: open, and outlined in red by a nudge. */
export function classeDoBotaoDoCarril({ activo, toque }: { activo: boolean; toque: boolean }): string {
  return ["rail-btn", activo ? "active" : "", toque ? "tocado" : ""].filter(Boolean).join(" ")
}

function frases({ quantas, porLer, activo, toque, chamada }: AvisosDoCarrilProps): string[] {
  const lista: string[] = []
  if (toque) lista.push(toque)
  if (quantas > 0) lista.push(strings.rail.porAtender(quantas))
  else if (porLer && !activo) lista.push(strings.rail.porLer)
  if (chamada) lista.push(strings.rail.chamada)
  return lista
}

/** The button only describes itself when there is something to describe. */
export function descricaoDoCarril(props: AvisosDoCarrilProps): string | undefined {
  return frases(props).length > 0 ? props.id : undefined
}

export function AvisosDoCarril(props: AvisosDoCarrilProps): React.JSX.Element | null {
  const { id, quantas, porLer = false, activo = false, toque, chamada = false } = props
  const ditas = frases(props)
  if (ditas.length === 0) return null
  return (
    <>
      {porLer && quantas <= 0 && !activo && <span className="rail-pill" aria-hidden="true" />}
      {toque ? (
        <span className="rail-toque" aria-hidden="true">
          <GlifoDoToque />
        </span>
      ) : (
        quantas > 0 && (
          <span className="rail-count" aria-hidden="true">
            {quantas > 9 ? "9+" : quantas}
          </span>
        )
      )}
      {chamada && (
        <span className="rail-chamada" aria-hidden="true">
          <GlifoDaChamada />
        </span>
      )}
      <span className="sr-only" id={id}>
        {ditas.join(". ")}
      </span>
    </>
  )
}

/*
  The glyphs, drawn on a 12 grid, sized by the sheet. A zigzag for the
  vibration of a nudge, three bars for a voice; both readable at 10 px.
*/
function GlifoDoToque(): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <path d="M1.2 6.2 3.1 3 5 9 7 3 8.9 9 10.8 5.8" />
    </svg>
  )
}

function GlifoDaChamada(): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" focusable="false">
      <path d="M3 5.2v1.6M6 3v6M9 5.2v1.6" />
    </svg>
  )
}

/** The "!" on the amber seal over the logo, when the connection dropped. */
export function GlifoSemLigacao(): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeLinecap="round" focusable="false">
      <path d="M6 2.8v4" strokeWidth={1.8} />
      <path d="M6 9.2v.05" strokeWidth={2.2} />
    </svg>
  )
}
