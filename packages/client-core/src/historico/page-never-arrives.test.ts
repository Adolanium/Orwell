import { toBase64 } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { acabou, ate, cabecalhoDe, doisAparelhos, mensagem, recarregar, tectosRapidos, type Aparelho } from "../../testes/two-devices-history.js"
import { entradasDoCanal, type StoredChatMessage } from "../vault.js"
import { TECTOS_DO_FIO_DO_HISTORICO } from "./historico.js"

/**
 * A page of history that never arrives (22/11/2026).
 *
 * The reported case: a phone stood at "Getting the history: 1437 of 1503
 * messages" for hours, through reloads. The main device ran 1.3.25, which
 * answers nothing when a response needs more than `partesMax` parts, or loses
 * a large response it no longer keeps. The phone asked the same page again
 * forever: each new session's inventory counted as progress, so the deadline
 * never stopped it, and the channels after that page never came.
 *
 * Now a page that fails `tentativasPorItem` REAL times (the sibling silent but
 * still there, its `hx` for the request, a response that does not open or does
 * not merge, a page that does not move the cursor) leaves: what is missing of
 * that channel counts as not received, the sync goes on, and the bar reaches
 * the end and says how many did not come.
 */

function no(canal: string, seq: number, sender = "@a:x"): StoredChatMessage {
  return { ...mensagem(seq), sender, payload: { ...mensagem(seq).payload, id: `${canal}${seq}` } }
}

/** Three channels. `!grande` is the newest (asked first) and its first page carries a large icon. */
function tresCanais(a: Aparelho, b: Aparelho): void {
  a.contents.history["!antes"] = [no("!antes", 1), no("!antes", 2), no("!antes", 3)].map((e) => ({ ...e, at: 3_000 + e.seq }))
  a.contents.history["!grande"] = [1, 2, 3, 4, 5, 6, 7].map((seq) => ({ ...no("!grande", seq), at: 9_000 + seq }))
  a.contents.history["!depois"] = [no("!depois", 1), no("!depois", 2), no("!depois", 3), no("!depois", 4)]
  const icone = toBase64(crypto.getRandomValues(new Uint8Array(30_000)))
  a.contents.spaceMeta["!grande"] = { at: 1, payload: { t: "space.meta", name: "Grande", icon: `data:image/png;base64,${icone}` } }
  b.contents.historico = { inicial: { desde: Date.now() } }
}

/** A response of many parts: only the first page of `!grande` (with its icon) is this large here. */
const grande = (sinal: string): boolean => {
  const c = cabecalhoDe(sinal)
  return c?.k === "hr" && (c.n ?? 0) >= 10
}

describe("a page of history that never arrives", () => {
  let tectos: { repor: () => void }
  beforeEach(() => {
    tectos = tectosRapidos()
  })
  afterEach(() => tectos.repor())

  it("a silent sibling on one page: the page leaves after 3 failures, the other channels come, the bar ends and says how many did not come", async () => {
    const { a, b } = doisAparelhos((sinal, de) => de === a && grande(sinal))
    tresCanais(a, b)
    a.h.aoLigar()
    b.h.aoLigar()
    const fim = await ate(() => acabou(b), 15_000)
    const ultimo = b.eventos.filter((e) => e.aTrazer && e.total > 0).at(-1)
    const final = b.eventos.at(-1)
    a.h.aoDesligar()
    b.h.aoDesligar()
    expect(fim).toBe(true)
    expect(b.h.estatisticas.pagesLost).toBe(1)
    // The 7 entries of `!grande` leave the total: the counter reaches it.
    expect(ultimo?.feitas).toBe(ultimo?.total)
    expect(ultimo?.total).toBe(7)
    expect(ultimo?.notReceived).toBe(7)
    expect(final).toMatchObject({ aTrazer: false, notReceived: 7, razao: "ilegiveis" })
    // The channel after the stuck page came whole.
    expect(entradasDoCanal(b.contents, "!depois")).toHaveLength(4)
    expect(entradasDoCanal(b.contents, "!antes")).toHaveLength(3)
    expect(entradasDoCanal(b.contents, "!grande")).toHaveLength(0)
    // The reason, once per real failure, for the diagnostic log.
    const failures = b.eventos.flatMap((e) => (e.pageFailure ? [e.pageFailure] : []))
    expect(failures.map((f) => f.attempt)).toEqual([1, 2, 3, 3])
    expect(failures.every((f) => f.reason === "silent")).toBe(true)
    expect(failures.at(-1)?.notReceived).toBe(7)
  }, 20_000)

  it("four reloads during the large page do not count: it arrives", async () => {
    let bloquear = true
    let largadas = 0
    const { a, b } = doisAparelhos((sinal, de) => {
      if (!bloquear || de !== a || !grande(sinal)) return false
      largadas++
      return true
    })
    tresCanais(a, b)
    a.h.aoLigar()
    b.h.aoLigar()
    for (let i = 0; i < 4; i++) {
      const antes = largadas
      expect(await ate(() => largadas > antes, 4_000)).toBe(true)
      recarregar(b)
    }
    bloquear = false
    const fim = await ate(() => acabou(b), 10_000)
    a.h.aoDesligar()
    b.h.aoDesligar()
    expect(fim).toBe(true)
    expect(b.h.estatisticas.pagesLost).toBe(0)
    expect(entradasDoCanal(b.contents, "!grande")).toHaveLength(7)
    expect(b.eventos.at(-1)?.notReceived).toBeUndefined()
  }, 30_000)

  it("a channel already finished does not grow its total when the sibling gains entries: the bar can reach the end", async () => {
    // The media phase never ends here: a photo of many parts that never arrives.
    const { a, b } = doisAparelhos((sinal, de) => de === a && grande(sinal))
    a.contents.history["!dm"] = [mensagem(1), mensagem(2), mensagem(3, { attachments: [{ name: "f.png", mediaType: "image/png", byteLength: 40_000, inline: `data:image/png;base64,${toBase64(crypto.getRandomValues(new Uint8Array(30_000)))}` }] })]
    b.contents.historico = { inicial: { desde: Date.now() } }
    TECTOS_DO_FIO_DO_HISTORICO.tentativasPorItem = 1_000
    a.h.aoLigar()
    b.h.aoLigar()
    expect(await ate(() => b.contents.historico?.plano?.media !== undefined, 8_000)).toBe(true)
    // The founder keeps using the main device: the finished channel gets more entries there.
    a.contents.history["!dm"]!.push(mensagem(4), mensagem(5))
    recarregar(b)
    const sessoes = b.h.estatisticas.sessoes
    expect(await ate(() => b.h.estatisticas.pedidos > 0 && b.h.estatisticas.sessoes >= sessoes, 4_000)).toBe(true)
    await ate(() => false, 500)
    const estado = b.h.estado()
    a.h.aoDesligar()
    b.h.aoDesligar()
    expect(estado.aTrazer).toBe(true)
    expect(estado.feitas).toBe(estado.total)
  }, 20_000)
})
