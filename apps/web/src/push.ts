import type { DadosDoPush } from "@enclave/client-core"
import { fromBase64, toBase64 } from "@enclave/protocol"
import { ehIos } from "@enclave/ui"

/**
 * The browser half of Web Push: the `PushManager` subscription on the
 * registration that `main.tsx` made. Nothing here registers a Service Worker,
 * and the bridge reaches the browser only through these functions
 * (`pwa.test.ts` holds both).
 *
 * The server half is three frames in the session (`subscreverPush`,
 * `cancelarPush`, `chaveDoPush`).
 */

/** The tag of the push notice. The Service Worker sets it; the page closes these on reconnect. */
export const ETIQUETA_DO_PUSH = "orwell-push"

/** How long to wait for an active Service Worker before giving up. */
const PRAZO_DO_REGISTO_MS = 10_000

/** The parts of `PushSubscription` this file uses. */
export interface SubscricaoDoBrowser {
  readonly endpoint: string
  readonly expirationTime: number | null
  readonly options: { readonly applicationServerKey: ArrayBuffer | null }
  getKey(nome: "p256dh" | "auth"): ArrayBuffer | null
  unsubscribe(): Promise<boolean>
}

interface RegistoDoPush {
  pushManager: {
    getSubscription(): Promise<SubscricaoDoBrowser | null>
    subscribe(opcoes: PushSubscriptionOptionsInit): Promise<SubscricaoDoBrowser>
  }
  getNotifications(filtro?: { tag?: string }): Promise<{ close(): void }[]>
}

/** What the browser offers, injected so a test can stand in for it. */
export interface AmbienteDoPush {
  temPushManager: boolean
  ios: boolean
  /** Opened from the Home Screen (standalone). */
  instalada: boolean
  /** The active registration, or `null` when there is none in time. */
  registo: () => Promise<RegistoDoPush | null>
}

export function ambienteDoBrowser(): AmbienteDoPush {
  const temServiceWorker = typeof navigator !== "undefined" && "serviceWorker" in navigator
  return {
    temPushManager: temServiceWorker && typeof window !== "undefined" && "PushManager" in window,
    // Read when asked, not when the bridge is built.
    get ios() {
      return ehIos()
    },
    instalada: typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches === true,
    registo: async () => {
      if (!temServiceWorker) return null
      return Promise.race([
        navigator.serviceWorker.ready as Promise<unknown> as Promise<RegistoDoPush>,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), PRAZO_DO_REGISTO_MS)),
      ])
    },
  }
}

/**
 * - `pronto`: this browser can subscribe.
 * - `ios-fora-do-ecra`: iOS or iPadOS in the browser; `PushManager` exists only
 *   in the app added to the Home Screen. The settings say so.
 * - `sem-browser`: any other browser without `PushManager`. The toggle hides.
 */
export function estadoDoPushNoBrowser(amb: AmbienteDoPush): "pronto" | "sem-browser" | "ios-fora-do-ecra" {
  if (amb.temPushManager) return "pronto"
  return amb.ios && !amb.instalada ? "ios-fora-do-ecra" : "sem-browser"
}

function recusadoPeloBrowser(causa?: unknown): Error {
  return new Error("the browser refused the notification subscription", { cause: causa })
}

/**
 * The browser subscription for this server key. One made with the same key is
 * reused; one made with another key (the server's VAPID key changed) is
 * cancelled first. Throws 791 (`ERRO_PUSH_RECUSADO_PELO_BROWSER`).
 */
export async function subscreverNoBrowser(amb: AmbienteDoPush, chaveDoServidor: string): Promise<SubscricaoDoBrowser> {
  const registo = await amb.registo()
  if (!registo) throw recusadoPeloBrowser()
  const chave = new Uint8Array(fromBase64(chaveDoServidor))
  const existente = await registo.pushManager.getSubscription()
  if (existente) {
    const dela = existente.options.applicationServerKey
    if (dela && toBase64(new Uint8Array(dela)) === chaveDoServidor) return existente
    await existente.unsubscribe().catch(() => false)
  }
  try {
    // `userVisibleOnly`: every push shows a notice. Safari and Chrome require it.
    return await registo.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave })
  } catch (erro) {
    throw recusadoPeloBrowser(erro)
  }
}

/** What `push.subscribe` carries, from the browser subscription and the device settings. */
export function dadosDaSubscricao(
  sub: SubscricaoDoBrowser,
  definicoes: { lingua: "pt" | "en"; silenciados: readonly string[]; calarAte: number },
): DadosDoPush {
  const p256dh = sub.getKey("p256dh")
  const auth = sub.getKey("auth")
  if (!p256dh || !auth) throw recusadoPeloBrowser()
  return {
    endpoint: sub.endpoint,
    p256dh: toBase64(new Uint8Array(p256dh)),
    auth: toBase64(new Uint8Array(auth)),
    lingua: definicoes.lingua,
    // A muted room (`canal/sala`) is inside the ciphertext: the server cannot honour it.
    silenciados: definicoes.silenciados.filter((alvo) => !alvo.includes("/")),
    calarAte: definicoes.calarAte,
    ...(sub.expirationTime !== null ? { expiresAt: sub.expirationTime } : {}),
  }
}

/** Cancel the browser subscription, if there is one. Never throws. */
export async function cancelarNoBrowser(amb: AmbienteDoPush): Promise<void> {
  const registo = await amb.registo().catch(() => null)
  const sub = await registo?.pushManager.getSubscription().catch(() => null)
  await sub?.unsubscribe().catch(() => false)
}

/** Close the push notices still on screen: the socket now brings the messages. Never throws. */
export async function fecharAvisosDoPush(amb: AmbienteDoPush): Promise<void> {
  const registo = await amb.registo().catch(() => null)
  const avisos = (await registo?.getNotifications({ tag: ETIQUETA_DO_PUSH }).catch(() => [])) ?? []
  for (const aviso of avisos) aviso.close()
}
