import { describe, expect, it } from "vitest"
import { decodePayload, encodePayload, IRREVERSIBLE_POWERS, POWERS, type Payload } from "./payload.js"
import {
  CARGO_ADMIN,
  type CargoDefinido,
  comImplicacoes,
  type EstadoDePermissoes,
  fundirCargoAntigo,
  fundirRepublicacaoAntiga,
  PODER_DAS_VOTACOES_DESDE_MINUTO,
  PODERES_CUMPRIDOS,
  PODERES_DE_TODOS_POR_OMISSAO,
  PODERES_DESDE_1_3_21,
  PODERES_POR_SALA,
  permissoesEm,
  poderesConhecidos,
  votacaoPedePoder,
} from "./permissoes.js"

/**
 * `votacoes` (1.3.21, 18/11/2026): creating polls needs a role.
 *
 * How it lives next to 1.3.20 and older, stated once, like the signed forms in
 * `autoria.forma.test.ts`:
 *
 * - A 1.3.20 does not know the name. It drops it when it reads a role
 *   (`rolesOf` filters by its own `POWERS`), shows the poll option to everyone,
 *   and accepts and draws polls from everyone. Nothing it receives is refused:
 *   the name travels inside `powers`, whose schema is the narrow format and not
 *   an enum, so the role arrives whole.
 * - A 1.3.21 reads a poll from a 1.3.20 member without the power as a plain
 *   message: the body already writes the question and the options in full (see
 *   `corpoDaVotacao` in the UI). The member sees a poll on their screen; the
 *   others see the text. That is the price of a rule older clients cannot apply.
 * - Polls the server received before `PODER_DAS_VOTACOES_DESDE_MINUTO` are not
 *   judged: they were made when everyone could, and keep their card and votes.
 * - A 1.3.20 founder or admin republishes roles with their original date and
 *   without `votacoes`: `fundirRepublicacaoAntiga` keeps it. An EDIT made in a
 *   1.3.20 (new date) drops it: that client cannot show the toggle.
 * - The built-in `admin` goes out with the first 32 names
 *   (`PODERES_DO_ADMIN_NO_FIO`), byte for byte what 1.3.20 sends, because the
 *   schema caps `powers` at 32 in every version (`payload.permissoes.test.ts`).
 */

const ANA = "@ana:t" // founder
const BRUNO = "@bruno:t" // admin
const CARLA = "@carla:t" // no role
const DARIO = "@dario:t" // `sondagens`, the role that creates polls
const EVA = "@eva:t" // `moderacao`: moderates, does not create polls

function estado(opcoes: { fundador?: string | null; cargos?: Record<string, CargoDefinido> } = {}): EstadoDePermissoes {
  const de: Record<string, string[]> = { [BRUNO]: [CARGO_ADMIN], [DARIO]: ["sondagens"], [EVA]: ["moderacao"] }
  const cargos: Record<string, CargoDefinido> = opcoes.cargos ?? {
    sondagens: { powers: ["votacoes"], rank: 1 },
    moderacao: { powers: ["moderar", "fixar", "atender", "gerirsalas", "mencionartodos"], rank: 2 },
  }
  return {
    fundador: opcoes.fundador === undefined ? ANA : opcoes.fundador,
    cargosDe: (address) => de[address] ?? [],
    cargo: (role) => cargos[role],
    todos: PODERES_DE_TODOS_POR_OMISSAO,
    categoriaDaSala: () => "",
  }
}

const cria = (e: EstadoDePermissoes, quem: string, sala?: string): boolean =>
  permissoesEm(e, quem, sala === undefined ? {} : { sala }).includes("votacoes")

describe("o poder votacoes", () => {
  it("entra no FIM de POWERS, sem mexer na ordem dos outros, e o editor de cargos oferece-o", () => {
    expect(POWERS.at(-1)).toBe("votacoes")
    expect(POWERS.indexOf("mencionavel")).toBe(31)
    expect(POWERS.indexOf("votacoes")).toBe(32)
    expect(PODERES_CUMPRIDOS).toContain("votacoes")
    expect(PODERES_DESDE_1_3_21).toEqual(["votacoes"])
  })

  it("é do canal inteiro, não de uma sala, e desfaz-se (não é irreversível)", () => {
    expect(PODERES_POR_SALA).not.toContain("votacoes")
    expect(IRREVERSIBLE_POWERS).not.toContain("votacoes")
  })

  it("ninguém o ganha na migração: nem toda a gente, nem quem modera, nem um cargo antigo", () => {
    expect(PODERES_DE_TODOS_POR_OMISSAO).not.toContain("votacoes")
    // `moderar` implies `apelidos` only: deleting messages is not creating polls.
    expect([...comImplicacoes(["moderar"])]).not.toContain("votacoes")
    for (const poder of POWERS) if (poder !== "votacoes") expect([...comImplicacoes([poder])]).not.toContain("votacoes")
    const e = estado()
    expect(cria(e, CARLA)).toBe(false)
    expect(cria(e, EVA)).toBe(false)
    // A role from before 1.2 (no `rank`) republished on top of a new one: it gains nothing.
    const guardado = { t: "role.define", role: "moderacao", powers: ["moderar"], rank: 2, definedAt: 5 }
    const antigo = { t: "role.define", role: "moderacao", powers: ["moderar", "fixar"], definedAt: 6 }
    expect(fundirCargoAntigo(guardado, antigo)["powers"]).not.toContain("votacoes")
  })

  it("a fundadora e o admin têm-no sempre; um cargo dá-o", () => {
    const e = estado()
    expect(cria(e, ANA)).toBe(true)
    expect(cria(e, BRUNO)).toBe(true)
    expect(cria(e, DARIO)).toBe(true)
    // In a room too: the channel rule, no override changes it.
    expect(cria(e, DARIO, "geral")).toBe(true)
    expect(cria(e, CARLA, "geral")).toBe(false)
  })

  it("num canal sem fundação conhecida, toda a gente o tem, como em 1.3.20", () => {
    // `permissoesEm` grants there everything that can be undone, and `votacoes` can.
    expect(cria(estado({ fundador: null }), CARLA)).toBe(true)
  })

  it("viaja num role.define e volta igual; uma 1.3.20 que não o conhece fica com o resto do cargo", () => {
    const payload = { t: "role.define", role: "sondagens", name: "Sondagens", powers: ["votacoes", "fixar"], position: 0, rank: 1, removed: false, definedAt: 1 } as Payload
    const lido = decodePayload(encodePayload(payload)) as { powers: string[] }
    expect(lido.powers).toEqual(["votacoes", "fixar"])
    expect(poderesConhecidos(lido.powers)).toEqual(["fixar", "votacoes"])
    // What a 1.3.20 keeps: its own `POWERS` is ours without the last name.
    const daVersaoAnterior = POWERS.slice(0, 32)
    expect(daVersaoAnterior.filter((poder) => lido.powers.includes(poder))).toEqual(["fixar"])
  })
})

describe("a data a partir da qual uma votação pede o poder", () => {
  it("é um minuto do servidor, 19/11/2026 00:00 UTC", () => {
    expect(PODER_DAS_VOTACOES_DESDE_MINUTO * 60_000).toBe(Date.UTC(2026, 10, 19))
  })

  it("antes desse minuto, a votação não é julgada; desde ele, é", () => {
    expect(votacaoPedePoder(PODER_DAS_VOTACOES_DESDE_MINUTO - 1)).toBe(false)
    expect(votacaoPedePoder(PODER_DAS_VOTACOES_DESDE_MINUTO)).toBe(true)
    expect(votacaoPedePoder(PODER_DAS_VOTACOES_DESDE_MINUTO + 60 * 24 * 30)).toBe(true)
  })

  it("sem minuto do servidor (um relato, um envio nosso), decide o relógio deste aparelho", () => {
    const antes = Date.UTC(2026, 10, 18, 23, 59)
    const depois = Date.UTC(2026, 10, 19, 0, 1)
    expect(votacaoPedePoder(undefined, antes)).toBe(false)
    expect(votacaoPedePoder(undefined, depois)).toBe(true)
  })
})

describe("uma 1.3.20 que republica um cargo não lhe tira votacoes", () => {
  const guardado = { t: "role.define", role: "sondagens", name: "Sondagens", powers: ["fixar", "votacoes"], rank: 1, removed: false, definedAt: 40 }

  it("com a data original (republicação), o poder fica", () => {
    const daAntiga = { ...guardado, powers: ["fixar"] }
    expect(fundirRepublicacaoAntiga(guardado, daAntiga)["powers"]).toEqual(["fixar", "votacoes"])
  })

  it("com uma data nova (uma edição), manda o que a edição diz", () => {
    const edicao = { ...guardado, powers: ["fixar"], definedAt: 41 }
    expect(fundirRepublicacaoAntiga(guardado, edicao)["powers"]).toEqual(["fixar"])
  })

  it("uma lápide, ou um cargo guardado sem o poder, não mudam", () => {
    const lapide = { ...guardado, powers: [], removed: true }
    expect(fundirRepublicacaoAntiga(guardado, lapide)["powers"]).toEqual([])
    const semPoder = { ...guardado, powers: ["fixar"] }
    expect(fundirRepublicacaoAntiga(semPoder, { ...semPoder })["powers"]).toEqual(["fixar"])
    expect(fundirRepublicacaoAntiga(undefined, semPoder)["powers"]).toEqual(["fixar"])
  })
})
