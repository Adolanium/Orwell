import { useEffect, useRef, useState } from "react"
import { parseServerName } from "@enclave/protocol"
import { nomeValido, parseInviteLink, parseShortInviteLink } from "@enclave/client-core"
import { useBridge } from "../../App.js"
import { Button } from "../../components/Button.js"
import { CampoDeNome } from "../../components/CampoDeNome.js"
import { GuardarFicheiroDaConta } from "../../components/FicheiroDaConta.js"
import { Field } from "../../components/Field.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { strings, traduzirErro } from "../../strings.js"
import { CampoDeIdentidade } from "./CampoDeIdentidade.js"
import { CartaoDoPortao, Entrada, RodapeDaEntrada } from "./Entrada.js"
import { EntrarComFicheiro } from "./EntrarComFicheiro.js"
import { fraseDoCampo } from "./fraseDoCampo.js"
import { lerIntencao } from "./outraEntrada.js"
import { activeAccountId, rememberAccountName } from "../../lib/accountNames.js"
import { EMPTY_SETUP_PROGRESS, firstIncomplete, markDone, type SetupStep } from "./setupSteps.js"

/** Sentinel for the one failure that must swap the whole screen. */
const VAULT_EXISTS = "__vault_exists__"

/** A community invite link (long or short), pasted where the code goes (1.3.26). */
export function eLigacaoDeConvite(texto: string): boolean {
  return parseInviteLink(texto) !== null || parseShortInviteLink(texto) !== null
}

/** The errors of a refused new account that a code can fix: the code field then opens, with the error under it. See `Session.connect`. */
const ERROS_QUE_PEDEM_CONVITE = new Set([
  "this server needs a registration invite",
  "the registration invite is not valid",
  // 1.3.26: over the network limit, a registration code or an invite link gets in.
  "this network created many accounts today",
])

/**
 * The server for the packaged desktop app.
 *
 * It opens the interface from a file (`file://`), which has no host. Until
 * 29 October 2026 that fell into the development branch, `localhost:8448`,
 * and creating an account in the installed app gave Error 201 ("could not reach
 * the server"). On desktop the account is created on the public server.
 */
export const SERVIDOR_DA_APP_DE_SECRETARIA = "orwell.pt"

/**
 * The server the account will live on, prefilled from where the app itself was
 * served: someone opening Orwell from orwell.pt wants an account on orwell.pt.
 * Local development keeps the dev server default. Anyone who needs another
 * server has the advanced options, or `?servidor=` in the address, which is how
 * scripts pass it without clicking.
 */
export function defaultServer(
  local: Pick<Location, "search" | "hostname" | "port" | "protocol"> | null = typeof window !== "undefined"
    ? window.location
    : null,
): string {
  const pedido = local ? new URLSearchParams(local.search).get("servidor")?.trim() : undefined
  if (pedido) return pedido
  if (local?.protocol === "file:") return SERVIDOR_DA_APP_DE_SECRETARIA
  const host = local?.hostname ?? ""
  if (!host || host === "localhost" || host === "127.0.0.1") return "localhost:8448"
  return local?.port ? `${host}:${local.port}` : host
}

/**
 * The Privacy and Terms links and the age sentence of the gate are orwell.pt's:
 * they show only while the account is being made on orwell.pt (1.3.25). The port
 * 443 and the case are the same server.
 */
export function eOServidorDeOmissao(servidor: string): boolean {
  const nome = servidor.trim().toLowerCase().replace(/:443$/, "")
  return nome === SERVIDOR_DA_APP_DE_SECRETARIA
}

/**
 * The "Join the official Orwell channel" checkbox comes unchecked.
 *
 * Since 12 November 2026, joining is opt-in. Whoever does nothing stays out;
 * whoever wants it ticks the box, or joins later from "Join with a link".
 */
export const ENTRAR_NO_CANAL_OFICIAL_POR_OMISSAO = false

export const MINIMO_DA_PALAVRA_PASSE = 8

type ModoDoServidor = "aberto" | "convite" | "fechado" | "versao-antiga" | null

/** The screens before there is an account. */
export type TelaDoSetup = "entrada" | "criar" | "ficheiro" | "versao-antiga"

/**
 * The gate of a device with no vault (mock-ups `Main` and `Desktop`, 21/11/2026).
 *
 * "Bem-vindo ao Orwell" and three ways in: create an account, the account
 * file, another device. Creating asks for the name and the password in one
 * screen; the profile picture is in the profile, later. Then "Guarda o ficheiro
 * da conta", which can wait: the banner inside the app stays until there is a
 * file or a second device.
 *
 * Before the vault exists, the server is asked who may create an account
 * (1.3.25) and whether it takes this version: a closed server says so in words,
 * a server that wants a code opens the code field, and an old app is told to
 * update. Nothing is written until the server could say yes.
 */
export function Setup({
  onDone,
  onUnlockInstead,
  onJoinInstead,
  telaInicial = "entrada",
  conviteInicial = "",
}: {
  onDone: (address: string) => void
  onUnlockInstead: () => void
  /** "Entrar com outro aparelho". Missing on a host that cannot pair. */
  onJoinInstead?: () => void
  telaInicial?: TelaDoSetup
  /** The invite link the page opened with (a community invite): the code field opens with it. */
  conviteInicial?: string
}): React.JSX.Element {
  const bridge = useBridge()

  /*
    "Usar outra conta" and "Esqueci-me" reload into an empty account with the
    screen the person chose (`outraEntrada.ts`). Read once, at the first render.
  */
  const [intencao] = useState(lerIntencao)
  const [tela, setTela] = useState<TelaDoSetup>(() => (intencao === "ficheiro" ? "ficheiro" : telaInicial))
  useEffect(() => {
    if (intencao === "outro-aparelho" && onJoinInstead) onJoinInstead()
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [server, setServer] = useState(() => defaultServer())
  const termosDoOrwell = eOServidorDeOmissao(server)
  const [name, setName] = useState("")
  const [passphrase, setPassphrase] = useState("")
  const [confirm, setConfirm] = useState("")
  const [entrarNoCanalOficial, setEntrarNoCanalOficial] = useState(ENTRAR_NO_CANAL_OFICIAL_POR_OMISSAO)
  const [vaultExists, setVaultExists] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [passError, setPassError] = useState<string | null>(null)
  const [busyStep, setBusyStep] = useState<SetupStep | null>(null)
  const [avancadas, setAvancadas] = useState(false)
  /** What the chosen server said: who may create an account, or that this version is old. `null`: not known. */
  const [registo, setRegisto] = useState<ModoDoServidor>(null)
  const [aSondar, setASondar] = useState(false)
  /** The registration invite code, or an invite link (1.3.26). Sent at the first connection only. */
  const [convite, setConvite] = useState(conviteInicial)
  /** The code field, open: the server wants a code, the person asked for it, or the page came with an invite. */
  const [comConvite, setComConvite] = useState(conviteInicial.trim() !== "")
  const [erroDoConvite, setErroDoConvite] = useState<string | null>(null)
  /** The proof of work of the new account, 0 to 1, while it runs (1.3.26). `null` otherwise. */
  const [aPreparar, setAPreparar] = useState<number | null>(null)
  /** The address of the account just created: the account-file step shows. */
  const [criada, setCriada] = useState<string | null>(null)

  // Refs, not state: the run spans awaits and StrictMode double-invokes
  // effects, so progress must be immune to re-renders and re-mount races.
  const progress = useRef(EMPTY_SETUP_PROGRESS)
  const addressRef = useRef<string | null>(null)
  const serverRef = useRef<string>(defaultServer())
  /** The answer of the probe for the server in the field. See `sondar`. */
  const sondagem = useRef<{ servidor: string; resposta: Promise<ModoDoServidor> } | null>(null)
  /**
   * The password that counts: the one in the FIELD when the form was sent. A
   * password manager can fill the field without an event, and the vault must be
   * born with what is on screen. See `fraseDoCampo`.
   */
  const fraseEscrita = useRef("")
  const campoDoConvite = useRef<HTMLInputElement | null>(null)
  /** "Criar conta" was pressed and waits for the probe: a second press does nothing. */
  const aEnviar = useRef(false)

  useEffect(() => {
    void bridge.vault
      .status()
      .then(({ exists }) => {
        // A vault already on disk means this screen must never create another over it.
        if (exists) setVaultExists(true)
      })
      .catch(() => {
        // The shell's boot check handles a vault that cannot even be probed.
      })
  }, [])

  /**
   * Ask the server, once per server name, before the vault exists. Not asked
   * (an older host, a server that did not answer): the gate goes on as before,
   * and the first connection says the same.
   */
  const sondar = (servidor: string): Promise<ModoDoServidor> => {
    if (sondagem.current?.servidor === servidor) return sondagem.current.resposta
    const pedir = bridge.session.sondarRegisto
    const resposta: Promise<ModoDoServidor> = pedir ? pedir(servidor).catch(() => null) : Promise.resolve(null)
    sondagem.current = { servidor, resposta }
    setASondar(true)
    void resposta.then((modo) => {
      if (sondagem.current?.servidor !== servidor) return
      setASondar(false)
      setRegisto(modo)
      if (modo === "convite") setComConvite(true)
      // Said as soon as it is known, before anything is typed for nothing.
      if (modo === "versao-antiga") setTela("versao-antiga")
    })
    return resposta
  }

  // The probe starts with the create screen, so the code field and a closed server show at once.
  useEffect(() => {
    if (tela !== "criar") return
    try {
      void sondar(parseServerName(server.trim()))
    } catch {
      // An address that does not parse is said at "Criar conta".
    }
    // The server field asks again when it loses focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tela])

  const performStep = async (step: SetupStep): Promise<void> => {
    switch (step) {
      case "cofre": {
        // Last-line guard: even if the mount probe lost a race, creating over
        // an existing vault is the one thing this screen must never do.
        const { exists } = await bridge.vault.status()
        if (exists) throw new Error(VAULT_EXISTS)
        await bridge.vault.create(fraseEscrita.current)
        return
      }
      case "identidade": {
        const identity = await bridge.identity.create(serverRef.current)
        addressRef.current = identity.address
        return
      }
      case "ligacao": {
        /*
          The choice BEFORE the connection: the account joins the common
          channel at the end of the handshake only with "yes" written (opt-in
          since 12/11/2026). Written in the account, so it reaches its other
          devices.
        */
        /*
          On a retry the server is already known and joining reaches for the
          common room before the handshake: that one fails with 202, and the
          handshake end joins it anyway. The choice itself is written.
        */
        await bridge.session.escolherSalaComum?.(entrarNoCanalOficial).catch((erro: Error) => {
          if (erro.message !== "no connection to the server") throw erro
        })
        /*
          The invite code, when there is one: the server reads it only for a new
          account. A pasted invite LINK is a community invite (1.3.26): over the
          network limit it gets the account in too.
        */
        const codigo = comConvite ? convite.trim() : ""
        if (eLigacaoDeConvite(codigo)) await bridge.session.definirConviteDeComunidade?.(codigo)
        else await bridge.session.definirConviteDeRegisto?.(codigo === "" ? null : codigo)
        // The proof of work of a new account (1.3.26), off the main thread, with the progress on the button.
        if (bridge.session.prepararContaNova) {
          setAPreparar(0)
          try {
            await bridge.session.prepararContaNova((fraccao) => setAPreparar(fraccao))
          } finally {
            setAPreparar(null)
          }
        }
        await bridge.session.connect()
        return
      }
      case "perfil":
        // The picture is in the profile, after the account: here only the name.
        await bridge.profile.set({ displayName: name.trim(), donations: [] })
        return
    }
  }

  const run = async (): Promise<void> => {
    setError(null)
    setErroDoConvite(null)
    let step = firstIncomplete(progress.current)
    while (step) {
      setBusyStep(step)
      try {
        await performStep(step)
      } catch (caught) {
        setBusyStep(null)
        if ((caught as Error).message === VAULT_EXISTS) {
          setVaultExists(true)
          return
        }
        const detalhe = traduzirErro(caught)
        // A server that wants a code (or a better one): the field opens with the error under it,
        // and the next "Criar conta" resumes at the connection. One place, no toast.
        if (ERROS_QUE_PEDEM_CONVITE.has((caught as Error).message) && bridge.session.definirConviteDeRegisto) {
          setComConvite(true)
          setErroDoConvite(detalhe)
          setTimeout(() => campoDoConvite.current?.focus(), 0)
        } else {
          setError(detalhe)
        }
        return
      }
      progress.current = markDone(progress.current, step)
      step = firstIncomplete(progress.current)
    }
    setBusyStep(null)
    // The name for "Olá, <name>" at the next sign-in, at once (`lib/accountNames.ts`).
    rememberAccountName(await activeAccountId(bridge), name.trim())
    if (addressRef.current) setCriada(addressRef.current)
  }

  const submeter = (formulario: HTMLFormElement | null): void => {
    if (busyStep || aEnviar.current) return
    setServerError(null)

    // Once the vault exists, the password and the server are set: "Criar conta" resumes.
    if (!progress.current.cofre) {
      if (!nomeValido(name)) return
      const frase = fraseDoCampo(formulario, "new-password", passphrase)
      const confirmacao = fraseDoCampo(formulario, "confirm-password", confirm)
      if (frase !== passphrase) setPassphrase(frase)
      if (confirmacao !== confirm) setConfirm(confirmacao)
      if (frase.length < MINIMO_DA_PALAVRA_PASSE) {
        setPassError(strings.entrada.curta)
        return
      }
      if (frase !== confirmacao) {
        setPassError(strings.entrada.diferentes)
        return
      }
      setPassError(null)
      fraseEscrita.current = frase
      try {
        serverRef.current = parseServerName(server.trim())
      } catch {
        setServerError(strings.gate.serverInvalid)
        setAvancadas(true)
        return
      }
    }

    aEnviar.current = true
    void sondar(serverRef.current).then((modo) => {
      aEnviar.current = false
      if (modo === "fechado") return
      if (modo === "versao-antiga") {
        setTela("versao-antiga")
        return
      }
      void run()
    })
  }

  /**
   * "Voltar" from the create screen. An account that stopped before the server
   * saw it (version, network, a refused code) is only on this device and opens
   * nothing: it goes, so the next gate is not "Olá" for an account that does
   * not exist. After the connection it stays: the account is real.
   */
  const voltar = (): void => {
    const aMeio = progress.current.cofre && !progress.current.ligacao
    const ir = (): void => {
      progress.current = EMPTY_SETUP_PROGRESS
      addressRef.current = null
      setError(null)
      setErroDoConvite(null)
      setTela("entrada")
    }
    if (!aMeio) {
      ir()
      return
    }
    void bridge.vault.destroy().catch(() => {}).then(ir)
  }

  if (criada) return <GuardarFicheiroDaConta address={criada} onContinuar={() => onDone(criada)} />

  if (vaultExists) {
    return (
      <div className="gate">
        <CartaoDoPortao titulo={strings.entrada.criarConta}>
          <p className="gate-lead">{strings.gate.vaultExists}</p>
          <Button variant="primary" type="button" className="entrada-botao" onClick={onUnlockInstead}>
            {strings.gate.goToUnlock}
          </Button>
        </CartaoDoPortao>
      </div>
    )
  }

  if (tela === "entrada") {
    return (
      <Entrada
        termosDoOrwell={termosDoOrwell}
        onCriar={() => setTela("criar")}
        onFicheiro={() => setTela("ficheiro")}
        onOutroAparelho={onJoinInstead}
      />
    )
  }

  if (tela === "ficheiro") return <EntrarComFicheiro onDone={onDone} onVoltar={() => setTela("entrada")} />

  if (tela === "versao-antiga") {
    return (
      <div className="gate">
        <CartaoDoPortao titulo={strings.entrada.criarConta} onVoltar={voltar}>
          <p className="gate-lead" role="alert">
            {strings.entrada.versaoAntiga}
          </p>
          <div className="entrada-fundo">
            <Button
              variant="primary"
              type="button"
              className="entrada-botao"
              onClick={() => {
                // The installed app opens the downloads page; the web has the new version one reload away.
                const abrir = bridge.actualizacao?.abrir
                if (abrir) void abrir().catch(() => {})
                else window.location.reload()
              }}
            >
              {strings.entrada.actualizar}
            </Button>
          </div>
        </CartaoDoPortao>
      </div>
    )
  }

  const aCriar = busyStep !== null
  const fixos = progress.current.cofre
  const fechado = registo === "fechado"

  return (
    <div className="gate">
      <CartaoDoPortao titulo={strings.entrada.criarConta} onVoltar={voltar} voltarDesligado={aCriar}>
        <form
          className="entrada-formulario"
          aria-label={strings.entrada.criarConta}
          onSubmit={(event) => {
            event.preventDefault()
            submeter(event.currentTarget)
          }}
        >
          <CampoDeNome
            rotulo={<span className="field-label">{strings.entrada.nome}</span>}
            value={name}
            autoFocus
            autoComplete="nickname"
            disabled={aCriar}
            onChange={setName}
          />
          {/* The same name that `Unlock` asks the manager to fill. See `CampoDeIdentidade`. */}
          <CampoDeIdentidade />
          <Field label={strings.entrada.palavraPasse}>
            <input
              type="password"
              name="new-password"
              value={passphrase}
              autoComplete="new-password"
              disabled={aCriar}
              readOnly={fixos}
              aria-invalid={passError ? true : undefined}
              aria-describedby="setup-minimo"
              onChange={(event) => {
                setPassphrase(event.target.value)
                setPassError(null)
              }}
            />
          </Field>
          <Field label={strings.entrada.palavraPasseOutraVez}>
            <input
              type="password"
              name="confirm-password"
              value={confirm}
              autoComplete="new-password"
              disabled={aCriar}
              readOnly={fixos}
              aria-invalid={passError ? true : undefined}
              onChange={(event) => {
                setConfirm(event.target.value)
                setPassError(null)
              }}
            />
          </Field>
          {passError ? (
            <p className="error" role="alert">
              {passError}
            </p>
          ) : (
            <p id="setup-minimo" className="field-note">
              {strings.entrada.minimo}
            </p>
          )}

          {comConvite ? (
            <Field label={strings.entrada.codigoDeConvite}>
              <input
                ref={campoDoConvite}
                name="convite-de-registo"
                value={convite}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={aCriar}
                // Room for an invite link as well as a code (1.3.26).
                maxLength={2048}
                aria-invalid={erroDoConvite ? true : undefined}
                onChange={(event) => {
                  setConvite(event.target.value)
                  setErroDoConvite(null)
                }}
              />
            </Field>
          ) : (
            <button type="button" className="gate-link entrada-link entrada-link-inicio" onClick={() => setComConvite(true)}>
              {strings.entrada.tenhoConvite}
            </button>
          )}
          {erroDoConvite && (
            <p className="error" role="alert">
              <TextoDeErro texto={erroDoConvite} />
            </p>
          )}

          {/* The common channel, as an explicit choice. Before 12/11/2026 every new account entered there. */}
          <label className="checkbox">
            <input
              type="checkbox"
              name="canal-oficial"
              checked={entrarNoCanalOficial}
              disabled={aCriar}
              onChange={(event) => setEntrarNoCanalOficial(event.target.checked)}
            />
            {strings.gate.canalOficial}
          </label>

          {fechado && (
            <p className="error" role="alert">
              <TextoDeErro texto={traduzirErro(new Error("this server does not accept new accounts"))} />
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              <TextoDeErro texto={error} />
            </p>
          )}

          {/* The age the Terms ask for, and that creating the account accepts them. orwell.pt's Terms, so only on orwell.pt. */}
          {termosDoOrwell && <p className="field-note setup-termos">{strings.legal.idadeEAceitacao}</p>}

          <Button
            variant="primary"
            type="submit"
            className="entrada-botao"
            disabled={aCriar || aSondar || fechado || !nomeValido(name) || (comConvite && registo === "convite" && convite.trim() === "")}
          >
            {aPreparar !== null
              ? strings.gate.aPrepararConta(Math.round(aPreparar * 100))
              : aCriar
                ? strings.entrada.aCriar
                : strings.entrada.criarConta}
          </Button>

          {/* The server, off everyone's path but in reach. Only until the account exists. */}
          {!progress.current.identidade && (
            <div className="setup-advanced">
              <button
                type="button"
                className="setup-advanced-toggle"
                aria-expanded={avancadas}
                onClick={() => setAvancadas((aberto) => !aberto)}
              >
                {strings.gate.advanced}
              </button>
              {avancadas && (
                <>
                  <Field label={strings.gate.server}>
                    <input
                      value={server}
                      disabled={aCriar}
                      aria-invalid={serverError ? true : undefined}
                      onChange={(event) => {
                        setServer(event.target.value)
                        setServerError(null)
                        // Another server: what the last one said no longer holds.
                        setRegisto(null)
                      }}
                      onBlur={() => {
                        try {
                          void sondar(parseServerName(server.trim()))
                        } catch {
                          // Said at "Criar conta".
                        }
                      }}
                    />
                  </Field>
                  {serverError && <p className="error">{serverError}</p>}
                </>
              )}
            </div>
          )}
        </form>
        <RodapeDaEntrada termosDoOrwell={termosDoOrwell} />
      </CartaoDoPortao>
    </div>
  )
}
