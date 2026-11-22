import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { acabou, ate, cabecalhoDe, doisAparelhos, imagem, mensagem, recarregar, tectosRapidos, type Aparelho } from "../../testes/two-devices-history.js"
import { TECTOS_DO_FIO_DO_HISTORICO } from "./historico.js"

/**
 * A media item that never completes (1.3.27). After `tentativasPorItem` REAL
 * failures (the sibling's `hx` for the request, a request given up with the
 * sibling still there, a response that does not open) the item leaves as
 * lost: it counts as done, the bar says how many files did not come, and the
 * sync ends. A reload, a suspension or the sibling closing never count.
 */
function inlineDe(ap: Aparelho, seq: number): unknown {
  const entrada = ap.contents.history["!dm"]?.find((e) => e.seq === seq)
  return (entrada?.payload["attachments"] as Record<string, unknown>[] | undefined)?.[0]?.["inline"]
}

/** A big photo (many parts) and a small one, on the main device. */
function comDuasFotos(a: Aparelho, b: Aparelho): void {
  a.contents.history["!dm"] = [mensagem(1), mensagem(2, { attachments: [imagem("g.png", 22_500)] }), mensagem(3, { attachments: [imagem("p.png", 1_500)] })]
  b.contents.historico = { inicial: { desde: Date.now() } }
}

describe("a media item that never completes", () => {
  let tectos: { repor: () => void }
  beforeEach(() => {
    tectos = tectosRapidos()
  })
  afterEach(() => tectos.repor())

  it("part 5 of the big photo never arrives: lost after 3 failures, the small one arrives, the bar reaches the end", async () => {
    const { a, b } = doisAparelhos((sinal, de) => {
      const c = cabecalhoDe(sinal)
      return de === a && c?.k === "hr" && (c.n ?? 0) >= 10 && c.i === 5
    })
    comDuasFotos(a, b)
    a.h.aoLigar()
    b.h.aoLigar()
    const fim = await ate(() => acabou(b), 8_000)
    const ultimo = b.eventos.filter((e) => e.aTrazer).at(-1)
    const final = b.eventos.at(-1)
    a.h.aoDesligar()
    b.h.aoDesligar()
    expect(fim).toBe(true)
    expect(b.h.estatisticas.mediaPerdida).toBe(1)
    // The lost item counts as done: the counter reaches the total, and says one file did not come.
    expect(ultimo?.media).toEqual({ feitas: 2, total: 2, perdidas: 1 })
    expect(final).toMatchObject({ aTrazer: false, ficheirosPerdidos: 1, razao: "ilegiveis" })
    expect(inlineDe(b, 3)).toBeTypeOf("string")
    expect(inlineDe(b, 2)).toBeUndefined()
  }, 12_000)

  it("four reloads in the middle of the big photo do not count: it arrives", async () => {
    let bloquear = true
    let largadas = 0
    const { a, b } = doisAparelhos((sinal, de) => {
      const c = cabecalhoDe(sinal)
      if (!bloquear || de !== a || c?.k !== "hr" || (c.n ?? 0) < 10) return false
      largadas++
      return true
    })
    comDuasFotos(a, b)
    a.h.aoLigar()
    b.h.aoLigar()
    for (let i = 0; i < 4; i++) {
      const antes = largadas
      expect(await ate(() => largadas > antes, 4_000)).toBe(true)
      recarregar(b)
    }
    bloquear = false
    const fim = await ate(() => acabou(b), 8_000)
    a.h.aoDesligar()
    b.h.aoDesligar()
    expect(fim).toBe(true)
    expect(b.h.estatisticas.mediaPerdida).toBe(0)
    expect(inlineDe(b, 2)).toBeTypeOf("string")
    expect(inlineDe(b, 3)).toBeTypeOf("string")
  }, 30_000)

  it("four suspensions of the main device (it forgets the session, hx without the request) do not count", async () => {
    let bloquear = true
    let largadas = 0
    const { a, b } = doisAparelhos((sinal, de) => {
      const c = cabecalhoDe(sinal)
      if (!bloquear || de !== a || c?.k !== "hr" || (c.n ?? 0) < 10) return false
      largadas++
      return true
    })
    comDuasFotos(a, b)
    a.h.aoLigar()
    b.h.aoLigar()
    for (let i = 0; i < 4; i++) {
      const antes = largadas
      expect(await ate(() => largadas > antes, 4_000)).toBe(true)
      a.h.aoDesligar()
      a.h.aoLigar()
    }
    bloquear = false
    const fim = await ate(() => acabou(b), 8_000)
    a.h.aoDesligar()
    b.h.aoDesligar()
    expect(fim).toBe(true)
    expect(b.h.estatisticas.mediaPerdida).toBe(0)
    expect(inlineDe(b, 2)).toBeTypeOf("string")
  }, 30_000)

  it("the main device closed four times, each for longer than all the tries, does not count: back on, the photo arrives", async () => {
    let fechado = false
    let bloquear = true
    let partes = 0
    const { a, b } = doisAparelhos((sinal, de) => {
      if (fechado) return true
      const c = cabecalhoDe(sinal)
      if (de !== a || c?.k !== "hr" || (c.n ?? 0) < 10) return false
      partes++
      // While the test runs the closures, part 5 never comes: the photo cannot finish between them.
      return bloquear && c.i === 5
    })
    comDuasFotos(a, b)
    a.h.aoLigar()
    b.h.aoLigar()
    for (let i = 0; i < 4; i++) {
      // In the middle of the big photo the main device closes, for 8 request timeouts.
      const antes = partes
      expect(await ate(() => partes >= antes + 3, 4_000)).toBe(true)
      fechado = true
      a.h.aoDesligar()
      await new Promise((r) => setTimeout(r, TECTOS_DO_FIO_DO_HISTORICO.esperaDaRespostaMs * 8))
      fechado = false
      a.h.aoLigar()
    }
    bloquear = false
    const fim = await ate(() => acabou(b), 8_000)
    a.h.aoDesligar()
    b.h.aoDesligar()
    expect(fim).toBe(true)
    expect(b.h.estatisticas.mediaPerdida).toBe(0)
    expect(inlineDe(b, 2)).toBeTypeOf("string")
  }, 30_000)
})
