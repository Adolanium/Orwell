import { describe, expect, it } from "vitest"
import { CODIGO_PROVA_EM_FALTA, CODIGO_PROVA_INVALIDA, CODIGO_REDE_COM_MUITAS_CONTAS } from "./anti-abuso.js"
import { CODIGOS_DE_RECUSA_DO_REGISTO } from "./registo.js"
import { ClientFrame, ServerFrame } from "./wire.js"

/**
 * The abuse brake, part 2 (1.3.26), on the wire. Every field is optional: an
 * old client drops what it does not know, and an old server never sends it.
 */
const ENDERECO = "@aaaaaaaaaaaaaaaaaaaaaaaaaa:orwell.pt"

describe("a prova de trabalho no fio", () => {
  it("hello.ok leva o desafio, auth.finish leva a prova", () => {
    const hello = ServerFrame.parse({
      t: "hello.ok",
      version: 1,
      server: "orwell.pt",
      capabilities: [],
      provaDeTrabalho: { desafio: "v1.x", trabalho: 600_000 },
    })
    expect(hello.t === "hello.ok" && hello.provaDeTrabalho).toEqual({ desafio: "v1.x", trabalho: 600_000 })
    const fim = ClientFrame.parse({ t: "auth.finish", signature: "AAAA", provaDeTrabalho: { desafio: "v1.x", nonce: "1a" } })
    expect(fim.t === "auth.finish" && fim.provaDeTrabalho).toEqual({ desafio: "v1.x", nonce: "1a" })
  })

  it("as três recusas novas são recusas do registo (a sessão não volta a ligar em ciclo)", () => {
    for (const codigo of [CODIGO_PROVA_EM_FALTA, CODIGO_PROVA_INVALIDA, CODIGO_REDE_COM_MUITAS_CONTAS]) {
      expect(CODIGOS_DE_RECUSA_DO_REGISTO).toContain(codigo)
    }
  })
})

describe("a conta nova no fio", () => {
  it("auth.ok leva os limites da conta nova", () => {
    const ok = ServerFrame.parse({
      t: "auth.ok",
      address: ENDERECO,
      contaNova: { ate24h: 10, ate72h: 20, intervaloAte24hS: 30, intervaloAte72hS: 10 },
    })
    expect(ok.t === "auth.ok" && ok.contaNova?.ate24h).toBe(10)
  })

  it("account.age.result diz até quando a conta é nova", () => {
    const r = ServerFrame.parse({ t: "account.age.result", address: ENDERECO, atestacao: null, chave: null, novaAte: 3_600_000 })
    expect(r.t === "account.age.result" && r.novaAte).toBe(3_600_000)
  })

  it("channel.rejected por ritmo marca a conta nova; keypackage.claimed e channel.claim.result dizem a recusa", () => {
    const r = ServerFrame.parse({ t: "channel.rejected", channel: "!x:orwell.pt", reason: "rate-limited", retryAfterMs: 5, contaNova: true })
    expect(r.t === "channel.rejected" && r.contaNova).toBe(true)
    expect(ServerFrame.parse({ t: "channel.rejected", channel: "!x:orwell.pt", reason: "conta-nova", ref: "r" }).t).toBe("channel.rejected")
    const k = ServerFrame.parse({ t: "keypackage.claimed", address: ENDERECO, keyPackage: null, recusa: "conta-nova" })
    expect(k.t === "keypackage.claimed" && k.recusa).toBe("conta-nova")
    const c = ServerFrame.parse({ t: "channel.claim.result", channel: "!x:orwell.pt", owner: "", mine: false, recusa: "conta-nova" })
    expect(c.t === "channel.claim.result" && c.recusa).toBe("conta-nova")
  })

  it("channel.rejoin.sent leva o lugar na fila da sala comum", () => {
    const r = ServerFrame.parse({ t: "channel.rejoin.sent", channel: "!x:orwell.pt", ouviram: 0, fila: { posicao: 3, esperaMs: 120_000 } })
    expect(r.t === "channel.rejoin.sent" && r.fila).toEqual({ posicao: 3, esperaMs: 120_000 })
  })
})
