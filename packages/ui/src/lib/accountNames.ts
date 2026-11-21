import type { EnclaveBridge } from "../bridge.js"

/**
 * The display name of each account on this device, kept OUTSIDE the vault
 * (21/11/2026), so the sign-in screen can say "Olá, <name>"
 * before the password.
 *
 * One entry per account id of the device's account list (`contas`), or
 * `"principal"` on a host without it. Written whenever the account is open and
 * its name is known, and when the name changes; removed when the account leaves
 * this device (its vault is destroyed, or the device was removed from it). It is
 * readable on the device without the password: see `docs/THREAT-MODEL.md`.
 */
export const ACCOUNT_NAMES_KEY = "enclave.accountNames"

/** The id when the host has no account list: the device's one account. */
export const SINGLE_ACCOUNT_ID = "principal"

/** Long enough for any display name (12 graphemes), short enough not to store anything else. */
const MAX_NAME = 80

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

function readAll(store: Pick<Storage, "getItem"> | null = storage()): Record<string, string> {
  try {
    const raw = JSON.parse(store?.getItem(ACCOUNT_NAMES_KEY) ?? "{}") as unknown
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  } catch {
    return {}
  }
}

function writeAll(names: Record<string, string>, store: Pick<Storage, "setItem"> | null = storage()): void {
  try {
    store?.setItem(ACCOUNT_NAMES_KEY, JSON.stringify(names))
  } catch {
    // No storage: the gate says "Olá" without the name, nothing else.
  }
}

/** The stored name of an account, or "" when there is none. */
export function storedAccountName(id: string): string {
  return readAll()[id] ?? ""
}

/** Store (or update) the name of an account. An empty name removes the entry. */
export function rememberAccountName(id: string, name: string): void {
  const clean = name.trim().slice(0, MAX_NAME)
  const names = readAll()
  if (clean === "") {
    if (!(id in names)) return
    delete names[id]
  } else {
    if (names[id] === clean) return
    names[id] = clean
  }
  writeAll(names)
}

/** The account left this device: its name goes too. */
export function forgetAccountName(id: string): void {
  rememberAccountName(id, "")
}

/** The id of the open (active) account on this device. */
export async function activeAccountId(bridge: EnclaveBridge): Promise<string> {
  if (!bridge.contas) return SINGLE_ACCOUNT_ID
  try {
    const { contas } = await bridge.contas.listar()
    return contas.find((account) => account.activa)?.id ?? SINGLE_ACCOUNT_ID
  } catch {
    return SINGLE_ACCOUNT_ID
  }
}
