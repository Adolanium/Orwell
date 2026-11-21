import { useEffect, useId, useState } from "react"
import { useBridge } from "../../App.js"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { Modal } from "../../components/Modal.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { strings, traduzirErro } from "../../strings.js"
import { CampoDeIdentidade } from "../gate/CampoDeIdentidade.js"
import { fraseDoCampo } from "../gate/fraseDoCampo.js"
import { MINIMO_DA_PALAVRA_PASSE } from "../gate/Setup.js"
import { AcrescentarAparelho } from "./AcrescentarAparelho.js"
import { Aparelhos } from "./Aparelhos.js"

/**
 * Configurações › Conta e segurança (mock-up `Voltar`, 21/11/2026).
 *
 * Everything that is about the account, in one list: change the password, save
 * the account file, the devices, add a device. Each row opens its own screen
 * or sheet. "Apagar a conta" stays below, in the danger zone, with its own
 * confirmation: it is the only place in the app that deletes an account.
 */
export function ContaESeguranca({
  onGuardarFicheiro,
  podeGuardar,
}: {
  /** Opens the account-file sheet of Settings (with "include images"). */
  onGuardarFicheiro: () => void
  /** False on an old paired device without the account key: its file would not be the account. */
  podeGuardar: boolean
}): React.JSX.Element {
  const bridge = useBridge()
  const [vista, setVista] = useState<"lista" | "aparelhos">("lista")
  const [aMudar, setAMudar] = useState(false)
  const [aJuntar, setAJuntar] = useState(false)
  const [quantos, setQuantos] = useState<number | null>(null)
  const [podeJuntar, setPodeJuntar] = useState(false)
  const [temFrase, setTemFrase] = useState(false)

  useEffect(() => {
    let vivo = true
    void bridge.pairing
      ?.devices()
      .then((lista) => vivo && setQuantos(lista?.length ?? null))
      .catch(() => {})
    void bridge.pairing
      ?.status()
      .then((estado) => vivo && setPodeJuntar(estado.temChaveDeConta && estado.servidorSuporta))
      .catch(() => {})
    void Promise.resolve()
      .then(() => bridge.vault.status())
      .then((estado) => vivo && setTemFrase(estado?.protection === "passphrase"))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [bridge, vista, aJuntar])

  if (vista === "aparelhos") {
    return (
      <>
        <button type="button" className="gate-voltar conta-voltar" onClick={() => setVista("lista")}>
          <span aria-hidden="true">‹</span> {strings.contaESeguranca.titulo}
        </button>
        <Aparelhos />
      </>
    )
  }

  const podeMudar = temFrase && bridge.vault.mudarPalavraPasse !== undefined

  return (
    <>
      <section className="card settings-card conta-e-seguranca">
        <h2>{strings.contaESeguranca.titulo}</h2>
        <ul className="conta-lista">
          {podeMudar && (
            <li>
              <button type="button" className="conta-linha" onClick={() => setAMudar(true)}>
                <span>{strings.contaESeguranca.mudar}</span>
                <span className="conta-seta" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          )}
          {podeGuardar && (
            <li>
              <button type="button" className="conta-linha" onClick={onGuardarFicheiro}>
                <span>{strings.contaESeguranca.guardarFicheiro}</span>
                <span className="conta-seta" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          )}
          <li>
            <button type="button" className="conta-linha" onClick={() => setVista("aparelhos")}>
              <span>{strings.contaESeguranca.aparelhos}</span>
              <span className="conta-seta">
                {quantos !== null && <span className="conta-contagem">{quantos}</span>}
                <span aria-hidden="true"> ›</span>
              </span>
            </button>
          </li>
          {podeJuntar && (
            <li>
              <button type="button" className="conta-linha" onClick={() => setAJuntar(true)}>
                <span>{strings.contaESeguranca.juntar}</span>
                <span className="conta-seta" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          )}
        </ul>
        {/* An old paired device has no account key: its file would not be the account. Say where it is saved. */}
        {!podeGuardar && <p className="field-note">{strings.settings.exportNeedsAccountKey}</p>}
      </section>
      {aMudar && <MudarPalavraPasse onFechar={() => setAMudar(false)} onGuardarFicheiro={podeGuardar ? onGuardarFicheiro : undefined} />}
      {aJuntar && <AcrescentarAparelho onClose={() => setAJuntar(false)} />}
    </>
  )
}

/**
 * "Mudar a palavra-passe" (1.3.26, `Vault.mudarPalavraPasse`): the current one,
 * the new one twice. Files saved before keep opening with the old one, so the
 * sheet offers a new file right after.
 */
export function MudarPalavraPasse({
  onFechar,
  onGuardarFicheiro,
}: {
  onFechar: () => void
  onGuardarFicheiro?: (() => void) | undefined
}): React.JSX.Element {
  const bridge = useBridge()
  const titulo = useId()
  const [erro, setErro] = useState<string | null>(null)
  const [aGravar, setAGravar] = useState(false)
  const [mudada, setMudada] = useState(false)
  /** "I forgot the current password" (S4): the open vault is the proof, no current password field. */
  const [forgot, setForgot] = useState(false)
  const changeWithOpenVault = bridge.vault.changePasswordWithOpenVault

  /* Reads the FIELDS, not React state: a password manager writes here too, sometimes without an event. */
  const mudar = (formulario: HTMLFormElement): void => {
    const comActual = bridge.vault.mudarPalavraPasse
    const fazer = forgot
      ? changeWithOpenVault && ((_actual: string, nova: string) => changeWithOpenVault(nova))
      : comActual
    if (aGravar || !fazer) return
    const actual = forgot ? "" : fraseDoCampo(formulario, "current-password", "")
    const nova = fraseDoCampo(formulario, "new-password", "")
    const outraVez = fraseDoCampo(formulario, "confirm-password", "")
    if (nova.length < MINIMO_DA_PALAVRA_PASSE) {
      setErro(strings.entrada.curta)
      return
    }
    if (nova !== outraVez) {
      setErro(strings.entrada.diferentes)
      return
    }
    setErro(null)
    setAGravar(true)
    void fazer(actual, nova)
      .then(() => setMudada(true))
      .catch((caught: Error) => setErro(traduzirErro(caught)))
      .finally(() => setAGravar(false))
  }

  return (
    <Modal className="sheet narrow" labelledBy={titulo} onClose={onFechar}>
      <header className="sheet-header">
        <h2 id={titulo}>{strings.contaESeguranca.mudar}</h2>
        <Button variant="ghost" type="button" onClick={onFechar}>
          {strings.common.close}
        </Button>
      </header>
      <div className="sheet-body">
        {mudada ? (
          <>
            <p className="field-note" role="status">
              {strings.contaESeguranca.mudada}
            </p>
            <p className="field-note">{strings.contaESeguranca.nota}</p>
            {onGuardarFicheiro && (
              <Button
                variant="primary"
                type="button"
                onClick={() => {
                  onFechar()
                  onGuardarFicheiro()
                }}
              >
                {strings.contaESeguranca.guardarNovo}
              </Button>
            )}
          </>
        ) : (
          <form
            className="entrada-formulario"
            onSubmit={(event) => {
              event.preventDefault()
              mudar(event.currentTarget)
            }}
          >
            <CampoDeIdentidade />
            {forgot ? (
              <p className="field-note">{strings.contaESeguranca.forgotCurrentNote}</p>
            ) : (
              <>
                <Field label={strings.contaESeguranca.actual}>
                  <input type="password" name="current-password" autoComplete="current-password" autoFocus />
                </Field>
                {changeWithOpenVault && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setForgot(true)
                      setErro(null)
                    }}
                  >
                    {strings.contaESeguranca.forgotCurrent}
                  </Button>
                )}
              </>
            )}
            <Field label={strings.contaESeguranca.nova}>
              <input type="password" name="new-password" autoComplete="new-password" autoFocus={forgot} />
            </Field>
            <Field label={strings.contaESeguranca.novaOutraVez}>
              <input type="password" name="confirm-password" autoComplete="new-password" />
            </Field>
            {erro && (
              <p className="error" role="alert">
                <TextoDeErro texto={erro} />
              </p>
            )}
            <p className="field-note">{strings.contaESeguranca.nota}</p>
            <Button variant="primary" type="submit" disabled={aGravar}>
              {strings.contaESeguranca.mudar}
            </Button>
          </form>
        )}
      </div>
    </Modal>
  )
}
