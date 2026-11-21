import { formatPairingCode } from "@enclave/protocol"
import { QrCode } from "../../components/QrCode.js"
import { strings } from "../../strings.js"

/**
 * The short pairing code on the NEW device (1.3.26, mock-up `Emparelhar`):
 * "On the device that has your account, open Settings › Add a device.", the
 * QR, "or type the code", and the code as "K7P · 4QM".
 *
 * Display only. The screen that holds it starts the pairing
 * (`bridge.pairing.showCode`) and passes what arrives as `{ fase: "code" }`
 * on `on.pair`; the words and the rest are that screen's, as with a QR.
 */
export function NewDeviceCode({ code, link }: { code: string; link: string }): React.JSX.Element {
  return (
    <div className="short-code">
      <p className="gate-lead">{strings.shortCode.newLead}</p>
      <QrCode texto={link} alt={strings.shortCode.qrAlt} />
      <p className="field-note">{strings.shortCode.orType}</p>
      <p className="short-code-text" data-code={code} aria-live="polite">
        {formatPairingCode(code)}
      </p>
      <p className="field-note">{strings.shortCode.lasts}</p>
    </div>
  )
}
