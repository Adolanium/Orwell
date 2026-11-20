/**
 * Which rooms hide the pinned bar, on this device (fixadas-topo, 20/11/2026).
 *
 * Per room, like Telegram: the person closes the bar and the room keeps the
 * pins, the header button and the sheet. What is stored is the `pinnedAt` of the
 * newest pin when the bar was closed. A pin that is newer than that shows the bar
 * again: it is news, and hiding news the person never saw is the opposite of
 * what pinning is for. The sheet has the button that shows the bar at once.
 *
 * In `localStorage` only, never in the account: it is a choice about this
 * screen. Capped, the oldest choices leave first. A storage that throws (private
 * mode, full disk) costs the memory, never the bar.
 */

export const CHAVE_DAS_FIXADAS_ESCONDIDAS = "enclave.fixadasEscondidas"

/** How many rooms this device remembers. */
export const TECTO_DE_SALAS_ESCONDIDAS = 200

type Armazem = Pick<Storage, "getItem" | "setItem">

function armazemDoBrowser(): Armazem | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

/** The key of one room: the channel and the room, which alone is not unique. */
export function chaveDaSala(canal: string, sala: string): string {
  return `${canal}|${sala}`
}

/** Room key → `pinnedAt` of the newest pin when the bar was closed. */
export function lerEscondidas(armazem: Armazem | null = armazemDoBrowser()): Record<string, number> {
  try {
    const bruto = armazem?.getItem(CHAVE_DAS_FIXADAS_ESCONDIDAS)
    if (!bruto) return {}
    const lido: unknown = JSON.parse(bruto)
    if (typeof lido !== "object" || lido === null || Array.isArray(lido)) return {}
    const saida: Record<string, number> = {}
    for (const [chave, valor] of Object.entries(lido)) if (typeof valor === "number" && Number.isFinite(valor)) saida[chave] = valor
    return saida
  } catch {
    return {}
  }
}

/**
 * Hide (with the stamp of the newest pin) or show (`null`) the bar of a room.
 * Returns the new map, also when the storage refuses it.
 */
export function gravarEscondida(
  actuais: Record<string, number>,
  chave: string,
  recente: number | null,
  armazem: Armazem | null = armazemDoBrowser(),
): Record<string, number> {
  const { [chave]: _antes, ...resto } = actuais
  let proximas: Record<string, number> = recente === null ? resto : { ...resto, [chave]: recente }
  const chaves = Object.keys(proximas)
  if (chaves.length > TECTO_DE_SALAS_ESCONDIDAS) {
    // Insertion order is the order of the choices: the first keys are the oldest.
    proximas = Object.fromEntries(Object.entries(proximas).slice(chaves.length - TECTO_DE_SALAS_ESCONDIDAS))
  }
  try {
    armazem?.setItem(CHAVE_DAS_FIXADAS_ESCONDIDAS, JSON.stringify(proximas))
  } catch {
    // Storage refused: the choice holds for this session only.
  }
  return proximas
}

/** Whether the bar of this room is hidden, given its newest pin. */
export function barraEscondida(escondidas: Record<string, number>, chave: string, recente: number | undefined): boolean {
  const marca = escondidas[chave]
  return marca !== undefined && recente !== undefined && recente <= marca
}
