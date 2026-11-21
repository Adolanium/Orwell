import { formatShortDate } from "../lib/format.js"
import { strings } from "../strings.js"

/**
 * "Novo aparelho na tua conta" (mock-ups `Ficheiro` and `Desktop`, 21/11/2026).
 *
 * A device this one did not add joined the account (with the account file, or
 * paired from another device). The card sits in a corner, does not cover the
 * conversation, and stays until one of its buttons: "Fui eu" closes it, "Remover"
 * takes the device out with the same removal as Settings › Aparelhos. The bell
 * keeps the entry either way.
 */
export function CartaoDeAparelhoNovo({
  quando,
  aRemover,
  onFuiEu,
  onRemover,
  agora = Date.now(),
}: {
  /** When the device joined, in milliseconds. */
  quando: number
  aRemover: boolean
  onFuiEu: () => void
  /** Missing on a device that cannot remove devices: only "Fui eu". */
  onRemover?: (() => void) | undefined
  agora?: number
}): React.JSX.Element {
  return (
    <section className="cartao-aparelho-novo" role="status" aria-label={strings.juntarAparelho.novoNaConta}>
      <div className="cartao-aparelho-novo-cabeca">
        <span className="cartao-aparelho-novo-icone" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="2" y="4" width="20" height="13" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
        </span>
        <div>
          <p className="cartao-aparelho-novo-titulo">{strings.juntarAparelho.novoNaConta}</p>
          <p className="field-note">{haQuanto(quando, agora)}</p>
        </div>
      </div>
      <div className="cartao-aparelho-novo-botoes">
        {onRemover && (
          <button type="button" className="ghost cartao-aparelho-novo-remover" disabled={aRemover} onClick={onRemover}>
            {strings.juntarAparelho.remover}
          </button>
        )}
        <button type="button" className="ghost" disabled={aRemover} onClick={onFuiEu}>
          {strings.juntarAparelho.fuiEu}
        </button>
      </div>
    </section>
  )
}

/** "agora mesmo", "há 5 min", "há 2 h", or the date. */
export function haQuanto(quando: number, agora: number): string {
  const minutos = Math.max(0, Math.floor((agora - quando) / 60_000))
  if (minutos < 1) return strings.common.tempo.agoraMesmo
  if (minutos < 60) return strings.common.tempo.haMinutos(minutos)
  if (minutos < 24 * 60) return strings.common.tempo.haHoras(Math.floor(minutos / 60))
  return formatShortDate(quando)
}
