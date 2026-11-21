import { useEffect, useId, useRef, useState } from "react"
import { copiarTexto } from "../../lib/copiar.js"
import { APARELHOS_MUDARAM } from "../../lib/ficheiroDaConta.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { useBridge } from "../../App.js"
import type { PairEvento } from "../../bridge.js"
import { AvisoDoEnvio, useHistoricoDosIrmaos } from "../../components/BarraDoHistorico.js"
import { Button } from "../../components/Button.js"
import { Modal } from "../../components/Modal.js"
import { PalavrasDoSas } from "../../components/PalavrasDoSas.js"
import { QrCode } from "../../components/QrCode.js"
import { useToast } from "../../components/Toast.js"
import { CopyIcon } from "../../icons.js"
import { strings, translateError, translatePairingError } from "../../strings.js"
import { TypeCode } from "./TypeCode.js"

/**
 * Add a device, from the computer (the side that HAS the account).
 *
 * Opens the vault on the server, shows the QR and the link, waits for the phone,
 * shows the six words, and only after the user says "They match" does the core
 * sign the certificate and publish the manifest. Closing the modal partway
 * cancels: the vault dies on the server and nothing was added.
 *
 * At the end, once, the confirmation text (`doneHostBody`): the new device
 * sees from now on, and what was said before stayed where it was.
 */
type Fase =
  | { que: "a-abrir" }
  | { que: "aguarda"; link: string }
  | { que: "ligado"; link: string }
  | { que: "sas"; palavras: string; confirmado: boolean }
  | { que: "concluido" }
  | { que: "falhou"; razao: string }

export function AcrescentarAparelho({ onClose, onConcluido }: { onClose: () => void; onConcluido?: () => void }): React.JSX.Element {
  const bridge = useBridge()
  const historico = useHistoricoDosIrmaos()
  const toast = useToast()
  const heading = useId()
  const [fase, setFase] = useState<Fase>({ que: "a-abrir" })
  /** The server knows short codes (1.3.26): the new device's code can be typed here. */
  const [knowsShortCode, setKnowsShortCode] = useState(false)
  /** Switching from this QR to a typed code: the QR pairing's "cancelled" is not news. */
  const switchingToCode = useRef(false)
  /** A code was typed: the QR of this screen is no longer the pairing. */
  const [byCode, setByCode] = useState(false)

  useEffect(() => {
    if (!bridge.pairing?.typeCode) return
    void bridge.pairing
      .status()
      .then((status) => setKnowsShortCode(status.serverKnowsShortCode === true))
      .catch(() => {})
  }, [bridge])

  const submitCode = (text: string): void => {
    const typeCode = bridge.pairing?.typeCode
    if (!typeCode) return
    switchingToCode.current = true
    setByCode(true)
    setFase({ que: "a-abrir" })
    typeCode(text).catch((error: Error) => {
      switchingToCode.current = false
      setFase({ que: "falhou", razao: translatePairingError(error.message, error.cause) })
    })
  }

  useEffect(() => {
    if (!bridge.pairing || !bridge.on.pair) {
      setFase({ que: "falhou", razao: translateError("this version of the app cannot do that") })
      return
    }
    let link = ""
    const desligar = bridge.on.pair((evento: PairEvento) => {
      switch (evento.fase) {
        case "aguarda":
          link = evento.link
          setFase({ que: "aguarda", link })
          return
        case "ligado":
          // A typed code is now this pairing: from here its failures are news again.
          switchingToCode.current = false
          setFase({ que: "ligado", link })
          return
        case "sas":
          setFase({ que: "sas", palavras: evento.palavras, confirmado: false })
          return
        case "concluido":
          setFase({ que: "concluido" })
          onConcluido?.()
          // A second device: the account-file banner may go (`App.tsx`).
          window.dispatchEvent(new Event(APARELHOS_MUDARAM))
          return
        case "falhou":
          if (switchingToCode.current && evento.razao === "cancelado") return
          setFase({ que: "falhou", razao: translatePairingError(evento.razao) })
          return
        case "certificado":
        case "code":
          return
      }
    })
    bridge.pairing.host().catch((erro: Error) =>
      // The core rejects either with a `PairFalha` code, or with a `Session` key
      // (no account key, no server, no connection). Both go through the same path
      // and carry the error code.
      setFase({ que: "falhou", razao: translatePairingError(erro.message, erro.cause) }),
    )
    return () => {
      desligar()
      // Closing partway is cancel. After completion or failure there is no vault,
      // and cancel is harmless.
      void bridge.pairing?.cancel().catch(() => {})
    }
    // Once per modal open: reopening the vault on each render was a new QR every second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copiar = (link: string): void => {
    void copiarTexto(link)
      .then(() => toast(strings.juntarAparelho.codigoCopiado, "info"))
      .catch(() => toast(strings.common.copyFailed, "error"))
  }

  const responder = (iguais: boolean): void => {
    if (fase.que !== "sas") return
    if (iguais) {
      setFase({ ...fase, confirmado: true })
      void bridge.pairing?.confirm().catch((erro: Error) => setFase({ que: "falhou", razao: translatePairingError(erro.message, erro.cause) }))
    } else {
      void bridge.pairing?.refuse().catch(() => {})
      setFase({ que: "falhou", razao: translatePairingError("palavras-diferentes") })
    }
  }

  return (
    <Modal className="sheet narrow" labelledBy={heading} onClose={onClose}>
      <header className="sheet-header">
        <h2 id={heading}>{fase.que === "sas" ? strings.juntarAparelho.palavrasTitulo : strings.juntarAparelho.titulo}</h2>
        {/*
         * In the final phases the body already has "Close" as the primary action,
         * in the place the eye goes after reading the outcome. The header one
         * added to that and gave two identical buttons on the same screen, which
         * on a phone reads as two different exits. While pairing is happening
         * the header one is the only exit, and it stays.
         */}
        {fase.que !== "concluido" && fase.que !== "falhou" && (
          <Button variant="ghost" type="button" onClick={onClose}>
            {strings.common.close}
          </Button>
        )}
      </header>

      <div className="sheet-body" aria-live="polite">
        {fase.que === "a-abrir" && <p className="field-note">{strings.common.connectionConnecting}</p>}

        {fase.que === "ligado" && byCode && <p className="field-note" role="status">{strings.common.connectionConnecting}</p>}

        {(fase.que === "aguarda" || (fase.que === "ligado" && !byCode)) && (
          <>
            <p className="field-note">{strings.juntarAparelho.contaLead}</p>
            <QrCode texto={fase.link} alt={strings.juntarAparelho.qrAlt} />
            <div className="emparelhar-link">
              <code data-link={fase.link}>{fase.link}</code>
              <Button variant="ghost" type="button" onClick={() => copiar(fase.link)}>
                <CopyIcon size={15} />
                {strings.juntarAparelho.copiarCodigo}
              </Button>
            </div>
            <p className="field-note" role="status">
              {fase.que === "ligado" ? strings.juntarAparelho.aLigar : strings.juntarAparelho.aEspera}
            </p>
            {/* 1.3.26: or the new device shows a short code, and it is typed here. */}
            {fase.que === "aguarda" && knowsShortCode && <TypeCode onCode={submitCode} />}
          </>
        )}

        {fase.que === "sas" && (
          <>
            <p className="field-note">{strings.juntarAparelho.palavrasNaConta}</p>
            <PalavrasDoSas palavras={fase.palavras} />
            {fase.confirmado ? (
              <p className="field-note" role="status">
                {strings.juntarAparelho.confirmadoAqui}
              </p>
            ) : (
              <div className="sheet-actions sas-actions">
                <Button variant="ghost" type="button" onClick={() => responder(false)}>
                  {strings.juntarAparelho.nao}
                </Button>
                <Button variant="primary" type="button" onClick={() => responder(true)}>
                  {strings.juntarAparelho.sim}
                </Button>
              </div>
            )}
          </>
        )}

        {fase.que === "concluido" && (
          <>
            <p className="field-note">{strings.juntarAparelho.concluido}</p>
            <p className="field-note">{strings.pairing.doneHostBody}</p>
            {/* "Keep this device on", with the progress, right where the pairing ended (16/11/2026). */}
            <AvisoDoEnvio estado={historico} />
            <div className="sheet-actions">
              <Button variant="primary" type="button" onClick={onClose}>
                {strings.common.close}
              </Button>
            </div>
          </>
        )}

        {fase.que === "falhou" && (
          <>
            <p className="field-note warn" role="alert">
              <TextoDeErro texto={fase.razao} />
            </p>
            <div className="sheet-actions">
              <Button variant="primary" type="button" onClick={onClose}>
                {strings.common.close}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
