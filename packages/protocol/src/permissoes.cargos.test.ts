import { describe, expect, it } from "vitest"
import { cargoDaMencao, mencaoDeCargo, mencoesDeCargoConferidas, MENCAO_TODOS } from "./permissoes.js"

describe("menções de cargo", () => {
  it("o cargo viaja como & e o id, e não se confunde com contas nem com todos", () => {
    expect(mencaoDeCargo("porteiro")).toBe("&porteiro")
    expect(cargoDaMencao("&porteiro")).toBe("porteiro")
    expect(cargoDaMencao("@ana-b-c-d:s")).toBeNull()
    expect(cargoDaMencao(MENCAO_TODOS)).toBeNull()
    expect(cargoDaMencao("&")).toBeNull()
  })

  it("sem mencionartodos, só ficam os cargos mencionáveis por todos", () => {
    const mentions = ["@ana:s", "&porteiro", "&guarda"]
    expect(mencoesDeCargoConferidas(mentions, true, () => false)).toBe(mentions)
    expect(mencoesDeCargoConferidas(mentions, false, (cargo) => cargo === "guarda")).toEqual(["@ana:s", "&guarda"])
    expect(mencoesDeCargoConferidas(mentions, false, () => false)).toEqual(["@ana:s"])
    const semCargos = ["@ana:s"]
    expect(mencoesDeCargoConferidas(semCargos, false, () => false)).toBe(semCargos)
  })
})
