import { describe, expect, it } from "vitest"
import { decodePayload, encodePayload, type Payload, type Sobreposicao } from "./payload.js"
import {
  CARGO_ADMIN,
  CARGO_TODOS,
  comSoLeitura,
  type CargoDefinido,
  type EstadoDePermissoes,
  mensagemPrecisaDeEscrita,
  permissoesEm,
  PODERES_DE_TODOS_POR_OMISSAO,
  PODERES_POR_SALA_CUMPRIDOS,
  soLeituraDe,
} from "./permissoes.js"

/**
 * Read-only rooms (12/11/2026): a room where only some roles write.
 *
 * Not a new field. It is the room override that already exists since 1.2:
 * `@todos` denies `escrever` in the room, and each chosen role allows it. These
 * tests prove the two helpers that read and write that shape, and the rule
 * `permissoesEm` gives for it.
 */

const ANA = "@ana:t" // founder
const BRUNO = "@bruno:t" // admin
const CARLA = "@carla:t" // no role
const DARIO = "@dario:t" // `anuncios`

function estado(salas: Record<string, Sobreposicao[]> = {}): EstadoDePermissoes {
  const de: Record<string, string[]> = { [BRUNO]: [CARGO_ADMIN], [DARIO]: ["anuncios"] }
  const cargos: Record<string, CargoDefinido> = { anuncios: { powers: [], rank: 1 } }
  return {
    fundador: ANA,
    cargosDe: (address) => de[address] ?? [],
    cargo: (role) => cargos[role],
    todos: PODERES_DE_TODOS_POR_OMISSAO,
    categoriaDaSala: () => "",
    sobreposicoesDaSala: (room) => salas[room],
  }
}

const escreve = (e: EstadoDePermissoes, quem: string, sala: string): boolean =>
  permissoesEm(e, quem, { sala }).includes("escrever")

describe("salas só de leitura", () => {
  it("escrever passa a ser cumprido por sala", () => {
    expect(PODERES_POR_SALA_CUMPRIDOS).toContain("escrever")
  })

  it("uma sala sem sobreposições não é só de leitura", () => {
    expect(soLeituraDe(undefined)).toEqual({ soLeitura: false, quemEscreve: [] })
    expect(soLeituraDe([])).toEqual({ soLeitura: false, quemEscreve: [] })
  })

  it("só leitura com um cargo: toda a gente perde escrever, o cargo e quem administra mantêm", () => {
    const perms = comSoLeitura([], { soLeitura: true, quemEscreve: ["anuncios"] })
    expect(soLeituraDe(perms)).toEqual({ soLeitura: true, quemEscreve: ["anuncios"] })
    const e = estado({ avisos: perms })
    expect(escreve(e, CARLA, "avisos")).toBe(false)
    expect(escreve(e, DARIO, "avisos")).toBe(true)
    expect(escreve(e, BRUNO, "avisos")).toBe(true)
    expect(escreve(e, ANA, "avisos")).toBe(true)
    // Only in that room.
    expect(escreve(e, CARLA, "geral")).toBe(true)
    // Reacting is not writing: it stays.
    expect(permissoesEm(e, CARLA, { sala: "avisos" })).toContain("reagir")
  })

  it("só leitura sem cargos: só quem administra escreve", () => {
    const e = estado({ avisos: comSoLeitura(undefined, { soLeitura: true, quemEscreve: [] }) })
    expect(escreve(e, DARIO, "avisos")).toBe(false)
    expect(escreve(e, BRUNO, "avisos")).toBe(true)
  })

  it("guarda as outras sobreposições da sala e desfaz-se sem deixar restos", () => {
    const antes: Sobreposicao[] = [
      { role: CARGO_TODOS, allow: [], deny: ["ligar"] },
      { role: "anuncios", allow: ["mover"], deny: [] },
    ]
    const ligada = comSoLeitura(antes, { soLeitura: true, quemEscreve: ["anuncios", "outro"] })
    expect(ligada).toEqual([
      { role: CARGO_TODOS, allow: [], deny: ["ligar", "escrever"] },
      { role: "anuncios", allow: ["mover", "escrever"], deny: [] },
      { role: "outro", allow: ["escrever"], deny: [] },
    ])
    // A role taken off the list loses only `escrever`.
    const menos = comSoLeitura(ligada, { soLeitura: true, quemEscreve: ["outro"] })
    expect(menos).toEqual([
      { role: CARGO_TODOS, allow: [], deny: ["ligar", "escrever"] },
      { role: "anuncios", allow: ["mover"], deny: [] },
      { role: "outro", allow: ["escrever"], deny: [] },
    ])
    // Off: back to what was there before.
    expect(comSoLeitura(menos, { soLeitura: false, quemEscreve: [] })).toEqual(antes)
  })

  it("um cargo que negava escrever passa a dar, quando escolhido", () => {
    const perms = comSoLeitura([{ role: "anuncios", allow: [], deny: ["escrever"] }], {
      soLeitura: true,
      quemEscreve: ["anuncios"],
    })
    expect(perms.find((p) => p.role === "anuncios")).toEqual({ role: "anuncios", allow: ["escrever"], deny: [] })
  })

  it("nunca escreve uma entrada para admin, e não repete cargos", () => {
    const perms = comSoLeitura([], { soLeitura: true, quemEscreve: [CARGO_ADMIN, "anuncios", "anuncios", CARGO_TODOS] })
    expect(perms.map((p) => p.role)).toEqual([CARGO_TODOS, "anuncios"])
  })

  it("viaja num channel.meta e volta igual (round-trip do formato)", () => {
    const perms = comSoLeitura([], { soLeitura: true, quemEscreve: ["anuncios"] })
    const payload: Payload = {
      t: "channel.meta",
      room: "avisos",
      name: "Avisos",
      category: "",
      kind: "text",
      position: 0,
      closed: false,
      removed: false,
      perms,
      updatedAt: 1,
    } as Payload
    const lido = decodePayload(encodePayload(payload)) as { perms?: Sobreposicao[] }
    expect(soLeituraDe(lido.perms)).toEqual({ soLeitura: true, quemEscreve: ["anuncios"] })
  })

  it("só as mensagens comuns precisam de escrever; actos de sistema dentro de mensagens não", () => {
    const base = { t: "message", id: "m1", sentAt: 1, body: "olá", attachments: [], links: [], mentions: [] }
    expect(mensagemPrecisaDeEscrita(base)).toBe(true)
    expect(mensagemPrecisaDeEscrita({ ...base, apelido: { subject: CARLA, nick: "C", at: 1 } })).toBe(false)
    expect(mensagemPrecisaDeEscrita({ ...base, sucessora: { para: ANA, at: 1 } })).toBe(false)
    expect(mensagemPrecisaDeEscrita({ t: "reaction", target: "m1", emoji: "👍", remove: false })).toBe(false)
    expect(mensagemPrecisaDeEscrita({ t: "edit", id: "e", target: "m1", editedAt: 1, body: "x" })).toBe(false)
  })
})

describe("um cargo apagado não vale nas regras por sala", () => {
  it("quem tinha o cargo apagado perde o que a sala lhe dava (como no Discord)", () => {
    const perms = comSoLeitura([], { soLeitura: true, quemEscreve: ["anuncios"] })
    const vivo = estado({ avisos: perms })
    expect(escreve(vivo, DARIO, "avisos")).toBe(true)
    // The role was deleted: `cargo()` no longer knows it, and Dario still has it in his list.
    const apagado: EstadoDePermissoes = { ...vivo, cargo: () => undefined }
    expect(apagado.cargosDe(DARIO)).toContain("anuncios")
    expect(escreve(apagado, DARIO, "avisos")).toBe(false)
    // The same for any per-room power, not only writing.
    const mover: EstadoDePermissoes = { ...apagado, sobreposicoesDaSala: () => [{ role: "anuncios", allow: ["mover"], deny: [] }] }
    expect(permissoesEm(mover, DARIO, { sala: "x" })).not.toContain("mover")
  })
})
