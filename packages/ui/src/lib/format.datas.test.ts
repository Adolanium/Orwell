import { afterEach, describe, expect, it } from "vitest"
import { definirLingua } from "../strings.js"
import { formatarDataEHora, formatarDia } from "./format.js"

/**
 * The full date and the day separator come from formatters kept per locale
 * (1.3.20 fluidity): the same text as a formatter built at each call, and the
 * language still switches.
 */
const AT = Date.UTC(2026, 10, 12, 15, 30)

afterEach(() => {
  definirLingua("pt")
})

describe("as datas das linhas", () => {
  it.each([
    ["pt", "pt-PT"],
    ["en", "en-US"],
  ] as const)("em %s, o mesmo texto que um formatador novo, chamada após chamada", (lingua, locale) => {
    definirLingua(lingua)
    const cheia = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(AT)
    const dia = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(AT)
    for (let k = 0; k < 3; k++) {
      expect(formatarDataEHora(AT)).toBe(cheia)
      expect(formatarDia(AT)).toBe(dia)
    }
  })

  it("mudar de língua muda o texto: o formatador guardado é por língua", () => {
    definirLingua("pt")
    const pt = formatarDataEHora(AT)
    definirLingua("en")
    const en = formatarDataEHora(AT)
    expect(en).not.toBe(pt)
    definirLingua("pt")
    expect(formatarDataEHora(AT)).toBe(pt)
  })

  it("sem data, nada", () => {
    expect(formatarDataEHora(undefined)).toBe("")
  })
})
