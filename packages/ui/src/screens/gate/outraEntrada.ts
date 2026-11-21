import type { EnclaveBridge } from "../../bridge.js"
import { pagina } from "./MudarDeConta.js"

/**
 * Where the gate opens after "Usar outra conta" or "Esqueci-me da palavra-passe"
 * (21/11/2026).
 *
 * The rule: no way in deletes an account. So these paths never
 * write over the vault that is on this device. When there is one, the app adds
 * an empty account next to it (`contas.acrescentar`), reloads, and the gate of
 * the new account opens on the screen the person chose. The account that was
 * here stays on this device, closed, in "Mudar de conta".
 *
 * The choice crosses the reload in `sessionStorage`: it is per tab, it dies with
 * the tab, and it holds a screen name, never a secret.
 */
export type Intencao = "inicio" | "ficheiro" | "outro-aparelho"

export const CHAVE_DA_INTENCAO = "enclave.entrada.intencao"

const INTENCOES: readonly Intencao[] = ["inicio", "ficheiro", "outro-aparelho"]

function armazem(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage
  } catch {
    return null
  }
}

export function guardarIntencao(intencao: Intencao): void {
  try {
    armazem()?.setItem(CHAVE_DA_INTENCAO, intencao)
  } catch {
    // No storage: the gate opens on the first screen, which has the same three paths.
  }
}

/** Read once: the choice is for the next gate only. */
export function lerIntencao(): Intencao | null {
  try {
    const guardada = armazem()?.getItem(CHAVE_DA_INTENCAO) ?? null
    armazem()?.removeItem(CHAVE_DA_INTENCAO)
    return INTENCOES.includes(guardada as Intencao) ? (guardada as Intencao) : null
  } catch {
    return null
  }
}

/**
 * Go to an empty account for `intencao`, keeping the account on this device.
 *
 * - `"aqui"`: this device has no vault (it was removed, or never made). The
 *   caller opens the screen in place.
 * - `"recarregou"`: there is a vault. An empty account was added next to it and
 *   the page reloads into it.
 *
 * Throws "this version of the app cannot do that" on a host without `contas`:
 * there, the only other way was to write over the vault, and that path is gone.
 */
export async function entrarNumaContaNova(bridge: EnclaveBridge, intencao: Intencao): Promise<"aqui" | "recarregou"> {
  const { exists } = await bridge.vault.status()
  if (!exists) return "aqui"
  if (!bridge.contas) throw new Error("this version of the app cannot do that")
  await bridge.contas.acrescentar()
  guardarIntencao(intencao)
  pagina.recarregar()
  return "recarregou"
}
