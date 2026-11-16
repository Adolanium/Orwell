import { dimensoesDaImagem as doNucleo } from "@enclave/client-core"
import { describe, expect, it } from "vitest"
import { dimensoesDaImagem, reserva } from "./dimensoesDaImagem.js"

/** Header reading is proven in the core (`armazem/dimensoes.test.ts`). */
describe("dimensoesDaImagem na interface", () => {
  it("é a do núcleo, e não uma cópia", () => {
    expect(dimensoesDaImagem).toBe(doNucleo)
  })

  it("reserva dá a largura e a proporção ao espaçador, e nada sem dimensões", () => {
    expect(reserva({ largura: 640, altura: 360 })).toEqual({ "--imagem-largura": "640px", "--imagem-proporcao": 640 / 360 })
    expect(reserva(null)).toBeUndefined()
  })
})
