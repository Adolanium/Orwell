import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import { strings } from "../../strings.js"
import {
  A_POR_EM_DIA_ATRASO_MS,
  A_POR_EM_DIA_FIM_MS,
  A_POR_EM_DIA_MINIMO_MS,
  A_POR_EM_DIA_SAIDA_MS,
  A_POR_EM_DIA_SAIDA_REDUZIDA_MS,
  AvisoAPorEmDia,
} from "./AvisoAPorEmDia.js"
import { Composer } from "./Composer.js"

/**
 * "Catching up on this conversation…" (1.3.26): under the box, always in the
 * layout, shown only after 400 ms of catch-up and for at least 1.5 s. The
 * layout itself (heights that do not move) is measured in a real browser, in
 * `AvisoAPorEmDia.medida.test.tsx`.
 */

const texto = (): string => strings.chat.aPorEmDia

function aviso(container: HTMLElement): HTMLElement {
  const linha = container.querySelector<HTMLElement>(".chat-a-recuperar")
  if (!linha) throw new Error("no notice line")
  return linha
}
const visivel = (linha: HTMLElement): boolean => linha.hasAttribute("data-visivel")
const avancar = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function reduzido(sim: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (consulta: string) =>
      ({ matches: sim && consulta.includes("reduce"), media: consulta, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  reduzido(false)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("the catching-up notice", () => {
  it("the times have names and the values asked for", () => {
    expect(A_POR_EM_DIA_ATRASO_MS).toBe(400)
    expect(A_POR_EM_DIA_MINIMO_MS).toBe(1_500)
    expect(A_POR_EM_DIA_FIM_MS).toBe(400)
    expect(A_POR_EM_DIA_SAIDA_MS).toBe(200)
    expect(A_POR_EM_DIA_SAIDA_REDUZIDA_MS).toBeGreaterThan(A_POR_EM_DIA_SAIDA_MS)
  })

  it("the line and its live region are there even with nothing to say, hidden and empty", () => {
    const { container } = render(<AvisoAPorEmDia ativo={false} />)
    const linha = aviso(container)
    expect(linha.getAttribute("role")).toBe("status")
    expect(visivel(linha)).toBe(false)
    expect(linha.getAttribute("aria-hidden")).toBe("true")
    expect(linha.textContent).toBe("")
  })

  it("a catch-up shorter than 400 ms shows nothing, ever", () => {
    const { container, rerender } = render(<AvisoAPorEmDia ativo />)
    avancar(A_POR_EM_DIA_ATRASO_MS - 50)
    rerender(<AvisoAPorEmDia ativo={false} />)
    avancar(5_000)
    const linha = aviso(container)
    expect(visivel(linha)).toBe(false)
    expect(linha.textContent).toBe("")
  })

  it("a run of short catch-ups shows nothing either", () => {
    const { container, rerender } = render(<AvisoAPorEmDia ativo={false} />)
    for (let vez = 0; vez < 6; vez++) {
      rerender(<AvisoAPorEmDia ativo />)
      avancar(300)
      rerender(<AvisoAPorEmDia ativo={false} />)
      avancar(100)
    }
    expect(aviso(container).textContent).toBe("")
  })

  it("past 400 ms it shows, with the text in the live region", () => {
    const { container } = render(<AvisoAPorEmDia ativo />)
    avancar(A_POR_EM_DIA_ATRASO_MS - 1)
    expect(visivel(aviso(container))).toBe(false)
    avancar(1)
    const linha = aviso(container)
    expect(visivel(linha)).toBe(true)
    expect(linha.hasAttribute("aria-hidden")).toBe(false)
    expect(linha.textContent).toBe(texto())
  })

  it("once shown it stays at least 1.5 s, even when the catch-up ends at once", () => {
    const { container, rerender } = render(<AvisoAPorEmDia ativo />)
    avancar(A_POR_EM_DIA_ATRASO_MS)
    rerender(<AvisoAPorEmDia ativo={false} />)
    avancar(A_POR_EM_DIA_MINIMO_MS - 1)
    expect(visivel(aviso(container))).toBe(true)
    avancar(1)
    expect(visivel(aviso(container))).toBe(false)
  })

  it("a long catch-up hides 400 ms after it ends, not at once", () => {
    const { container, rerender } = render(<AvisoAPorEmDia ativo />)
    avancar(A_POR_EM_DIA_ATRASO_MS + 3_000)
    rerender(<AvisoAPorEmDia ativo={false} />)
    avancar(A_POR_EM_DIA_FIM_MS - 1)
    expect(visivel(aviso(container))).toBe(true)
    avancar(1)
    expect(visivel(aviso(container))).toBe(false)
  })

  it("blinking while shown keeps it up, and the text node is never replaced (no second announcement)", () => {
    const { container, rerender } = render(<AvisoAPorEmDia ativo />)
    avancar(A_POR_EM_DIA_ATRASO_MS)
    const no = aviso(container).firstChild
    expect(no?.textContent).toBe(texto())
    for (let vez = 0; vez < 5; vez++) {
      rerender(<AvisoAPorEmDia ativo={false} />)
      avancar(200)
      rerender(<AvisoAPorEmDia ativo />)
      avancar(200)
      expect(visivel(aviso(container))).toBe(true)
      expect(aviso(container).firstChild).toBe(no)
    }
  })

  it("the text stays through the fade and leaves after it, 200 ms", () => {
    const { container, rerender } = render(<AvisoAPorEmDia ativo />)
    avancar(A_POR_EM_DIA_ATRASO_MS)
    rerender(<AvisoAPorEmDia ativo={false} />)
    avancar(A_POR_EM_DIA_MINIMO_MS)
    const linha = aviso(container)
    expect(visivel(linha)).toBe(false)
    expect(linha.getAttribute("aria-hidden")).toBe("true")
    expect(linha.textContent).toBe(texto())
    avancar(A_POR_EM_DIA_SAIDA_MS)
    expect(linha.textContent).toBe("")
  })

  it("with reduced motion the same times, and the text waits for the slower fade", () => {
    reduzido(true)
    const { container, rerender } = render(<AvisoAPorEmDia ativo />)
    avancar(A_POR_EM_DIA_ATRASO_MS - 1)
    expect(visivel(aviso(container))).toBe(false)
    avancar(1)
    expect(visivel(aviso(container))).toBe(true)
    rerender(<AvisoAPorEmDia ativo={false} />)
    avancar(A_POR_EM_DIA_MINIMO_MS)
    expect(visivel(aviso(container))).toBe(false)
    avancar(A_POR_EM_DIA_SAIDA_MS)
    expect(aviso(container).textContent).toBe(texto())
    avancar(A_POR_EM_DIA_SAIDA_REDUZIDA_MS - A_POR_EM_DIA_SAIDA_MS)
    expect(aviso(container).textContent).toBe("")
  })
})

describe("the catching-up notice in the composer", () => {
  const bridge = { social: { linkPreview: vi.fn().mockRejectedValue(new Error("no")) } } as unknown as EnclaveBridge

  it("is the last line of the form, under the box", () => {
    const { container } = render(
      <BridgeContext.Provider value={bridge}>
        <Composer connection="online" value="" onChange={vi.fn()} onSend={vi.fn()} rodape={<AvisoAPorEmDia ativo />} />
      </BridgeContext.Provider>,
    )
    const form = container.querySelector("form.chat-composer")
    const linha = form?.querySelector(".chat-a-recuperar")
    const caixa = form?.querySelector(".composer-line")
    expect(linha && caixa).toBeTruthy()
    expect(form?.lastElementChild).toBe(linha)
    expect(caixa!.compareDocumentPosition(linha!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
