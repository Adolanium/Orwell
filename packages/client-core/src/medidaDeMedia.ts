import type { RefDeMedia } from "./vault.js"

/**
 * How much media a vault entry holds (`entryMediaBytes`), and the shapes the
 * bytes take in a payload. Kept apart from the vault so the folds
 * (`colapsarCopias`) can read it without importing the vault. The vault
 * re-exports `entryMediaBytes`.
 */
/** The payload arrays that can carry media: `message.attachments`, `post.media`. */
export const MEDIA_KEYS = ["attachments", "media"] as const

/**
 * `post.links`, which carries bytes in another way and so gets its own step.
 *
 * An attachment is an object whose bytes are in `inline` (or, at most, in a
 * `url` that starts with `data:`), or, since version 3, in a `{ ref }`. A link
 * card is nothing like that: the thumbnail is the `thumbnail` field in there, a
 * string or a `{ ref }`, and the `url` beside it is the page, never a `data:`.
 */
export const LINK_KEY = "links"

/** Characters of a card thumbnail held as text. Zero if it has none, or if it is a reference. */
export function thumbnailBytes(item: unknown): number {
  if (typeof item !== "object" || item === null) return 0
  const thumbnail = (item as Record<string, unknown>).thumbnail
  return typeof thumbnail === "string" ? thumbnail.length : 0
}

export function carriesBytes(item: unknown): item is Record<string, unknown> {
  if (typeof item !== "object" || item === null) return false
  const record = item as Record<string, unknown>
  if (record.evicted === true) return false
  return (
    (typeof record.inline === "string" && record.inline.length > 0) ||
    (typeof record.url === "string" && record.url.startsWith("data:"))
  )
}

function bytesOf(item: Record<string, unknown>): number {
  const inline = typeof item.inline === "string" ? item.inline.length : 0
  const url = typeof item.url === "string" && item.url.startsWith("data:") ? item.url.length : 0
  return inline + url
}

/** The `sha` of a `{ ref }`, or null. */
function refDoCampo(valor: unknown): string | null {
  if (typeof valor !== "object" || valor === null) return null
  const ref = (valor as Record<string, unknown>).ref
  return typeof ref === "string" ? ref : null
}

/**
 * The characters the `inline` of a reference would have: the unit of
 * `entryMediaBytes`, the same one a 1.1.x to 1.3.x sibling counts. Without the
 * reference (the vault does not have it), 1: it is present, and weighs something.
 */
export function caracteresDaRef(ref: RefDeMedia | undefined): number {
  if (!ref) return 1
  return ref.f === "bytes" ? (ref.p?.length ?? 0) + 4 * Math.ceil(ref.b / 3) : ref.b
}

/**
 * The media bytes an entry holds ON THIS DEVICE, in characters of the
 * `inline` (the unit of 1.1.x to 1.3.x siblings, which count it too).
 *
 * Used to pick the most complete copy (`confirmarRelato`, `colapsarCopias`,
 * the interface) and to ask another device for what is missing (`mediaDe`,
 * `faltaMediaDaEntrada`). So it counts EVERYTHING present, thumbnails
 * included (Ruling R3; dropping thumbnails broke the YouTube ones in 1.1.0):
 *
 * - the text still carried in the entry: `inline`, a data: `url`, `poster`,
 *   `thumbnail` (an old sibling, or a vault not yet migrated);
 * - each reference (`{ ref }` in the attachment, the `poster`, the `thumbnail`)
 *   that `presente` says is in the store, and its thumbnail, if it is a
 *   different one and is there, whether or not the original is. Without
 *   `presente`, each reference counts as present. `media` gives the weight of
 *   each reference (`contents.media`).
 */
export function entryMediaBytes<E extends { readonly payload: { t: string } }>(
  entry: E,
  presente: (sha: string) => boolean = () => true,
  media?: Readonly<Record<string, RefDeMedia>>,
): number {
  let total = 0
  const daRef = (sha: string | null): void => {
    if (sha === null) return
    const ref = media?.[sha]
    if (presente(sha)) total += caracteresDaRef(ref)
    // The thumbnail counts even without the original: the original leaves by the cap, the thumbnail always stays (design §4).
    const mini = ref?.mini
    if (mini !== undefined && mini !== sha && presente(mini)) total += caracteresDaRef(media?.[mini])
  }
  const payload = entry.payload as Record<string, unknown>
  for (const key of MEDIA_KEYS) {
    const list = payload[key]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (typeof item !== "object" || item === null || (item as Record<string, unknown>).evicted === true) continue
      const record = item as Record<string, unknown>
      if (carriesBytes(record)) total += bytesOf(record)
      if (typeof record.poster === "string") total += record.poster.length
      daRef(refDoCampo(record))
      daRef(refDoCampo(record.poster))
    }
  }
  const links = payload[LINK_KEY]
  if (Array.isArray(links)) {
    for (const item of links) {
      total += thumbnailBytes(item)
      if (typeof item === "object" && item !== null) daRef(refDoCampo((item as Record<string, unknown>).thumbnail))
    }
  }
  return total
}

