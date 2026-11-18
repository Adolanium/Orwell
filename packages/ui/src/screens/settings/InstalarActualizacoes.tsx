import { useEffect, useState } from "react"
import { useBridge } from "../../App.js"
import type { ModoDeActualizacao } from "../../bridge.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { strings, traduzirErro } from "../../strings.js"

const MODOS: readonly ModoDeActualizacao[] = ["perguntar", "automaticamente"]

/**
 * "Install updates: Ask first / Automatically", for this device.
 *
 * Only where the app updates itself (the packaged Windows app): the bridge
 * says so (`actualizacao.modo().disponivel`), and anywhere else this draws
 * nothing. The choice is read by the main process at the next start, before
 * any window (`apps/client/src/main/actualizacao-windows.ts`). "Ask first" is
 * the default. Either way a version installs only once it is public on GitHub
 * for 72 hours, and the note says the app contacts GitHub for that.
 */
export function InstalarActualizacoes(): React.JSX.Element | null {
  const bridge = useBridge()
  const ler = bridge.actualizacao?.modo
  const definir = bridge.actualizacao?.definirModo
  const [modo, setModo] = useState<ModoDeActualizacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!ler) return
    let vivo = true
    void ler()
      .then((resposta) => {
        if (vivo && resposta.disponivel) setModo(resposta.modo === "automaticamente" ? "automaticamente" : "perguntar")
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [ler])

  if (modo === null || !definir) return null

  const escolher = (novo: ModoDeActualizacao): void => {
    if (novo === modo) return
    setErro(null)
    void definir(novo)
      .then((resposta) => {
        if (resposta.ok) setModo(novo)
        else setErro(traduzirErro(new Error("could not save the update choice")))
      })
      .catch(() => setErro(traduzirErro(new Error("could not save the update choice"))))
  }

  return (
    <section className="card settings-card">
      <h2>{strings.settings.instalarActualizacoes}</h2>
      <div className="choice-row">
        {MODOS.map((opcao) => (
          <button key={opcao} className={modo === opcao ? "chip on" : "chip"} aria-pressed={modo === opcao} onClick={() => escolher(opcao)}>
            {strings.settings.modosDeActualizacao[opcao]}
          </button>
        ))}
      </div>
      <p className="field-note">{strings.settings.actualizacoesNota}</p>
      {erro && (
        <p className="field-note warn" role="alert">
          <TextoDeErro texto={erro} />
        </p>
      )}
    </section>
  )
}
