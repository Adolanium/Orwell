import { useState, type ReactNode } from "react"
import { BIO_CONTADOR_DESDE, BIO_MAX, contarGrafemas, cortarBio } from "@enclave/client-core"
import { strings } from "../strings.js"

/**
 * The field where the profile bio is written, on phone and computer alike.
 *
 * It will not hold more than `BIO_MAX` graphemes (`cortarBio`): typing stops
 * there and a long paste is cut, with a short sentence that says why. No
 * `maxLength`: that counts UTF-16 units, and would split a compound emoji.
 *
 * The counter ("247/300") shows only in the last 60 graphemes
 * (`BIO_CONTADOR_DESDE`): a bio is a few lines, and a number under every short
 * one is noise. It sits below the `<label>`, so it is not part of the field's
 * accessible name. Same foot, same classes as `CampoDeNome`.
 *
 * While an input method is composing, the text passes as is and is cut when
 * the composition ends, so a half-built character is never split.
 */
export function CampoDaBio({
  rotulo,
  value,
  onChange,
}: {
  rotulo: ReactNode
  value: string
  onChange: (valor: string) => void
}): React.JSX.Element {
  const [cortado, setCortado] = useState(false)
  const contados = contarGrafemas(value)

  const aceitar = (bruto: string): void => {
    const guardado = cortarBio(bruto)
    setCortado(guardado !== bruto)
    onChange(guardado)
  }

  return (
    <>
      <label>
        {rotulo}
        <textarea
          value={value}
          rows={3}
          onChange={(event) => {
            if ((event.nativeEvent as InputEvent).isComposing) onChange(event.target.value)
            else aceitar(event.target.value)
          }}
          onCompositionEnd={(event) => aceitar(event.currentTarget.value)}
        />
      </label>
      {(cortado || contados >= BIO_CONTADOR_DESDE) && (
        <p className="campo-de-nome-pe">
          {cortado && (
            <span className="aviso-do-nome" role="status">
              {strings.profileEditor.bioMaximo(BIO_MAX)}
            </span>
          )}
          <span className="contador-do-nome contador-da-bio" aria-label={strings.nomeCurto.contadorRotulo(contados, BIO_MAX)}>
            {strings.nomeCurto.contador(contados, BIO_MAX)}
          </span>
        </p>
      )}
    </>
  )
}
