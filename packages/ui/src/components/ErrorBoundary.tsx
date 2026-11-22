import { comChaveDoBrowser } from "@enclave/client-core"
import { Component, type ErrorInfo, type ReactNode } from "react"
import { registarFalha } from "../lib/falhas.js"
import type { ConnectionState, EnclaveBridge } from "../bridge.js"
import { ComunicarErro, useComunicarErro } from "./ComunicarErro.js"
import { TextoDeErro } from "./TextoDeErro.js"
import { CODIGO_DESCONHECIDO, codigoDoErro } from "../lib/codigosDeErro.js"
import { strings, translateError, traduzirErro } from "../strings.js"
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
 * What the card says (1.3.27). An error the table knows keeps its own sentence;
 * any other throw (a `TypeError` in a hook) is "Error 901": the screen stopped,
 * the messages are safe, reload. Never the raw message of the engine alone.
 */
export function textoDaFalha(error: unknown): string {
  const comChave = comChaveDoBrowser(error)
  const mensagem = comChave instanceof Error ? comChave.message : String(comChave ?? "")
  return codigoDoErro(mensagem) === CODIGO_DESCONHECIDO ? translateError("the app screen stopped working") : traduzirErro(error)
}

/**
 * The last line: a render crash anywhere in the tree lands here instead of a
 * blank page. Reloading is the honest recovery — the vault and session re-open
 * from scratch, which is exactly what a wedged tree needs. It wraps the whole
 * `App` (1.3.27) and, again, the ready tree inside the `Shell`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, comunicar: false }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  // The cause, for the diagnostic log (1.3.27): the next real case brings it.
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    registarFalha("screen-crash", error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error) {
      const { bridge, connection = "offline" } = this.props
      return (
        <div className="gate">
          <div className="gate-card">
            <h1>{strings.errors.crashTitle}</h1>
            <p className="error">
              <TextoDeErro texto={textoDaFalha(this.state.error)} />
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
