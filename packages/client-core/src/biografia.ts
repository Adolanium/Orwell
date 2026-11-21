import { grafemas } from "./nomeDeApresentacao.js"

/**
 * The profile bio: how long it may be, and how it is shown.
 *
 * **Write stops at 300 graphemes** (since 1.3.26; it was 1000 UTF-16 units).
 * A grapheme is what a person sees as one character, so a compound emoji
 * counts as one, as in the name (`nomeDeApresentacao.ts`). The core cuts every
 * bio it publishes (`cortarBio`), so no client of this version sends more,
 * whatever the field or a script hands it.
 *
 * **Read never rejects.** The schema still reads 1000 (`payload.ts`,
 * `estado.ts`): profiles written by older clients keep arriving and must stay
 * valid. A longer bio is kept as it came; only the drawing cuts it, at 300
 * graphemes and an ellipsis (`bioVisivel`).
 */

export const BIO_MAX = 300

/** Where the editor starts to show the counter: the last 60 graphemes. */
export const BIO_CONTADOR_DESDE = 240

/** At most `max` graphemes of the bio, never splitting one. Within the limit it is returned as is. */
export function cortarBio(texto: string, max: number = BIO_MAX): string {
  const partes = grafemas(texto)
  if (partes.length <= max) return texto
  return partes.slice(0, max).join("")
}

/** A bio as it is drawn: at most `max` graphemes, then "…". The data keeps the whole text. */
export function bioVisivel(texto: string, max: number = BIO_MAX): string {
  const partes = grafemas(texto)
  if (partes.length <= max) return texto
  return `${partes.slice(0, max).join("").trimEnd()}…`
}
