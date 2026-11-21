import { impressaoDoEndereco } from "./impressaoDoEndereco.js"

/**
 * Whether this browser already saved an account's file: the file was
 * downloaded or shared, or the account came in from a file. Outside the vault,
 * like the first-steps mark, and by the address fingerprint, not the address:
 * `localStorage` is not encrypted.
 *
 * A new key since 21/11/2026. The old one (`enclave.ficheiroDaConta`) also
 * counted closing the one-time notice, and the banner that replaced the notice
 * stays until there is a file. Closing never counts now.
 */
export const FICHEIRO_DA_CONTA_KEY = "enclave.ficheiroGuardado"

/** Fired on `window` when a file is saved: the banner inside the app hears it and goes. */
export const FICHEIRO_GUARDADO = "enclave:ficheiro-guardado"

/** Fired on `window` when this device added a device ("Juntar um aparelho"): the banner counts the devices again. */
export const APARELHOS_MUDARAM = "enclave:aparelhos-mudaram"

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

/** Never throws: without storage or `crypto.subtle`, the banner may come back, nothing else. */
export async function marcarFicheiroTratado(
  address: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): Promise<void> {
  try {
    const impressao = await impressaoDoEndereco(address)
    const actuais = lidas(storage).filter((item) => item !== impressao)
    storage.setItem(FICHEIRO_DA_CONTA_KEY, JSON.stringify([...actuais, impressao].slice(-TECTO)))
    if (typeof window !== "undefined") window.dispatchEvent(new Event(FICHEIRO_GUARDADO))
  } catch {
    // Storage locked: the banner shows again on the next opening.
  }
}

/** Whether this account still has no saved file in this browser. False when it cannot tell. */
export async function ficheiroPorTratar(address: string, storage: Pick<Storage, "getItem"> = localStorage): Promise<boolean> {
  try {
    return !lidas(storage).includes(await impressaoDoEndereco(address))
  } catch {
    return false
  }
}
