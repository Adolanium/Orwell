import { useEffect, useRef } from "react"

/**
 * What the page tells the system while a call is open, so the call holds up
 * with the screen locked or the app in the background.
 *
 *  - **Media Session.** The room's name and "playing", and the system's own
 *    buttons: `togglemicrophone` (Safari 18.4, Chrome 93) and `hangup` (Chrome
 *    93) reach the app. `play` and `pause` are taken on purpose and do nothing:
 *    without a handler, a "pause" on the lock screen or in Android's media
 *    notification would pause the elements the voices play in.
 *    `setMicrophoneActive` is NOT called: in Safari it mutes the capture at the
 *    browser level, and a muted raw track is what the microphone watchdog reads
 *    as a dead microphone.
 *  - **`navigator.audioSession`** (Safari 16.4+): "play-and-record" while the
 *    call is open, back to what it was on leaving. The type tells iOS this is a
 *    call, not background music.
 *  - **Screen wake lock** (the Settings option): the screen stays on with the
 *    app in front. The system releases it when the page hides; it is asked for
 *    again when the page comes back. It does nothing for a person who presses
 *    the lock button, which is why it is an option and off by default.
 *
 * Every API is optional. A browser without one just does without it.
 */
export function useChamadaEmSegundoPlano({
  emChamada,
  titulo,
  ecraLigado,
  aoAlternarMicrofone,
  aoSair,
}: {
  emChamada: boolean
  /** The room's name, shown by the system. */
  titulo: string
  /** "Keep the screen on during calls". */
  ecraLigado: boolean
  aoAlternarMicrofone: () => void
  aoSair: () => void
}): void {
  // Read when the system calls, so a new callback does not re-register the handlers.
  const accoes = useRef({ aoAlternarMicrofone, aoSair })
  accoes.current = { aoAlternarMicrofone, aoSair }

  // Media Session: the handlers live as long as the call.
  useEffect(() => {
    const sessao = lerSessao()
    if (!emChamada || !sessao) return
    const handlers: [string, () => void][] = [
      ["togglemicrophone", () => accoes.current.aoAlternarMicrofone()],
      ["hangup", () => accoes.current.aoSair()],
      ["play", () => {}],
      ["pause", () => {}],
    ]
    const postos: string[] = []
    for (const [accao, fazer] of handlers) {
      try {
        sessao.setActionHandler(accao, fazer)
        postos.push(accao)
      } catch {
        // An action this browser does not know (Safari has no `hangup`): the others stay.
      }
    }
    sessao.playbackState = "playing"
    return () => {
      for (const accao of postos) {
        try {
          sessao.setActionHandler(accao, null)
        } catch {
          // Nothing to undo.
        }
      }
      sessao.playbackState = "none"
      sessao.metadata = null
    }
  }, [emChamada])

  // The name follows the room without touching the handlers.
  useEffect(() => {
    const sessao = lerSessao()
    if (!emChamada || !sessao) return
    const Metadados = (globalThis as { MediaMetadata?: new (dados: { title: string; artist: string }) => unknown }).MediaMetadata
    if (typeof Metadados !== "function") return
    try {
      sessao.metadata = new Metadados({ title: titulo, artist: "Orwell" })
    } catch {
      // A browser that refuses the metadata still has the call.
    }
  }, [emChamada, titulo])

  // The audio session type, Safari only.
  useEffect(() => {
    const audio = (globalThis.navigator as { audioSession?: { type: string } } | undefined)?.audioSession
    if (!emChamada || !audio) return
    const antes = audio.type
    try {
      audio.type = "play-and-record"
    } catch {
      return
    }
    return () => {
      try {
        audio.type = antes
      } catch {
        // Leaving the call does not depend on this.
      }
    }
  }, [emChamada])

  // The screen wake lock, only when asked for, and only with the page in front.
  useEffect(() => {
    const wakeLock = (globalThis.navigator as { wakeLock?: { request(tipo: "screen"): Promise<TrincoDoEcra> } } | undefined)?.wakeLock
    if (!emChamada || !ecraLigado || !wakeLock || typeof document === "undefined") return
    let acabou = false
    let trinco: TrincoDoEcra | null = null
    let aPedir = false
    const pedir = (): void => {
      if (acabou || aPedir || document.visibilityState !== "visible") return
      if (trinco && !trinco.released) return
      aPedir = true
      wakeLock
        .request("screen")
        .then((novo) => {
          aPedir = false
          if (acabou) void novo.release().catch(() => {})
          else trinco = novo
        })
        .catch(() => {
          // Refused (battery saver, no gesture yet): the call goes on without it.
          aPedir = false
        })
    }
    const aoVer = (): void => {
      if (document.visibilityState === "visible") pedir()
    }
    pedir()
    document.addEventListener("visibilitychange", aoVer)
    return () => {
      acabou = true
      document.removeEventListener("visibilitychange", aoVer)
      if (trinco && !trinco.released) void trinco.release().catch(() => {})
    }
  }, [emChamada, ecraLigado])
}

interface TrincoDoEcra {
  readonly released: boolean
  release(): Promise<void>
}

interface SessaoDeMedia {
  metadata: unknown
  playbackState: string
  setActionHandler(accao: string, fazer: (() => void) | null): void
}

function lerSessao(): SessaoDeMedia | null {
  const sessao = (globalThis.navigator as { mediaSession?: SessaoDeMedia } | undefined)?.mediaSession
  return sessao && typeof sessao.setActionHandler === "function" ? sessao : null
}
