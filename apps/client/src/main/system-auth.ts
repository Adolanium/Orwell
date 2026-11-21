import { ERRO_SISTEMA_NAO_CONFIRMOU } from "@enclave/client-core"

/**
 * The system re-auth before "I forgot the current password" (S4, 21/11/2026).
 *
 * On macOS with Touch ID, the system asks who is there, and a cancel or a wrong
 * finger refuses the change (Erro 143). Electron has no Windows Hello and no
 * Linux equivalent: there, and on a Mac without Touch ID, the open vault is the
 * only proof, as on the web. `docs/THREAT-MODEL.md` writes that down.
 */
export interface SystemAuth {
  platform: NodeJS.Platform
  canPromptTouchID: () => boolean
  promptTouchID: (reason: string) => Promise<void>
}

/** `"confirmed"` after Touch ID, `"not-available"` where the system cannot ask. Throws when the person does not confirm. */
export async function confirmWithSystem(auth: SystemAuth, reason: string): Promise<"confirmed" | "not-available"> {
  if (auth.platform !== "darwin" || !auth.canPromptTouchID()) return "not-available"
  try {
    await auth.promptTouchID(reason)
  } catch {
    throw new Error(ERRO_SISTEMA_NAO_CONFIRMOU)
  }
  return "confirmed"
}
