import { useState } from "react"
import { marcarFicheiroTratado } from "../../lib/ficheiroDaConta.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { useBridge } from "../../App.js"
import type { FicheiroDeContaEscolhido } from "../../bridge.js"
import { useToast } from "../../components/Toast.js"
import { Button } from "../../components/Button.js"
import { ApagarConta } from "../../components/ConfirmarDestruicao.js"
import { Field } from "../../components/Field.js"
import { fraseDoCampo } from "./fraseDoCampo.js"
import { formaDoFicheiro } from "../../lib/ficheiroDeConta.js"
import { strings, traduzirErro } from "../../strings.js"

/**
 * Bring an exported account onto this device.
 *
 * The file is the encrypted vault; the passphrase proves ownership by
 * decrypting it before anything local is touched. Replacing an existing vault
 * is destruction of the local account, so that path asks with the same sheet
 * as Settings and the gate, typed word included (`ApagarConta`). And the warning is not small print: importing MOVES the account to
 * this device, and two devices running the same copy break the channels'
 * cryptography for good. Two devices is what pairing is for.
 */
export function ImportAccount({
  replacing,
  onDone,
}: {
  /** A vault already lives on this device; importing destroys it. */
  replacing: boolean
  onDone: (address: string) => void
}): React.JSX.Element {
  const bridge = useBridge()
  const toast = useToast()
  /**
   * The chosen file, whole. It goes to the bridge like this: the container with
   * the images can be hundreds of MB. On the desktop it is only the mark of the
   * file the main process chose and kept (`escolherFicheiroDeConta`).
   */
  const [data, setData] = useState<Blob | FicheiroDeContaEscolhido | null>(null)
  const [fileName, setFileName] = useState("")
  const [passphrase, setPassphrase] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The passphrase read from the field, waiting for the delete account sheet to say yes. */
  const [aConfirmar, setAConfirmar] = useState<string | null>(null)

  /*
    The file shape is checked here, before the password and before the delete
    sheet. A file that is not an account file was only refused at the end, when
    the person had already typed "apagar"; now the rest of the form does not
    even open. The sentence is the core's, with the same code. See
    `formaDoFicheiroDeConta`, which reads in slices (the file with the images
    is large).
  */
  const aceitar = (forma: "conta" | "beta" | "outro", ficheiro: Blob | FicheiroDeContaEscolhido, nome: string): void => {
    // A 0.9.x file is named as such, and not as "not an account file": it is an
    // account file, but from a version 1.0 does not read (1.0 "Arca", slice 2).
    if (forma === "beta") {
      setData(null)
      setFileName("")
      setError(traduzirErro(new Error("this account file is from the beta")))
      return
    }
    if (forma !== "conta") {
      setData(null)
      setFileName("")
      // The core sentence, written out in full: that is how the error code sweep
      // (`codigosDeErro.cobertura.test.ts`) finds it.
      setError(traduzirErro(new Error("this is not an enclave account file")))
      return
    }
    setData(ficheiro)
    setFileName(nome)
  }

  const pick = (file: File | undefined): void => {
    if (!file) return
    setError(null)
    void formaDoFicheiro(file)
      .catch(() => "outro" as const)
      .then((forma) => aceitar(forma, file, file.name))
  }

  /** The desktop: the main process opens the dialog and keeps the path. The interface only gets the name and the shape. */
  const escolherNaSecretaria = (): void => {
    const escolher = bridge.vault.escolherFicheiroDeConta
    if (!escolher) return
    setError(null)
    void escolher()
      .then((escolha) => {
        if (escolha) aceitar(escolha.forma, { escolhido: true }, escolha.nome)
      })
      .catch((caught: Error) => setError(traduzirErro(caught)))
  }

  /*
    The passphrase comes from the FIELD, not from React state. See `fraseDoCampo`.

    Here the bug was the cruelest of the three: the passphrase that opens the file
    is not the one the system manager has stored for this account, and if they
    fill over what the user typed, the import runs with the wrong passphrase and
    answers "the vault is damaged, or the passphrase is wrong" on an intact file.
    That is what happened to the owner on September 30, 2026, and it made them
    doubt the file instead of the screen.

    And so the button also stopped looking at the state length: with the field
    full and the state empty, it was disabled with nothing to explain it.
  */
  const run = (formulario: HTMLFormElement | null): void => {
    const frase = fraseDoCampo(formulario, "import-password", passphrase)
    if (!data || frase.length === 0 || busy) return
    // Importing over an existing account deletes it. It is asked first, and only
    // the sheet's answer lets it proceed.
    if (replacing) setAConfirmar(frase)
    else importar(frase)
  }

  const importar = (frase: string): void => {
    if (!data) return
    setBusy(true)
    setError(null)
    void (async () => {
      const resultado = await bridge.vault.import(data, frase)
      // The account got in; the images that did not stay are reported, and come back from another device.
      const emFalta = resultado.emFalta ?? 0
      if (emFalta > 0) toast(strings.gate.importImagensEmFalta(emFalta))
      await bridge.vault.unlock(frase)
      const identity = await bridge.identity.load()
      await bridge.session.connect()
      // The account came in from its file: the notice about saving the file is not owed here.
      void marcarFicheiroTratado(identity.address)
      onDone(identity.address)
    })().catch((caught: Error) => {
      setError(traduzirErro(caught))
      setBusy(false)
    })
  }

  return (
    <div className="import-account">
      {bridge.vault.escolherFicheiroDeConta ? (
        <button type="button" className="ghost file wide" onClick={escolherNaSecretaria}>
          {data ? fileName : strings.gate.importPick}
        </button>
      ) : (
        <label className="ghost file wide">
          {data ? fileName : strings.gate.importPick}
          <input
            type="file"
            accept=".enclave,application/json"
            onChange={(event) => {
              pick(event.target.files?.[0])
              event.target.value = ""
            }}
          />
        </label>
      )}
      {/* A file rejected by shape does not open the form: the error stays
          here, below the choose button, which is the gesture to repeat. */}
      {!data && error && (
        <p className="error" role="alert">
          <TextoDeErro texto={error} />
        </p>
      )}
      {data && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            run(event.currentTarget)
          }}
        >
          <Field label={strings.gate.importPassLabel}>
            <input
              type="password"
              name="import-password"
              /* The FILE passphrase is not the account passphrase: asking the manager to
                 fill it was offering the wrong secret. */
              autoComplete="off"
              value={passphrase}
              autoFocus
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </Field>
          <p className="gate-warning">{strings.settings.importReplacesDevice}</p>
          {error && (
            <p className="error">
              <TextoDeErro texto={error} />
            </p>
          )}
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? strings.gate.importing : strings.gate.importAction}
          </Button>
        </form>
      )}
      {aConfirmar !== null && (
        <ApagarConta
          porta="importar"
          onClose={() => setAConfirmar(null)}
          fazer={() => {
            // The sheet closes, and import runs as always: its errors
            // (wrong passphrase, corrupted file) come from the form, not the sheet.
            setAConfirmar(null)
            importar(aConfirmar)
          }}
        />
      )}
    </div>
  )
}
