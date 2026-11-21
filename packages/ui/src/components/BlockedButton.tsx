import { useEffect, useId, useState } from "react"
import { createPortal } from "react-dom"

/** How long a tapped tip stays open before it closes on its own. */
export const TIP_OPEN_MS = 4000
/** The widest a tapped tip gets, in px; a narrow window gets less. */
const TIP_WIDTH_PX = 272
/** Room kept between a tapped tip and the window edge, in px. */
const TIP_MARGIN_PX = 8

/**
 * A button the account cannot use now, that says why (1.3.26: the cap on
 * channels and on rooms). It stays visible, grey, and takes focus:
 * `aria-disabled`, not `disabled`, because a disabled button gets no hover, no
 * keyboard focus and no tap, and the reason would be unreachable.
 *
 * On mouse hover and on keyboard focus the reason uses the tooltip that
 * already exists (`[data-tip]` in `components.css`). A phone has no hover, so a
 * tap opens the same text in a short bubble under the button. The bubble is
 * fixed to the window, not a pseudo-element: the phone rail and the column
 * clip what overflows them. It closes on its own after `TIP_OPEN_MS`, on
 * another tap, or when the focus leaves. Screen readers read the reason
 * through `aria-describedby`.
 */
export function BlockedButton({
  tip,
  label,
  className,
  side,
  children,
}: {
  /** Why the button does nothing now. */
  tip: string
  /** The accessible name: what the button would do. */
  label: string
  className: string
  /** Where the hover bubble opens. See the `data-tip-side` variants. */
  side?: "end" | "start" | "right" | "below-end" | undefined
  children: React.ReactNode
}): React.JSX.Element {
  const id = useId()
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null)
  useEffect(() => {
    if (!at) return
    const close = setTimeout(() => setAt(null), TIP_OPEN_MS)
    return () => clearTimeout(close)
  }, [at])
  return (
    <>
      <button
        type="button"
        className={`${className} no-tecto${at ? " dica-tocada-aberta" : ""}`}
        data-tip={tip}
        data-tip-longa="1"
        {...(side ? { "data-tip-side": side } : {})}
        aria-label={label}
        aria-disabled="true"
        aria-describedby={id}
        onClick={(event) => {
          if (at) {
            setAt(null)
            return
          }
          const box = event.currentTarget.getBoundingClientRect()
          const width = Math.min(TIP_WIDTH_PX, window.innerWidth - 2 * TIP_MARGIN_PX)
          const centred = box.left + box.width / 2 - width / 2
          setAt({
            top: box.bottom + TIP_MARGIN_PX,
            left: Math.max(TIP_MARGIN_PX, Math.min(centred, window.innerWidth - TIP_MARGIN_PX - width)),
            width,
          })
        }}
        onBlur={() => setAt(null)}
      >
        {children}
      </button>
      <span id={id} hidden>
        {tip}
      </span>
      {at &&
        createPortal(
          <span className="dica-tocada" aria-hidden="true" style={{ top: at.top, left: at.left, maxWidth: at.width }}>
            {tip}
          </span>,
          document.body,
        )}
    </>
  )
}
