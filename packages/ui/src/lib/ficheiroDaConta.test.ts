import { beforeEach, describe, expect, it } from "vitest"
import { FICHEIRO_DA_CONTA_KEY, ficheiroPorTratar, marcarFicheiroTratado } from "./ficheiroDaConta.js"

beforeEach(() => localStorage.clear())

describe("o ficheiro da conta, por conta e por browser (16/11/2026)", () => {
  it("uma conta nunca tratada deve o aviso; depois de marcada, não", async () => {
    expect(await ficheiroPorTratar("@ana:s")).toBe(true)
    await marcarFicheiroTratado("@ana:s")
    expect(await ficheiroPorTratar("@ana:s")).toBe(false)
    // Another account in the same browser still owes it.
    expect(await ficheiroPorTratar("@bruno:s")).toBe(true)
  })

  it("guarda impressões, não endereços, e não cresce sem fim", async () => {
    for (let i = 0; i < 60; i++) await marcarFicheiroTratado(`@conta${i}:s`)
    const guardado = localStorage.getItem(FICHEIRO_DA_CONTA_KEY) ?? ""
    expect(guardado).not.toContain("conta")
    expect(JSON.parse(guardado)).toHaveLength(50)
    expect(await ficheiroPorTratar("@conta59:s")).toBe(false)
  })

  it("um registo estragado conta como vazio", async () => {
    localStorage.setItem(FICHEIRO_DA_CONTA_KEY, "{nada")
    expect(await ficheiroPorTratar("@ana:s")).toBe(true)
    await marcarFicheiroTratado("@ana:s")
    expect(await ficheiroPorTratar("@ana:s")).toBe(false)
  })
})
