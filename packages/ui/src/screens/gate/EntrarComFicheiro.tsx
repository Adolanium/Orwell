import { useRef, useState } from "react"
import { useBridge } from "../../App.js"
import type { FicheiroDeContaEscolhido } from "../../bridge.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { useToast } from "../../components/Toast.js"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { marcarFicheiroTratado } from "../../lib/ficheiroDaConta.js"
import { formaDoFicheiro } from "../../lib/ficheiroDeConta.js"
import { strings, traduzirErro } from "../../strings.js"
import { CampoDeIdentidade } from "./CampoDeIdentidade.js"
import { CartaoDoPortao, IconeFicheiro } from "./Entrada.js"
import { fraseDoCampo } from "./fraseDoCampo.js"

/**
 * "Entrar com o ficheiro da conta" (mock-ups `Ficheiro` and `Desktop`, 21/11/2026).
 *
 * The file and the password, and the person is in. Since 1.3.26 the core makes
 * THIS device a new device of the account (`passagem.ts`): no other device
 * leaves, and the others see "Novo aparelho na tua conta". So there is nothing
 * to warn about and nothing to delete here. The gate only opens this screen on
 * a device with no vault: "Usar outra conta" and "Esqueci-me" add an empty
 * account first (`outraEntrada.ts`).
 *
 * The file's shape is checked as soon as it is chosen: a file that is not an
 * account says so under the box, and the password field does not open.
 */
export const CAMPO_DA_FRASE = "import-password"

/** A computer with a mouse: the box also takes a dragged file, and says so. */
function arrastaveis(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches === true
  } catch {
    return false
  }
}

export function EntrarComFicheiro({ onDone, onVoltar }: { onDone: (address: string) => void; onVoltar?: () => void }): React.JSX.Element {
  const bridge = useBridge()
  const toast = useToast()
  /**
   * The chosen file, whole. It goes to the bridge like this: the container with
   * the images can be hundreds of MB. On the desktop, a file chosen in the system
   * dialog is only the mark of the file the main process kept.
   */
  const [data, setData] = useState<Blob | FicheiroDeContaEscolhido | null>(null)
  const [nome, setNome] = useState("")
  const [frase, setFrase] = useState("")
  const [aEntrar, setAEntrar] = useState(false)
  const [erroDoFicheiro, setErroDoFicheiro] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [porCima, setPorCima] = useState(false)
  const [comRato] = useState(arrastaveis)
  const escolha = useRef<HTMLInputElement | null>(null)

  const aceitar = (forma: "conta" | "beta" | "outro", ficheiro: Blob | FicheiroDeContaEscolhido, nomeDoFicheiro: string): void => {
    if (forma !== "conta") {
      setData(null)
      setNome("")
      // The core sentence, written out in full: the error code sweep finds it like this.
      setErroDoFicheiro(
        traduzirErro(new Error(forma === "beta" ? "this account file is from the beta" : "this is not an enclave account file")),
      )
      return
    }
    setErroDoFicheiro(null)
    setErro(null)
    setData(ficheiro)
    setNome(nomeDoFicheiro)
  }

  const ler = (ficheiro: File | undefined): void => {
    if (!ficheiro) return
    void formaDoFicheiro(ficheiro)
      .catch(() => "outro" as const)
      .then((forma) => aceitar(forma, ficheiro, ficheiro.name))
  }

  /** The desktop: the main process opens the dialog and keeps the path. The interface only gets the name and the shape. */
  const escolher = (): void => {
    const doSistema = bridge.vault.escolherFicheiroDeConta
    if (!doSistema) {
      escolha.current?.click()
      return
    }
    void doSistema()
      .then((escolhido) => {
        if (escolhido) aceitar(escolhido.forma, { escolhido: true }, escolhido.nome)
      })
      .catch((caught: Error) => setErroDoFicheiro(traduzirErro(caught)))
  }

  /*
    The password comes from the FIELD, not from React state: a password manager
    can fill it without an event. See `fraseDoCampo`.
  */
  const entrar = (formulario: HTMLFormElement | null): void => {
    const escrita = fraseDoCampo(formulario, CAMPO_DA_FRASE, frase)
    if (!data || escrita.length === 0 || aEntrar) return
    setAEntrar(true)
    setErro(null)
    void (async () => {
      const resultado = await bridge.vault.import(data, escrita)
      // The account got in; the images that did not stay are said, and come back from another device.
      const emFalta = resultado.emFalta ?? 0
      if (emFalta > 0) toast(strings.gate.importImagensEmFalta(emFalta))
      await bridge.vault.unlock(escrita)
      const identity = await bridge.identity.load()
      await bridge.session.connect()
      // The account came in from its file: this browser has the file.
      void marcarFicheiroTratado(identity.address)
      onDone(identity.address)
    })().catch((caught: Error) => {
      setErro(traduzirErro(caught))
      setAEntrar(false)
    })
  }

  const pronto = data !== null && frase.length > 0

  return (
    <div className="gate">
      <CartaoDoPortao titulo={strings.entrada.comFicheiro} onVoltar={onVoltar} voltarDesligado={aEntrar}>
        {data ? (
          <div className="entrada-ficheiro-escolhido">
            <IconeFicheiro tamanho={24} />
            <span className="entrada-ficheiro-nome">{nome}</span>
            <button type="button" className="gate-link entrada-link" disabled={aEntrar} onClick={escolher}>
              {strings.entrada.trocar}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={porCima ? "entrada-largar por-cima" : "entrada-largar"}
            onClick={escolher}
            onDragOver={(event) => {
              event.preventDefault()
              setPorCima(true)
            }}
            onDragLeave={() => setPorCima(false)}
            onDrop={(event) => {
              event.preventDefault()
              setPorCima(false)
              ler(event.dataTransfer.files?.[0])
            }}
          >
            <IconeFicheiro tamanho={32} />
            {comRato ? (
              <span>
                {strings.entrada.arrastarOu} <span className="entrada-largar-escolher">{strings.entrada.escolheO}</span>
              </span>
            ) : (
              <span>{strings.entrada.escolherFicheiro}</span>
            )}
          </button>
        )}
        <input
          ref={escolha}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          accept=".enclave,application/json"
          onChange={(event) => {
            ler(event.target.files?.[0])
            event.target.value = ""
          }}
        />
        {erroDoFicheiro && (
          <p className="error" role="alert">
            <TextoDeErro texto={erroDoFicheiro} />
          </p>
        )}
        <form
          className="entrada-formulario"
          onSubmit={(event) => {
            event.preventDefault()
            entrar(event.currentTarget)
          }}
        >
          {/* The account's name for the password manager. See `CampoDeIdentidade`. */}
          <CampoDeIdentidade />
          <Field label={strings.entrada.palavraPasse}>
            <input
              type="password"
              name={CAMPO_DA_FRASE}
              autoComplete="current-password"
              value={frase}
              disabled={aEntrar}
              aria-invalid={erro ? true : undefined}
              onChange={(event) => {
                setFrase(event.target.value)
                setErro(null)
              }}
              // A manager that fills without an event still turns the button on.
              onBlur={(event) => setFrase(event.currentTarget.value)}
            />
          </Field>
          {erro && (
            <p className="error" role="alert">
              <TextoDeErro texto={erro} />
            </p>
          )}
          <Button variant="primary" type="submit" className="entrada-botao" disabled={!pronto || aEntrar}>
            {aEntrar ? strings.entrada.aEntrar : strings.entrada.entrar}
          </Button>
        </form>
      </CartaoDoPortao>
    </div>
  )
}
