import { useEffect, useId, useRef, useState } from "react"
import { useBridge } from "../App.js"
import { marcarFicheiroTratado } from "../lib/ficheiroDaConta.js"
import { fraseDoCampo } from "../screens/gate/fraseDoCampo.js"
import { strings, traduzirErro } from "../strings.js"
import { Button } from "./Button.js"
import { Field } from "./Field.js"
import { Modal } from "./Modal.js"
import { useToast } from "./Toast.js"

/**
 * The account file (.enclave): the only way back into an account (16/11/2026).
 *
 * There is no email and no phone number, so nothing can reset an account. A
 * new account gets a step right after it is created (`PassoDoFicheiroDaConta`),
 * and an account that already existed gets one notice, once
 * (`AvisoDoFicheiroDaConta`).
 *
 * The file is `exportVault`: the vault as it is on disk, locked with the
 * account's password. A vault the system keychain guards (`protection: "os"`,
 * the old desktop accounts) has no password to travel with, so the person
 * chooses one for the file first.
 *
 * Where the browser can share files (the iPhone), "Share" opens the share
 * sheet, which has "Save to Files". The file is made ready before the tap: a
 * share must start inside the tap, and making the file can take a second.
 */

const PRECISA_DE_FRASE = "an export passphrase is required"
const FRASE_MINIMA = 8
const CAMPO = "frase-do-ficheiro"

interface Ficheiro {
  /** The system keychain guards this vault: a password for the file comes first. */
  pedeFrase: boolean
  /** The file, ready. Null until made (or while the password is missing). */
  pronto: string | null
  aPreparar: boolean
  podePartilhar: boolean
  /** Make the file with this password (only when `pedeFrase`). */
  preparar: (frase?: string) => Promise<string | null>
  descarregar: (frase?: string) => Promise<boolean>
  partilhar: () => Promise<boolean>
}

function podePartilharFicheiros(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false
  try {
    return navigator.canShare({ files: [new File([""], strings.ficheiroDaConta.nomeDoFicheiro)] })
  } catch {
    return false
  }
}

function useFicheiro(address: string, onGuardado: () => void): Ficheiro {
  const bridge = useBridge()
  const toast = useToast()
  const [pedeFrase, setPedeFrase] = useState(false)
  const [pronto, setPronto] = useState<string | null>(null)
  const [aPreparar, setAPreparar] = useState(false)
  const [podePartilhar] = useState(podePartilharFicheiros)
  // One export at a time: Argon2id runs for each one (see `SettingsScreen.exportAccount`).
  const emCurso = useRef<Promise<string | null> | null>(null)

  const preparar = (frase?: string): Promise<string | null> => {
    if (emCurso.current) return emCurso.current
    setAPreparar(true)
    const pedido = bridge.vault
      .export(frase)
      .then((ficheiro) => {
        // Without images, every host answers with the text of the file.
        const data = "data" in ficheiro ? ficheiro.data : null
        if (data !== null) setPronto(data)
        return data
      })
      .catch((erro: Error) => {
        if (erro.message === PRECISA_DE_FRASE) setPedeFrase(true)
        else toast(traduzirErro(erro), "error")
        return null
      })
      .finally(() => {
        emCurso.current = null
        setAPreparar(false)
      })
    emCurso.current = pedido
    return pedido
  }

  // Ready before the first tap, when no password is needed. A keychain vault answers with `PRECISA_DE_FRASE`.
  useEffect(() => {
    void bridge.vault
      .status()
      .then((estado) => {
        if (estado.protection === "os") setPedeFrase(true)
        else void preparar()
      })
      .catch(() => void preparar())
    // Once per screen: the file is the vault as it is now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const guardado = (): void => {
    void marcarFicheiroTratado(address)
    toast(strings.ficheiroDaConta.guardado)
    onGuardado()
  }

  const descarregar = async (frase?: string): Promise<boolean> => {
    const data = pronto ?? (await preparar(frase))
    if (data === null) return false
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }))
    const ancora = document.createElement("a")
    ancora.href = url
    ancora.download = strings.ficheiroDaConta.nomeDoFicheiro
    ancora.click()
    URL.revokeObjectURL(url)
    guardado()
    return true
  }

  const partilhar = async (): Promise<boolean> => {
    if (pronto === null) return false
    const ficheiro = new File([pronto], strings.ficheiroDaConta.nomeDoFicheiro, { type: "application/json" })
    try {
      await navigator.share({ files: [ficheiro], title: strings.ficheiroDaConta.titulo })
    } catch (erro) {
      // The person closed the sheet: nothing was saved, and that is not a fault.
      if ((erro as Error)?.name !== "AbortError") toast(traduzirErro(erro), "error")
      return false
    }
    guardado()
    return true
  }

  return { pedeFrase, pronto, aPreparar, podePartilhar, preparar, descarregar, partilhar }
}

/** The password for the file, the buttons, and nothing else: the same in the step and in the notice. */
function Botoes({ ficheiro }: { ficheiro: Ficheiro }): React.JSX.Element {
  const [frase, setFrase] = useState("")
  const formulario = useRef<HTMLFormElement>(null)
  const nota = useId()
  const semFrase = ficheiro.pedeFrase && ficheiro.pronto === null
  return (
    <form
      ref={formulario}
      className="ficheiro-da-conta-botoes"
      onSubmit={(event) => {
        event.preventDefault()
        // From the FIELD: a password manager may fill it without events. See `fraseDoCampo`.
        const escrita = fraseDoCampo(event.currentTarget, CAMPO, frase)
        if (semFrase && escrita.length < FRASE_MINIMA) return
        void ficheiro.descarregar(semFrase ? escrita : undefined)
      }}
    >
      {semFrase && (
        <>
          <Field label={strings.ficheiroDaConta.fraseLabel}>
            <input
              type="password"
              name={CAMPO}
              autoComplete="new-password"
              aria-describedby={nota}
              value={frase}
              onChange={(event) => setFrase(event.target.value)}
            />
          </Field>
          <p id={nota} className="field-note">
            {strings.ficheiroDaConta.fraseNota}
          </p>
        </>
      )}
      <Button variant="primary" type="submit" disabled={ficheiro.aPreparar || (semFrase && frase.length < FRASE_MINIMA)}>
        {ficheiro.aPreparar ? strings.ficheiroDaConta.aDescarregar : strings.ficheiroDaConta.descarregar}
      </Button>
      {ficheiro.podePartilhar && ficheiro.pronto !== null && (
        <Button variant="ghost" type="button" onClick={() => void ficheiro.partilhar()}>
          {strings.ficheiroDaConta.partilhar}
        </Button>
      )}
    </form>
  )
}

/**
 * The step right after the account is created. "Continue" stays off until the
 * file went out (downloaded or shared) AND the box is ticked.
 */
export function PassoDoFicheiroDaConta({ address, onContinuar }: { address: string; onContinuar: () => void }): React.JSX.Element {
  const titulo = useId()
  const [saiu, setSaiu] = useState(false)
  const [guardei, setGuardei] = useState(false)
  const ficheiro = useFicheiro(address, () => setSaiu(true))
  return (
    <div className="gate">
      <section className="gate-card ficheiro-da-conta" aria-labelledby={titulo}>
        <h1 id={titulo}>{strings.ficheiroDaConta.titulo}</h1>
        <p className="gate-lead">{strings.ficheiroDaConta.texto}</p>
        <Botoes ficheiro={ficheiro} />
        <label className="checkbox">
          <input type="checkbox" name="guardei-o-ficheiro" checked={guardei} onChange={(event) => setGuardei(event.target.checked)} />
          {strings.ficheiroDaConta.guardei}
        </label>
        <Button variant="primary" type="button" disabled={!saiu || !guardei} onClick={onContinuar}>
          {strings.ficheiroDaConta.continuar}
        </Button>
        <p className="field-note">{strings.ficheiroDaConta.nota}</p>
      </section>
    </div>
  )
}

/** The one-time notice for an account that already existed. Closing it counts as seen. */
export function AvisoDoFicheiroDaConta({ address, onFechar }: { address: string; onFechar: () => void }): React.JSX.Element {
  const titulo = useId()
  const fechar = (): void => {
    void marcarFicheiroTratado(address)
    onFechar()
  }
  const ficheiro = useFicheiro(address, onFechar)
  return (
    <Modal className="sheet ficheiro-da-conta-aviso" labelledBy={titulo} onClose={fechar}>
      <header className="sheet-header">
        <h2 id={titulo}>{strings.ficheiroDaConta.aviso}</h2>
        <Button variant="ghost" type="button" onClick={fechar}>
          {strings.ficheiroDaConta.fechar}
        </Button>
      </header>
      <div className="sheet-body">
        <p>{strings.ficheiroDaConta.texto}</p>
        <Botoes ficheiro={ficheiro} />
        <p className="field-note">{strings.ficheiroDaConta.nota}</p>
      </div>
    </Modal>
  )
}
