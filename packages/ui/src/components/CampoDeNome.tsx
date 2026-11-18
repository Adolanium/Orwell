import { useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react"
import { contarGrafemas, cortarNome, NOME_MAX } from "@enclave/client-core"
import { strings } from "../strings.js"

/**
 * The field where a display name is written: signup, the profile editor and a
 * channel nickname. One field, so the three places keep the same rule.
 *
 * It will not hold more than `max` graphemes (`cortarNome`): the 13th letter
 * typed does not enter, and a long paste is cut. When something was cut, a
 * short sentence says why. No `maxLength`: that counts UTF-16 units, and would
 * stop a name of compound emojis long before 12, or split one in half.
 *
 * A value that is already longer (an old profile) is shown whole, with the
 * counter over the limit, and is only cut when it is edited: opening the
 * editor never rewrites a name nobody touched.
 *
 * The counter and the sentence sit BELOW the `<label>`, not inside it: inside,
 * they would become part of the field's accessible name ("Name 8/12").
 *
 * While an input method is composing (Chinese, Japanese, dead keys), the text
 * passes as is and is cut when the composition ends, so a half-built
 * character is never split.
 */
export function CampoDeNome({
  rotulo,
  value,
  onChange,
  max = NOME_MAX,
  campoRef,
  ...resto
}: {
  /** The field's label, as `Field` takes it. */
  rotulo: ReactNode
  value: string
  onChange: (valor: string) => void
  max?: number
  campoRef?: Ref<HTMLInputElement> | undefined
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "maxLength">): React.JSX.Element {
  const [cortado, setCortado] = useState(false)
  const contados = contarGrafemas(value.trim())

  const aceitar = (bruto: string): void => {
    const guardado = cortarNome(bruto, max)
    setCortado(guardado !== bruto)
    onChange(guardado)
  }

  return (
    <>
      <label>
        {rotulo}
        <input
          {...resto}
          ref={campoRef}
          value={value}
          onChange={(event) => {
            if ((event.nativeEvent as InputEvent).isComposing) onChange(event.target.value)
            else aceitar(event.target.value)
          }}
          onCompositionEnd={(event) => aceitar(event.currentTarget.value)}
        />
      </label>
      <p className="campo-de-nome-pe">
        {cortado && (
          <span className="aviso-do-nome" role="status">
            {strings.nomeCurto.maximo(max)}
          </span>
        )}
        <span
          className={contados > max ? "contador-do-nome acima" : "contador-do-nome"}
          aria-label={strings.nomeCurto.contadorRotulo(contados, max)}
        >
          {strings.nomeCurto.contador(contados, max)}
        </span>
      </p>
    </>
  )
}
