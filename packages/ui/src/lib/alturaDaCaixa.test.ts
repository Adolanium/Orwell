import { describe, expect, it } from "vitest"
import { alturaDaCaixa, FRACCAO_DA_AREA } from "./alturaDaCaixa.js"

/**
 * How tall the text box is (20/11/2026, as in Discord).
 *
 * The box grows line by line up to about half of the conversation area, the
 * real area (the conversation plus the composer), not the window. Past that it
 * scrolls inside.
 */
describe("a altura da caixa de escrita", () => {
  it("cresce com o texto enquanto cabe", () => {
    expect(alturaDaCaixa({ conteudo: 120, area: 800 })).toEqual({ altura: 120, rola: false })
  })

  it("pára a metade da área da conversa, e a partir daí rola por dentro", () => {
    expect(FRACCAO_DA_AREA).toBe(0.5)
    expect(alturaDaCaixa({ conteudo: 900, area: 800 })).toEqual({ altura: 400, rola: true })
  })

  it("com o teclado do telemóvel a área é menor, e o tecto desce com ela", () => {
    expect(alturaDaCaixa({ conteudo: 300, area: 400 })).toEqual({ altura: 200, rola: true })
  })

  it("nunca fica mais baixa do que uma linha, nem numa área minúscula", () => {
    expect(alturaDaCaixa({ conteudo: 40, area: 50, minima: 40 })).toEqual({ altura: 40, rola: false })
    expect(alturaDaCaixa({ conteudo: 200, area: 50, minima: 40 })).toEqual({ altura: 40, rola: true })
  })
})
