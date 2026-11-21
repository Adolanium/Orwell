import { useEffect, useId, useRef, useState } from "react"
import { useBridge } from "../App.js"
import { marcarFicheiroTratado } from "../lib/ficheiroDaConta.js"
import { fraseDoCampo } from "../screens/gate/fraseDoCampo.js"
import { IconeFicheiro } from "../screens/gate/Entrada.js"
import { strings, traduzirErro } from "../strings.js"
import { Button } from "./Button.js"
import { Field } from "./Field.js"
import { Modal } from "./Modal.js"
import { useToast } from "./Toast.js"

/**
 * The account file (.enclave): with it and the password, the account opens on
 * any device, and no device leaves (21/11/2026, mock-up `Main`).
 *
 * Two places, one sentence: the step right after the account is created
 * (`GuardarFicheiroDaConta`), which can be left for later, and the sheet that
 * the banner inside the app opens (`FolhaDoFicheiroDaConta`). The banner stays
 * until a file is saved or the account has a second device. See `App.tsx`.
 *
 * The file is `exportVault`: the vault as it is on disk, locked with the
 * account's password. A vault the system keychain guards (`protection: "os"`,
 * old desktop accounts) has no password to travel with, so the person chooses
 * one for the file first.
 *
 * One button. Where the browser can share files (the iPhone), it opens the
 * share sheet, which has "Save to Files"; elsewhere it downloads. The file is
 * made ready before the tap: a share must start inside the tap, and making the
 * file can take a second.
 */

const PRECISA_DE_FRASE = "an export passphrase is required"
const FRASE_MINIMA = 8
const CAMPO = "frase-do-ficheiro"
/** Read when used, not at load: the language can change after the module loads. */
const nomeDoFicheiro = (): string => strings.ficheiroDaConta.nomeDoFicheiro

interface Ficheiro {
  /** The system keychain guards this vault: a password for the file comes first. */
  pedeFrase: boolean
  /** The file, ready. Null until made (or while the password is missing). */
  pronto: string | null
  aPreparar: boolean
  guardar: (frase?: string) => Promise<boolean>
}

function podePartilharFicheiros(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false
  // Only on a touch device: Safari on a computer can share too, and there the person expects a download.
  try {
    if (typeof window !== "undefined" && window.matchMedia && !window.matchMedia("(pointer: coarse)").matches) return false
  } catch {
    // No media queries: go on.
  }
  try {
    return navigator.canShare({ files: [new File([""], nomeDoFicheiro())] })
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
    toast(strings.entrada.guardado)
    onGuardado()
  }

  const partilhar = async (data: string): Promise<boolean> => {
    const ficheiro = new File([data], nomeDoFicheiro(), { type: "application/json" })
    try {
      await navigator.share({ files: [ficheiro], title: strings.entrada.guardarTitulo })
    } catch (erro) {
      // The person closed the sheet: nothing was saved, and that is not a fault.
      if ((erro as Error)?.name !== "AbortError") toast(traduzirErro(erro), "error")
      return false
    }
    guardado()
    return true
  }

  const guardar = async (frase?: string): Promise<boolean> => {
    if (podePartilhar && pronto !== null) return partilhar(pronto)
    const data = pronto ?? (await preparar(frase))
    if (data === null) return false
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }))
    const ancora = document.createElement("a")
    ancora.href = url
    ancora.download = nomeDoFicheiro()
    ancora.click()
    URL.revokeObjectURL(url)
    guardado()
    return true
  }

  return { pedeFrase, pronto, aPreparar, guardar }
}

/** The password for the file (old keychain vaults only) and the one button. The same in the step and in the sheet. */
function Guardar({ ficheiro }: { ficheiro: Ficheiro }): React.JSX.Element {
  const [frase, setFrase] = useState("")
  const nota = useId()
  const semFrase = ficheiro.pedeFrase && ficheiro.pronto === null
  return (
    <form
      className="ficheiro-da-conta-botoes"
      onSubmit={(event) => {
        event.preventDefault()
        // From the FIELD: a password manager may fill it without events. See `fraseDoCampo`.
        const escrita = fraseDoCampo(event.currentTarget, CAMPO, frase)
        if (semFrase && escrita.length < FRASE_MINIMA) return
        void ficheiro.guardar(semFrase ? escrita : undefined)
      }}
    >
      {semFrase && (
        <>
          <Field label={strings.entrada.palavraPasse}>
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
            {strings.entrada.minimo}
          </p>
        </>
      )}
      <Button
        variant="primary"
        type="submit"
        className="entrada-botao"
        disabled={ficheiro.aPreparar || (semFrase && frase.length < FRASE_MINIMA)}
      >
        {ficheiro.aPreparar ? strings.entrada.aPrepararFicheiro : strings.entrada.guardarFicheiro}
      </Button>
    </form>
  )
}

/**
 * The step right after the account is created. Saving goes on into the app;
 * "Fazer mais tarde" goes too, and the banner inside the app stays until there
 * is a file.
 */
export function GuardarFicheiroDaConta({ address, onContinuar }: { address: string; onContinuar: () => void }): React.JSX.Element {
  const titulo = useId()
  const ficheiro = useFicheiro(address, onContinuar)
  return (
    <div className="gate">
      <section className="gate-card gate-entrada ficheiro-da-conta" aria-labelledby={titulo}>
        <span className="entrada-icone" aria-hidden="true">
          <IconeFicheiro tamanho={32} />
        </span>
        <h1 id={titulo} className="entrada-titulo">
          {strings.entrada.guardarTitulo}
        </h1>
        <p className="gate-lead">{strings.entrada.guardarTexto}</p>
        <div className="entrada-fundo">
          <Guardar ficheiro={ficheiro} />
          <button type="button" className="gate-link entrada-link" onClick={onContinuar}>
            {strings.entrada.maisTarde}
          </button>
        </div>
      </section>
    </div>
  )
}

/** The sheet the banner opens. Closing it does not count as saved: the banner stays. */
export function FolhaDoFicheiroDaConta({
  address,
  onGuardado,
  onFechar,
}: {
  address: string
  onGuardado: () => void
  onFechar: () => void
}): React.JSX.Element {
  const titulo = useId()
  const ficheiro = useFicheiro(address, onGuardado)
  return (
    <Modal className="sheet narrow ficheiro-da-conta-aviso" labelledBy={titulo} onClose={onFechar}>
      <header className="sheet-header">
        <h2 id={titulo}>{strings.entrada.guardarTitulo}</h2>
        <Button variant="ghost" type="button" onClick={onFechar}>
          {strings.common.close}
        </Button>
      </header>
      <div className="sheet-body">
        <p>{strings.entrada.guardarTexto}</p>
        <Guardar ficheiro={ficheiro} />
      </div>
    </Modal>
  )
}
