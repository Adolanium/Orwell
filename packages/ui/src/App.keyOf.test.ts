import { describe, expect, it } from "vitest"
import { keyOf } from "./App.js"
import type { ChatMessage } from "./types.js"

const m = (seq: number, payload: ChatMessage["payload"], sender = "@ana:s"): ChatMessage => ({ channel: "!c:s", seq, sender, payload })

describe("keyOf", () => {
  it("dois envios nossos sem eco e sem id não são a mesma mensagem", () => {
    const reaccao = m(-1, { t: "reaction", target: "m1", emoji: "👍", remove: false })
    const outra = m(-1, { t: "channel.meta" })
    expect(keyOf(reaccao)).not.toBe(keyOf(outra))
    expect(keyOf(reaccao)).not.toBe(keyOf(m(-1, { t: "reaction", target: "m1", emoji: "🎉", remove: false })))
    expect(keyOf(reaccao)).not.toBe(keyOf(m(-1, { t: "reaction", target: "m1", emoji: "👍", remove: true })))
  })

  it("o mesmo acto, do cofre e ao vivo, é um só", () => {
    const a = m(7, { t: "reaction", target: "m1", emoji: "👍", remove: false }, "@bruno:s")
    expect(keyOf(a)).toBe(keyOf({ ...a, payload: { ...a.payload } }))
    expect(keyOf(m(3, { t: "message", id: "x" }))).toBe(keyOf(m(9, { t: "message", id: "x" })))
  })
})
