import { useState } from "react"
import { normalizePairingCode } from "@enclave/protocol"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { LeitorQr } from "../../components/LeitorQr.js"
import { strings } from "../../strings.js"

/**
 * The device WITH the account reads or types the new device's short code
 * (1.3.26, mock-up `Emparelhar`): "Camera", "Or type the code", "Continue".
 *
 * `onCode` gets the code normalized ("K7P4QM") when typed, or the text the
 * camera read (the QR link), which the core checks (`parsePairCode`). The
 * holder calls `bridge.pairing.typeCode` with it.
 */
export function TypeCode({ onCode }: { onCode: (text: string) => void }): React.JSX.Element {
  const [scanning, setScanning] = useState(false)
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    const code = normalizePairingCode(text)
    if (!code) {
      setError(strings.shortCode.invalid)
      return
    }
    setError(null)
    onCode(code)
  }

  return (
    <div className="type-code">
      {scanning ? (
        <LeitorQr
          onLido={(read) => {
            setScanning(false)
            onCode(read)
          }}
          onCancelar={() => setScanning(false)}
        />
      ) : (
        <Button variant="primary" type="button" onClick={() => setScanning(true)}>
          {strings.shortCode.camera}
        </Button>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Field label={strings.shortCode.typeLabel}>
          <input
            value={text}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            className="short-code-field"
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setText(event.target.value)
              setError(null)
            }}
          />
        </Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Button variant="primary" type="submit" disabled={text.trim().length === 0}>
          {strings.shortCode.continue}
        </Button>
      </form>
    </div>
  )
}
