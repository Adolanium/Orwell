import { useCallback, useContext, useEffect, useRef, useState } from "react"
import { marcarArranque } from "@enclave/client-core"
import { useBridge } from "../../App.js"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { OrwellWordmark } from "../../components/Logo.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { ToastContext } from "../../components/Toast.js"
import { strings, traduzirErro } from "../../strings.js"
import { CampoDeIdentidade } from "./CampoDeIdentidade.js"
import { CartaoDoPortao, IconeAparelhos, IconeFicheiro } from "./Entrada.js"
import { fraseDoCampo } from "./fraseDoCampo.js"
import { CaixaMemorizar, podeMemorizar, useEstadoDoCofre, useMemorizarDepoisDeAbrir } from "./MemorizarSessao.js"
import { LigacaoMudarDeConta, useContasDoAparelho } from "./MudarDeConta.js"
import { entrarNumaContaNova, type Intencao } from "./outraEntrada.js"
import { Splash } from "./Splash.js"
import { SINGLE_ACCOUNT_ID, storedAccountName } from "../../lib/accountNames.js"

/**
 * "Keep me signed in" comes OFF (21/11/2026). With it on, the app stops asking
 * for the password, and the person forgets the one thing that opens the
 * account file and joins a new device (problem 9 of the gate map). Who wants it
 * ticks the box. Change it in this line.
 */
export const MANTER_SESSAO_POR_OMISSAO = false

/**
 * Back to this device (mock-up `Voltar`, 21/11/2026): the name, the password,
 * "Manter sessão iniciada", "Entrar". Two ways out, and neither deletes the
 * account: "Esqueci-me da palavra-passe" opens the other two ways in (another
 * device, the file), and "Usar outra conta" opens the three ways of the first
 * screen. Both add an empty account next to this one (`outraEntrada.ts`): the
 * account here stays on this device, closed, in "Mudar de conta".
 */
export function Unlock({
  onDone,
  onLigacaoFalhou,
}: {
  /** The vault is open: enter. Called before the connection ends (see `attempt`). */
  onDone: (address: string) => void
  /** The connection started on entry failed, after `onDone`: the app is already open. */
  onLigacaoFalhou?: (erro: Error) => void
}): React.JSX.Element {
  const bridge = useBridge()
  const toast = useContext(ToastContext)
  const [passphrase, setPassphrase] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [needsPassphrase, setNeedsPassphrase] = useState(false)
  const [esqueceste, setEsqueceste] = useState(false)
  const [aSair, setASair] = useState(false)
  const estado = useEstadoDoCofre(bridge)
  const caixa = podeMemorizar(bridge, estado)
  const [memorizar, setMemorizar] = useState(MANTER_SESSAO_POR_OMISSAO)
  const memorizarDepoisDeAbrir = useMemorizarDepoisDeAbrir(bridge)
  // Read at the moment of `attempt`, which is a `useCallback` without these dependencies.
  const memorizarAgora = useRef(false)
  memorizarAgora.current = caixa && memorizar
  const contas = useContasDoAparelho(bridge)
  const activa = contas?.find((conta) => conta.activa)
  // The list's name, or the one kept outside the vault for this account (`lib/accountNames.ts`).
  const nome = activa?.nome.trim() || storedAccountName(activa?.id ?? SINGLE_ACCOUNT_ID)

  const attempt = useCallback(
    (secret: string | null) => {
      setBusy(true)
      setError(null)
      void (async () => {
        let address: string
        try {
          await bridge.vault.unlock(secret)
          marcarArranque("cofre-aberto")
          if (secret !== null) await memorizarDepoisDeAbrir(memorizarAgora.current)
          address = (await bridge.identity.load()).address
        } catch (caught) {
          // The first attempt is the silent one (keychain, remembered session,
          // tab key). If that is not how this vault opens, ask, with no error.
          if (secret === null) setNeedsPassphrase(true)
          else setError(traduzirErro(caught))
          setBusy(false)
          return
        }
        /*
          Go in NOW, not when the connection ends (12/11/2026): the vault is
          open, so the app opens with what it holds, and the connection goes on
          behind with its state in the banner. A revocation or a suspension that
          the connection finds still takes the app back to the gate.
        */
        const ligacao = bridge.session.connect()
        onDone(address)
        await ligacao.catch((caught: Error) => onLigacaoFalhou?.(caught))
      })()
    },
    [onDone, onLigacaoFalhou],
  )

  // Exactly one silent attempt, even under StrictMode's double-mounted effects.
  const attempted = useRef(false)
  useEffect(() => {
    if (attempted.current) return
    attempted.current = true
    attempt(null)
  }, [])

  const outraForma = (intencao: Intencao): void => {
    if (aSair) return
    setASair(true)
    void entrarNumaContaNova(bridge, intencao).catch((erro: Error) => {
      setASair(false)
      toast?.(traduzirErro(erro), "error")
    })
  }

  if (busy && !needsPassphrase) return <Splash />

  if (esqueceste) {
    return (
      <div className="gate">
        <CartaoDoPortao titulo={strings.entrada.esquecesteTitulo} onVoltar={() => setEsqueceste(false)} voltarDesligado={aSair}>
          <p className="gate-lead">{strings.entrada.esquecesteTexto}</p>
          <div className="entrada-caminhos entrada-fundo">
            <Button variant="ghost" type="button" className="entrada-botao entrada-caminho" disabled={aSair} onClick={() => outraForma("outro-aparelho")}>
              <IconeAparelhos />
              {strings.entrada.comOutroAparelho}
            </Button>
            <Button variant="ghost" type="button" className="entrada-botao entrada-caminho" disabled={aSair} onClick={() => outraForma("ficheiro")}>
              <IconeFicheiro />
              {strings.entrada.comFicheiro}
            </Button>
          </div>
        </CartaoDoPortao>
      </div>
    )
  }

  return (
    <div className="gate">
      <div className="gate-card gate-entrada entrada-ola">
        {/*
          The name is kept outside the vault for this screen (`lib/accountNames.ts`).
          An older account, before its first opening with this version: the mark and
          "Olá", and the name is stored right after the unlock.
        */}
        {nome ? (
          <span className="entrada-avatar" aria-hidden="true">
            {[...nome][0]?.toUpperCase()}
          </span>
        ) : (
          <header className="setup-head">
            <OrwellWordmark size={22} />
          </header>
        )}
        <h1 className="entrada-titulo">{nome ? strings.entrada.ola(nome) : strings.entrada.olaSemNome}</h1>
        {/*
          A real sign-in form: `<form>`, an identity field and a password marked
          as CURRENT, so the system password manager (Face ID on iPhone) offers
          to fill it.
        */}
        <form
          className="entrada-formulario"
          onSubmit={(event) => {
            event.preventDefault()
            if (busy) return
            // What the FIELD has: the manager can fill without an event. See `fraseDoCampo`.
            attempt(fraseDoCampo(event.currentTarget, "password", passphrase))
          }}
        >
          <CampoDeIdentidade />
          <Field label={strings.entrada.palavraPasse}>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              autoFocus
              value={passphrase}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setPassphrase(event.target.value)
                setError(null)
              }}
            />
          </Field>
          {error && (
            <p className="error" role="alert">
              <TextoDeErro texto={error} />
            </p>
          )}
          {caixa && <CaixaMemorizar ligada={memorizar} onMudar={setMemorizar} />}
          <Button variant="primary" type="submit" className="entrada-botao" disabled={busy}>
            {busy ? (
              <>
                <span className="anel-ocupado" aria-hidden="true" />
                {strings.entrada.aAbrir}
              </>
            ) : (
              strings.entrada.entrar
            )}
          </Button>
        </form>
        <div className="gate-rodape">
          <p>
            <button type="button" className="gate-link" disabled={busy} onClick={() => setEsqueceste(true)}>
              {strings.entrada.esqueci}
            </button>
          </p>
          {bridge.contas && (
            <p>
              <button type="button" className="gate-link" disabled={busy || aSair} onClick={() => outraForma("inicio")}>
                {strings.entrada.outraConta}
              </button>
            </p>
          )}
          {/* Only with another account on this device. */}
          <LigacaoMudarDeConta disabled={busy} />
        </div>
      </div>
    </div>
  )
}

/**
 * This device left the account (21/11/2026): removed in Settings on another
 * device. The account is still on the other devices; the file or another
 * device brings it back here. Nothing on this screen deletes anything.
 */
export function AparelhoRemovido({
  onFicheiro,
  onOutroAparelho,
}: {
  onFicheiro: () => void
  onOutroAparelho?: (() => void) | undefined
}): React.JSX.Element {
  return (
    <div className="gate">
      <CartaoDoPortao titulo={strings.entrada.removido}>
        <div className="entrada-caminhos entrada-fundo">
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
        <div className="gate-rodape">
          <LigacaoMudarDeConta rotulo={strings.entrada.voltarAConta} podeAcrescentar={false} />
        </div>
      </CartaoDoPortao>
    </div>
  )
}
