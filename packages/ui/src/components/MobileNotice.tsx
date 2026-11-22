import { useEffect, useState } from "react"
import { CONSULTA_DO_TELEMOVEL } from "../hooks/useTelemovel.js"
import { strings } from "../strings.js"

/** A phone: the phone layout AND a finger. A narrow window on a computer is not one. */
export const MOBILE_NOTICE_QUERY = `${CONSULTA_DO_TELEMOVEL} and (pointer: coarse)`
export const MOBILE_NOTICE_KEY = "enclave.mobileNoticeClosed"

function wasClosed(): boolean {
  try {
    return localStorage.getItem(MOBILE_NOTICE_KEY) === "1"
  } catch {
    return false
  }
}

/**
 * "We are optimizing Orwell for mobile." on the phone, once per device.
 *
 * A row of the app's grid, never a layer (`styles/telemovel.css`): the shell
 * draws it only over the lists, where the tabs are, so a conversation, its
 * header, its box and the keyboard never share the screen with it.
 */
export function MobileNotice(): React.JSX.Element | null {
  const [closed, setClosed] = useState(wasClosed)
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const query = window.matchMedia(MOBILE_NOTICE_QUERY)
    const changed = (): void => setPhone(query.matches)
    changed()
    query.addEventListener?.("change", changed)
    return () => query.removeEventListener?.("change", changed)
  }, [])
  if (closed || !phone) return null

  const close = (): void => {
    setClosed(true)
    try {
      localStorage.setItem(MOBILE_NOTICE_KEY, "1")
    } catch {
      // No storage: it comes back on the next opening.
    }
  }
  return (
    <aside className="mobile-notice" aria-label={strings.mobileNotice.title}>
      <p>
        <strong>{strings.mobileNotice.title}</strong> {strings.mobileNotice.body}
      </p>
      <button type="button" aria-label={strings.mobileNotice.close} onClick={close}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M3 3l10 10M13 3 3 13" />
        </svg>
      </button>
    </aside>
  )
}
