import { describe, expect, it } from "vitest"
import { z } from "zod"
import { ed25519 } from "@noble/curves/ed25519.js"
import { assinarAutoria, formaAssinada, verificarAutoria } from "./autoria.js"
import { Payload, Poll } from "./payload.js"

/**
 * Coexistence of the signed form of `message`, `post` and `edit` with 1.3.9 (see `autoria.forma.test.ts`).
 *
 * The poll deadline and the early close gave `Poll` the optional `closesAt` and `edit` the
 * optional `closePoll`, both with no default value. A message, post or edit without them (every
 * one that exists today) must sign the same way here and in 1.3.9. With them it verifies here;
 * stripped, as 1.3.9 reads it, it does not: the stated limit, and only in a relayed copy.
 */

const ramo = (tipo: string): z.ZodObject =>
  Payload.options.find((opcao) => (opcao.shape as { t: z.ZodLiteral<string> }).t.value === tipo) as unknown as z.ZodObject

/** The schemas as 1.3.9 has them: these ones without the two fields. */
const votacaoAntiga = Poll.omit({ closesAt: true }).optional().catch(undefined)
const esquemaDa139 = (tipo: "message" | "post" | "edit"): z.ZodObject =>
  tipo === "edit" ? ramo("edit").omit({ closePoll: true } as never) : ramo(tipo).extend({ poll: votacaoAntiga })

const POLL = { question: "Jantar na sexta?", options: ["Sim", "Não"] }
const mensagem = { t: "message", id: "mensagem-votacao-1", body: "Jantar na sexta?", sentAt: 1_762_000_000_000, poll: POLL }
const publicacao = { t: "post", id: "post-votacao-1", caption: "Jantar na sexta?", postedAt: 1_762_000_000_000, poll: POLL }
const edicao = { t: "edit", id: "edicao-1", target: "mensagem-votacao-1", editedAt: 1_762_000_100_000, body: "Jantar na sexta?" }

describe("a forma assinada de uma votação, com e sem o prazo e o fecho", () => {
  const semente = new Uint8Array(32).fill(7)
  const assinar = (payload: Record<string, unknown>): Record<string, unknown> => ({
    ...payload,
    autoria: assinarAutoria({
      canal: "!c:orwell.pt",
      autor: "@ana:orwell.pt",
      payload,
      aparelho: ed25519.getPublicKey(semente),
      assinar: (m) => ed25519.sign(m, semente),
    }),
  })

  it.each([
    ["message", mensagem],
    ["post", publicacao],
    ["edit", edicao],
  ] as const)("sem os campos novos, %s tem a mesma forma assinada aqui e na 1.3.9", (tipo, payload) => {
    const aqui = Payload.parse(payload) as Record<string, unknown>
    const na139 = esquemaDa139(tipo).parse(payload) as Record<string, unknown>
    expect(JSON.stringify(formaAssinada(aqui))).toBe(JSON.stringify(formaAssinada(na139)))
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", assinar(aqui)).ok).toBe(true)
  })

  it.each([
    ["message", { ...mensagem, poll: { ...POLL, closesAt: 1_762_000_900_000 } }],
    ["post", { ...publicacao, poll: { ...POLL, closesAt: 1_762_000_900_000 } }],
    ["edit", { ...edicao, closePoll: true }],
  ] as const)("com o campo novo, %s verifica aqui; lido pela 1.3.9 (sem o campo), não verifica", (tipo, payload) => {
    const assinado = assinar(Payload.parse(payload) as Record<string, unknown>)
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", assinado).ok).toBe(true)
    const comoA139 = { ...(esquemaDa139(tipo).parse(assinado) as Record<string, unknown>), autoria: assinado.autoria }
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", comoA139).ok).toBe(false)
  })
})
