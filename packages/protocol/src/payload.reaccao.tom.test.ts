import { describe, expect, it } from "vitest"
import { ed25519 } from "@noble/curves/ed25519.js"
import { assinarAutoria, formaAssinada, verificarAutoria } from "./autoria.js"
import { Payload } from "./payload.js"

/**
 * A reaction with a skin tone, or a long ZWJ sequence, keeps the shape every
 * client since 1.3.7 reads: `{ t: "reaction", target, emoji, remove }`. Only the
 * string is longer, and the longest one the picker can send (a kiss with two
 * toned people, 15 UTF-16 units) is far under the 32 the schema has always
 * accepted. Signed here, it verifies; the signed form is the same bytes.
 */
const LONGOS = ["👍🏽", "🧑🏿‍🤝‍🧑🏿", "👩🏻‍❤️‍💋‍👨🏻", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"]

describe("reacção com tom de pele, como a 1.3.7 a lê", () => {
  it.each(LONGOS)("%s cabe no campo de sempre, sem campo novo", (emoji) => {
    const payload = { t: "reaction", target: "mensagem-1", emoji, remove: false }
    const lido = Payload.parse(payload) as Record<string, unknown>
    expect(Object.keys(lido).sort()).toEqual(["emoji", "remove", "t", "target"])
    expect(lido.emoji).toBe(emoji)
    expect(emoji.length).toBeLessThanOrEqual(32)
  })

  it("assinada aqui, verifica, e a forma assinada não muda com o tom", () => {
    const semente = new Uint8Array(32).fill(9)
    const payload = Payload.parse({ t: "reaction", target: "mensagem-1", emoji: "👩🏻‍❤️‍💋‍👨🏻" }) as Record<string, unknown>
    const assinado = {
      ...payload,
      autoria: assinarAutoria({
        canal: "!c:orwell.pt",
        autor: "@ana:orwell.pt",
        payload,
        aparelho: ed25519.getPublicKey(semente),
        assinar: (m) => ed25519.sign(m, semente),
      }),
    }
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", assinado).ok).toBe(true)
    expect(JSON.stringify(formaAssinada(Payload.parse(assinado) as Record<string, unknown>))).toBe(JSON.stringify(formaAssinada(payload)))
  })
})
