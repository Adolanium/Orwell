/*
  The Orwell Service Worker, and everything it does NOT do.

  It exists for one reason only: on Android, Chrome refuses a page the right to
  create a system alert on its own (throws `TypeError`), and only accepts
  it from `registration.showNotification()`. Without this file, the app installed
  on an Android phone notifies no one of anything.

  What is NOT here, on purpose, and a test locks down
  (`apps/web/src/pwa.test.ts`, which reads this source):

    · it does not intercept any network request. An encrypted chat cannot have a
      layer between the person and the server deciding what code they run; the
      `index.html` always comes from the network, and `version-watch.ts` alerts
      to a new version, as it always has;
    · it does not store anything. Assets already carry the hash in the name and
      the server already tells them to keep them for a year; a second copy here only
      added persistent code that nobody audits;
    · it reads nothing from a push but the language. A push from the
      homeserver (Web Push) wakes a closed app with a fixed sentence; the
      notices with names and text are still born on the page, from what
      arrived over the socket;
    · it does not load any other script or talk to any other origin.

  Whoever wants to add any of these things here will find the test red, and the
  conversation to have is with the threat model (`docs/THREAT-MODEL.md`) and not
  with the test.

  REMOVAL: deleting this file from the server does NOT remove it from those who
  have it. The update request got the app page with 200 (the Caddy resource),
  which is not a valid script, and the browser kept the old version forever.
  Removal requires publishing, at this same URL, a script that unregisters itself
  (`self.registration.unregister()` in `activate`). See `docs/DEPLOY-WEB.md`.
*/

// Nothing to prepare: the new version takes effect right away.
self.addEventListener("install", () => {
  self.skipWaiting()
})

// And takes care of already open windows, so the first alert does not
// have to wait for a reload.
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

/*
  The tap on the alert.
  
  The page knows how to open the conversation: it has the vault, the session, and
  the route. From here we only tell it WHICH alert was tapped, by the tag
  that it put in `data` itself, and it does the rest
  (`packages/ui/src/lib/notifications.ts`). It goes to all windows of the app:
  the one that does not know the tag just comes to the front.
  
  The tag is drawn by the page, per alert, and says nothing: no channel,
  no message, no person. It is the ONLY thing we read from an alert here,
  and the registration scope is the only thing we open from here. The test locks
  both down.
  
  With no window open, the app opens. The right conversation does not open in
  that case: the page that knew how to open it no longer exists, and the vault
  is locked.
  */
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const id = event.notification.data && event.notification.data.id
  event.waitUntil(
    (async () => {
      const ambito = self.registration.scope
      const todas = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      const janelas = todas.filter((janela) => janela.url.startsWith(ambito))
      if (janelas.length === 0) {
        await self.clients.openWindow(ambito)
        return
      }
      for (const janela of janelas) {
        janela.postMessage({ type: "enclave.notice-click", id })
      }
      const visivel = janelas.find((janela) => janela.visibilityState === "visible")
      try {
        await (visivel || janelas[0]).focus()
      } catch {
        // Some systems refuse to bring the window to the front. The message has already been sent.
      }
    })(),
  )
})

/*
  A push from the homeserver (Web Push), with the app closed or the screen locked.

  It carries only the device language, encrypted for this device; the browser
  has already decrypted it. The notice is one of two fixed sentences, the same
  as `settings.pushCorpo` in the catalogs (the test holds them equal): no name,
  no text, no channel. It is ALWAYS shown: Safari drops a subscription that
  pushes without a notice, and Chrome shows its own. The tag folds repeats into
  one, and the page closes it when it connects again. No `data`: a tap brings
  the app forward, and the app reads the rest the usual way.
*/
self.addEventListener("push", (event) => {
  const lingua = event.data ? event.data.text() : ""
  const corpo = lingua === "pt" ? "Nova mensagem no Orwell" : "New message in Orwell"
  event.waitUntil(self.registration.showNotification("Orwell", { body: corpo, tag: "orwell-push" }))
})
