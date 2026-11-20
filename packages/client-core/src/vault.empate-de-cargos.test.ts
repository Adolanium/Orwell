import { describe, expect, it } from "vitest"
import { aplicarAtribuicao, empateDepoisDe, newVaultContents, seqDoEmpate } from "./vault.js"

/**
 * I1 of the polls-somem review: a tie of timestamps on a role record.
 *
 * The record keeps the `seq` of a tie that changed its content (`empateSeq`), so a
 * poll judged again does not count a power given by re-sending the stored date
 * (`#tinhaOPoder` in the session). The mark must not come from an honest re-send
 * (same date, same content), and must leave with a later date.
 */

const CANAL = "!lagar:s"
const BENTO = "@bento:s"
const ANA = "@ana:s"

describe("seqDoEmpate", () => {
  it("sem registo, ou com data posterior: sem marca", () => {
    expect(seqDoEmpate(undefined, { at: 10, seq: 5 }, true)).toBeUndefined()
    expect(seqDoEmpate({ at: 10, empateSeq: 3 }, { at: 11, seq: 5 }, true)).toBeUndefined()
  })

  it("a mesma data com conteúdo diferente marca o seq de quem ganhou o empate", () => {
    expect(seqDoEmpate({ at: 10 }, { at: 10, seq: 7 }, true)).toBe(7)
    // A mark already there is never lowered.
    expect(seqDoEmpate({ at: 10, empateSeq: 9 }, { at: 10, seq: 7 }, true)).toBe(9)
    // An unknown `seq` marks for every poll.
    expect(seqDoEmpate({ at: 10 }, { at: 10, seq: -1 }, true)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it("a mesma data com o mesmo conteúdo (cascata) não marca, e guarda a marca que havia", () => {
    expect(seqDoEmpate({ at: 10 }, { at: 10, seq: 7 }, false)).toBeUndefined()
    expect(seqDoEmpate({ at: 10, empateSeq: 4 }, { at: 10, seq: 7 }, false)).toBe(4)
  })
})

describe("empateDepoisDe", () => {
  it("só conta uma marca posterior à votação na ordem do servidor", () => {
    expect(empateDepoisDe(undefined, 5)).toBe(false)
    expect(empateDepoisDe({}, 5)).toBe(false)
    expect(empateDepoisDe({ empateSeq: 4 }, 5)).toBe(false)
    expect(empateDepoisDe({ empateSeq: 6 }, 5)).toBe(true)
    // A poll with no `seq` (a report): any mark counts against it.
    expect(empateDepoisDe({ empateSeq: 0 }, -1)).toBe(true)
  })
})

describe("aplicarAtribuicao num empate", () => {
  it("marca o empate que muda os cargos, não o que os repete", () => {
    const c = newVaultContents()
    expect(aplicarAtribuicao(c, CANAL, BENTO, ["leitores"], { at: 100, seq: 3, por: ANA })).toBe(true)
    expect(c.channelMemberRolesAt?.[CANAL]?.[BENTO]?.empateSeq).toBeUndefined()
    // The same date and the same roles, by a larger `seq` (a cascade): no mark.
    expect(aplicarAtribuicao(c, CANAL, BENTO, ["leitores"], { at: 100, seq: 8, por: ANA })).toBe(true)
    expect(c.channelMemberRolesAt?.[CANAL]?.[BENTO]?.empateSeq).toBeUndefined()
    // The same date and other roles: the mark.
    expect(aplicarAtribuicao(c, CANAL, BENTO, ["sondagens"], { at: 100, seq: 12, por: ANA })).toBe(true)
    expect(c.channelMemberRoles[CANAL]?.[BENTO]).toEqual(["sondagens"])
    expect(c.channelMemberRolesAt?.[CANAL]?.[BENTO]?.empateSeq).toBe(12)
    // A later date is a new version: the mark leaves.
    expect(aplicarAtribuicao(c, CANAL, BENTO, ["sondagens"], { at: 101, seq: 15, por: ANA })).toBe(true)
    expect(c.channelMemberRolesAt?.[CANAL]?.[BENTO]?.empateSeq).toBeUndefined()
  })
})
