import { describe, expect, it } from "vitest"
import { z } from "zod"
import { ed25519 } from "@noble/curves/ed25519.js"
import { assinarAutoria, formaAssinada, verificarAutoria } from "./autoria.js"
import { Payload, PinnedMessage } from "./payload.js"

/**
 * Coexistence of the signed form of `channel.meta` with 1.3.7 (see `autoria.forma.test.ts`).
 *
 * Permanent pins (12/11/2026) gave `channel.meta` two optional fields with no
 * default value: `pinnedProof` on the room, and `attachments` on each pin. A room
 * without them (every room that exists today, and every text-only pin) must sign
 * the same way here and in 1.3.7. With them it verifies here; stripped, as a
 * 1.3.7 reads it, it does not: the stated limit, and only in a relayed copy.
 */

const sala = {
  t: "channel.meta",
  room: "geral",
  name: "geral",
  category: "",
  kind: "text",
  position: 0,
  closed: false,
  removed: false,
  updatedAt: 1_762_000_000_000,
  pinned: [
    { id: "mensagem-0001", sender: "@bruno:orwell.pt", body: "olá", sentAt: 1_762_000_000_000, pinnedAt: 1_762_000_001_000, pinnedBy: "@ana:orwell.pt" },
  ],
} as const

/** The `channel.meta` schema as 1.3.7 has it: this one without the two fields. */
function esquemaDa137(): z.ZodObject {
  const ramo = Payload.options.find(
    (opcao) => (opcao.shape as { t: z.ZodLiteral<string> }).t.value === "channel.meta",
  ) as unknown as z.ZodObject
  const fixadaAntiga = PinnedMessage.omit({ attachments: true })
  return ramo.omit({ pinnedProof: true } as never).extend({ pinned: z.array(fixadaAntiga).optional() })
}

describe("a forma assinada de uma sala, com e sem os campos das fixadas permanentes", () => {
  const semente = new Uint8Array(32).fill(9)
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

  it("uma sala com uma fixada só de texto tem a mesma forma assinada aqui e na 1.3.7", () => {
    const aqui = Payload.parse(sala) as Record<string, unknown>
    const na137 = esquemaDa137().parse(sala) as Record<string, unknown>
    expect(aqui).not.toHaveProperty("pinnedProof")
    expect((aqui.pinned as Record<string, unknown>[])[0]).not.toHaveProperty("attachments")
    expect(JSON.stringify(formaAssinada(aqui))).toBe(JSON.stringify(formaAssinada(na137)))
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", assinar(aqui)).ok).toBe(true)
  })

  it("com anexos na fixada, verifica aqui; lida pela 1.3.7 (sem o campo), não verifica", () => {
    const comAnexo = {
      ...sala,
      pinned: [{ ...sala.pinned[0], attachments: [{ name: "foto.jpg", kind: "image", mediaType: "image/jpeg", byteLength: 1000 }] }],
    }
    const assinado = assinar(Payload.parse(comAnexo) as Record<string, unknown>)
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", assinado).ok).toBe(true)
    const comoA137 = { ...(esquemaDa137().parse(assinado) as Record<string, unknown>), autoria: assinado.autoria }
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", comoA137).ok).toBe(false)
  })
})
