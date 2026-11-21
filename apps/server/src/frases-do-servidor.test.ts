import { describe, expect, it } from "vitest"
import { Gateway } from "./gateway.js"

/**
 * The sentences the server sends to clients (1.3.26, M5 of the 1.3.25 public
 * review). An app that knows the code shows its own sentence; an app that does not
 * shows this one. English first, then " / " and Portuguese, in every one that has
 * both. The media refusals are read by code only, and are English only.
 */
describe("as frases do servidor: inglês primeiro", () => {
  const nasDuasLinguas = {
    FRASE_VERSAO_ANTIGA: Gateway.FRASE_VERSAO_ANTIGA,
    FRASE_CONTA_SUSPENSA: Gateway.FRASE_CONTA_SUSPENSA,
    FRASE_REGISTO_FECHADO: Gateway.FRASE_REGISTO_FECHADO,
    FRASE_CONVITE_DE_REGISTO_EM_FALTA: Gateway.FRASE_CONVITE_DE_REGISTO_EM_FALTA,
    FRASE_CONVITE_DE_REGISTO_INVALIDO: Gateway.FRASE_CONVITE_DE_REGISTO_INVALIDO,
    FRASE_PROVA_EM_FALTA: Gateway.FRASE_PROVA_EM_FALTA,
    FRASE_PROVA_INVALIDA: Gateway.FRASE_PROVA_INVALIDA,
    FRASE_REDE_COM_MUITAS_CONTAS: Gateway.FRASE_REDE_COM_MUITAS_CONTAS,
  }

  it.each(Object.entries(nasDuasLinguas))("%s: inglês, \" / \", português", (_nome, frase) => {
    const partes = frase.split(" / ")
    expect(partes).toHaveLength(2)
    const [ingles, portugues] = partes as [string, string]
    // English has none of the Portuguese letters; the Portuguese half has at least one word of its own.
    expect(ingles).not.toMatch(/[ãõçáéíóúâêô]/i)
    expect(portugues).toMatch(/[ãõçáéíóúâêô]|\b(conta|servidor|versão|código|outra)\b/i)
  })

  it("as recusas de media só em inglês", () => {
    expect(Gateway.FRASE_SFU_NOUTRO_APARELHO).toBe("this account is in a call on another device")
    expect(Gateway.FRASE_SFU_DEMASIADOS_PEDIDOS).toBe("too many media requests this minute")
    expect(Gateway.FRASE_SFU_FORA_DA_CHAMADA).toBe("join the call before you ask for a transport")
  })
})
