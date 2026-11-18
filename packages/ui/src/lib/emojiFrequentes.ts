import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { EMOJI_RECENTS_MAX, PREFS_EVENT, PREFS_KEY, readPrefs, writePrefs } from "../hooks/usePrefs.js"

/**
 * Frequently used emojis, and the quick reactions that come from them.
 *
 * Like Discord: the picker opens on "Frequently used", and the hover bar of a
 * message offers the three reactions this person uses most. The person can also
 * pin their own three in Settings; an empty slot goes back to "most used".
 *
 * Everything is a device preference (`Prefs`), next to the recents it extends:
 * no vault, no network. What someone reacts with often says something about
 * them, and it never leaves this device.
 */

/** One emoji, how many times it was used, and when it was last used. */
export interface UsoDeEmoji {
  e: string
  n: number
  t: number
}

/** Kept on disk. Six rows of eight: more than "Frequently used" ever shows. */
export const USOS_MAX = 48

/** A use loses half its weight every two weeks, so a habit that ended gives way. */
const MEIA_VIDA_MS = 14 * 86_400_000

/** How many quick reactions the hover bar and the long-press menu show. */
export const N_RAPIDAS = 3

/** The factory three, before the person has used any. */
export const RAPIDAS_POR_OMISSAO: readonly string[] = ["👍", "❤️", "😂"]

const pontuar = (uso: UsoDeEmoji, agora: number): number => uso.n * 0.5 ** (Math.max(0, agora - uso.t) / MEIA_VIDA_MS)

/** Count one use of `emoji`. Over the cap, the entry worth least leaves. */
export function registarUso(usos: readonly UsoDeEmoji[], emoji: string, agora = Date.now()): UsoDeEmoji[] {
  const proximo = usos.some((uso) => uso.e === emoji)
    ? usos.map((uso) => (uso.e === emoji ? { e: emoji, n: uso.n + 1, t: agora } : uso))
    : [...usos, { e: emoji, n: 1, t: agora }]
  if (proximo.length <= USOS_MAX) return proximo
  // The emoji just used always stays: otherwise a new one could never get in.
  const outros = proximo
    .filter((uso) => uso.e !== emoji)
    .sort((a, b) => pontuar(b, agora) - pontuar(a, agora) || b.t - a.t)
  const ficam = new Set([emoji, ...outros.slice(0, USOS_MAX - 1).map((uso) => uso.e)])
  return proximo.filter((uso) => ficam.has(uso.e))
}

/**
 * The emojis in "Frequently used" order: most used first, recent use weighing more.
 *
 * With no counts yet (a device from before this list), the old recents count,
 * in their own order: nobody opens the picker to find their list gone.
 */
export function frequentes(
  usos: readonly UsoDeEmoji[],
  recentes: readonly string[],
  agora = Date.now(),
  limite = EMOJI_RECENTS_MAX,
): string[] {
  if (usos.length === 0) return recentes.slice(0, limite)
  // Ties go to the later entry: two picks in the same millisecond still keep their order.
  return usos
    .map((uso, indice) => ({ uso, indice, peso: pontuar(uso, agora) }))
    .sort((a, b) => b.peso - a.peso || b.uso.t - a.uso.t || b.indice - a.indice)
    .slice(0, limite)
    .map(({ uso }) => uso.e)
}

/**
 * The three quick reactions: each slot the person chose in Settings, and each
 * empty slot filled with the next most used emoji, then the factory ones. Never
 * the same emoji twice.
 */
export function rapidasEfectivas(escolhidas: readonly string[], maisUsadas: readonly string[]): string[] {
  const fixas = new Set(escolhidas.filter(Boolean))
  const reserva = [...maisUsadas, ...RAPIDAS_POR_OMISSAO].filter((emoji) => !fixas.has(emoji))
  const vistas = new Set<string>()
  const resultado: string[] = []
  for (let i = 0; i < N_RAPIDAS; i++) {
    let emoji = escolhidas[i] || ""
    while (!emoji && reserva.length > 0) {
      const seguinte = reserva.shift() ?? ""
      if (!vistas.has(seguinte)) emoji = seguinte
    }
    if (!emoji) continue
    vistas.add(emoji)
    resultado.push(emoji)
  }
  return resultado
}

/** Count one use, on disk. The picker, a quick reaction and a chip pressed all come here. */
export function lembrarEmoji(emoji: string, agora = Date.now()): void {
  const disco = readPrefs()
  writePrefs({
    ...disco,
    // The recents stay written as before: an older version on this device reads them.
    emojiRecents: [emoji, ...disco.emojiRecents.filter((entrada) => entrada !== emoji)].slice(0, EMOJI_RECENTS_MAX),
    emojiUsos: registarUso(disco.emojiUsos, emoji, agora),
  })
}

/* ------------------------------------------------- the store of the quick three */

let chaveGuardada: string | null = null
let rapidasGuardadas: readonly string[] = RAPIDAS_POR_OMISSAO

/**
 * The quick reactions now. Same array while the list is the same: the hover
 * bars read it through `useSyncExternalStore`, and a new array on each read would
 * redraw every bar on each preference change.
 */
export function lerRapidas(): readonly string[] {
  const prefs = readPrefs()
  const lista = rapidasEfectivas(prefs.reaccoesRapidas, frequentes(prefs.emojiUsos, prefs.emojiRecents))
  const chave = lista.join(" ")
  if (chave !== chaveGuardada) {
    chaveGuardada = chave
    rapidasGuardadas = lista
  }
  return rapidasGuardadas
}

function subscrever(avisar: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const deOutroSeparador = (evento: StorageEvent): void => {
    if (evento.key === PREFS_KEY) avisar()
  }
  window.addEventListener(PREFS_EVENT, avisar)
  window.addEventListener("storage", deOutroSeparador)
  return () => {
    window.removeEventListener(PREFS_EVENT, avisar)
    window.removeEventListener("storage", deOutroSeparador)
  }
}

/*
 * Every message line on screen reads the quick three, and `useSyncExternalStore`
 * calls the snapshot on every render of each line. Reading the preferences
 * from disk each time (getItem, JSON.parse, the checks, a sort) cost the big
 * case 15 to 60 % more on channel switch, menus and a burst of 200 messages.
 *
 * So the list is kept with the raw text it came from, and only a different text
 * is parsed again: one getItem per read. The snapshot runs during render, before
 * any subscription exists, so the key cannot be an event. And one pair of window
 * listeners is shared by all lines, not two per line.
 */
let textoDasRapidas: string | null | undefined
let rapidasDoTexto: readonly string[] = RAPIDAS_POR_OMISSAO

function lerRapidasEmCache(): readonly string[] {
  let texto: string | null
  try {
    texto = localStorage.getItem(PREFS_KEY)
  } catch {
    return lerRapidas()
  }
  if (texto !== textoDasRapidas) {
    rapidasDoTexto = lerRapidas()
    textoDasRapidas = texto
  }
  return rapidasDoTexto
}

const quemOuveAsRapidas = new Set<() => void>()
let deixarDeOuvir: (() => void) | null = null

function subscreverRapidas(avisar: () => void): () => void {
  quemOuveAsRapidas.add(avisar)
  deixarDeOuvir ??= subscrever(() => {
    for (const avisarUm of [...quemOuveAsRapidas]) avisarUm()
  })
  return () => {
    quemOuveAsRapidas.delete(avisar)
    if (quemOuveAsRapidas.size === 0) {
      deixarDeOuvir?.()
      deixarDeOuvir = null
    }
  }
}

/**
 * The quick reactions, live. Only the components that draw them re-render when
 * they change, never the message line around them (its memo stays whole).
 */
export function useReaccoesRapidas(): readonly string[] {
  return useSyncExternalStore(subscreverRapidas, lerRapidasEmCache, lerRapidasEmCache)
}

/**
 * "Frequently used", for the picker, and the way to count one more use.
 *
 * Its own hook because the message box and the reaction picker both need it,
 * and threading the preference down by hand crosses components that have
 * nothing to do with emojis.
 *
 * The write happens OUTSIDE any state updater. Picking an emoji closes the
 * picker in the same batch, and an updater from a component that unmounts may
 * never run: the emoji would never reach the disk. Here the disk is written
 * now; `setRecents` only affects what stays on screen.
 */
export function useEmojiRecents(): { recents: string[]; remember: (char: string) => void } {
  const ler = (): string[] => {
    const prefs = readPrefs()
    return frequentes(prefs.emojiUsos, prefs.emojiRecents)
  }
  const [recents, setRecents] = useState<string[]>(ler)

  // Another picker (Settings, the message box) may count a use while this one is open.
  useEffect(() => subscrever(() => setRecents(ler())), [])

  const remember = useCallback((char: string) => {
    lembrarEmoji(char)
    setRecents(ler())
  }, [])

  return { recents, remember }
}
