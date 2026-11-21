import type { ReactNode } from "react"
import { Button } from "../../components/Button.js"
import { LigacoesLegais } from "../../components/LigacoesLegais.js"
import { OrwellWordmark } from "../../components/Logo.js"
import { strings } from "../../strings.js"
import { LigacaoMudarDeConta } from "./MudarDeConta.js"

/**
 * The first screen (mock-up `Main`, 21/11/2026): one title and the three ways
 * in, all in view. "Criar conta" is the main one. The account file is no longer
 * hidden under the name field, and the other device is no longer a question.
 */
export function Entrada({
  onCriar,
  onFicheiro,
  onOutroAparelho,
  termosDoOrwell,
}: {
  onCriar: () => void
  onFicheiro: () => void
  /** Missing on a host that cannot pair: the button does not show. */
  onOutroAparelho?: (() => void) | undefined
  /** orwell.pt's Privacy and Terms, only for an account made on orwell.pt. */
  termosDoOrwell: boolean
}): React.JSX.Element {
  return (
    <div className="gate">
      <div className="gate-card gate-entrada">
        <header className="setup-head">
          <OrwellWordmark size={22} />
        </header>
        <h1 className="entrada-titulo">{strings.entrada.bemVindo}</h1>
        <div className="entrada-caminhos">
          <Button variant="primary" type="button" className="entrada-botao" onClick={onCriar}>
            {strings.entrada.criarConta}
          </Button>
          <Button variant="ghost" type="button" className="entrada-botao entrada-caminho" onClick={onFicheiro}>
            <IconeFicheiro />
            {strings.entrada.comFicheiro}
          </Button>
          {onOutroAparelho && (
            <Button variant="ghost" type="button" className="entrada-botao entrada-caminho" onClick={onOutroAparelho}>
              <IconeAparelhos />
              {strings.entrada.comOutroAparelho}
            </Button>
          )}
        </div>
        <RodapeDaEntrada termosDoOrwell={termosDoOrwell} />
      </div>
    </div>
  )
}

/**
 * Below the card: orwell.pt's Privacy and Terms (GDPR art. 13, on every screen
 * that asks for data), and the way back to another account on this device, only
 * when there is one.
 *
 * No "How it works" link here since 1.3.26: the first screen shows the three
 * ways in and nothing else. The page stays in Settings, under Help and
 * diagnostics.
 */
export function RodapeDaEntrada({ termosDoOrwell }: { termosDoOrwell: boolean }): React.JSX.Element {
  return (
    <div className="gate-rodape">
      {termosDoOrwell && (
        <p>
          <LigacoesLegais className="gate-link" />
        </p>
      )}
      <LigacaoMudarDeConta rotulo={strings.entrada.voltarAConta} podeAcrescentar={false} />
    </div>
  )
}

/** "‹ Voltar", at the top left of every screen after the first. */
export function BotaoVoltar({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button type="button" className="gate-voltar" disabled={disabled} onClick={onClick}>
      <span aria-hidden="true">‹</span> {strings.entrada.voltar}
    </button>
  )
}

/** A card of the gate, with the "Voltar" on top. The same shape on the phone and the computer. */
export function CartaoDoPortao({
  titulo,
  onVoltar,
  voltarDesligado,
  children,
  className,
}: {
  titulo: ReactNode
  onVoltar?: (() => void) | undefined
  voltarDesligado?: boolean
  children?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={className ? `gate-card gate-entrada ${className}` : "gate-card gate-entrada"}>
      {onVoltar && <BotaoVoltar onClick={onVoltar} disabled={voltarDesligado ?? false} />}
      <h1 className="entrada-titulo">{titulo}</h1>
      {children}
    </div>
  )
}

export function IconeFicheiro({ tamanho = 20 }: { tamanho?: number }): React.JSX.Element {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 11v6M9 14l3 3 3-3" />
    </svg>
  )
}

export function IconeAparelhos(): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="2" y="4" width="13" height="10" rx="2" />
      <rect x="16" y="8" width="6" height="12" rx="1.5" />
      <path d="M6 18h6" />
    </svg>
  )
}
