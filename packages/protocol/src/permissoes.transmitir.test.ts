import { describe, expect, it } from "vitest"
import { decodePayload, encodePayload, POWERS, type Payload } from "./payload.js"
import {
  CARGO_ADMIN,
  CARGO_TODOS,
  type CargoDefinido,
  type EstadoDePermissoes,
  permissoesEm,
  PODERES_CUMPRIDOS,
  PODERES_DE_TODOS_POR_OMISSAO,
  PODERES_POR_SALA_CUMPRIDOS,
  poderesConhecidos,
} from "./permissoes.js"

/**
 * `transmitir` (12/11/2026): sharing the screen becomes a role power. Admins and
 * the founder always have it; `@todos` does not, in new and existing channels.
 */

const ANA = "@ana:t" // founder
const BRUNO = "@bruno:t" // admin
const CARLA = "@carla:t" // no role
const DARIO = "@dario:t" // `transmissao`

function estado(todos: readonly string[] = PODERES_DE_TODOS_POR_OMISSAO, sala: EstadoDePermissoes["sobreposicoesDaSala"] = () => undefined): EstadoDePermissoes {
  const de: Record<string, string[]> = { [BRUNO]: [CARGO_ADMIN], [DARIO]: ["transmissao"] }
  const cargos: Record<string, CargoDefinido> = { transmissao: { powers: ["transmitir"], rank: 1 } }
  return {
    fundador: ANA,
    cargosDe: (address) => de[address] ?? [],
    cargo: (role) => cargos[role],
    todos: poderesConhecidos(todos),
    categoriaDaSala: () => "",
    sobreposicoesDaSala: sala,
  }
}

const transmite = (e: EstadoDePermissoes, quem: string, sala = "voz"): boolean => permissoesEm(e, quem, { sala }).includes("transmitir")

describe("a permissão transmitir", () => {
  it("é cumprida no canal e por sala, e não vem com toda a gente", () => {
    expect(POWERS).toContain("transmitir")
    expect(PODERES_CUMPRIDOS).toContain("transmitir")
    expect(PODERES_POR_SALA_CUMPRIDOS).toContain("transmitir")
    expect(PODERES_DE_TODOS_POR_OMISSAO).not.toContain("transmitir")
  })

  it("fundador e admin têm-na; um membro sem cargo não; o cargo dá-a", () => {
    const e = estado()
    expect(transmite(e, ANA)).toBe(true)
    expect(transmite(e, BRUNO)).toBe(true)
    expect(transmite(e, CARLA)).toBe(false)
    expect(transmite(e, DARIO)).toBe(true)
  })

  it("um canal que já existe, com @todos publicado com ecra, continua sem transmitir para toda a gente", () => {
    // What a 1.2 to 1.3.7 client published for `@todos`: the old defaults, `ecra` included.
    const e = estado([...PODERES_DE_TODOS_POR_OMISSAO, "ecra"])
    expect(transmite(e, CARLA)).toBe(false)
  })

  it("uma sobreposição dá ou tira transmitir só naquela sala", () => {
    const e = estado(PODERES_DE_TODOS_POR_OMISSAO, (sala) =>
      sala === "palco" ? [{ role: CARGO_TODOS, allow: ["transmitir"], deny: [] }, { role: "transmissao", allow: [], deny: ["transmitir"] }] : undefined,
    )
    expect(transmite(e, CARLA, "palco")).toBe(true)
    expect(transmite(e, DARIO, "palco")).toBe(false)
    expect(transmite(e, DARIO, "voz")).toBe(true)
  })

  it("viaja num role.define e volta igual; um nome que não se conhece cai sem levar o cargo", () => {
    const payload = { t: "role.define", role: "transmissao", name: "Transmissão", powers: ["transmitir"], position: 0, rank: 1, removed: false, definedAt: 1 } as Payload
    const lido = decodePayload(encodePayload(payload)) as { powers: string[] }
    expect(poderesConhecidos(lido.powers)).toEqual(["transmitir"])
  })
})
