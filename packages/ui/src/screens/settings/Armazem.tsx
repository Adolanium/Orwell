import { TECTOS_DO_ARMAZEM, type EstadoDoArmazem } from "@enclave/client-core"
import { useCallback, useEffect, useState } from "react"
import { useBridge } from "../../App.js"
import { Button } from "../../components/Button.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { useToast } from "../../components/Toast.js"
import { useConfirmar } from "../../hooks/useConfirmar.js"
import { formatarBytes } from "../../lib/ficheiros.js"
import { strings, traduzirErro } from "../../strings.js"

/** "250 MB", "1 GB": the selector options, without the decimal place `formatarBytes` gives below 10. */
function rotuloDoTecto(bytes: number): string {
  if (bytes === 0) return strings.settings.armazem.semTecto
  return bytes >= 1_000_000_000 ? `${bytes / 1_000_000_000} GB` : `${bytes / 1_000_000} MB`
}

/**
 * The space for images and files on this device (design §8 and §13), in
 * Settings › Devices: the media store ceiling, what is in use, and "Free up
 * space".
 *
 * It is a choice of the DEVICE, not of the person: it goes only to the bridge
 * (`media`), and the core keeps it in the store backend. It never travels with
 * the account.
 *
 * On the web, the browser may give less space than the chosen ceiling: the
 * core keeps the smaller (`tectoEfectivo`), and this screen says which it is.
 *
 * Without `media` on the bridge (a `preload` from another version) there is no
 * section.
 */
export function Armazem(): React.JSX.Element | null {
  const bridge = useBridge()
  const toast = useToast()
  const confirmar = useConfirmar()
  const media = bridge.media
  const [estado, setEstado] = useState<EstadoDoArmazem | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aLibertar, setALibertar] = useState(false)

  const reler = useCallback((): void => {
    if (!media) return
    void media
      .estado()
      .then(setEstado)
      .catch(() => setEstado(null))
  }, [media])

  useEffect(reler, [reler])

  if (!media) return null

  const mudarTecto = (bytes: number): void => {
    setErro(null)
    media
      .definirTecto(bytes)
      .catch((e: Error) => setErro(traduzirErro(e)))
      .finally(reler)
  }

  const pedirLibertar = (): void => {
    if (aLibertar) return
    void confirmar({
      titulo: strings.settings.armazem.libertarTitulo,
      corpo: strings.settings.armazem.libertarCorpo,
      verbo: strings.settings.armazem.libertar,
      destructive: true,
    }).then((sim) => {
      if (!sim) return
      setErro(null)
      setALibertar(true)
      media
        .libertar()
        .then(() => toast(strings.settings.armazem.libertado))
        .catch((e: Error) => setErro(traduzirErro(e)))
        .finally(() => {
          setALibertar(false)
          reler()
        })
    })
  }

  const tecto = estado?.tecto ?? TECTOS_DO_ARMAZEM.omissao
  const apertado = estado !== null && estado.tectoEfectivo !== estado.tecto

  return (
    <section className="card settings-card">
      <h2>{strings.settings.armazem.titulo}</h2>
      <p className="field-note">{strings.settings.armazem.nota}</p>
      <select
        className="field"
        value={String(tecto)}
        aria-label={strings.settings.armazem.titulo}
        onChange={(event) => mudarTecto(Number(event.target.value))}
      >
        {TECTOS_DO_ARMAZEM.opcoes.map((bytes) => (
          <option key={bytes} value={String(bytes)}>
            {rotuloDoTecto(bytes)}
          </option>
        ))}
      </select>
      {estado && (
        <p className="field-note">{strings.settings.armazem.emUso(formatarBytes(estado.usados), formatarBytes(estado.usadosPelasMinis))}</p>
      )}
      {apertado && <p className="field-note warn">{strings.settings.armazem.quota(formatarBytes(estado.tectoEfectivo))}</p>}
      <Button variant="ghost" disabled={aLibertar} onClick={pedirLibertar}>
        {strings.settings.armazem.libertar}
      </Button>
      {erro && (
        <p className="error" role="alert">
          <TextoDeErro texto={erro} />
        </p>
      )}
    </section>
  )
}
