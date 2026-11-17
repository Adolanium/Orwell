import { describe, expect, it } from "vitest"
import { lugaresDoHistorico, proximoPedidoDeLugar, ESPERA_PELO_PRINCIPAL_MS, PEDIDO_DE_LUGAR_MAX_MS } from "./lugaresDoAparelhoNovo.js"

/**
 * A paired phone with the main device off (12/11/2026: "full parity").
 *
 * The phone held the history of a channel (the main device passed it) and
 * was not in its group: the main device seats it, and when that failed with
 * the main device off, the phone had no way in. Now the channels of the
 * history plan that have no group here become seats to ask the members, after
 * a wait that leaves the main device the first turn.
 */
describe("os lugares que o aparelho novo pede", () => {
  const agora = 1_000_000

  it("os canais do plano sem grupo aqui, menos a sala comum, o canal da conta e os de onde a conta saiu", () => {
    const lugares = lugaresDoHistorico({
      canaisDoPlano: ["!a", "!b", "!comum", "!conta", "!saiu", "!pedido"],
      temGrupo: (c) => c === "!b",
      salaComum: "!comum",
      canalDaConta: "!conta",
      arquivados: { "!saiu": 5 },
      jaPedidos: { "!pedido": { desde: 1, tentativas: 2, proxima: 9 } },
      agora,
    })
    expect(Object.keys(lugares)).toEqual(["!a"])
    expect(lugares["!a"]).toEqual({ desde: agora, tentativas: 0, proxima: agora + ESPERA_PELO_PRINCIPAL_MS })
  })

  it("entre pedidos, um minuto, dois, quatro, e nunca mais de meia hora", () => {
    expect(proximoPedidoDeLugar(0, agora)).toBe(agora + 60_000)
    expect(proximoPedidoDeLugar(2, agora)).toBe(agora + 4 * 60_000)
    expect(proximoPedidoDeLugar(30, agora)).toBe(agora + PEDIDO_DE_LUGAR_MAX_MS)
    expect(PEDIDO_DE_LUGAR_MAX_MS).toBeLessThanOrEqual(30 * 60_000)
  })
})
