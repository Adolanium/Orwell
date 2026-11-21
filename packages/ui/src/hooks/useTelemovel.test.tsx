import { afterEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { CONSULTA_DO_TELEMOVEL, useTelemovel } from "./useTelemovel.js"

/**
 * The phone layout (option B, 20/11/2026) exists only where the browser says
 * the screen is narrow. Without `matchMedia` (jsdom, an old engine) the answer
 * is "no": the desktop layout, which every older test reads.
 */
afterEach(() => vi.unstubAllGlobals())

function ecra(estreito: boolean): { mudar: (novo: boolean) => void } {
  let ouvinte: (() => void) | null = null
  let actual = estreito
  vi.stubGlobal(
    "matchMedia",
    vi.fn((consulta: string) => ({
      get matches() {
        return consulta === CONSULTA_DO_TELEMOVEL && actual
      },
      media: consulta,
      addEventListener: (_: string, fn: () => void) => {
        ouvinte = fn
      },
      removeEventListener: () => {
        ouvinte = null
      },
    })),
  )
  return {
    mudar: (novo) => {
      actual = novo
      ouvinte?.()
    },
  }
}

describe("useTelemovel", () => {
  it("is false without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined)
    expect(renderHook(() => useTelemovel()).result.current).toBe(false)
  })

  it("is true at 390 px, and follows a rotation", () => {
    const controlo = ecra(true)
    const { result } = renderHook(() => useTelemovel())
    expect(result.current).toBe(true)
    act(() => controlo.mudar(false))
    expect(result.current).toBe(false)
  })

  it("uses the same breakpoint as the sheets (840 px)", () => {
    expect(CONSULTA_DO_TELEMOVEL).toBe("(max-width: 840px)")
  })
})
