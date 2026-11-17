import { describe, expect, it } from "vitest"
import { aoEsconderAPagina, aoMostrarAPagina } from "./pagina-escondida.js"

/**
 * The page leaving for the navigation cache releases the account, and the
 * page that comes back reloads. With a call open that reload ends the call:
 * iOS can fire `pagehide` with `persisted` and come back without `pageshow`
 * (see `main.tsx`), and the unlocked phone lost the call it was in.
 */
describe("a página que se esconde", () => {
  it("sem chamada, a cache larga a posse e o fecho fecha-a, como sempre", () => {
    expect(aoEsconderAPagina({ persisted: true, emChamada: false })).toBe("largar")
    expect(aoEsconderAPagina({ persisted: false, emChamada: false })).toBe("fechar")
  })

  it("com uma chamada, a ida para a cache mantém a posse: ao voltar não recarrega", () => {
    expect(aoEsconderAPagina({ persisted: true, emChamada: true })).toBe("manter")
  })

  it("com uma chamada, fechar a página continua a fechar", () => {
    expect(aoEsconderAPagina({ persisted: false, emChamada: true })).toBe("fechar")
  })

  it("de volta da cache sem chamada, recarrega; com uma chamada, não", () => {
    expect(aoMostrarAPagina({ persisted: true, emChamada: false })).toBe("recarregar")
    // The locked iPhone: `pagehide(persisted)` then `pageshow(persisted)` on unlock.
    expect(aoMostrarAPagina({ persisted: true, emChamada: true })).toBe("nada")
    expect(aoMostrarAPagina({ persisted: false, emChamada: false })).toBe("nada")
  })
})
