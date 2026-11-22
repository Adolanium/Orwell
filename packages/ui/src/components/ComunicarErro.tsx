import { useEffect, useId, useState } from "react"
import { DESCRICAO_DO_BUG_MAX, type DetalhesDoBug } from "@enclave/protocol"
import type { ConnectionState, EnclaveBridge } from "../bridge.js"
import { detalhesDoBug } from "../lib/detalhesDoBug.js"
import { diagnosticsSnapshot } from "../lib/diagnostics.js"
import { formatStamp } from "../lib/format.js"
import { fittingLog, reportLog, withReportLog } from "../lib/reportLog.js"
import { strings, traduzirErro } from "../strings.js"
import { Button } from "./Button.js"
import { Field } from "./Field.js"
import { Modal } from "./Modal.js"
import { TextoDeErro } from "./TextoDeErro.js"

/**
 * Whether this host and this server take bug reports. `false` until the server
 * answers, and on an old server or an old `preload`: then the button does not exist.
 */
export function useComunicarErro(bridge: EnclaveBridge | undefined, connection?: ConnectionState): boolean {
  const [suportado, setSuportado] = useState(false)
  useEffect(() => {
    let vivo = true
    void bridge?.bugs
      ?.suportado()
      .then((sim) => vivo && setSuportado(sim))
      .catch(() => vivo && setSuportado(false))
    return () => {
      vivo = false
    }
  }, [bridge, connection])
  return suportado
}

/**
 * "Report a bug" (12/11/2026): the description, the technical details, and the
 * choice to be contacted.
 *
 * **The list under the box is what goes, word for word.** It is built from the
 * same object that is sent (`detalhesDoBug`), so it cannot say one thing and send
 * another. Unchecking the box sends none of it. The address goes only with
 * "Let us contact you", and the server stores it only then.
 */
export function ComunicarErro({
  bridge,
  connection,
  onClose,
  initialText = "",
}: {
  bridge: EnclaveBridge
  connection: ConnectionState
  onClose: () => void
  /** What the box starts with: the crash, from the crash card. */
  initialText?: string | undefined
}): React.JSX.Element {
  const heading = useId()
  const t = strings.comunicarErro
  const [descricao, setDescricao] = useState(() => initialText.slice(0, DESCRICAO_DO_BUG_MAX))
  // Read once, when the form opens: what it shows is what it sends.
  const [logLines] = useState(() => reportLog(diagnosticsSnapshot()))
  const [comDetalhes, setComDetalhes] = useState(true)
  const [contacto, setContacto] = useState(false)
  const [detalhes, setDetalhes] = useState<DetalhesDoBug | null>(null)
  const [aEnviar, setAEnviar] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void detalhesDoBug(bridge, connection).then((lidos) => vivo && setDetalhes(lidos))
    return () => {
      vivo = false
    }
  }, [bridge, connection])

  const enviar = async (): Promise<void> => {
    if (!bridge.bugs || descricao.trim() === "" || aEnviar) return
    setAEnviar(true)
    setErro(null)
    try {
      await bridge.bugs.enviar({
        v: 1,
        descricao: withReportLog(descricao.trim(), comDetalhes ? logLines : [], DESCRICAO_DO_BUG_MAX),
        ...(comDetalhes && detalhes ? { detalhes } : {}),
        contacto,
      })
      setEnviado(true)
    } catch (falha) {
      setErro(traduzirErro(falha))
    } finally {
      setAEnviar(false)
    }
  }

  const logShown = comDetalhes ? fittingLog(logLines, DESCRICAO_DO_BUG_MAX - descricao.trim().length) : ""

  return (
    <Modal
      className="sheet narrow comunicar-erro"
      labelledBy={heading}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        void enviar()
      }}
    >
      <header className="sheet-header">
        <h2 id={heading}>{t.titulo}</h2>
        <Button variant="ghost" type="button" onClick={onClose}>
          {t.fechar}
        </Button>
      </header>

      <div className="sheet-body">
        {enviado ? (
          <p className="field-note" role="status">
            {t.enviado}
          </p>
        ) : (
          <>
            <Field label={t.descricao}>
              <textarea
                value={descricao}
                maxLength={DESCRICAO_DO_BUG_MAX}
                rows={5}
                required
                onChange={(event) => setDescricao(event.target.value)}
              />
            </Field>
            <p className="field-note">{t.descricaoAjuda}</p>

            <label className="checkbox" htmlFor={`${heading}-detalhes`}>
              <input id={`${heading}-detalhes`} type="checkbox" checked={comDetalhes} onChange={(event) => setComDetalhes(event.target.checked)} />
              {t.detalhes}
            </label>
            {comDetalhes && detalhes && (
              <div className="comunicar-erro-lista">
                <p className="field-note">{t.oQueVai}</p>
                <ul>
                  <li>{t.versao(detalhes.versao)}</li>
                  <li>{t.plataforma(detalhes.plataforma)}</li>
                  <li>{t.sistema(detalhes.sistema, detalhes.browser)}</li>
                  <li>{t.lingua(detalhes.lingua)}</li>
                  <li>
                    {t.erros(detalhes.erros.length)}
                    {detalhes.erros.length > 0 && (
                      <ul>
                        {detalhes.erros.map((mostrado, indice) => (
                          <li key={indice}>
                            {strings.errors.codigo(mostrado.codigo)}, {formatStamp(mostrado.em)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                  <li>{t.ligacao(detalhes.ligacao)}</li>
                  <li>{t.sincronia(detalhes.sincronia)}</li>
                </ul>
              </div>
            )}
            {logShown !== "" && (
              <div className="comunicar-erro-lista">
                <p className="field-note">{t.registo}</p>
                <pre className="comunicar-erro-registo" tabIndex={0}>
                  {logShown}
                </pre>
              </div>
            )}
            <p className="field-note">{t.nuncaVai}</p>

            <label className="checkbox" htmlFor={`${heading}-contacto`}>
              <input id={`${heading}-contacto`} type="checkbox" checked={contacto} onChange={(event) => setContacto(event.target.checked)} />
              {t.contacto}
            </label>
            <p className="field-note">{t.contactoAjuda}</p>
          </>
        )}
        {erro !== null && (
          <p className="field-note warn" role="alert">
            <TextoDeErro texto={erro} />
          </p>
        )}
      </div>

      <div className="sheet-actions">
        {enviado ? (
          <Button variant="primary" type="button" onClick={onClose}>
            {t.fechar}
          </Button>
        ) : (
          <Button variant="primary" type="submit" disabled={aEnviar || descricao.trim() === ""}>
            {aEnviar ? t.aEnviar : t.enviar}
          </Button>
        )}
      </div>
    </Modal>
  )
}
