import { useEffect, useState } from "react"
import { useBridge } from "../App.js"
import type { HistoricoDosIrmaos } from "../bridge.js"
import { strings } from "../strings.js"

/**
 * History from a sibling device on the same account (1.0 "Arca"): reads the
 * state on mount and follows the `historico` event from the bridge. Without the new bridge
 * (a host on another version), nothing.
 */
export function useHistoricoDosIrmaos(): HistoricoDosIrmaos | null {
  const bridge = useBridge()
  const [estado, setEstado] = useState<HistoricoDosIrmaos | null>(null)
  useEffect(() => {
    let vivo = true
    void bridge.sincronia
      ?.historico?.()
      .then((agora) => {
        if (vivo) setEstado((antes) => antes ?? agora)
      })
      .catch(() => {})
    const largar = bridge.on.historico?.((novo) => setEstado(novo))
    return () => {
      vivo = false
      largar?.()
    }
  }, [bridge])
  return estado
}

/**
 * The thin "Bringing history: 340 of 1200 messages." bar. Only on a freshly paired device,
 * or when what is missing is large: small sync between already paired devices runs
 * without a bar. After messages come files, which arrive at the end and in the
 * background. No button and covers nothing: the app works during sync.
 *
 * **And it never stands still (12/11/2026).** "402 of 420" stood on screen for
 * hours. When the transfer gives up (no progress for the core's deadline) or
 * ends with entries the main device could not send, the bar becomes ONE line:
 * the reason and what happens next, with a button to close it. Closed, it stays
 * closed for this reason until the reason changes.
 */
export function BarraDoHistorico({
  estado,
  noTopo = false,
}: {
  estado: HistoricoDosIrmaos | null
  /**
   * In the channel's top bar, next to the name and image (wide screen
   * 12/11/2026): one line, the text and the progress, and nothing pushed down in
   * the conversation. On the phone it stays its own bar, as before.
   */
  noTopo?: boolean
}): React.JSX.Element | null {
  const [fechada, setFechada] = useState<string | null>(null)
  const aviso = avisoDoHistorico(estado)
  if (aviso) {
    if (fechada === aviso) return null
    return (
      <div
        className={noTopo ? "barra-historico-no-topo barra-historico-aviso" : "barra-sincronia barra-historico barra-historico-aviso"}
        role="status"
        aria-live="polite"
      >
        <span className="barra-sincronia-texto">{aviso}</span>
        <button type="button" className="barra-historico-fechar" aria-label={strings.sincronia.historicoFechar} onClick={() => setFechada(aviso)}>
          ×
        </button>
      </div>
    )
  }
  if (!estado?.aTrazer || (!estado.inicial && estado.total < 50)) return null
  const nasMensagens = estado.feitas < estado.total
  const media = estado.media
  if (!nasMensagens && (!media || media.total === 0)) return null
  const texto = nasMensagens
    ? strings.sincronia.historico(estado.feitas, estado.total)
    : strings.sincronia.historicoMedia(media?.feitas ?? 0, media?.total ?? 0)
  return (
    <div className={noTopo ? "barra-historico-no-topo" : "barra-sincronia barra-historico"} role="status" aria-live="polite">
      <span className="barra-sincronia-texto">{texto}</span>
      <progress
        className="barra-sincronia-progresso"
        max={nasMensagens ? estado.total : (media?.total ?? 1)}
        value={nasMensagens ? estado.feitas : (media?.feitas ?? 0)}
        aria-label={texto}
      />
    </div>
  )
}

/**
 * The one line for a transfer that stopped short, or `null` while it runs (or ended whole).
 *
 * 20/11/2026: a stopped transfer only exists while a device can still send
 * the history (the core drops it when none is left), so "Sync will resume"
 * is true when it shows. The number is what is missing on THIS device
 * (`faltam`), exact or absent: without it (a sibling before 1.3.26), the same
 * line with no number. A fresh device that never got an inventory (no plan,
 * `total` 0) says its main device does not answer. Between devices already
 * paired, the same rule as the progress bar: a small sync shows nothing.
 */
export function avisoDoHistorico(estado: HistoricoDosIrmaos | null): string | null {
  if (!estado || estado.aTrazer || !estado.razao) return null
  if (estado.razao === "ilegiveis") return (estado.perdidas ?? 0) > 0 ? strings.sincronia.historicoPerdidas(estado.perdidas ?? 0) : null
  if (!estado.inicial && estado.total < 50) return null
  if (estado.faltam !== undefined) return estado.faltam > 0 ? strings.sincronia.historicoEmFalta(estado.faltam) : null
  if (estado.total > 0) return strings.sincronia.historicoEmFaltaSemNumero
  return estado.razao === "sem-irmao" && estado.inicial ? strings.sincronia.historicoSemIrmao : null
}

/**
 * "Keep this device on": on THIS device, while it sends the
 * history to a device that just paired. The title, the approved line, and the
 * progress. No button: it closes when the new device has everything, or stops
 * asking (the core's `envioCaladoMs`). The photo count joins the line when the
 * new device asks for the media list, after the text.
 */
export function AvisoDoEnvio({ estado }: { estado: HistoricoDosIrmaos | null }): React.JSX.Element | null {
  const envio = estado?.envio
  if (!envio) return null
  const { mensagens, fotografias } = envio
  const texto = strings.sincronia.envioProgresso(
    mensagens.feitas,
    mensagens.total,
    fotografias?.feitas ?? 0,
    fotografias ? fotografias.total : null,
  )
  const nasMensagens = mensagens.feitas < mensagens.total || fotografias === null
  return (
    <div className="barra-sincronia barra-envio" role="status" aria-live="polite">
      <strong className="barra-envio-titulo">{strings.sincronia.envioTitulo}</strong>
      <span className="barra-sincronia-texto">{strings.sincronia.envioCorpo}</span>
      <span className="barra-sincronia-texto barra-envio-progresso">{texto}</span>
      <progress
        className="barra-sincronia-progresso"
        max={nasMensagens ? Math.max(1, mensagens.total) : Math.max(1, fotografias?.total ?? 1)}
        value={nasMensagens ? mensagens.feitas : (fotografias?.feitas ?? 0)}
        aria-label={texto}
      />
    </div>
  )
}
