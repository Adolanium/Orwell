import { youtubeIdOf } from "@enclave/protocol"
import { fetchPreviewViaHost, type HostPreview, type PreviewFields } from "../social/fetchPreview.js"

/** How many videos one compose box remembers. A conversation, not a catalogue. */
const KEEP = 32
/**
 * Requests in flight at once. The homeserver refuses a third one at once
 * (`PREVIEWS_AT_ONCE`, 2), and a refused preview is a blank card: the next
 * one waits its turn here instead.
 */
const AT_ONCE = 2

/**
 * The previews of the YouTube videos written in one compose box, one request per video.
 *
 * Two parties ask for the same preview: the card in the box (`LinkAttach`, a
 * moment after the address appears) and Enter (`Composer`, which must not send
 * a video card without its thumbnail while the preview is still on its way).
 * Both get the same promise, so the host is asked once.
 *
 * Kept by video identifier, so `&t=42` or `?si=` written next is the same
 * request. A failure is forgotten, so the next ask tries again. It lives as
 * long as the compose box, never in a module: which videos someone shared is
 * not something to keep after the box goes away.
 */
export class VideoPreviews {
  readonly #byVideo = new Map<string, Promise<PreviewFields>>()
  readonly #queue: (() => void)[] = []
  #inFlight = 0

  constructor(private readonly viaHost: (url: string) => Promise<HostPreview>) {}

  /** The preview of this video, asked now or already on its way. `null` when the address is not a YouTube video. */
  of(url: string): Promise<PreviewFields> | null {
    const id = youtubeIdOf(url)
    if (!id) return null
    const known = this.#byVideo.get(id)
    if (known) return known
    const pending = this.#inTurn(() => fetchPreviewViaHost(url, this.viaHost))
    this.#byVideo.set(id, pending)
    pending.catch(() => {
      if (this.#byVideo.get(id) === pending) this.#byVideo.delete(id)
    })
    for (const oldest of this.#byVideo.keys()) {
      if (this.#byVideo.size <= KEEP) break
      this.#byVideo.delete(oldest)
    }
    return pending
  }

  /** Runs `work` when one of the `AT_ONCE` places is free, in the order asked. */
  #inTurn<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        this.#inFlight++
        work()
          .then(resolve, reject)
          .finally(() => {
            this.#inFlight--
            this.#queue.shift()?.()
          })
      }
      if (this.#inFlight < AT_ONCE) start()
      else this.#queue.push(start)
    })
  }
}

/** The promise's value, or `null` when it fails or `ms` passes first. */
export function withinMs<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const clock = setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => {
        clearTimeout(clock)
        resolve(value)
      },
      () => {
        clearTimeout(clock)
        resolve(null)
      },
    )
  })
}
