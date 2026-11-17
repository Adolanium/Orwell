import { describe, expect, it } from "vitest"
import { notificationTextOf, textoDoCargoAtribuido, type AppNotification } from "./notifications.js"
import { strings } from "../strings.js"

/** The role notice (12/11/2026): one sentence, however many roles. */
describe("o aviso de cargo atribuído", () => {
  it("um cargo, dois cargos e três cargos dão uma frase só", () => {
    const t = strings.notifCenter.cargoAtribuido
    expect(textoDoCargoAtribuido([{ nome: "Anúncios" }], "Redacção")).toBe(`${t.um}Anúncios${t.em("Redacção")}`)
    expect(textoDoCargoAtribuido([{ nome: "A" }, { nome: "B" }], "R")).toBe(`${t.varios}A${t.e}B${t.em("R")}`)
    expect(textoDoCargoAtribuido([{ nome: "A" }, { nome: "B" }, { nome: "C" }], "R")).toBe(`${t.varios}A, B${t.e}C${t.em("R")}`)
  })

  it("o texto do sino usa o nome do canal", () => {
    const entrada: AppNotification = { id: "c", kind: "role-given", at: 1, channel: "!x:s", cargos: [{ nome: "Mods", cor: "lima" }], read: false }
    expect(notificationTextOf(entrada, () => "", () => "Redacção")).toBe(textoDoCargoAtribuido([{ nome: "Mods" }], "Redacção"))
  })
})
