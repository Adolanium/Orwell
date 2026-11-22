import { afterEach, describe, expect, it } from "vitest"
import { clearDiagnostics, diagnosticsSnapshot } from "./diagnostics.js"
import { capturarErrosGlobais, esquecerFalhas, marcarSincronia, registarFalha, semDadosPessoais, stackMinificada } from "./falhas.js"
import { VERSAO_DA_APP } from "./versao.js"

afterEach(() => {
  clearDiagnostics()
  esquecerFalhas()
})

describe("crashes and stray errors in the diagnostic log", () => {
  it("a screen crash writes the message, a short stack, the version and the sync state", () => {
    marcarSincronia("history", true)
    const erro = new TypeError("Cannot read properties of undefined (reading 'payload')")
    erro.stack = [
      "TypeError: Cannot read properties of undefined (reading 'payload')",
      "    at Ab (https://orwell.pt/app/assets/index-D4f9.js?v=3:41:2210)",
      "    at Shell (https://orwell.pt/app/assets/index-D4f9.js:12:88)",
    ].join("\n")
    registarFalha("screen-crash", erro, "\n    at Shell (x)\n    at App (y)")
    const [linha] = diagnosticsSnapshot()
    expect(linha?.kind).toBe("error")
    expect(linha?.code).toBe("screen-crash")
    expect(linha?.detail).toContain(`v=${VERSAO_DA_APP}`)
    expect(linha?.detail).toContain("sync=history")
    expect(linha?.detail).toContain(`msg="TypeError: Cannot read properties of undefined (reading 'payload')"`)
    expect(linha?.detail).toContain("stack=index-D4f9.js:41:2210 < index-D4f9.js:12:88")
    expect(linha?.detail).toContain("in=Shell>App")
    expect(linha?.detail).not.toContain("orwell.pt")
  })

  it("not syncing says so", () => {
    registarFalha("uncaught-error", new Error("boom"))
    expect(diagnosticsSnapshot()[0]?.detail).toContain("sync=no")
  })

  it("addresses, channels, links, e-mails and long tokens never reach the log", () => {
    const texto = semDadosPessoais(
      "no seat for @k4x7m2pq8rtv:orwell.pt in !lagar:orwell.pt, see https://orwell.pt/a#segredo, ana@exemplo.pt, key AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    )
    expect(texto).not.toMatch(/k4x7m2|lagar|segredo|ana@|AAAAAAAA/)
    expect(texto).toContain("<address>")
    expect(texto).toContain("<url>")
    expect(texto).toContain("<email>")
    expect(texto).toContain("<token>")
    expect(semDadosPessoais("x".repeat(500)).length).toBeLessThanOrEqual(160)
  })

  it("the stack keeps six frames at most, file:line:col only", () => {
    const pilha = Array.from({ length: 10 }, (_, i) => `    at f${i} (http://127.0.0.1:5173/src/a${i}.tsx?t=1:${i + 1}:${i + 2})`).join("\n")
    expect(stackMinificada(pilha)).toBe("a0.tsx:1:2 < a1.tsx:2:3 < a2.tsx:3:4 < a3.tsx:4:5 < a4.tsx:5:6 < a5.tsx:6:7")
    expect(stackMinificada(undefined)).toBe("")
  })

  it("window.onerror and unhandledrejection reach the log", () => {
    const parar = capturarErrosGlobais(window)
    window.dispatchEvent(new ErrorEvent("error", { error: new RangeError("too deep"), message: "too deep" }))
    const rejeicao = new Event("unhandledrejection") as Event & { reason?: unknown }
    rejeicao.reason = new Error("the socket closed")
    window.dispatchEvent(rejeicao)
    parar()
    const linhas = diagnosticsSnapshot()
    expect(linhas.map((l) => l.code)).toEqual(["uncaught-error", "unhandled-rejection"])
    expect(linhas[0]?.detail).toContain(`msg="RangeError: too deep"`)
    expect(linhas[1]?.detail).toContain(`msg="Error: the socket closed"`)
  })

  it("the same throw reported twice in a row counts once", () => {
    const erro = new Error("twice")
    registarFalha("uncaught-error", erro, null, 1_000)
    registarFalha("uncaught-error", erro, null, 1_500)
    registarFalha("uncaught-error", erro, null, 4_000)
    expect(diagnosticsSnapshot()).toHaveLength(2)
  })

  it("a screen crash survives the reload: the next start writes it to the log", () => {
    registarFalha("screen-crash", new Error("before the reload"))
    // The reload: the in-memory log is gone, the line in localStorage is not.
    clearDiagnostics()
    const parar = capturarErrosGlobais(window)
    parar()
    const [linha] = diagnosticsSnapshot()
    expect(linha?.code).toBe("screen-crash")
    expect(linha?.outcome).toBe("before-reload")
    expect(linha?.detail).toContain("before the reload")
    // Written once: a second start does not repeat it.
    clearDiagnostics()
    capturarErrosGlobais(window)()
    expect(diagnosticsSnapshot()).toHaveLength(0)
  })
})
