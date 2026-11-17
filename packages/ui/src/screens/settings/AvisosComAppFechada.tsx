import { useEffect, useState } from "react"
import type { ConnectionState, EnclaveBridge } from "../../bridge.js"
import { Interruptor } from "../../components/Interruptor.js"
import { useToast } from "../../components/Toast.js"
import { useLingua } from "../../hooks/useLingua.js"
import { usePrefs } from "../../hooks/usePrefs.js"
import { definicoesDoPush } from "../../hooks/usePushFechada.js"
import { temAnfitriaoDeAvisos } from "../../lib/notifications.js"
import { strings, traduzirErro } from "../../strings.js"

/**
 * "Notifications when the app is closed" (Web Push), under "System
 * notifications". The toggle shows only with those on; the iOS note shows
 * without them, because Safari outside the Home Screen has no `Notification`.
 *
 * Shown only on the web, with a server that announces `web-push` and a browser
 * with `PushManager`. On iOS outside the Home Screen there is no `PushManager`,
 * and the note says how to get it. The desktop app has no push (it keeps its
 * socket in the tray) and shows nothing here.
 *
 * Turning it on asks for the browser permission from this gesture if it is not
 * granted yet, then subscribes. The preference turns on only when both worked.
 */
export function AvisosComAppFechada({
  bridge,
  connection,
  notificacoesLigadas,
}: {
  bridge: Pick<EnclaveBridge, "push">
  connection: ConnectionState
  /** "System notifications" on, with the browser permission. */
  notificacoesLigadas: boolean
}): React.JSX.Element | null {
  const toast = useToast()
  const lingua = useLingua()
  const { prefs, setPreferencia } = usePrefs()
  const [estado, setEstado] = useState<Awaited<ReturnType<NonNullable<EnclaveBridge["push"]>["estado"]>> | null>(null)
  const [aMudar, setAMudar] = useState(false)
  const push = temAnfitriaoDeAvisos() ? undefined : bridge.push

  useEffect(() => {
    let vivo = true
    void push
      ?.estado()
      .then((proximo) => vivo && setEstado(proximo))
      .catch(() => vivo && setEstado(null))
    return () => {
      vivo = false
    }
  }, [push, connection])

  if (!push || estado === null || estado === "sem-servidor" || estado === "sem-browser") return null
  if (estado === "ios-fora-do-ecra") return <p className="field-note">{strings.settings.pushIosNota}</p>
  if (!notificacoesLigadas) return null

  const mudar = (ligar: boolean): void => {
    if (aMudar) return
    setAMudar(true)
    const feito = (): void => setAMudar(false)
    if (!ligar) {
      setPreferencia({ pushFechada: false })
      void push.desligar().finally(feito)
      return
    }
    // From the gesture, before any await: the browser only asks from here.
    const permissao =
      typeof Notification === "undefined" || Notification.permission === "granted"
        ? Promise.resolve<NotificationPermission>("granted")
        : Notification.requestPermission()
    void permissao
      .then((resultado) => {
        if (resultado !== "granted") throw new Error("the browser refused the notification subscription")
        return push.ligar(definicoesDoPush(prefs, lingua))
      })
      .then(() => setPreferencia({ pushFechada: true }))
      .catch((erro: unknown) => toast(traduzirErro(erro), "error"))
      .finally(feito)
  }

  return (
    <>
      <Interruptor ligado={prefs.pushFechada} disabled={aMudar} rotulo={strings.settings.pushFechada} onMudar={mudar} />
      <p className="field-note">{strings.settings.pushFechadaNota}</p>
      <p className="field-note">{strings.settings.pushSalaNota}</p>
    </>
  )
}
