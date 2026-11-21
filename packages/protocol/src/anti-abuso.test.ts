import { describe, expect, it } from "vitest"
import {
  ContaNova,
  DesafioDeTrabalho,
  faseDaContaNova,
  procurarNonce,
  progressoDaProva,
  ProvaDeTrabalho,
  provaCumpre,
  resolverProvaDeTrabalho,
  TRABALHO_MAXIMO,
} from "./anti-abuso.js"

/** Proof of work at registration (1.3.26): what the client solves and the server checks. */
describe("a prova de trabalho", () => {
  it("o nonce que resolve cumpre, e outro nonce quase nunca cumpre", async () => {
    const desafio = { desafio: "v1.teste", trabalho: 256 }
    const prova = await resolverProvaDeTrabalho(desafio)
    expect(prova.desafio).toBe("v1.teste")
    expect(provaCumpre("v1.teste", prova.nonce, 256)).toBe(true)
    // The same nonce for another challenge: a proof is bound to its challenge.
    const outros = ["a", "b", "c", "d", "e", "f", "g", "h"].filter((d) => provaCumpre(`v1.outro-${d}`, prova.nonce, 2 ** 20))
    expect(outros.length).toBeLessThan(2)
  })

  it("trabalho 1 aceita qualquer nonce; um nonce mal formado nunca cumpre", () => {
    expect(provaCumpre("x", "0", 1)).toBe(true)
    expect(provaCumpre("x", "ABC", 1)).toBe(false)
    expect(provaCumpre("x", "", 1)).toBe(false)
    expect(provaCumpre("x", "0".repeat(17), 1)).toBe(false)
    expect(provaCumpre("x", "0", 0)).toBe(false)
  })

  it("o número de tentativas segue o trabalho pedido (média de 40 desafios)", () => {
    let total = 0
    for (let i = 0; i < 40; i++) {
      const nonce = procurarNonce(`media-${i}`, 500, 0, 1_000_000)
      expect(nonce).not.toBeNull()
      total += Number.parseInt(nonce as string, 36) + 1
    }
    const media = total / 40
    expect(media).toBeGreaterThan(250)
    expect(media).toBeLessThan(1000)
  })

  it("o progresso sobe, fica abaixo de 1 até acabar, e chega a 1 no fim", async () => {
    const vistos: number[] = []
    await resolverProvaDeTrabalho({ desafio: "progresso", trabalho: 50_000 }, { aoProgresso: (f) => vistos.push(f) })
    expect(vistos.at(-1)).toBe(1)
    expect(vistos.slice(0, -1).every((f) => f <= 0.95)).toBe(true)
    expect(progressoDaProva(0, 100)).toBe(0)
    expect(progressoDaProva(1e9, 100)).toBe(0.95)
  })

  it("pára quando lhe pedem", async () => {
    const parar = new AbortController()
    parar.abort()
    await expect(resolverProvaDeTrabalho({ desafio: "x", trabalho: 2 ** 30 }, { sinal: parar.signal })).rejects.toThrow(/cancelled/)
  })

  it("os esquemas: limites do trabalho e do nonce", () => {
    expect(DesafioDeTrabalho.safeParse({ desafio: "d", trabalho: TRABALHO_MAXIMO + 1 }).success).toBe(false)
    expect(DesafioDeTrabalho.safeParse({ desafio: "d", trabalho: 0 }).success).toBe(false)
    expect(ProvaDeTrabalho.safeParse({ desafio: "d", nonce: "zz9" }).success).toBe(true)
    expect(ProvaDeTrabalho.safeParse({ desafio: "d", nonce: "Z" }).success).toBe(false)
  })
})

describe("a fase da conta nova", () => {
  const conta = ContaNova.parse({ ate24h: 1000, ate72h: 3000, intervaloAte24hS: 30, intervaloAte72hS: 10 })
  it("primeiro dia, depois dois dias, depois nada", () => {
    expect(faseDaContaNova(conta, 999)).toBe("24h")
    expect(faseDaContaNova(conta, 1000)).toBe("72h")
    expect(faseDaContaNova(conta, 3000)).toBeNull()
    expect(faseDaContaNova(undefined, 0)).toBeNull()
  })
})
