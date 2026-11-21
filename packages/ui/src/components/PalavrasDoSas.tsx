/** How many SAS words the screens show: the first three of the six, 60 bits (21/11/2026, mock-up `Emparelhar`). */
export const PALAVRAS_NO_ECRA = 3

/** The words both screens show. The two sides compute the same six, so the first three match too. */
export function palavrasNoEcra(palavras: string): string {
  return palavras.split("-").slice(0, PALAVRAS_NO_ECRA).join("-")
}

/**
 * The words of the SAS, in large letters, one per line.
 *
 * The core gives six words of 20 bits each. Since 21/11/2026 the screens show
 * three: 60 bits is far beyond what someone with the secret but not the device
 * can match in the minutes a pairing lives, and three words are read at a glance.
 *
 * It is the only thing the person compares between the two screens, so it is
 * the only thing this component does: split the words by hyphen and number
 * them, so "the third one is different" can be said out loud. No colors, no
 * icons, nothing that looks like a confirmation by itself.
 */
export function PalavrasDoSas({ palavras }: { palavras: string }): React.JSX.Element {
  const vistas = palavrasNoEcra(palavras)
  return (
    <ol className="sas-palavras" data-palavras={vistas}>
      {vistas.split("-").map((palavra, i) => (
        <li key={`${i}-${palavra}`}>
          <span className="sas-numero" aria-hidden="true">
            {i + 1}
          </span>
          <span className="sas-palavra">{palavra}</span>
        </li>
      ))}
    </ol>
  )
}
