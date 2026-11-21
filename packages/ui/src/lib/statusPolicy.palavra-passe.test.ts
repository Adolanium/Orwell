import { describe, expect, it } from "vitest"
import { fraseDoStatus, routeStatus, QUIET_WINDOW_MS } from "./statusPolicy.js"
import { strings } from "../strings.js"

/**
 * "The account password changed on another device" (1.3.26) is learned in the
 * recovery right after connecting, for a device that was off: the quiet window
 * that hides other info toasts after a connection must not hide this one.
 */
describe("o aviso da palavra-passe da conta", () => {
  const status = { detail: "account password version 2", level: "info" as const, code: "account-password-changed" as const, route: "toast" as const }

  it("fura a janela de silêncio logo a seguir a ligar", () => {
    const agora = 1_000_000
    const decisao = routeStatus(status, { now: agora, connectedAt: agora - QUIET_WINDOW_MS / 2, lastToastAt: new Map() })
    expect(decisao.target).toBe("toast")
  })

  it("diz a frase do catálogo", () => {
    expect(fraseDoStatus(status, (c) => c)).toBe(strings.settings.palavraPasseMudouNoutro)
  })
})
