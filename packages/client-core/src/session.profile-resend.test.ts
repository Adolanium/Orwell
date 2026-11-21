import { describe, expect, it } from "vitest"
import { perfilPorReenviar, podeResponderAPedidoDePerfis, Session } from "./session.js"

/**
 * When a channel that grew still gets our whole profile resent (1.3.26).
 *
 * A newcomer whose leaf declares `EXTENSAO_PERFIS_A_PEDIDO` asks for the profiles it
 * lacks, so the ~124 KB resend from every member only goes to a leaf that will not
 * ask: a 1.3.25 device. Decided by leaf, not by account. The proof against a real
 * server is in `session.profile-latest-only.rede.test.ts`.
 */
describe("perfilPorReenviar", () => {
  const base = {
    eu: "@eu:s",
    versao: 100,
    publicada: 100,
    aparelhosDitos: ["ana-pc", "telemovel"],
    folhas: [
      { conta: "@ana:s", aparelho: "ana-pc", pedeOsPerfis: false },
      { conta: "@eu:s", aparelho: "telemovel", pedeOsPerfis: true },
      { conta: "@nova:s", aparelho: "nova-pc", pedeOsPerfis: true },
    ],
  }

  it("does not resend when every new leaf asks for the profiles itself", () => {
    expect(perfilPorReenviar(base)).toBe(false)
  })

  it("resends for a new leaf that does not ask (1.3.25 and older)", () => {
    expect(perfilPorReenviar({ ...base, folhas: [...base.folhas, { conta: "@velha:s", aparelho: "velha-pc", pedeOsPerfis: false }] })).toBe(true)
  })

  it("resends for a 1.3.25 device added to an account that was already here", () => {
    expect(perfilPorReenviar({ ...base, folhas: [...base.folhas, { conta: "@ana:s", aparelho: "ana-tablet", pedeOsPerfis: false }] })).toBe(true)
    // The same account's new device that asks does not.
    expect(perfilPorReenviar({ ...base, folhas: [...base.folhas, { conta: "@ana:s", aparelho: "ana-tablet", pedeOsPerfis: true }] })).toBe(false)
  })

  it("an old leaf that already got this version does not count", () => {
    expect(perfilPorReenviar({ ...base, folhas: base.folhas.slice(0, 1) })).toBe(false)
  })

  it("a device of ours counts by key: one that joined since gets the resend", () => {
    expect(perfilPorReenviar({ ...base, folhas: [...base.folhas, { conta: "@eu:s", aparelho: "portatil", pedeOsPerfis: true }] })).toBe(true)
    // A leaf that left is not a reason.
    expect(perfilPorReenviar({ ...base, folhas: [] })).toBe(false)
  })

  it("publishes when this version never went out here, or when the vault does not know the leaves", () => {
    expect(perfilPorReenviar({ ...base, publicada: undefined })).toBe(true)
    expect(perfilPorReenviar({ ...base, publicada: 99 })).toBe(true)
    // A vault from before 1.3.26 does not know the leaves there: once, then it does.
    expect(perfilPorReenviar({ ...base, aparelhosDitos: undefined })).toBe(true)
  })
})

describe("F10 by leaf (1.3.26)", () => {
  const AGORA = 10 * Session.PERFIS_DADOS_MS
  const base = {
    eu: "@eu:s",
    contas: ["@eu:s", "@ana:s"],
    ditas: ["@eu:s", "@ana:s"],
    ultimaResposta: undefined,
    agora: AGORA,
    seq: 50,
    aoVivo: true,
    lidoAntesDaLigacao: 40,
  }

  it("answers for a 1.3.25 device of an account that was already here", () => {
    expect(podeResponderAPedidoDePerfis(base)).toBe(false)
    expect(podeResponderAPedidoDePerfis({ ...base, folhaNovaSemPedido: true })).toBe(true)
  })

  it("a newcomer our profile never reached is answered past the daily cap, once it is recorded it is not", () => {
    const nova = { ...base, contas: [...base.contas, "@nova:s"], ultimaResposta: AGORA - 60_000 }
    expect(podeResponderAPedidoDePerfis({ ...nova, quemPede: "@nova:s" })).toBe(true)
    expect(podeResponderAPedidoDePerfis({ ...nova, quemPede: "@nova:s", ditas: [...base.ditas, "@nova:s"] })).toBe(false)
    // Someone already told is not a newcomer: the cap holds.
    expect(podeResponderAPedidoDePerfis({ ...nova, quemPede: "@ana:s" })).toBe(false)
    // A stale request from a recovery is never answered.
    expect(podeResponderAPedidoDePerfis({ ...nova, quemPede: "@nova:s", aoVivo: false, seq: 30 })).toBe(false)
  })

  it("the daily cap and a stale request still hold", () => {
    expect(podeResponderAPedidoDePerfis({ ...base, folhaNovaSemPedido: true, ultimaResposta: AGORA - 60_000 })).toBe(false)
    expect(podeResponderAPedidoDePerfis({ ...base, folhaNovaSemPedido: true, aoVivo: false, seq: 30 })).toBe(false)
  })
})
