import { describe, expect, it } from "vitest"
import {
  barraEscondida,
  chaveDaSala,
  CHAVE_DAS_FIXADAS_ESCONDIDAS,
  gravarEscondida,
  lerEscondidas,
  TECTO_DE_SALAS_ESCONDIDAS,
} from "./barraDasFixadas.js"

/** A storage in memory, with the two calls this module uses. */
function armazem(inicial: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem"> & { dados: Record<string, string> } {
  const dados = { ...inicial }
  return { dados, getItem: (k) => dados[k] ?? null, setItem: (k, v) => void (dados[k] = v) }
}

describe("a barra das fixadas, escondida por sala neste aparelho", () => {
  it("esconde até chegar uma fixada mais nova", () => {
    const chave = chaveDaSala("!c:s", "")
    const a = armazem()
    const escondidas = gravarEscondida({}, chave, 100, a)
    expect(barraEscondida(escondidas, chave, 100)).toBe(true)
    expect(barraEscondida(escondidas, chave, 101)).toBe(false)
    expect(barraEscondida(lerEscondidas(a), chave, 100)).toBe(true)
    // Another room of the same channel is not touched.
    expect(barraEscondida(escondidas, chaveDaSala("!c:s", "outra"), 100)).toBe(false)
  })

  it("mostrar outra vez tira a sala da lista", () => {
    const chave = chaveDaSala("!c:s", "")
    const a = armazem()
    const mostradas = gravarEscondida(gravarEscondida({}, chave, 100, a), chave, null, a)
    expect(mostradas).toEqual({})
    expect(lerEscondidas(a)).toEqual({})
  })

  it("guarda no máximo as últimas salas", () => {
    const a = armazem()
    let escondidas: Record<string, number> = {}
    for (let i = 0; i < TECTO_DE_SALAS_ESCONDIDAS + 5; i++) escondidas = gravarEscondida(escondidas, `!c${i}:s|`, i, a)
    expect(Object.keys(escondidas)).toHaveLength(TECTO_DE_SALAS_ESCONDIDAS)
    expect(escondidas["!c0:s|"]).toBeUndefined()
    expect(escondidas[`!c${TECTO_DE_SALAS_ESCONDIDAS + 4}:s|`]).toBe(TECTO_DE_SALAS_ESCONDIDAS + 4)
  })

  it("um armazém estragado ou que recusa não parte nada", () => {
    expect(lerEscondidas(armazem({ [CHAVE_DAS_FIXADAS_ESCONDIDAS]: "{não é json" }))).toEqual({})
    expect(lerEscondidas(armazem({ [CHAVE_DAS_FIXADAS_ESCONDIDAS]: '{"a":"x","b":3}' }))).toEqual({ b: 3 })
    const recusa = {
      getItem: (): string | null => {
        throw new Error("bloqueado")
      },
      setItem: (): void => {
        throw new Error("cheio")
      },
    }
    expect(lerEscondidas(recusa)).toEqual({})
    expect(gravarEscondida({}, "x|", 1, recusa)).toEqual({ "x|": 1 })
  })
})
