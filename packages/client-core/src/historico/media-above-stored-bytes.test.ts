import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { acabou, ate, cabecalhoDe, doisAparelhos, imagem, mensagem, tectosRapidos } from "../../testes/two-devices-history.js"
import { TECTOS_DO_FIO_DO_HISTORICO } from "./historico.js"

/**
 * A media response larger than `guardadasBytes` (1.3.27). In production a 25 MiB
 * video against the 16 MiB cap; here 30 KiB against 16 000 bytes, with the wire
 * scaled down. Before, such a response went whole and was never kept, so the
 * first lost part was answered `hx` forever and the sync never ended. Now it is
 * windowed and the newest response is always kept.
 */
describe("a media response above guardadasBytes", () => {
  let tectos: { repor: () => void }
  beforeEach(() => {
    tectos = tectosRapidos()
  })
  afterEach(() => tectos.repor())

  for (const guardadas of [16 * 1024 * 1024, 16_000]) {
    it(`guardadasBytes ${guardadas}: one part lost once, the photo still arrives and the sync ends`, async () => {
      TECTOS_DO_FIO_DO_HISTORICO.guardadasBytes = guardadas
      const vistos = new Set<string>()
      let hx = 0
      const { a, b } = doisAparelhos((sinal, de) => {
        const c = cabecalhoDe(sinal)
        if (c?.k === "hx") hx++
        if (de !== a || c?.k !== "hr" || (c.n ?? 0) < 10) return false
        // The first copy of part 5 of each media response is lost on the way.
        const chave = `${c.id}|${c.i}`
        if (c.i === 5 && !vistos.has(chave)) {
          vistos.add(chave)
          return true
        }
        return false
      })
      a.contents.history["!dm"] = [mensagem(1), mensagem(2, { attachments: [imagem("f.png", 22_500)] })]
      b.contents.historico = { inicial: { desde: Date.now() } }
      a.h.aoLigar()
      b.h.aoLigar()
      const fim = await ate(() => acabou(b), 6_000)
      const ultimo = b.eventos.filter((e) => e.aTrazer).at(-1)
      const foto = b.contents.history["!dm"]?.find((e) => e.seq === 2)
      a.h.aoDesligar()
      b.h.aoDesligar()
      expect(fim).toBe(true)
      expect(hx).toBe(0)
      expect(ultimo?.media).toEqual({ feitas: 1, total: 1 })
      expect(b.h.estatisticas.mediaPerdida).toBe(0)
      expect((foto?.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"]).toBeTypeOf("string")
    }, 10_000)
  }
})
