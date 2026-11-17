import { impressaoDoEndereco } from "../hooks/usePrimeirosPassos.js"

/**
 * Whether this browser already dealt with an account's file (16/11/2026): the
 * file was downloaded or shared, the account came in from a file, or the person
 * closed the one-time notice. Outside the vault, like the first-steps mark, and
 * by the address fingerprint, not the address: `localStorage` is not encrypted.
 */
export const FICHEIRO_DA_CONTA_KEY = "enclave.ficheiroDaConta"

/** Enough for the accounts one browser ever holds; the oldest leave first. */
const TECTO = 50

function lidas(storage: Pick<Storage, "getItem">): string[] {
  try {
    const bruto = JSON.parse(storage.getItem(FICHEIRO_DA_CONTA_KEY) ?? "[]") as unknown
    return Array.isArray(bruto) ? bruto.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

/** Never throws: without storage or `crypto.subtle`, the notice may come back, nothing else. */
export async function marcarFicheiroTratado(
  address: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): Promise<void> {
  try {
    const impressao = await impressaoDoEndereco(address)
    const actuais = lidas(storage).filter((item) => item !== impressao)
    storage.setItem(FICHEIRO_DA_CONTA_KEY, JSON.stringify([...actuais, impressao].slice(-TECTO)))
  } catch {
    // Storage locked: the notice shows again on the next opening.
  }
}

/** Whether the one-time notice is still owed to this account. False when it cannot tell. */
export async function ficheiroPorTratar(address: string, storage: Pick<Storage, "getItem"> = localStorage): Promise<boolean> {
  try {
    return !lidas(storage).includes(await impressaoDoEndereco(address))
  } catch {
    return false
  }
}
