import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { acabou, ate, doisAparelhos, imagem, mensagem, tectosRapidos } from "../../testes/two-devices-history.js"
import { TECTOS_DO_FIO_DO_HISTORICO } from "./historico.js"

/**
 * `progressAt` (1.3.27): the time the history last moved, at part level, on both
 * sides. The interface holds the auto-lock while it moves (`useBloqueioAutomatico`).
 * One large media item takes many minutes and keeps `feitas` still the whole time:
 * without a part-level mark, a sync that moves looked stopped.
 */
describe("progressAt", () => {
  let tectos: { repor: () => void }
  beforeEach(() => {
    tectos = tectosRapidos()
    // Every part counts here; production marks at most every 30 s.
    TECTOS_DO_FIO_DO_HISTORICO.progressStepMs = 0
  })
  afterEach(() => tectos.repor())

  it("moves on the receiver while the parts of one large photo arrive, and on the sender while it sends them", async () => {
    const { a, b } = doisAparelhos(() => false)
    a.contents.history["!dm"] = [mensagem(1), mensagem(2, { attachments: [imagem("f.png", 60_000)] })]
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.h.aoLigar()
    b.h.aoLigar()
    const fim = await ate(() => acabou(b), 10_000)
    a.h.aoDesligar()
    b.h.aoDesligar()
    expect(fim).toBe(true)
    // During the media phase, before the photo is done, the mark moves more than once.
    const midPhoto = b.eventos.filter((e) => e.aTrazer && e.media?.feitas === 0 && e.media.total === 1 && e.progressAt !== undefined)
    expect(new Set(midPhoto.map((e) => e.progressAt)).size).toBeGreaterThan(1)
    // The sender says it too, in its own events.
    const sending = a.eventos.filter((e) => e.envio && e.progressAt !== undefined)
    expect(sending.length).toBeGreaterThan(0)
    // No mark once the sync is over.
    expect(b.eventos.at(-1)?.aTrazer).toBe(false)
    expect(b.eventos.at(-1)?.progressAt).toBeUndefined()
  }, 15_000)

  it("marks at most once per progressStepMs", async () => {
    TECTOS_DO_FIO_DO_HISTORICO.progressStepMs = 60_000
    const { a, b } = doisAparelhos(() => false)
    a.contents.history["!dm"] = [mensagem(1), mensagem(2, { attachments: [imagem("f.png", 60_000)] })]
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.h.aoLigar()
    b.h.aoLigar()
    await ate(() => acabou(b), 10_000)
    a.h.aoDesligar()
    b.h.aoDesligar()
    expect(new Set(b.eventos.map((e) => e.progressAt).filter((t) => t !== undefined)).size).toBeLessThanOrEqual(1)
  }, 15_000)
})
