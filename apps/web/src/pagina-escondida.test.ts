import { describe, expect, it } from "vitest"
import { aoEsconderAPagina, aoMostrarAPagina } from "./pagina-escondida.js"

/**
 * The page leaving for the navigation cache suspends the account, and the
 * page that comes back resumes it without reloading (21/11/2026: the reload
 * restarted the iOS app on every screen lock). With a call open that reload ends the call:
 * iOS can fire `pagehide` with `persisted` and come back without `pageshow`
 * (see `main.tsx`), and the unlocked phone lost the call it was in.
 */
describe("a página que se esconde", () => {
  it("sem chamada, a cache suspende a posse e o fecho fecha-a", () => {
    expect(aoEsconderAPagina({ persisted: true, emChamada: false })).toBe("suspender")
    expect(aoEsconderAPagina({ persisted: false, emChamada: false })).toBe("fechar")
  })

  it("com uma chamada, a ida para a cache mantém a posse: ao voltar não recarrega", () => {
    expect(aoEsconderAPagina({ persisted: true, emChamada: true })).toBe("manter")
  })

  it("com uma chamada, fechar a página continua a fechar", () => {
    expect(aoEsconderAPagina({ persisted: false, emChamada: true })).toBe("fechar")
  })

  it("de volta da cache sem chamada, retoma sem recarregar; com uma chamada, nada", () => {
    expect(aoMostrarAPagina({ persisted: true, emChamada: false })).toBe("retomar")
    // The locked iPhone: `pagehide(persisted)` then `pageshow(persisted)` on unlock.
    expect(aoMostrarAPagina({ persisted: true, emChamada: true })).toBe("nada")
    expect(aoMostrarAPagina({ persisted: false, emChamada: false })).toBe("nada")
  })
})
