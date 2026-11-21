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
  /**
   * The person granted notifications in this browser. Without it no push
   * subscription can exist. Absent: read as granted (a test double from before 1.3.26).
   */
  permissaoConcedida?: () => boolean
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
    permissaoConcedida: () => typeof Notification !== "undefined" && Notification.permission === "granted",
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

/*
  "Never throws" for real (1.3.26): WebKit registers the service worker with no
  `pushManager` and no `getNotifications` on the registration. The optional
  chain stopped at the registration only, and the TypeError went up through
  account deletion: a device removed from the account kept its vault. The
  calls run inside the `try` now, so a missing member is a missing feature.
*/

/**
 * How long `cancelarNoBrowser` waits. WebKit can leave `getSubscription()`
 * unanswered for ever, and account deletion waits for this before erasing the
 * vault: a removed device hung at "loading" with its vault on disk.
 */
export const PRAZO_DO_CANCELAR_MS = 5_000

/**
 * Cancel the browser subscription, if there is one. Never throws, and never waits more than `PRAZO_DO_CANCELAR_MS`.
 *
 * Without notification permission there is no subscription, and the Push API is
 * not touched at all: in WebKit, `pushManager.getSubscription()` on a
 * registration with no permission froze the page (main thread and timers), and
 * a device removed from the account never erased its vault (1.3.26).
 */
export async function cancelarNoBrowser(amb: AmbienteDoPush): Promise<void> {
  if (amb.permissaoConcedida && !amb.permissaoConcedida()) return
  const cancelar = (async () => {
    try {
      const registo = await amb.registo().catch(() => null)
      const sub = await registo?.pushManager?.getSubscription?.().catch(() => null)
      await sub?.unsubscribe().catch(() => false)
    } catch {
      // No Push in this browser: nothing to cancel.
    }
  })()
  let relogio: ReturnType<typeof setTimeout> | undefined
  const prazo = new Promise<void>((resolve) => {
    relogio = setTimeout(resolve, PRAZO_DO_CANCELAR_MS)
  })
  await Promise.race([cancelar, prazo])
  clearTimeout(relogio)
}

/** Close the push notices still on screen: the socket now brings the messages. Never throws. */
export async function fecharAvisosDoPush(amb: AmbienteDoPush): Promise<void> {
  try {
    const registo = await amb.registo().catch(() => null)
    const avisos = (await registo?.getNotifications?.({ tag: ETIQUETA_DO_PUSH }).catch(() => [])) ?? []
    for (const aviso of avisos) aviso.close()
  } catch {
    // No notices API in this browser: nothing to close.
  }
}
