import type { ConnectionState } from "../bridge.js"
import { connectionLabel } from "../lib/format.js"

/**
 * The quiet line of connection state at the foot of a screen.
 *
 * It speaks only when there is something to say: "connected" under every
 * screen was noise. Errors go to toasts, and the banner at the top carries
 * the outages. One component, so every screen hides it the same way.
 */
export function LinhaDoEstado({ connection }: { connection: ConnectionState }): React.JSX.Element | null {
  if (connection === "online") return null
  return <footer className="statusbar">{connectionLabel(connection)}</footer>
}
