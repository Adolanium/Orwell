import { createContext, useContext } from "react"
import { strings } from "../strings.js"

/**
 * "Ainda não guardaste o ficheiro da conta." (mock-up `Main`, 21/11/2026).
 *
 * After "Fazer mais tarde", the banner stays at the top of every screen until
 * a file is saved or the account has a second device. It rides with the
 * connection banner, which every screen already draws (`ConnectionBanner`), so
 * no screen has to know about the file. The shell decides when it shows and
 * opens the sheet ("Guardar"). Without a provider, nothing draws.
 */
export interface FaixaDoFicheiroValor {
  guardar: () => void
}

export const FaixaDoFicheiroContext = createContext<FaixaDoFicheiroValor | null>(null)

export function FaixaDoFicheiro(): React.JSX.Element | null {
  const faixa = useContext(FaixaDoFicheiroContext)
  if (!faixa) return null
  return (
    <div className="faixa-do-ficheiro" role="status">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
      <span className="faixa-do-ficheiro-texto">{strings.entrada.faixa}</span>
      <button type="button" className="faixa-do-ficheiro-guardar" onClick={faixa.guardar}>
        {strings.entrada.faixaGuardar}
      </button>
    </div>
  )
}
