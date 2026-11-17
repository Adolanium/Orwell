/**
 * Web Push, the part the session and the hosts share: what a subscription
 * carries, and the error keys that reach the screen.
 *
 * The browser side (`PushManager`, the Service Worker) lives in `apps/web`;
 * the session only speaks the three `push.*` frames.
 */

/** What `push.subscribe` carries. Keys in unpadded base64url, as the browser gives them. */
export interface DadosDoPush {
  endpoint: string
  p256dh: string
  auth: string
  lingua: "pt" | "en"
  /** Whole channels only: a room is inside the ciphertext. */
  silenciados: string[]
  /** Epoch ms before which no push is sent: the pause, or `CALAR_PARA_SEMPRE` for Busy. */
  calarAte: number
  /** The browser's expiry, in epoch ms, when it gives one. */
  expiresAt?: number
}

/*
  The session throws these as literals (the error-code scan reads literals
  only); the network test holds the two copies equal.
*/

/** The server did not announce `web-push`, or it answered the key as `null`. Code 790. */
export const ERRO_PUSH_SEM_SERVIDOR = "this server does not send notifications when the app is closed"
/** The browser refused the permission or the subscription. Code 791. Thrown by the hosts. */
export const ERRO_PUSH_RECUSADO_PELO_BROWSER = "the browser refused the notification subscription"
/** `push.subscribed` with `ok: false`; the reason goes in `cause`. Code 792. */
export const ERRO_PUSH_RECUSADO_PELO_SERVIDOR = "the server refused the notification subscription"
