import { useEffect, useRef, useState } from "react"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { parseServerName } from "@enclave/protocol"
import { nomeValido } from "@enclave/client-core"
import { useBridge } from "../../App.js"
import { Button } from "../../components/Button.js"
import { CampoDeNome } from "../../components/CampoDeNome.js"
import { Field } from "../../components/Field.js"
import { CampoDeIdentidade } from "./CampoDeIdentidade.js"
import { CaixaMemorizar, useMemorizarDepoisDeAbrir } from "./MemorizarSessao.js"
import { LigacaoMudarDeConta } from "./MudarDeConta.js"
import { fraseDoCampo } from "./fraseDoCampo.js"
import { OrwellWordmark } from "../../components/Logo.js"
import { useToast } from "../../components/Toast.js"
import { strings, traduzirErro } from "../../strings.js"
import { ImportAccount } from "./ImportAccount.js"
import { PassoDoFicheiroDaConta } from "../../components/FicheiroDaConta.js"
import { FolhaComoFunciona } from "../settings/ComoFunciona.js"
import { FraseDoMomento } from "../../components/FraseDoMomento.js"
import { Enquadrar } from "../../components/Enquadrar.js"
import { LigacoesLegais } from "../../components/LigacoesLegais.js"
import { podeEnquadrar } from "../../lib/enquadrar.js"
import { avisoDeAnimacaoPerdida, compressImage, IMAGE_BUDGETS, type CompressedImage } from "../../lib/images.js"
import { EMPTY_SETUP_PROGRESS, ecraInicial, firstIncomplete, markDone, SETUP_STEPS, type SetupStep } from "./setupSteps.js"

/** Sentinel for the one failure that must swap the whole screen, not toast. */
const VAULT_EXISTS = "__vault_exists__"

/**
 * The questions, one at a time.
 *
 * The signup screen was a form with everything in view: name, server, two
 * passwords, a checkbox and two warnings, all at once. It now asks one question
 * per page. It's not just tidying: the password is the only thing in this app
 * that doesn't recover, and someone looking at six fields won't read the
 * paragraph that explains it.
 *
 * `confirm` drops when the vault is protected by the system, there's no password
 * to confirm. That's why the list is calculated, not written.
 */
type Passo = "nome" | "convite" | "fotografia" | "chave" | "confirmar"

/*
  No color question. It was here between the name and password, and it was
  one step too many for someone who just wants to reach someone: color doesn't
  change what the person can do, and it stays in Settings, where it always was.
  The first screen after the account is the one that now says how to reach
  someone (see `PrimeirosPassos`).
*/
/*
  The photo, right after the name. The other pages keep the interview
  tone (the proposal to swap them for direct titles was dropped). It's the only page
  you can skip: the button that advances says "Skip" until there's a photo,
  with the same weight as "Choose photo". Unlike color, the face changes what
  others see of who talks to them; but it's not a condition for anything, so it
  never blocks the path.
*/
const PASSOS_COM_FRASE: readonly Passo[] = ["nome", "fotografia", "chave", "confirmar"]
const PASSOS_COM_SISTEMA: readonly Passo[] = ["nome", "fotografia", "chave"]

/**
 * The pages, with the invite code page right after the name on a server that
 * takes new accounts only with an invite (1.3.25, `ENCLAVE_REGISTO=convite`).
 */
export function passosDoSetup(base: readonly Passo[], registo: "aberto" | "convite" | "fechado" | null): readonly Passo[] {
  return registo === "convite" ? [base[0]!, "convite", ...base.slice(1)] : base
}

/** The errors of a refused new account that a code can fix: the gate then shows the code field. See `Session.connect`. */
const ERROS_QUE_PEDEM_CONVITE = new Set(["this server needs a registration invite", "the registration invite is not valid"])

/**
 * Account creation, as an atomic-feeling sequence of five steps.
 *
 * Each completed step is flagged and a retry resumes from the first incomplete
 * one — `vault.create` and `identity.create` are never re-run once they have
 * succeeded, because re-running them would destroy the identity just minted.
 */
/**
 * The server the account will live on, prefilled from where the app itself
 * was served: someone opening enclave from orwell.pt almost certainly wants
 * an account on orwell.pt. Local development keeps the dev server default.
 *
 * It's no longer in the signup path. Everyone who opens this page wants an
 * account where they opened it from, and a field that comes prefilled and no one
 * should touch only makes it seem like there's a decision to make. Anyone who
 * really needs another server has two ways, and neither goes through the path for
 * everyone: the advanced options button, or `?servidor=` in the address, which is
 * how scripts pass it without clicking.
 */
/**
 * The server for the packaged desktop app.
 *
 * It opens the interface from a file (`file://`), which has no host. Until
 * 29 October 2026 that fell into the development branch, `localhost:8448`,
 * and creating an account in the installed app gave Error 201 ("could not reach
 * the server"). On desktop the account is created on
 * the public server.
 */
export const SERVIDOR_DA_APP_DE_SECRETARIA = "orwell.pt"

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
 * they show only while the account is being made on orwell.pt (1.3.25). Another server, chosen in the advanced options or by `?servidor=`,
 * has its own rules, and the gate does not hand them orwell.pt's. The port 443
 * and the case are the same server.
 */
export function eOServidorDeOmissao(servidor: string): boolean {
  const nome = servidor.trim().toLowerCase().replace(/:443$/, "")
  return nome === SERVIDOR_DA_APP_DE_SECRETARIA
}

/**
 * The "Join the official Orwell channel" checkbox on the last step comes unchecked.
 *
 * Since 12 November 2026, joining is opt-in. Whoever does nothing
 * stays out; whoever wants it ticks the box, or joins later from "Join with a
 * link". (It came checked from 3 November.) Change it in this line.
 */
export const ENTRAR_NO_CANAL_OFICIAL_POR_OMISSAO = false

export function Setup({
  onDone,
  onUnlockInstead,
  onJoinInstead,
}: {
  onDone: (address: string) => void
  onUnlockInstead: () => void
  /** The third way through the gate: add this device to an account that lives elsewhere. Missing where it doesn't make sense (legacy tests). */
  onJoinInstead?: () => void
}): React.JSX.Element {
  const bridge = useBridge()
  const toast = useToast()

  const [server, setServer] = useState(() => defaultServer())
  const termosDoOrwell = eOServidorDeOmissao(server)
  const [name, setName] = useState("")
  /** The initial profile photo, already compressed. `null` = no photo: stays initial. */
  const [avatar, setAvatar] = useState<string | null>(null)
  const [avisoDoGif, setAvisoDoGif] = useState<string | null>(null)
  /** The chosen photo, waiting to be framed. See `escolherFotografia`. */
  const [aEnquadrar, setAEnquadrar] = useState<File | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState("")
  const [confirm, setConfirm] = useState("")
  const [reveal, setReveal] = useState(false)
  // F3 of session memory: a new account is ALWAYS born with a password.
  // The vault from keychain only (`os`) stopped being offered: with it,
  // "Sign out" didn't sign anyone out. The ones that already exist convert to
  // Account > Session > "Set password".
  const useOs = false
  /** The platform has a place to memorize the session (F1). See `MemorizarSessao.tsx`. */
  const [memoriaDisponivel, setMemoriaDisponivel] = useState(false)
  /** "Memorize the session", on by default. */
  const [memorizar, setMemorizar] = useState(true)
  const memorizarDepoisDeAbrir = useMemorizarDepoisDeAbrir(bridge)
  /** "Join the Orwell channel", on the last step. See `ENTRAR_NO_CANAL_OFICIAL_POR_OMISSAO`. */
  const [entrarNoCanalOficial, setEntrarNoCanalOficial] = useState(ENTRAR_NO_CANAL_OFICIAL_POR_OMISSAO)
  const [vaultExists, setVaultExists] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [passError, setPassError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [busyStep, setBusyStep] = useState<SetupStep | null>(null)
  const [indice, setIndice] = useState(0)
  const [avancadas, setAvancadas] = useState(false)
  /**
   * Who may create an account on the chosen server (1.3.25), asked at the name
   * page, before the vault. `null`: not asked yet, or the server could not be asked.
   */
  const [registo, setRegisto] = useState<"aberto" | "convite" | "fechado" | null>(null)
  /** Asking the server, between the name page and the next one. */
  const [aSondar, setASondar] = useState(false)
  /** The registration invite code, as typed. Sent at the first connection only. */
  const [convite, setConvite] = useState("")
  /** The first connection was refused for want of a valid code: the field shows on the creation screen. */
  const [conviteRecusado, setConviteRecusado] = useState(false)
  /** From here on the answers are set and the screen shows creation. */
  const [aCriar, setACriar] = useState(false)
  /**
   * The question "Do you use Orwell on another device?" was already answered with "No".
   * See `ecraInicial`. Without a pairing path, we don't ask.
   */
  const [aCriarConta, setACriarConta] = useState(() => ecraInicial({ podeEmparelhar: onJoinInstead !== undefined }) === "criar")
  /** The "How it works" page, open on top of the gate. */
  const [comoFunciona, setComoFunciona] = useState(false)
  /** The address of the account just created: the account-file step shows. */
  const [criada, setCriada] = useState<string | null>(null)

  // Refs, not state: the run spans awaits and StrictMode double-invokes
  // effects, so progress must be immune to re-renders and re-mount races.
  const progress = useRef(EMPTY_SETUP_PROGRESS)
  const addressRef = useRef<string | null>(null)
  const serverRef = useRef<string>(defaultServer())
  const probed = useRef(false)
  /**
   * The phrase that counts: the one in the FIELD when it was submitted.
   *
   * **Today this is deliberate overkill.** The `submeter` already syncs state
   * from the field, and since creation only happens in the NEXT step (confirmation),
   * the `passphrase` for that turn is already right, changing the `create` line
   * to read state breaks no test.
   *
   * It stays because the equivalence depends on something no one wrote down: that
   * between syncing and creating there's a render. The day the passphrase becomes
   * the LAST step, `run()` starts in the same turn it's submitted, state for that
   * turn is still old, and the vault is born with what React knew before, the
   * 30 September bug again, and again with nothing to explain it. The value that
   * creates the vault now comes from somewhere explicit. See `fraseDoCampo`.
   */
  const fraseEscrita = useRef("")
  /** The field for the question on screen, to give it focus. */
  const campo = useRef<HTMLInputElement | null>(null)
  /** And the page itself, for questions that have no field. */
  const painel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (probed.current) return
    probed.current = true
    void bridge.vault
      .status()
      .then(({ exists, memoriaDisponivel: memoria }) => {
        setMemoriaDisponivel(Boolean(memoria && bridge.vault.memorizar))
        // A vault already on disk means this screen must never create another
        // over it: surface the fact and point at unlock instead.
        if (exists) setVaultExists(true)
      })
      .catch(() => {
        // The shell's boot check handles a vault that cannot even be probed.
      })
  }, [])

  const passos = passosDoSetup(useOs ? PASSOS_COM_SISTEMA : PASSOS_COM_FRASE, registo)
  const posicao = Math.min(indice, passos.length - 1)
  const passo = passos[posicao] as Passo
  const ultimo = posicao === passos.length - 1

  /*
   * Focus follows the question: someone on a new page writes there without
   * having to point first.
   *
   * A page with no field (the key page, when the system guards it, just has the
   * checkbox) would drop focus on the `body`: Enter would do nothing and the
   * keyboard would get stuck there. The page itself receives it, and the
   * form's `onKeyDown` handles the rest.
   */
  useEffect(() => {
    if (aCriar) return
    if (campo.current) campo.current.focus()
    else painel.current?.focus()
  }, [passo, aCriar, useOs])

  const performStep = async (step: SetupStep): Promise<void> => {
    switch (step) {
      case "cofre": {
        // Last-line guard: even if the mount probe lost a race, creating over
        // an existing vault is the one thing this screen must never do.
        const { exists } = await bridge.vault.status()
        if (exists) throw new Error(VAULT_EXISTS)
        // `fraseEscrita` not `passphrase`: the vault is born with what was in the
        // FIELD when it was submitted, which might have been the system manager
        // putting it there. See `fraseDoCampo`.
        await bridge.vault.create(useOs ? null : fraseEscrita.current)
        // The vault exists and is open: save now, if the checkbox was on.
        // A failure is reported and the account keeps being created.
        await memorizarDepoisDeAbrir(!useOs && memoriaDisponivel && memorizar)
        return
      }
      case "identidade": {
        const identity = await bridge.identity.create(serverRef.current)
        addressRef.current = identity.address
        return
      }
      case "ligacao":
        /*
          The choice BEFORE the connection, both ways: the account joins the
          common channel at the end of the handshake only with "yes" written
          (opt-in since 12/11/2026), and anyone who left it unchecked cannot
          enter, not even for a moment. Written in the account, so it reaches
          its other devices. Retrying doesn't change anything.
        */
        await bridge.session.escolherSalaComum?.(entrarNoCanalOficial)
        // The invite code, when there is one: the server reads it only for a new account. See `Session.definirConviteDeRegisto`.
        if (convite.trim() !== "") await bridge.session.definirConviteDeRegisto?.(convite)
        await bridge.session.connect()
        return
      case "perfil":
        // No photo, the key won't go: with exactOptionalPropertyTypes,
        // missing and `undefined` aren't the same.
        await bridge.profile.set({
          displayName: name.trim(),
          donations: [],
          ...(avatar ? { avatarDataUrl: avatar } : {}),
        })
        return
    }
  }

  const run = async (): Promise<void> => {
    setError(null)
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
        // A server that wants a code (or a better one): show the field, and retry resumes at the connection.
        if (ERROS_QUE_PEDEM_CONVITE.has((caught as Error).message) && bridge.session.definirConviteDeRegisto) {
          setConviteRecusado(true)
        }
        const detail = traduzirErro(caught)
        setError(detail)
        toast(detail, "error")
        return
      }
      progress.current = markDone(progress.current, step)
      step = firstIncomplete(progress.current)
    }
    setBusyStep(null)
    // The account exists: the file comes next, and only then the app. See `PassoDoFicheiroDaConta`.
    if (addressRef.current) setCriada(addressRef.current)
  }

  /**
   * The photo goes through the same compressor as the profile editor, with the same
   * budget: the initial profile is republished on the same channels as the later one,
   * and costs the same. A light animated GIF keeps moving; a heavy one stops, and
   * the page says why. See `ProfileEditor.pickAvatar`.
   *
   * Before compressing, the framing sheet, with the same circle as the profile editor.
   * Without it (a device that can't crop), the old path.
   */
  const escolherFotografia = (file: File | undefined): void => {
    if (!file) return
    setPhotoError(null)
    setAvisoDoGif(null)
    if (podeEnquadrar()) {
      setAEnquadrar(file)
      return
    }
    void compressImage(file, IMAGE_BUDGETS.avatar)
      .then((imagem) => aplicarFotografia(file, imagem))
      .catch((erro: Error) => setPhotoError(traduzirErro(erro)))
  }

  const aplicarFotografia = (file: File, imagem: CompressedImage): void => {
    setAvatar(imagem.dataUrl)
    setAvisoDoGif(avisoDeAnimacaoPerdida(file, imagem, IMAGE_BUDGETS.avatar))
  }

  /**
   * What's missing for this page's button to stop being disabled.
   *
   * One question at a time also means one condition at a time: the button only
   * knows about the field in front of the person.
   */
  const pronto =
    passo === "convite"
      ? convite.trim() !== ""
      : passo === "nome"
      ? /* The display-name rule (12 graphemes, `nomeValido`): the field cuts
           what is typed, but not while a keyboard composes, and Android's
           composes every word. */
        nomeValido(name)
      : /*
             The password pages don't lock by state.

             The field might have been filled by the system manager without
             firing any event: state stays empty, and locking the button by it
             is putting the person in front of a full field and a dead button,
             with nothing to explain it. What validates is `submeter`, which reads
             the FIELD, and which already said "at least 8 characters" and
             "don't match" when needed. See `fraseDoCampo`.
          */
          true

  /**
   * Move to the next page, or create the account if this is the last one.
   *
   * Takes the form because that's where the truth about the fields comes from.
   * The two places that call this, the `onSubmit` and the Enter `onKeyDown`,    * have it in `event.currentTarget`.
   */
  const submeter = (formulario: HTMLFormElement | null): void => {
    if (busyStep) return

    // We're already creating: the button is retry, and `run` resumes at the
    // first step that failed, never redoes the vault or identity.
    if (aCriar) {
      void run()
      return
    }

    if (passo === "nome") {
      if (!nomeValido(name)) return
      setServerError(null)
      try {
        serverRef.current = parseServerName(server.trim())
      } catch {
        setServerError(strings.gate.serverInvalid)
        setAvancadas(true)
        return
      }
      /*
        Who may create an account there (1.3.25), before anything is written.
        `fechado` stops here, on the name page, with the vault still unmade; the
        person can pick another server below, or go back and pair. `convite` adds
        the code page next. Not asked (an older host, a server that did not answer):
        the gate goes on as before, and the first connection says the same.
      */
      const sondar = bridge.session.sondarRegisto
      if (sondar) {
        setASondar(true)
        void sondar(serverRef.current)
          .catch(() => null)
          .then((modo) => {
            setASondar(false)
            setRegisto(modo)
            if (modo === "fechado") return
            setIndice(1)
          })
        return
      }
    }

    /*
      What the FIELDS have, now that the system manager writes in them too.

      One step has only that step's field, and the other falls into state, which
      by now has been synced by the previous step. See `fraseDoCampo`.
    */
    const frase = fraseDoCampo(formulario, "new-password", passphrase)
    const confirmacao = fraseDoCampo(formulario, "confirm-password", confirm)
    fraseEscrita.current = frase
    // State follows the field, so the screen and the next step agree
    // with what's actually there.
    if (frase !== passphrase) setPassphrase(frase)
    if (confirmacao !== confirm) setConfirm(confirmacao)

    if (passo === "chave" && !useOs) {
      if (frase.length < 8) {
        setPassError(strings.gate.passphraseShort)
        return
      }
      setPassError(null)
    }

    if (passo === "confirmar") {
      if (frase !== confirmacao) {
        setConfirmError(strings.gate.passphraseMismatch)
        return
      }
      setConfirmError(null)
    }

    if (!ultimo) {
      setIndice(posicao + 1)
      return
    }

    setACriar(true)
    void run()
  }

  if (criada) return <PassoDoFicheiroDaConta address={criada} onContinuar={() => onDone(criada)} />

  if (vaultExists) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>{strings.gate.setupTitle}</h1>
          <p className="gate-lead">{strings.gate.vaultExists}</p>
          <p className="gate-warning">{strings.gate.vaultExistsBody}</p>
          <Button variant="primary" onClick={onUnlockInstead}>
            {strings.gate.goToUnlock}
          </Button>
          <p className="gate-lead">{strings.gate.importLead}</p>
          <ImportAccount replacing onDone={onDone} />
        </div>
      </div>
    )
  }

  /*
    The first question, before the account (phase 8.1).

    This replaces earlier choices about the
    gate order: creating an account is no longer the default path, and pairing
    is no longer the "third option" in a button below the name. Both answers
    carry equal weight, because neither is wrong; the wrong choice was to create
    a second account without knowing the other option existed.
  */
  if (!aCriarConta && onJoinInstead) {
    return (
      <div className="gate">
        <div className="gate-card gate-setup">
          <header className="setup-head">
            <OrwellWordmark size={22} />
          </header>
          <div className="setup-pane">
            <h1>{strings.gate.outroAparelhoPergunta}</h1>
            <p className="gate-lead">{strings.gate.outroAparelhoLead}</p>
          </div>
          <div className="setup-escolha">
            <Button variant="primary" type="button" className="wide" onClick={onJoinInstead}>
              {strings.gate.outroAparelhoSim}
            </Button>
            <Button variant="primary" type="button" className="wide" onClick={() => setACriarConta(true)}>
              {strings.gate.outroAparelhoNao}
            </Button>
          </div>
          <div className="gate-rodape">
            <p>
              <button type="button" className="gate-link" onClick={() => setComoFunciona(true)}>
                {strings.comoFunciona.link}
              </button>
            </p>
            {termosDoOrwell && (
              <p>
                <LigacoesLegais className="gate-link" />
              </p>
            )}
            {/* An account added, still empty: go back to the existing ones. */}
            <LigacaoMudarDeConta rotulo={strings.contas.voltar} podeAcrescentar={false} />
          </div>
        </div>
        {comoFunciona && <FolhaComoFunciona onClose={() => setComoFunciona(false)} />}
      </div>
    )
  }

  const pergunta = aCriar
    ? strings.gate.creatingTitle
    : passo === "nome"
      ? strings.gate.askName
      : passo === "convite"
        ? strings.gate.askInvite
        : passo === "fotografia"
        ? strings.gate.askPhoto
        : passo === "chave"
        ? useOs
          ? strings.gate.askPassKeychain
          : strings.gate.askPass
        : strings.gate.askConfirm

  const explicacao = aCriar
    ? strings.gate.creatingLead
    : passo === "nome"
      ? strings.gate.askNameLead
      : passo === "convite"
        ? strings.gate.askInviteLead
        : passo === "fotografia"
        ? strings.gate.askPhotoLead
        : passo === "chave"
        ? useOs
          ? strings.gate.askPassKeychainLead
          : strings.gate.askPassLead
        : strings.gate.askConfirmLead

  return (
    <div className="gate">
      <div className="gate-card gate-setup">
        <header className="setup-head">
          <OrwellWordmark size={22} />
          {!aCriar && (
            <>
              <ol className="setup-dots" aria-hidden="true">
                {passos.map((cada, i) => (
                  <li key={cada} className={i === posicao ? "current" : i < posicao ? "done" : undefined} />
                ))}
              </ol>
              <p className="sr-only" aria-live="polite">
                {strings.gate.stepOf(posicao + 1, passos.length)}
              </p>
            </>
          )}
        </header>

        <form
          className="setup-form"
          aria-labelledby="setup-pergunta"
          onSubmit={(event) => {
            event.preventDefault()
            submeter(event.currentTarget)
          }}
          onKeyDown={(event) => {
            // Enter advances from anywhere. A single field submitted the form on its own;
            // a page with no text field does not, and without this Enter did nothing. The
            // buttons handle their own Enter and do not pass through here, or it would
            // advance two pages.
            if (event.key !== "Enter") return
            if ((event.target as HTMLElement).tagName === "BUTTON") return
            event.preventDefault()
            submeter(event.currentTarget)
          }}
        >
          {/* `key` per step: each question enters as a new screen, and the field there
              is a fresh field, not the previous one reused. */}
          <div className="setup-pane" key={aCriar ? "a-criar" : passo} ref={painel} tabIndex={-1}>
            <h1 id="setup-pergunta">{pergunta}</h1>
            <p className="gate-lead">{explicacao}</p>

            {!aCriar && passo === "nome" && (
              <>
                <CampoDeNome
                  rotulo={<span className="sr-only">{strings.gate.name}</span>}
                  campoRef={campo}
                  value={name}
                  autoFocus
                  placeholder={strings.gate.namePlaceholder}
                  onChange={setName}
                />
                <p className="gate-lead setup-promise">{strings.gate.setupLead}</p>
              </>
            )}

            {((!aCriar && passo === "convite") || (aCriar && conviteRecusado)) && (
              <Field label={aCriar ? strings.gate.inviteCode : <span className="sr-only">{strings.gate.inviteCode}</span>}>
                <input
                  ref={aCriar ? undefined : campo}
                  name="convite-de-registo"
                  value={convite}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={64}
                  placeholder={strings.gate.invitePlaceholder}
                  onChange={(event) => setConvite(event.target.value)}
                />
              </Field>
            )}

            {!aCriar && passo === "nome" && registo === "fechado" && (
              <p className="error" role="alert">
                {strings.gate.registoFechado}
              </p>
            )}

            {!aCriar && passo === "fotografia" && (
              <>
                {/* The same rounded preview as the profile editor.
                    No photo: the first letter of the name, which is what stays in the account. */}
                <div className="setup-foto">
                  <div className="avatar-preview">
                    {avatar ? (
                      <img src={avatar} alt="" />
                    ) : (
                      <span>{(name.trim()[0] ?? "?").toUpperCase()}</span>
                    )}
                  </div>
                  {/* "Choose photo" with the look of the advance button
                      ("Skip"): both answers weigh the same. */}
                  <label className="primary wide file">
                    {strings.gate.choosePhoto}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(event) => {
                        escolherFotografia(event.target.files?.[0])
                        // After "Cancel", the same file reopens the sheet.
                        event.target.value = ""
                      }}
                    />
                  </label>
                  {avatar && (
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        setAvatar(null)
                        setAvisoDoGif(null)
                      }}
                    >
                      {strings.gate.removePhoto}
                    </Button>
                  )}
                </div>
                {avisoDoGif && (
                  <p className="hint" role="status">
                    {avisoDoGif}
                  </p>
                )}
                {photoError && (
                  <p className="error">
                    <TextoDeErro texto={photoError} />
                  </p>
                )}
                {aEnquadrar && (
                  <Enquadrar
                    ficheiro={aEnquadrar}
                    forma="circulo"
                    budget={IMAGE_BUDGETS.avatar}
                    onGuardar={(imagem) => {
                      aplicarFotografia(aEnquadrar, imagem)
                      setAEnquadrar(null)
                    }}
                    onCancelar={() => setAEnquadrar(null)}
                  />
                )}
              </>
            )}

            {!aCriar && passo === "chave" && (
              <>
                {!useOs && (
                  <>
                    {/* The same name that `Unlock` will ask to fill in:
                        because they are the same, the manager recognizes the entry
                        saved here. See `CampoDeIdentidade`. */}
                    <CampoDeIdentidade />
                    <Field label={<span className="sr-only">{strings.gate.devicePassphrase}</span>}>
                      <span className="pass-row">
                        <input
                          ref={campo}
                          type={reveal ? "text" : "password"}
                          name="new-password"
                          value={passphrase}
                          autoComplete="new-password"
                          aria-invalid={passError ? true : undefined}
                          placeholder={strings.gate.passphrasePlaceholder}
                          onChange={(event) => {
                            setPassphrase(event.target.value)
                            setPassError(null)
                          }}
                        />
                        <button
                          type="button"
                          className="reveal-toggle"
                          aria-pressed={reveal}
                          onClick={() => setReveal((current) => !current)}
                        >
                          {reveal ? strings.gate.conceal : strings.gate.reveal}
                        </button>
                      </span>
                    </Field>
                    {memoriaDisponivel && <CaixaMemorizar ligada={memorizar} onMudar={setMemorizar} />}
                  </>
                )}
                {passError && <p className="error">{passError}</p>}
                <p className="gate-warning">{useOs ? strings.gate.warning : strings.gate.passphraseNote}</p>
              </>
            )}

            {!aCriar && passo === "confirmar" && (
              <>
                <Field label={<span className="sr-only">{strings.gate.confirmPassphrase}</span>}>
                  <span className="pass-row">
                    <input
                      ref={campo}
                      type={reveal ? "text" : "password"}
                      name="confirm-password"
                      value={confirm}
                      autoComplete="new-password"
                      aria-invalid={confirmError ? true : undefined}
                      onChange={(event) => {
                        setConfirm(event.target.value)
                        setConfirmError(null)
                      }}
                    />
                    <button
                      type="button"
                      className="reveal-toggle"
                      aria-pressed={reveal}
                      onClick={() => setReveal((current) => !current)}
                    >
                      {reveal ? strings.gate.conceal : strings.gate.reveal}
                    </button>
                  </span>
                </Field>
                {confirmError && <p className="error">{confirmError}</p>}
                <p className="gate-warning">{strings.gate.warning}</p>
              </>
            )}

            {/* The common channel, on the last screen, as an explicit choice.
                Before this, every new account entered there without asking. */}
            {!aCriar && ultimo && (
              <div className="canal-oficial-escolha">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    name="canal-oficial"
                    checked={entrarNoCanalOficial}
                    onChange={(event) => setEntrarNoCanalOficial(event.target.checked)}
                  />
                  {strings.gate.canalOficial}
                </label>
              </div>
            )}

            {/* Phase 6, layer 1: the account sentence, on the last screen before
                "Create". This is the last moment the password can still be
                chosen thinking there is no going back. */}
            {!aCriar && ultimo && <FraseDoMomento id="conta" />}

            {aCriar && (
              <ol className="setup-steps">
                {SETUP_STEPS.map((step) => (
                  <li
                    key={step}
                    className={progress.current[step] ? "done" : step === busyStep ? "current" : undefined}
                  >
                    {strings.gate.stepNames[step]}
                  </li>
                ))}
              </ol>
            )}

            {error && (
            <p className="error">
              <TextoDeErro texto={error} />
            </p>
          )}
          </div>

          {/* Before "Create": the age the Terms ask for, and that creating the
              account accepts them. No checkbox: the Terms say that using the
              service is the acceptance. orwell.pt's Terms, so only on orwell.pt. */}
          {!aCriar && ultimo && termosDoOrwell && <p className="field-note setup-termos">{strings.legal.idadeEAceitacao}</p>}

          <div className="setup-actions">
            {/* On the first screen, "Back" goes to the other device question:
                that is how you reach pairing after saying "No". */}
            {!aCriar && (posicao > 0 || onJoinInstead) && (
              <Button
                variant="ghost"
                type="button"
                onClick={() => (posicao > 0 ? setIndice(posicao - 1) : setACriarConta(false))}
              >
                {strings.gate.back}
              </Button>
            )}
            <Button
              variant="primary"
              type="submit"
              className="setup-go"
              disabled={busyStep !== null || aSondar || (!aCriar && !pronto) || (aCriar && conviteRecusado && convite.trim() === "")}
            >
              {busyStep
                ? strings.gate.stepLabels[busyStep]
                : error
                  ? strings.common.retry
                  : ultimo
                    ? strings.gate.create
                    : passo === "fotografia" && !avatar
                      ? strings.gate.skipPhoto
                      : strings.gate.next}
            </Button>
          </div>

          {/* The server, off everyone's path but within reach for those who
              look for it. Only on the first screen: the account does not yet exist
              there and the choice still means something. */}
          {!aCriar && passo === "nome" && (
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
                      aria-invalid={serverError ? true : undefined}
                      onChange={(event) => {
                        setServer(event.target.value)
                        setServerError(null)
                        // Another server: what the last one said about new accounts no longer holds.
                        setRegisto(null)
                      }}
                    />
                  </Field>
                  <p className="field-note">{strings.gate.advancedNote}</p>
                  {serverError && <p className="error">{serverError}</p>}
                </>
              )}
            </div>
          )}
        </form>

        {!aCriar && passo === "nome" && (
          <div className="setup-import">
            {/* The "Pair" button that was here (the "third option") moved up
                to the first Setup question: phase 8.1.
                Import remains, for those with the file. */}
            <p className="gate-lead">{strings.gate.importLead}</p>
            <ImportAccount replacing={false} onDone={onDone} />
          </div>
        )}

        {/* Phase 6: "How it works" before there is an account, as in `Unlock`.
            On every screen: the doubt ("why is there no email?") can arise
            on any of them. */}
        <div className="gate-rodape">
          <p>
            <button type="button" className="gate-link" onClick={() => setComoFunciona(true)}>
              {strings.comoFunciona.link}
            </button>
          </p>
          {/* GDPR art. 13: the policy is at hand on every screen that asks for data.
              orwell.pt's policy, so only for an account on orwell.pt. */}
          {termosDoOrwell && (
            <p>
              <LigacoesLegais className="gate-link" />
            </p>
          )}
          {!aCriar && <LigacaoMudarDeConta rotulo={strings.contas.voltar} podeAcrescentar={false} />}
        </div>
      </div>
      {comoFunciona && <FolhaComoFunciona onClose={() => setComoFunciona(false)} />}
    </div>
  )
}
