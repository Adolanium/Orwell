/**
 * The display name: how long it may be, and how it is shown.
 *
 * **Write stops at 12 graphemes.** A grapheme is what a person sees as one
 * character: a compound emoji (a family, a flag, a skin tone) or a letter with
 * a combining accent counts as one, so the limit reads the same to whoever
 * types it. The count is taken after trimming, and an empty name is not a name.
 * The same rule caps a channel nickname (`APELIDO_MAX`), which is a display
 * name for one channel.
 *
 * **Read never rejects.** Profiles are signed and travel inside the channel,
 * and clients 1.3.7 to 1.3.18 wrote up to 32 (the schema reads 64, see
 * `payload.ts`). A longer name that arrives is kept whole, so mentions and
 * search still find the person by it. Only the drawing cuts it: 12 graphemes
 * and an ellipsis (`nomeVisivel`), with the whole name in a tooltip.
 */

export const NOME_MAX = 12

const segmentador: Intl.Segmenter | null =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null

/** The graphemes of a text, in order. Without `Intl.Segmenter`, code points (a safe over-count). */
export function grafemas(texto: string): string[] {
  if (!segmentador) return Array.from(texto)
  const partes: string[] = []
  for (const { segment } of segmentador.segment(texto)) partes.push(segment)
  return partes
}

export function contarGrafemas(texto: string): number {
  return grafemas(texto).length
}

/** A name that may be written: not empty and at most `max` graphemes, after trimming. */
export function nomeValido(nome: string, max: number = NOME_MAX): boolean {
  const limpo = nome.trim()
  return limpo !== "" && contarGrafemas(limpo) <= max
}

/**
 * What a name field keeps of what was typed or pasted.
 *
 * Within the limit it is returned as is, spaces included, so typing "Ana "
 * before "Silva" works. Over the limit it keeps the first `max` graphemes of
 * the text without its leading space, and never splits a grapheme.
 */
export function cortarNome(texto: string, max: number = NOME_MAX): string {
  if (contarGrafemas(texto.trim()) <= max) return texto
  return grafemas(texto.trimStart()).slice(0, max).join("")
}

/**
 * A name as it is drawn: at most `max` graphemes, then "…".
 *
 * For names that arrived longer than the write limit (old profiles, other
 * clients). The whole name stays in the data; this is only the drawing.
 */
export function nomeVisivel(nome: string, max: number = NOME_MAX): string {
  const partes = grafemas(nome)
  if (partes.length <= max) return nome
  return `${partes.slice(0, max).join("").trimEnd()}…`
}
