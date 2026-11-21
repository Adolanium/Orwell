import { useCallback, useEffect, useRef, useState } from "react"
import { ERRO_NAO_E_A_PALAVRA_PASSE_DA_CONTA, parsePairLink } from "@enclave/client-core"
import { useBridge } from "../../App.js"
import type { PairEvento } from "../../bridge.js"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { LeitorQr } from "../../components/LeitorQr.js"
import { PalavrasDoSas } from "../../components/PalavrasDoSas.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { strings, translateError, translatePairingError, traduzirErro } from "../../strings.js"
import { CampoDeIdentidade } from "./CampoDeIdentidade.js"
import { CartaoDoPortao } from "./Entrada.js"
import { fraseDoCampo } from "./fraseDoCampo.js"
import { NewDeviceCode } from "./NewDeviceCode.js"
import { defaultServer, MINIMO_DA_PALAVRA_PASSE } from "./Setup.js"

/**
 * "Entrar com outro aparelho", on the new device (mock-up `Emparelhar`, 21/11/2026).
 *
 *  1. **The code.** "No aparelho onde tens a conta, abre Configurações › Juntar
 *     um aparelho." That device shows a QR code: this one reads it with the
 *     camera, or the person pastes the code.
 *  2. **The words.** Both screens show the same three words, and the person
 *     says "Sim, juntar o aparelho" on both. Only then does the certificate
 *     come.
 *  3. **"Estás dentro"**, with the account password, and "Abrir o Orwell".
 *
 * The protocol is the one from before (`emparelhar.ts`): the device with the
 * account makes the secret and shows it as a QR code.
 *
 * **Or this device shows a short code** (1.3.26, `pairing-pake`). "Show a code
 * on this device" opens a box on this device's server and shows "K7P · 4QM"
 * with its QR (`NewDeviceCode`). The person types it, or reads it, on the
 * device with the account (`TypeCode`), and CPace makes the box key from the
 * code. From the words on, both paths are the same.
 *
 * **The account password after pairing** (1.3.26, one password on all devices).
 * The vault of this attempt is provisional, in memory and with no password
 * (`vault.createProvisionalToSeal`). After the certificate, "Estás dentro" asks
 * for the account password and `pairing.seal` checks it against the record the
 * other device sent: a wrong one is Erro 140, and the step stays. When the other
 * device sent no record (an older version, or a vault with no password), the
 * person chooses the account password here, typed twice. Only then does the vault
 * reach the disk (`pairing.done`) and the app open.
 *
 * No path here deletes an account: the gate only opens this screen on a device
 * with no vault (`outraEntrada.ts`), and the provisional vault leaves with
 * `pairing.cancel`.
 */
type Fase =
  | { que: "codigo" }
  | { que: "a-ligar" }
  /** Short code (1.3.26): this device shows the code and waits for the other to type it. */
  | { que: "code"; code: string; link: string }
  | { que: "sas"; palavras: string; confirmado: boolean }
  | { que: "a-receber" }
  | { que: "dentro"; tipo: "conta" | "nova"; semEstado: boolean }
  | { que: "falhou"; razao: string }

export function Emparelhar({
  linkInicial,
  onDone,
  onBack,
}: {
  /** The code the page opened with, if it opened with one. */
  linkInicial?: string | null
  onDone: (address: string) => void
  onBack: () => void
}): React.JSX.Element {
  const bridge = useBridge()
  const [fase, setFase] = useState<Fase>({ que: "codigo" })
  const [link, setLink] = useState(linkInicial ?? "")
  const [aLer, setALer] = useState(false)
  const [erroDoLink, setErroDoLink] = useState<string | null>(null)
  const [frase, setFrase] = useState("")
  const [outraVez, setOutraVez] = useState("")
  const [erroDaFrase, setErroDaFrase] = useState<string | null>(null)
  const [aAbrir, setAAbrir] = useState(false)
  /** The typed password was not the account's (Erro 140): show the way out. */
  const [notAccountPassword, setNotAccountPassword] = useState(false)
  /** The account is on disk (`pairing.done`): leaving no longer cancels anything. */
  const concluido = useRef(false)

  /** Listens to the core while pairing. */
  useEffect(() => {
    if (fase.que === "codigo" || fase.que === "falhou" || !bridge.on.pair) return
    const desligar = bridge.on.pair((evento: PairEvento) => {
      switch (evento.fase) {
        case "code":
          setFase({ que: "code", code: evento.code, link: evento.link })
          return
        case "ligado":
          // The other device found the code: the words come next.
          setFase((agora) => (agora.que === "code" ? { que: "a-ligar" } : agora))
          return
        case "sas":
          setFase({ que: "sas", palavras: evento.palavras, confirmado: false })
          return
        case "estado":
          setFase({ que: "a-receber" })
          return
        case "certificado":
          setErroDaFrase(null)
          setFase({ que: "dentro", tipo: evento.palavraPasse ?? "nova", semEstado: evento.estado === "em-falta" })
          return
        case "falhou":
          setFase({ que: "falhou", razao: translatePairingError(evento.razao) })
          return
        default:
          return
      }
    })
    return desligar
    // Subscribed once per pairing, not once per phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase.que === "codigo" || fase.que === "falhou", bridge])

  const comecar = (codigo: string): void => {
    if (!parsePairLink(codigo)) {
      setErroDoLink(strings.juntarAparelho.codigoInvalido)
      return
    }
    setErroDoLink(null)
    setLink(codigo.trim())
    setALer(false)
    const pairing = bridge.pairing
    const criarPorSelar = bridge.vault.createProvisionalToSeal
    if (!pairing || !criarPorSelar) {
      // An older host: better not to pair than to end up without an account.
      setFase({ que: "falhou", razao: translateError("this version of the app cannot do that") })
      return
    }
    setFase({ que: "a-ligar" })
    void (async () => {
      const { exists } = await bridge.vault.status()
      if (exists) throw new Error("this vault already holds an account")
      // Provisional, in memory: the disk changes only at `pairing.done`.
      await criarPorSelar()
      await pairing.join(codigo.trim())
    })().catch((erro: Error) => setFase({ que: "falhou", razao: translatePairingError(erro.message, erro.cause) }))
  }

  /**
   * "Show a code on this device" (1.3.26): the same provisional vault as with a
   * QR, then a short code on this device's server instead of the other's QR.
   */
  const mostrarCodigo = (): void => {
    const pairing = bridge.pairing
    const criarPorSelar = bridge.vault.createProvisionalToSeal
    if (!pairing?.showCode || !criarPorSelar) {
      setFase({ que: "falhou", razao: translateError("this version of the app cannot do that") })
      return
    }
    const showCode = pairing.showCode
    setErroDoLink(null)
    setALer(false)
    setFase({ que: "a-ligar" })
    void (async () => {
      const { exists } = await bridge.vault.status()
      if (exists) throw new Error("this vault already holds an account")
      await criarPorSelar()
      await showCode(defaultServer())
    })().catch((erro: Error) => setFase({ que: "falhou", razao: translatePairingError(erro.message, erro.cause) }))
  }

  // A page opened with the code goes straight on.
  const comecou = useRef(false)
  useEffect(() => {
    if (comecou.current || !linkInicial) return
    comecou.current = true
    comecar(linkInicial)
    // Once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Leave this attempt without a trace: the provisional vault leaves with the pairing. */
  const abandonar = useCallback(async (): Promise<void> => {
    if (concluido.current) return
    await bridge.pairing?.cancel().catch(() => {})
  }, [bridge])

  const sair = (): void => {
    void abandonar().then(onBack, onBack)
  }

  // And on unmount: closing the tab, reloading, the shell switching screens.
  const abandonarRef = useRef(abandonar)
  abandonarRef.current = abandonar
  useEffect(() => {
    return () => {
      void abandonarRef.current()
    }
  }, [])

  const tentarDeNovo = (): void => {
    void abandonar().then(() => setFase({ que: "codigo" }))
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

  /**
   * "Abrir o Orwell": seal the vault with the account password, then save it and
   * open. Reads the FIELDS: a password manager can fill them without an event.
   */
  const abrir = (formulario: HTMLFormElement | null): void => {
    if (fase.que !== "dentro" || aAbrir) return
    const { tipo } = fase
    const escrita = fraseDoCampo(formulario, tipo === "conta" ? "current-password" : "new-password", frase)
    if (tipo === "nova") {
      if (escrita.length < MINIMO_DA_PALAVRA_PASSE) {
        setErroDaFrase(strings.entrada.curta)
        return
      }
      if (escrita !== fraseDoCampo(formulario, "confirm-password", outraVez)) {
        setErroDaFrase(strings.entrada.diferentes)
        return
      }
    } else if (escrita.length === 0) {
      return
    }
    const selar = bridge.pairing?.seal
    if (!selar) {
      setFase({ que: "falhou", razao: translateError("this version of the app cannot do that") })
      return
    }
    setErroDaFrase(null)
    setAAbrir(true)
    void (async () => {
      try {
        await selar(escrita)
      } catch (erro) {
        // Not the account password (Erro 140): the same step, with the reason by the field.
        if ((erro as Error).message === ERRO_NAO_E_A_PALAVRA_PASSE_DA_CONTA) setNotAccountPassword(true)
        setErroDaFrase(traduzirErro(erro as Error))
        setAAbrir(false)
        return
      }
      try {
        const identity = await bridge.identity.load()
        await bridge.session.connect()
        await bridge.pairing?.done()
        concluido.current = true
        onDone(identity.address)
      } catch (erro) {
        setFase({ que: "falhou", razao: traduzirErro(erro as Error) })
        setAAbrir(false)
      }
    })()
  }

  if (fase.que === "codigo") {
    return (
      <div className="gate">
        <CartaoDoPortao titulo={strings.entrada.comOutroAparelho} onVoltar={sair} className="emparelhar">
          <p className="gate-lead">{strings.juntarAparelho.novoLead}</p>
          {aLer ? (
            <LeitorQr onLido={comecar} onCancelar={() => setALer(false)} />
          ) : (
            <Button variant="primary" type="button" className="entrada-botao" onClick={() => setALer(true)}>
              {strings.juntarAparelho.lerCamara}
            </Button>
          )}
          <form
            className="entrada-formulario"
            onSubmit={(event) => {
              event.preventDefault()
              comecar(link)
            }}
          >
            <Field label={strings.juntarAparelho.colarCodigo}>
              <input
                name="codigo-do-aparelho"
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
            <Button variant="ghost" type="submit" className="entrada-botao" disabled={link.trim().length === 0}>
              {strings.juntarAparelho.continuar}
            </Button>
          </form>
          {bridge.pairing?.showCode && (
            <Button variant="ghost" type="button" className="entrada-botao" onClick={mostrarCodigo}>
              {strings.shortCode.showCode}
            </Button>
          )}
        </CartaoDoPortao>
      </div>
    )
  }

  if (fase.que === "code") {
    return (
      <div className="gate">
        {/* Back leaves the code (its box closes) and goes back to the QR path. */}
        <CartaoDoPortao titulo={strings.shortCode.newTitle} onVoltar={tentarDeNovo} className="emparelhar">
          <NewDeviceCode code={fase.code} link={fase.link} />
        </CartaoDoPortao>
      </div>
    )
  }

  if (fase.que === "sas") {
    return (
      <div className="gate">
        <CartaoDoPortao titulo={strings.juntarAparelho.palavrasTitulo} className="emparelhar">
          <p className="gate-lead">{strings.juntarAparelho.palavrasNoNovo}</p>
          <PalavrasDoSas palavras={fase.palavras} />
          <div className="entrada-caminhos entrada-fundo">
            {fase.confirmado ? (
              <p className="field-note" role="status">
                {strings.juntarAparelho.confirmadoAqui}
              </p>
            ) : (
              <>
                <Button variant="primary" type="button" className="entrada-botao" onClick={() => responder(true)}>
                  {strings.juntarAparelho.sim}
                </Button>
                <Button variant="ghost" type="button" className="entrada-botao" onClick={() => responder(false)}>
                  {strings.juntarAparelho.nao}
                </Button>
              </>
            )}
          </div>
        </CartaoDoPortao>
      </div>
    )
  }

  if (fase.que === "dentro") {
    const nova = fase.tipo === "nova"
    return (
      <div className="gate">
        <CartaoDoPortao titulo={strings.juntarAparelho.estasDentro} className="emparelhar">
          <form
            className="entrada-formulario"
            onSubmit={(event) => {
              event.preventDefault()
              abrir(event.currentTarget)
            }}
          >
            {/* The same name that `Unlock` asks the manager to fill. See `CampoDeIdentidade`. */}
            <CampoDeIdentidade />
            <Field label={strings.juntarAparelho.palavraPasseDaConta}>
              <input
                type="password"
                // The account's password is one the manager already knows; a new one it should save.
                name={nova ? "new-password" : "current-password"}
                autoComplete={nova ? "new-password" : "current-password"}
                autoFocus
                value={frase}
                disabled={aAbrir}
                aria-invalid={erroDaFrase ? true : undefined}
                onChange={(event) => {
                  setFrase(event.target.value)
                  setErroDaFrase(null)
                }}
              />
            </Field>
            {nova && (
              <Field label={strings.entrada.palavraPasseOutraVez}>
                <input
                  type="password"
                  name="confirm-password"
                  autoComplete="new-password"
                  value={outraVez}
                  disabled={aAbrir}
                  onChange={(event) => {
                    setOutraVez(event.target.value)
                    setErroDaFrase(null)
                  }}
                />
              </Field>
            )}
            {erroDaFrase ? (
              <p className="error" role="alert">
                <TextoDeErro texto={erroDaFrase} />
              </p>
            ) : (
              nova && <p className="field-note">{strings.entrada.minimo}</p>
            )}
            {fase.semEstado && (
              <p className="field-note" role="status">
                {strings.pairing.stateMissing}
              </p>
            )}
            <Button variant="primary" type="submit" className="entrada-botao" disabled={aAbrir}>
              {aAbrir ? strings.entrada.aAbrir : strings.juntarAparelho.abrir}
            </Button>
            {!nova && notAccountPassword && (
              <>
                <p className="field-note">{strings.juntarAparelho.forgotAccountPassword}</p>
                <Button variant="ghost" type="button" className="entrada-botao" disabled={aAbrir} onClick={sair}>
                  {strings.common.cancel}
                </Button>
              </>
            )}
          </form>
        </CartaoDoPortao>
      </div>
    )
  }

  if (fase.que === "falhou") {
    return (
      <div className="gate">
        <CartaoDoPortao titulo={strings.juntarAparelho.falhou} onVoltar={sair} className="emparelhar">
          <p className="error" role="alert">
            <TextoDeErro texto={fase.razao} />
          </p>
          <Button variant="primary" type="button" className="entrada-botao" onClick={tentarDeNovo}>
            {strings.common.retry}
          </Button>
        </CartaoDoPortao>
      </div>
    )
  }

  return (
    <div className="gate">
      <CartaoDoPortao titulo={strings.entrada.comOutroAparelho} onVoltar={sair} className="emparelhar">
        <p className="gate-lead" role="status">
          {fase.que === "a-receber" ? strings.juntarAparelho.aReceber : strings.juntarAparelho.aLigar}
        </p>
        <span className="anel-ocupado entrada-anel" aria-hidden="true" />
      </CartaoDoPortao>
    </div>
  )
}
