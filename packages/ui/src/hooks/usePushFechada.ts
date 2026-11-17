import { CALAR_PARA_SEMPRE } from "@enclave/protocol"
import { useEffect } from "react"
import type { ConnectionState, DefinicoesDoPush, EnclaveBridge } from "../bridge.js"
import type { Lingua } from "../escolha-da-lingua.js"
import { usePrefs, type Prefs } from "./usePrefs.js"
import { useLingua } from "./useLingua.js"

/**
 * What the server needs to know to wake this device: the language of the
 * notice, the muted channels, and until when to stay quiet (the pause, or for
 * ever while Busy). Only these; the server learns nothing else from the page.
 */
export function definicoesDoPush(
  prefs: Pick<Prefs, "silenciados" | "pausaAte" | "activity">,
  lingua: Lingua,
  agora = Date.now(),
): DefinicoesDoPush {
  return {
    lingua,
    silenciados: prefs.silenciados,
    calarAte: prefs.activity === "ocupado" ? CALAR_PARA_SEMPRE : prefs.pausaAte > agora ? prefs.pausaAte : 0,
  }
}

/**
 * Keep this device's push subscription in step with the app (Web Push, web only).
 *
 * On every connect, and whenever the language, the muted channels, the pause
 * or Busy change, the subscription goes to the server again: that is the
 * renewal, and it is how the server learns the new settings. On connect the
 * push notices still on screen close, because the socket now brings the
 * messages.
 *
 * With the preference on and a server that does not send pushes (an old one,
 * or one without `ENCLAVE_PUSH=on`), the preference goes off and `avisar` gets Error 790
 * once. With the permission blocked in the browser, it goes off quietly: the
 * settings already say "Blocked by the browser".
 */
export function usePushFechada(
  bridge: Pick<EnclaveBridge, "push">,
  connection: ConnectionState,
  avisar: (erro: Error) => void,
): void {
  const { prefs, setPreferencia } = usePrefs()
  const lingua = useLingua()
  const push = bridge.push
  const definicoes = definicoesDoPush(prefs, lingua)
  const chave = JSON.stringify(definicoes)

  useEffect(() => {
    if (connection === "online") void push?.fecharAvisos().catch(() => {})
  }, [push, connection])

  useEffect(() => {
    if (!push || !prefs.pushFechada || connection !== "online") return
    let vivo = true
    void (async () => {
      const estado = await push.estado().catch(() => null)
      if (!vivo || estado === null) return
      if (estado === "sem-servidor") {
        setPreferencia({ pushFechada: false })
        avisar(new Error("this server does not send notifications when the app is closed"))
        return
      }
      if (estado !== "pronto") return
      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        setPreferencia({ pushFechada: false })
        return
      }
      await push.renovar(JSON.parse(chave) as DefinicoesDoPush).catch(() => {})
    })()
    return () => {
      vivo = false
    }
    // `chave` stands for the settings: a new object each render must not resend.
  }, [push, prefs.pushFechada, connection, chave])
}
