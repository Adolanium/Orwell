import { describe, expect, it } from "vitest"
import {
  ATRASOS_DO_PEDIDO_MS,
  PedidosDeLugar,
  REGRAS_DOS_PEDIDOS,
  SURDEZ_AVISADA_MS,
  atrasoDoPedido,
  surdezAvisada,
  type EstadoDoCanalSurdo,
  type RegrasDosPedidos,
} from "./surdez.js"

/**
 * The seat requests of a deaf channel (P3 of 1.3.25), on a fake clock.
 *
 * Before: one request per channel per session, and none after a
 * `reseat-failed`. Measured on 20/11/2026: devices stuck in an old epoch for
 * eleven days.
 */

interface Bancada {
  pedidos: PedidosDeLugar
  /** Requests that went out, with the time. */
  enviados: { canal: string; em: number }[]
  estados: Map<string, EstadoDoCanalSurdo>
  avancar: (ms: number) => void
  ligado: { valor: boolean }
}

function bancada(regras: RegrasDosPedidos = REGRAS_DOS_PEDIDOS, aleatorio = 0.5): Bancada {
  let agora = 1_000_000
  let relogios: { quando: number; fn: () => void; vivo: boolean }[] = []
  const enviados: { canal: string; em: number }[] = []
  const estados = new Map<string, EstadoDoCanalSurdo>()
  const ligado = { valor: true }
  const pedidos = new PedidosDeLugar(
    {
      estado: (canal) => estados.get(canal) ?? "surdo",
      pedir: (canal) => {
        if (!ligado.valor) return false
        enviados.push({ canal, em: agora })
        return true
      },
      agora: () => agora,
      aleatorio: () => aleatorio,
      programar: (fn, ms) => {
        const relogio = { quando: agora + ms, fn, vivo: true }
        relogios.push(relogio)
        return () => {
          relogio.vivo = false
        }
      },
    },
    regras,
  )
  const avancar = (ms: number): void => {
    const fim = agora + ms
    for (;;) {
      relogios = relogios.filter((relogio) => relogio.vivo)
      const proximo = relogios.filter((relogio) => relogio.quando <= fim).sort((a, b) => a.quando - b.quando)[0]
      if (!proximo) break
      agora = Math.max(agora, proximo.quando)
      proximo.vivo = false
      proximo.fn()
    }
    agora = fim
  }
  return { pedidos, enviados, estados, avancar, ligado }
}

const MINUTO = 60_000

describe("atrasoDoPedido", () => {
  it("30 s, 1, 2, 5, 15 e 30 min, e depois a cada 30 min", () => {
    const sem = [0, 1, 2, 3, 4, 5, 6, 7, 50].map((tentativa) => atrasoDoPedido(tentativa, 0.5))
    expect(sem).toEqual([30_000, MINUTO, 2 * MINUTO, 5 * MINUTO, 15 * MINUTO, 30 * MINUTO, 30 * MINUTO, 30 * MINUTO, 30 * MINUTO])
  })

  it("varia até 20 % para cada lado, nunca mais", () => {
    expect(atrasoDoPedido(0, 0)).toBe(24_000)
    expect(atrasoDoPedido(0, 0.999_999)).toBeLessThanOrEqual(36_000)
    expect(atrasoDoPedido(5, 0)).toBe(24 * MINUTO)
  })
})

describe("surdezAvisada", () => {
  it("só depois de um minuto de falhas seguidas, e com o limiar de falhas", () => {
    const agora = 10 * MINUTO
    expect(surdezAvisada(undefined, agora, 5)).toBe(false)
    expect(surdezAvisada({ falhas: 5, desde: agora - SURDEZ_AVISADA_MS + 1 }, agora, 5)).toBe(false)
    expect(surdezAvisada({ falhas: 4, desde: agora - 2 * MINUTO }, agora, 5)).toBe(false)
    expect(surdezAvisada({ falhas: 5, desde: agora - SURDEZ_AVISADA_MS }, agora, 5)).toBe(true)
  })
})

describe("PedidosDeLugar", () => {
  it("pede logo, e volta a pedir com recuo enquanto o canal está surdo", () => {
    const { pedidos, enviados, avancar } = bancada()
    pedidos.comecar("!a")
    expect(enviados).toHaveLength(1)
    const inicio = enviados[0]!.em
    avancar(2 * 60 * MINUTO)
    const intervalos = enviados.slice(1).map((pedido, indice) => pedido.em - (enviados[indice] as { em: number }).em)
    expect(intervalos.slice(0, 6)).toEqual(ATRASOS_DO_PEDIDO_MS)
    // After the ceiling, every thirty minutes: 53.5 min of waits, then each 30.
    expect(enviados.at(-1)!.em - inicio).toBeLessThanOrEqual(2 * 60 * MINUTO)
    expect(intervalos.slice(6).every((intervalo) => intervalo === 30 * MINUTO)).toBe(true)
    expect(enviados.length).toBe(1 + 6 + Math.floor((120 - 53.5) / 30))
  })

  it("pára quando o canal volta a ouvir", () => {
    const { pedidos, enviados, estados, avancar } = bancada()
    pedidos.comecar("!a")
    avancar(31_000)
    expect(enviados).toHaveLength(2)
    // A frame opened: the session says it hears. The next one that comes due stops the series.
    estados.set("!a", "ouve")
    avancar(10 * 60 * MINUTO)
    expect(enviados).toHaveLength(2)
    expect(pedidos.ativo("!a")).toBe(false)
  })

  it("parar() corta a série logo, sem esperar pela próxima", () => {
    const { pedidos, enviados, avancar } = bancada()
    pedidos.comecar("!a")
    pedidos.parar("!a")
    avancar(60 * MINUTO)
    expect(enviados).toHaveLength(1)
  })

  it("um canal já em série não pede outra vez ao ser começado de novo (um envio para o surdo não pede)", () => {
    const { pedidos, enviados } = bancada()
    pedidos.comecar("!a")
    pedidos.comecar("!a")
    pedidos.comecar("!a")
    expect(enviados).toHaveLength(1)
  })

  it("sem rajadas: noventa canais surdos de uma vez saem três a três, um a cada dois segundos", () => {
    const { pedidos, enviados, avancar } = bancada()
    for (let i = 0; i < 90; i++) pedidos.comecar(`!c${i}`)
    expect(enviados).toHaveLength(REGRAS_DOS_PEDIDOS.rajada)
    avancar(10_000)
    expect(enviados).toHaveLength(REGRAS_DOS_PEDIDOS.rajada + 5)
    avancar(200_000)
    // Each channel asked once, and no two seconds ever had more than the bucket allows.
    expect(new Set(enviados.slice(0, 90).map((pedido) => pedido.canal)).size).toBe(90)
    for (const pedido of enviados) {
      const naJanela = enviados.filter((outro) => outro.em > pedido.em - REGRAS_DOS_PEDIDOS.intervaloMs && outro.em <= pedido.em)
      expect(naJanela.length).toBeLessThanOrEqual(REGRAS_DOS_PEDIDOS.rajada)
    }
  })

  it("adiar (a pôr em dia) não conta tentativa e volta a ver passado o primeiro atraso", () => {
    const { pedidos, enviados, estados, avancar } = bancada()
    pedidos.comecar("!a")
    estados.set("!a", "adiar")
    avancar(31_000)
    expect(enviados).toHaveLength(1)
    estados.set("!a", "surdo")
    avancar(31_000)
    expect(enviados).toHaveLength(2)
    // Still the second wait (1 min), not a later one: the delay did not count.
    avancar(57_000)
    expect(enviados).toHaveLength(2)
    avancar(2_000)
    expect(enviados).toHaveLength(3)
  })

  it("adiar só uma vez por tentativa: numa sala cheia, a recuperação nunca deixa de correr, e o pedido sai na mesma", () => {
    const { pedidos, enviados, estados, avancar } = bancada()
    pedidos.comecar("!a")
    estados.set("!a", "adiar")
    avancar(31_000)
    expect(enviados).toHaveLength(1)
    avancar(30_000)
    expect(enviados).toHaveLength(2)
  })

  it("sem ligação o pedido não conta; adiantar() pede quando a ligação volta", () => {
    const { pedidos, enviados, avancar, ligado } = bancada()
    pedidos.comecar("!a")
    expect(enviados).toHaveLength(1)
    ligado.valor = false
    avancar(5 * MINUTO)
    expect(enviados).toHaveLength(1)
    ligado.valor = true
    pedidos.adiantar()
    avancar(REGRAS_DOS_PEDIDOS.adiantamentoMs * 1.2 + 1)
    expect(enviados).toHaveLength(2)
  })

  it("adiantar() (chaves novas) traz o pedido para já, mas nunca a menos de 30 s do último", () => {
    const { pedidos, enviados, avancar } = bancada()
    pedidos.comecar("!a")
    avancar(31_000 + MINUTO + 2 * MINUTO)
    expect(enviados).toHaveLength(4)
    // The next is 5 min after the last. The keys came back: it asks in about ten seconds.
    avancar(MINUTO)
    pedidos.adiantar()
    avancar(REGRAS_DOS_PEDIDOS.adiantamentoMs * 1.2 + 1)
    expect(enviados).toHaveLength(5)
    // Just after a request, the floor is the first wait, not ten seconds.
    pedidos.adiantar()
    avancar(REGRAS_DOS_PEDIDOS.adiantamentoMs * 1.2 + 1)
    expect(enviados).toHaveLength(5)
    avancar(30_000)
    expect(enviados).toHaveLength(6)
  })

  it("adiantar(so) (alguém do canal apareceu) traz só esses canais (1.3.26)", () => {
    const { pedidos, enviados, avancar } = bancada()
    pedidos.comecar("!a")
    pedidos.comecar("!b")
    avancar(31_000 + MINUTO + 2 * MINUTO)
    const antes = enviados.length
    avancar(MINUTO)
    pedidos.adiantar(["!b"])
    avancar(REGRAS_DOS_PEDIDOS.adiantamentoMs * 1.2 + 1)
    expect(enviados.slice(antes).map((e) => e.canal)).toEqual(["!b"])
  })

  it("limpar() não deixa nada a sair", () => {
    const { pedidos, enviados, avancar } = bancada()
    pedidos.comecar("!a")
    pedidos.comecar("!b")
    pedidos.limpar()
    avancar(60 * MINUTO)
    expect(enviados).toHaveLength(2)
    expect(pedidos.ativos()).toEqual([])
  })
})
