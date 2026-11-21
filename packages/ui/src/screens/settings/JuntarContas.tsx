import { useEffect, useId, useRef, useState } from "react"
import { parsePairLink } from "@enclave/client-core"
import { useBridge } from "../../App.js"
import type { PairEvento } from "../../bridge.js"
import { Button } from "../../components/Button.js"
import { ApagarConta } from "../../components/ConfirmarDestruicao.js"
import { Field } from "../../components/Field.js"
import { LeitorQr } from "../../components/LeitorQr.js"
import { Modal } from "../../components/Modal.js"
import { PalavrasDoSas } from "../../components/PalavrasDoSas.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { strings, translateError, translatePairingError, traduzirErro } from "../../strings.js"
import { CampoDeIdentidade } from "../gate/CampoDeIdentidade.js"
import { fraseDoCampo } from "../gate/fraseDoCampo.js"

/**
 * "Merge with other account" (phase 8.2 of 0.9), in Devices, on the device of the
 * additional account.
 *
 * People create a new account just because they change
 * devices. The rule: **merge friends and channels, and merge nothing else; the
 * secondary account is destroyed and hidden from all spaces.** Two keys do not merge into one.
 * This is what happens, in this order:
 *
 *  1. **Pair** this device with the primary account (the QR or the link as always,
 *     six words on both screens). The certificate stays in memory: the vault
 *     remains this account's.
 *  2. **Alert.** Using this account's key, send "this account is now @primary"
 *     to each direct chat and each channel; then break friendships and leave
 *     all channels.
 *  3. **Delete.** The vault becomes the primary account's, and this account's key
 *     leaves the device. There is no archive of the old account.
 *
 * If pairing fails, nothing alerts and nothing deletes: steps 2 and 3 only start
 * after the certificate. If step 2 cannot leave all channels, step 3 does not run
 * and the account stays (as in "Delete account").
 *
 * The "delete" confirmation is asked before starting, as in other deletions
 * (`DeleteAccount`). Closing the sheet before step 2 changed nothing.
 */
type Passo = "explicar" | "link" | "emparelhar" | "password" | "avisar" | "apagar"

type Fase =
  | { que: "a-ligar" }
  | { que: "a-espera" }
  | { que: "sas"; palavras: string; confirmado: boolean }
  | { que: "estado" }
  | { que: "feito"; address: string }
  /** `locked`: step 3 failed and the vault stayed locked; only restart is possible. */
  | { que: "falhou"; razao: string; trancado: boolean }

export function JuntarContas({ onClose, onDone }: { onClose: () => void; onDone: () => void }): React.JSX.Element {
  const bridge = useBridge()
  const heading = useId()
  const [passo, setPasso] = useState<Passo>("explicar")
  const [fase, setFase] = useState<Fase>({ que: "a-ligar" })
  const [link, setLink] = useState("")
  const [aLer, setALer] = useState(false)
  const [erroDoLink, setErroDoLink] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState("")
  const [confirm, setConfirm] = useState("")
  // F3 of session memory: a new account is ALWAYS born with a password.
  // The vault from keychain only (`os`) stopped being offered: with it,
  // "Sign out" didn't sign anyone out. The ones that already exist convert to
  // Account > Session > "Set password".
  const useOs = false
  const [erroDaChave, setErroDaChave] = useState<string | null>(null)
  /** "apagar" asked, at the start: the pairing begins only after it. */
  const [aApagar, setAApagar] = useState(false)
  /** The main account sent its password record ("conta"), or not ("nova"): see `Session.joinCheckPassword`. */
  const [passwordKind, setPasswordKind] = useState<"conta" | "nova">("conta")
  const [checking, setChecking] = useState(false)
  /** The phrase that step 3 uses. In a ref: the `certificate` event arrives outside render. */
  const frase = useRef<string | null>(null)
  /** Step 2 has started: from here on, closing does not cancel anything. */
  const semVolta = useRef(false)
  const pairing = bridge.pairing

  /** Steps 2 and 3, one after the other, after the certificate. */
  const avisarEApagar = async (): Promise<void> => {
    if (!pairing?.juntarAvisar || !pairing.juntarTrocar) return
    semVolta.current = true
    setPasso("avisar")
    try {
      await pairing.juntarAvisar()
    } catch (erro) {
      semVolta.current = false
      await pairing.juntarCancelar?.().catch(() => {})
      setFase({ que: "falhou", razao: traduzirErro(erro as Error), trancado: false })
      setPasso("emparelhar")
      return
    }
    setPasso("apagar")
    try {
      const { address } = await pairing.juntarTrocar(frase.current)
      setFase({ que: "feito", address })
    } catch (erro) {
      setFase({ que: "falhou", razao: traduzirErro(erro as Error), trancado: true })
    }
  }
  const avisarEApagarRef = useRef(avisarEApagar)
  avisarEApagarRef.current = avisarEApagar

  /** Listen to the core while pairing. */
  useEffect(() => {
    if (passo !== "emparelhar" || !bridge.on.pair) return
    return bridge.on.pair((evento: PairEvento) => {
      switch (evento.fase) {
        case "ligado":
          setFase({ que: "a-espera" })
          return
        case "sas":
          setFase({ que: "sas", palavras: evento.palavras, confirmado: false })
          return
        case "estado":
          setFase({ que: "estado" })
          return
        case "certificado":
          // One password on every device (1.3.26): the main account's password first, then the goodbye.
          setPasswordKind(evento.palavraPasse ?? "nova")
          setErroDaChave(null)
          setPasso("password")
          return
        case "falhou":
          setFase({ que: "falhou", razao: translatePairingError(evento.razao), trancado: false })
          return
        default:
          return
      }
    })
  }, [passo, bridge])

  // Leaving mid step 1 drops the pairing. After step 2 there is no going back.
  useEffect(() => {
    return () => {
      if (!semVolta.current) void bridge.pairing?.juntarCancelar?.().catch(() => {})
    }
  }, [bridge])

  const aceitarLink = (texto: string): void => {
    if (!parsePairLink(texto)) {
      setErroDoLink(strings.pairing.linkInvalid)
      return
    }
    setErroDoLink(null)
    setLink(texto.trim())
    setALer(false)
    setAApagar(true)
  }

  /** Same as `Pair`: read the FIELDS, which the manager may have filled. */
  /**
   * The main account's password, checked before step 2 (which leaves the channels
   * and has no way back). A wrong one is Error 140 by the field, and the step stays.
   */
  const confirmPassword = (formulario: HTMLFormElement | null): void => {
    if (checking) return
    const written = fraseDoCampo(formulario, passwordKind === "conta" ? "current-password" : "new-password", passphrase)
    if (passwordKind === "nova") {
      if (written.length < 8) return setErroDaChave(strings.entrada.curta)
      if (written !== fraseDoCampo(formulario, "confirm-password", confirm)) return setErroDaChave(strings.entrada.diferentes)
    } else if (written.length === 0) return
    setErroDaChave(null)
    setChecking(true)
    void Promise.resolve(pairing?.joinCheckPassword?.(written))
      .then(() => {
        frase.current = useOs ? null : written
        void avisarEApagarRef.current()
      })
      .catch((erro: Error) => setErroDaChave(traduzirErro(erro)))
      .finally(() => setChecking(false))
  }

  const iniciar = (): void => {
    setPasso("emparelhar")
    setFase({ que: "a-ligar" })
    if (!pairing?.juntar) {
      setFase({ que: "falhou", razao: translateError("this version of the app cannot do that"), trancado: false })
      return
    }
    void pairing.juntar(link).catch((erro: Error) =>
      setFase({ que: "falhou", razao: translatePairingError(erro.message, erro.cause), trancado: false }),
    )
  }

  const responderSas = (iguais: boolean): void => {
    if (fase.que !== "sas") return
    if (iguais) {
      setFase({ ...fase, confirmado: true })
      void pairing?.confirm().catch((erro: Error) =>
        setFase({ que: "falhou", razao: translatePairingError(erro.message, erro.cause), trancado: false }),
      )
    } else {
      void pairing?.refuse().catch(() => {})
      setFase({ que: "falhou", razao: translatePairingError("palavras-diferentes"), trancado: false })
    }
  }

  const tentarDeNovo = (): void => {
    void (async () => {
      await pairing?.juntarCancelar?.().catch(() => {})
      setFase({ que: "a-ligar" })
      setPasso("link")
    })()
  }

  /** Close: only before step 2. During steps 2 and 3 the sheet stays. */
  const fechar = (): void => {
    if (passo === "avisar" || passo === "apagar") {
      if (fase.que === "falhou" && fase.trancado) onDone()
      else if (fase.que === "feito") onDone()
      return
    }
    onClose()
  }

  return (
    <Modal className="sheet narrow juntar-contas" labelledBy={heading} onClose={fechar}>
      <header className="sheet-header">
        <h2 id={heading}>{strings.juntar.titulo}</h2>
        {passo !== "avisar" && passo !== "apagar" && (
          <Button variant="ghost" type="button" onClick={onClose}>
            {strings.common.close}
          </Button>
        )}
      </header>
      <div className="sheet-body" aria-live="polite">
        {passo === "explicar" && (
          <>
            <p className="gate-lead">{strings.juntar.lead}</p>
            <p className="field-note">{strings.juntar.passa}</p>
            <p className="field-note warn">{strings.juntar.naoPassa}</p>
            <p className="field-note">{strings.juntar.assinado}</p>
            <p className="field-note">{strings.juntar.passos}</p>
            <div className="setup-actions">
              <Button variant="ghost" type="button" onClick={onClose}>
                {strings.entrada.voltar}
              </Button>
              <Button variant="primary" type="button" onClick={() => setPasso("link")}>
                {strings.juntar.comecar}
              </Button>
            </div>
          </>
        )}

        {passo === "link" && (
          <>
            <p className="gate-lead">{strings.pairing.joinLead}</p>
            {aLer ? (
              <LeitorQr onLido={aceitarLink} onCancelar={() => setALer(false)} />
            ) : (
              <Button variant="primary" type="button" onClick={() => setALer(true)}>
                {strings.pairing.scan}
              </Button>
            )}
            <form
              className="emparelhar-colar"
              onSubmit={(event) => {
                event.preventDefault()
                aceitarLink(link)
              }}
            >
              <Field label={strings.pairing.pasteLabel}>
                <input
                  value={link}
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={erroDoLink ? true : undefined}
                  onChange={(event) => {
                    setLink(event.target.value)
                    setErroDoLink(null)
                  }}
                />
              </Field>
              {erroDoLink && (
                <p className="error" role="alert">
                  {erroDoLink}
                </p>
              )}
              <div className="setup-actions">
                <Button variant="ghost" type="button" onClick={() => setPasso("explicar")}>
                  {strings.entrada.voltar}
                </Button>
                <Button variant="primary" type="submit" disabled={link.trim().length === 0}>
                  {strings.pairing.pasteAction}
                </Button>
              </div>
            </form>
          </>
        )}

        {passo === "password" && (
          <form
            className="entrada-formulario"
            onSubmit={(event) => {
              event.preventDefault()
              confirmPassword(event.currentTarget)
            }}
          >
            {/* The same name that the gate asks the manager to fill. See `CampoDeIdentidade`. */}
            <CampoDeIdentidade />
            <Field label={strings.juntarAparelho.palavraPasseDaConta}>
              <input
                type="password"
                name={passwordKind === "conta" ? "current-password" : "new-password"}
                autoComplete={passwordKind === "conta" ? "current-password" : "new-password"}
                value={passphrase}
                autoFocus
                disabled={checking}
                aria-invalid={erroDaChave ? true : undefined}
                onChange={(event) => {
                  setPassphrase(event.target.value)
                  setErroDaChave(null)
                }}
              />
            </Field>
            {passwordKind === "nova" && (
              <Field label={strings.entrada.palavraPasseOutraVez}>
                <input
                  type="password"
                  name="confirm-password"
                  value={confirm}
                  autoComplete="new-password"
                  disabled={checking}
                  onChange={(event) => {
                    setConfirm(event.target.value)
                    setErroDaChave(null)
                  }}
                />
              </Field>
            )}
            {erroDaChave ? (
              <p className="error" role="alert">
                <TextoDeErro texto={erroDaChave} />
              </p>
            ) : (
              passwordKind === "nova" && <p className="field-note">{strings.entrada.minimo}</p>
            )}
            <div className="setup-actions">
              <Button variant="primary" type="submit" disabled={checking}>
                {strings.juntarAparelho.continuar}
              </Button>
            </div>
          </form>
        )}

        {passo === "emparelhar" && (
          <>
            {(fase.que === "a-ligar" || fase.que === "a-espera" || fase.que === "estado") && (
              <p className="gate-lead">
                {fase.que === "a-ligar"
                  ? strings.pairing.connecting
                  : fase.que === "a-espera"
                    ? strings.pairing.waitingHost
                    : strings.pairing.receivingState}
              </p>
            )}
            {fase.que === "sas" && (
              <>
                <p className="gate-lead">{strings.pairing.sasLead}</p>
                <PalavrasDoSas palavras={fase.palavras} />
                {fase.confirmado ? (
                  <p className="field-note" role="status">
                    {strings.pairing.sasConfirmedHere}
                  </p>
                ) : (
                  <div className="setup-actions sas-actions">
                    <Button variant="ghost" type="button" onClick={() => responderSas(false)}>
                      {strings.pairing.sasDifferent}
                    </Button>
                    <Button variant="primary" type="button" onClick={() => responderSas(true)}>
                      {strings.pairing.sasSame}
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {passo === "avisar" && fase.que !== "falhou" && (
          <p className="gate-lead" role="status">
            {strings.juntar.avisando}
          </p>
        )}
        {passo === "apagar" && fase.que !== "falhou" && fase.que !== "feito" && (
          <p className="gate-lead" role="status">
            {strings.juntar.apagando}
          </p>
        )}

        {fase.que === "feito" && (
          <>
            <h3>{strings.juntar.feitoTitulo}</h3>
            <p className="gate-lead">{strings.juntar.feito(fase.address)}</p>
            <p className="field-note">{strings.juntar.feitoNota}</p>
            <div className="setup-actions">
              <Button variant="primary" type="button" onClick={onDone}>
                {strings.juntar.continuar}
              </Button>
            </div>
          </>
        )}

        {fase.que === "falhou" && (
          <>
            <p className="error" role="alert">
              <TextoDeErro texto={fase.razao} />
            </p>
            <div className="setup-actions">
              {fase.trancado ? (
                <Button variant="primary" type="button" onClick={onDone}>
                  {strings.juntar.voltarAoInicio}
                </Button>
              ) : (
                <>
                  <Button variant="ghost" type="button" onClick={onClose}>
                    {strings.entrada.voltar}
                  </Button>
                  <Button variant="primary" type="button" onClick={tentarDeNovo}>
                    {strings.common.retry}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {aApagar && (
        <ApagarConta
          porta="juntar"
          onClose={() => setAApagar(false)}
          fazer={async () => {
            // The "delete" is authorization; the act is step 3, after the certificate and the password.
            setAApagar(false)
            iniciar()
          }}
        />
      )}
    </Modal>
  )
}
