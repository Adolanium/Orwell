import { Component, type ReactNode } from "react"
import type { ConnectionState, EnclaveBridge } from "../bridge.js"
import { ComunicarErro, useComunicarErro } from "./ComunicarErro.js"
import { TextoDeErro } from "./TextoDeErro.js"
import { strings, traduzirErro } from "../strings.js"
import { Button } from "./Button.js"

interface ErrorBoundaryState {
  error: Error | null
  comunicar: boolean
}

interface ErrorBoundaryProps {
  children: ReactNode
  /** For "Report a bug" on this screen (12/11/2026). Without it, the button does not exist. */
  bridge?: EnclaveBridge | undefined
  connection?: ConnectionState | undefined
}

/** The button, only where the server takes bug reports. A function, for the hook. */
function BotaoComunicarErro({ bridge, connection, onClick }: { bridge: EnclaveBridge; connection: ConnectionState; onClick: () => void }): ReactNode {
  return useComunicarErro(bridge, connection) ? (
    <Button variant="ghost" onClick={onClick}>
      {strings.comunicarErro.botao}
    </Button>
  ) : null
}

/**
 * The last line: a render crash anywhere in the ready tree lands here instead
 * of a blank page. Reloading is the honest recovery — the vault and session
 * re-open from scratch, which is exactly what a wedged tree needs.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, comunicar: false }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  override render(): ReactNode {
    if (this.state.error) {
      const { bridge, connection = "offline" } = this.props
      return (
        <div className="gate">
          <div className="gate-card">
            <h1>{strings.errors.crashTitle}</h1>
            <p className="error">
              <TextoDeErro texto={traduzirErro(this.state.error)} />
            </p>
            <Button variant="primary" onClick={() => location.reload()}>
              {strings.errors.reload}
            </Button>
            {bridge && <BotaoComunicarErro bridge={bridge} connection={connection} onClick={() => this.setState({ comunicar: true })} />}
          </div>
          {bridge && this.state.comunicar && (
            <ComunicarErro bridge={bridge} connection={connection} onClose={() => this.setState({ comunicar: false })} />
          )}
        </div>
      )
    }
    return this.props.children
  }
}
