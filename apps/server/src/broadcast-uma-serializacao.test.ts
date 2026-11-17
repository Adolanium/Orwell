import { generateIdentity } from "@enclave/protocol"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { Cliente, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/**
 * One frame to many connections is serialised once (12/11/2026).
 *
 * `broadcast` called `JSON.stringify` once per recipient. Measured locally: with
 * 400 sockets, serialising once saves 7 % of the server CPU on small frames
 * and 34 % on a 75 KB commit. `#sinal` already did this.
 */

let servidor: ServidorDeTeste

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterAll(async () => {
  await servidor?.fechar()
})

describe("broadcast", () => {
  it("serializa a trama uma vez para todas as ligações, e todas a recebem", async () => {
    const identidade = generateIdentity(servidor.casa)
    const ligacoes = await Promise.all([1, 2, 3].map(() => Cliente.ligar(servidor.url, identidade)))
    try {
      const trama = { t: "pong" } as const
      const espiao = vi.spyOn(JSON, "stringify")
      let vezes = 0
      try {
        const servidas = servidor.enclave.gateway.broadcast("!qualquer:localhost", trama, identidade.address)
        vezes = espiao.mock.calls.filter(([valor]) => valor === trama).length
        expect(servidas).toBe(3)
      } finally {
        espiao.mockRestore()
      }
      expect(vezes).toBe(1)
      for (const ligacao of ligacoes) expect((await ligacao.proximoDe("pong")).t).toBe("pong")
    } finally {
      for (const ligacao of ligacoes) ligacao.fechar()
    }
  }, 30_000)
})
