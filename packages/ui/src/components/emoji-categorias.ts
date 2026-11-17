/**
 * The nine emoji categories, without the emojis.
 *
 * Small on purpose: the picker shows its tabs from this list while the big
 * catalog (`emoji.ts` and `emoji.gen.ts`, ~36 KB gzip) is still loading, and
 * the main bundle carries only this file.
 */
export type EmojiCategoryId =
  | "rostos"
  | "gestos"
  | "natureza"
  | "comida"
  | "actividades"
  | "viagens"
  | "objectos"
  | "simbolos"
  | "bandeiras"

export const EMOJI_CATEGORY_TABS: readonly { id: EmojiCategoryId; symbol: string }[] = [
  { id: "rostos", symbol: "😀" },
  { id: "gestos", symbol: "👋" },
  { id: "natureza", symbol: "🌿" },
  { id: "comida", symbol: "🍕" },
  { id: "actividades", symbol: "⚽" },
  { id: "viagens", symbol: "✈️" },
  { id: "objectos", symbol: "💡" },
  { id: "simbolos", symbol: "❤️" },
  { id: "bandeiras", symbol: "🇵🇹" },
]
