import { describe, expect, it, vi } from "vitest"
import { membrosDaSala, type AcessoDoCanal } from "./membrosDaSala.js"

const DONA = "@dona:casa.pt"
const ADMIN = "@admin:casa.pt"
const GESTOR = "@gestor:casa.pt"
const CHEFE = "@chefe:casa.pt"
const ANA = "@ana:casa.pt"
const MEMBROS = [DONA, ADMIN, GESTOR, CHEFE, ANA]

function acesso(papeisDe = vi.fn((quem: string) => ({ [GESTOR]: ["organiza"], [CHEFE]: ["chefe"], [ANA]: ["guia"] })[quem] ?? [])): AcessoDoCanal & {
  papeisDe: typeof papeisDe
} {
  return { fundador: DONA, admins: new Set([ADMIN]), papeisQueAdministram: new Set(["organiza"]), papeisDe }
}

describe("quem aparece na lista de uma sala", () => {
  it("numa sala aberta, toda a gente, e o mesmo array sem ler cargo nenhum", () => {
    const a = acesso()
    expect(membrosDaSala(MEMBROS, [], a)).toBe(MEMBROS)
    expect(membrosDaSala(MEMBROS, undefined, a)).toBe(MEMBROS)
    // A channel of 700 pays nothing for an open room.
    expect(a.papeisDe).not.toHaveBeenCalled()
  })

  it("numa sala privada: fundador, admin, quem gere o canal e quem tem o cargo", () => {
    expect(membrosDaSala(MEMBROS, ["chefe"], acesso())).toEqual([DONA, ADMIN, GESTOR, CHEFE])
  })

  it("\"só administração\" deixa de fora quem só tem cargos comuns", () => {
    expect(membrosDaSala(MEMBROS, ["admin"], acesso())).toEqual([DONA, ADMIN, GESTOR])
  })

  it("o fundador e os admins não custam uma leitura de cargos", () => {
    const a = acesso()
    membrosDaSala(MEMBROS, ["chefe"], a)
    expect(a.papeisDe.mock.calls.map(([quem]) => quem)).toEqual([GESTOR, CHEFE, ANA])
  })
})
