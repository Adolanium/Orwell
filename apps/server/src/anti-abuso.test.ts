import { procurarNonce, type DesafioDeTrabalho } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import {
  CriadoresDosConvites,
  EmissorDeProvas,
  FilaDaSalaComum,
  LimiteDeRede,
  PassesDoConvite,
  VigiaDaContaNova,
  prefixoDaRede,
} from "./anti-abuso.js"

/**
 * The abuse brake, part 2 (1.3.26): the four pieces on their own, with a
 * clock in the test's hands. The gateway tests (`anti-abuso-gateway.test.ts`)
 * put them on a real socket.
 */

function resolver(desafio: DesafioDeTrabalho): string {
  const nonce = procurarNonce(desafio.desafio, desafio.trabalho, 0, 10_000_000)
  if (nonce === null) throw new Error("no nonce")
  return nonce
}

describe("o emissor de provas de trabalho", () => {
  const novo = (extra: Partial<ConstructorParameters<typeof EmissorDeProvas>[0]> = {}) => {
    let agora = 1_000_000_000_000
    let ultimaHora = 0
    const emissor = new EmissorDeProvas({
      trabalho: 64,
      trabalhoNoPico: 512,
      picoPorHora: 50,
      contarUltimaHora: () => ultimaHora,
      agora: () => agora,
      ...extra,
    })
    return {
      emissor,
      andar: (ms: number) => {
        agora += ms
      },
      contas: (n: number) => {
        ultimaHora = n
      },
    }
  }

  it("um desafio resolvido passa uma vez, e só uma", () => {
    const { emissor } = novo()
    const desafio = emissor.emitir()
    expect(desafio.trabalho).toBe(64)
    const prova = { desafio: desafio.desafio, nonce: resolver(desafio) }
    expect(emissor.verificar(prova)).toBe("ok")
    expect(emissor.verificar(prova)).toBe("invalida")
  })

  it("sem prova é em-falta; um nonce errado, um desafio forjado ou alterado é inválido", () => {
    const { emissor } = novo({ trabalho: 2 ** 30 })
    expect(emissor.verificar(undefined)).toBe("em-falta")
    const desafio = emissor.emitir()
    expect(emissor.verificar({ desafio: desafio.desafio, nonce: "0" })).toBe("invalida")
    // Lowering the work in the string breaks the signature.
    const baixado = desafio.desafio.replace(/^v1\.\d+\./, "v1.1.")
    expect(emissor.verificar({ desafio: baixado, nonce: "0" })).toBe("invalida")
    expect(emissor.verificar({ desafio: "v1.1.99999999999.abc.def", nonce: "0" })).toBe("invalida")
    // Another server's challenge (another secret) does not pass here.
    const outro = novo({ trabalho: 1 }).emissor.emitir()
    expect(emissor.verificar({ desafio: outro.desafio, nonce: "0" })).toBe("invalida")
  })

  it("um desafio expira ao fim de dez minutos", () => {
    const { emissor, andar } = novo()
    const desafio = emissor.emitir()
    const prova = { desafio: desafio.desafio, nonce: resolver(desafio) }
    andar(10 * 60_000 + 1)
    expect(emissor.verificar(prova)).toBe("invalida")
  })

  it("num pico de contas novas pede mais trabalho, e volta ao normal quando o pico passa", () => {
    const { emissor, contas, andar } = novo()
    contas(51)
    andar(60_000)
    expect(emissor.emitir().trabalho).toBe(512)
    contas(10)
    andar(60_000)
    expect(emissor.emitir().trabalho).toBe(64)
  })

  it("conta as contas da última hora no máximo de 30 em 30 segundos", () => {
    let leituras = 0
    const emissor = new EmissorDeProvas({
      trabalho: 64,
      trabalhoNoPico: 512,
      picoPorHora: 50,
      contarUltimaHora: () => {
        leituras++
        return 0
      },
      agora: () => 5,
    })
    for (let i = 0; i < 100; i++) emissor.emitir()
    expect(leituras).toBe(1)
  })
})

describe("o prefixo da rede", () => {
  it("IPv4 por /24, IPv6 por /56, IPv4 dentro de IPv6 como IPv4", () => {
    expect(prefixoDaRede("203.0.113.218")).toBe(prefixoDaRede("203.0.113.1"))
    expect(prefixoDaRede("203.0.113.218")).not.toBe(prefixoDaRede("203.0.114.218"))
    expect(prefixoDaRede("::ffff:203.0.113.9")).toBe(prefixoDaRede("203.0.113.218"))
    expect(prefixoDaRede("2001:db8:aa:bb00::1")).toBe(prefixoDaRede("2001:db8:aa:bbff:1:2:3:4"))
    expect(prefixoDaRede("2001:db8:aa:bb00::1")).not.toBe(prefixoDaRede("2001:db8:aa:bc00::1"))
    expect(prefixoDaRede("2001:0db8:00aa:bb00:0000:0000:0000:0001")).toBe(prefixoDaRede("2001:db8:aa:bb00::1"))
    expect(prefixoDaRede("isto não é um endereço")).toBeNull()
    // Private, loopback and link-local addresses are never a client's network: a broken proxy chain.
    for (const privado of ["127.0.0.1", "10.1.2.3", "172.18.0.1", "172.31.255.1", "192.168.0.9", "169.254.1.1", "::1", "fd12::1", "fe80::2", "::ffff:172.18.0.1"]) {
      expect(prefixoDaRede(privado), privado).toBeNull()
    }
    expect(prefixoDaRede("172.32.0.1")).not.toBeNull()
    expect(prefixoDaRede(undefined)).toBeNull()
  })
})

describe("o limite de contas novas por rede", () => {
  const novo = () => {
    let agora = Date.UTC(2026, 10, 20, 12)
    const limite = new LimiteDeRede({ porHora: 3, porDia: 10, agora: () => agora })
    return { limite, andar: (ms: number) => (agora += ms) }
  }

  it("3 por hora e 10 por dia na mesma /24; outra rede conta à parte", () => {
    const { limite, andar } = novo()
    const casa = limite.identificar("198.51.100.7")
    for (let i = 0; i < 3; i++) {
      expect(limite.podeCriar(casa)).toBe(true)
      limite.registar(casa)
    }
    expect(limite.podeCriar(limite.identificar("198.51.100.200"))).toBe(false)
    expect(limite.podeCriar(limite.identificar("198.51.101.7"))).toBe(true)
    // Across hours, the day caps at 10.
    for (let hora = 0; hora < 3; hora++) {
      andar(60 * 60_000 + 1)
      for (let i = 0; i < 3; i++) {
        const id = limite.identificar("198.51.100.7")
        if (!limite.podeCriar(id)) break
        limite.registar(id)
      }
    }
    andar(60 * 60_000 + 1)
    expect(limite.podeCriar(limite.identificar("198.51.100.7"))).toBe(false)
  })

  it("o dia conta 24 horas para trás, mesmo depois de o sal mudar à meia-noite", () => {
    let agora = Date.UTC(2026, 10, 20, 22)
    const limite = new LimiteDeRede({ porHora: 100, porDia: 2, agora: () => agora })
    const antes = limite.identificar("192.0.2.1")
    limite.registar(antes)
    limite.registar(antes)
    agora = Date.UTC(2026, 10, 21, 1)
    expect(limite.podeCriar(limite.identificar("192.0.2.1"))).toBe(false)
    agora = Date.UTC(2026, 10, 21, 22, 1)
    expect(limite.podeCriar(limite.identificar("192.0.2.1"))).toBe(true)
  })

  it("não guarda o endereço: só chaves HMAC com um sal que vive na memória", () => {
    const { limite } = novo()
    const id = limite.identificar("198.51.100.7")
    limite.registar(id)
    const dentro = JSON.stringify(limite.estadoParaTestes())
    expect(dentro).not.toContain("198.51.100")
    expect(dentro).not.toContain("198")
    // Two instances (two processes) give different keys for the same network.
    const outra = new LimiteDeRede({ porHora: 3, porDia: 10, agora: () => Date.UTC(2026, 10, 20, 12) }).identificar("198.51.100.7")
    expect(id.chaves.size).toBe(2)
    expect([...outra.chaves.values()]).not.toEqual([...id.chaves.values()])
  })

  it("sem endereço conhecido, não limita", () => {
    const { limite } = novo()
    const id = limite.identificar(undefined)
    for (let i = 0; i < 20; i++) limite.registar(id)
    expect(limite.podeCriar(id)).toBe(true)
  })
})

describe("a vigia da conta nova", () => {
  const LIMITES = {
    intervaloAte24hS: 30,
    intervaloAte72hS: 10,
    maxBytesAte24h: 1000,
    pessoasAte24h: 5,
    pessoasAte72h: 15,
    comunidades: 1,
    canaisAte24h: 9,
    canaisAte72h: 21,
  }
  const novo = () => {
    let agora = 1_000_000_000_000
    const vigia = new VigiaDaContaNova(LIMITES, () => agora)
    return { vigia, andar: (ms: number) => (agora += ms), agora: () => agora }
  }
  const HORA = 60 * 60_000

  it("a fase: até 24 h, até 72 h, depois nada; sem data conhecida, nada", () => {
    const { vigia, agora } = novo()
    expect(vigia.fase(agora() - 23 * HORA)).toBe("24h")
    expect(vigia.fase(agora() - 25 * HORA)).toBe("72h")
    expect(vigia.fase(agora() - 73 * HORA)).toBeNull()
    expect(vigia.fase(null)).toBeNull()
  })

  it("na sala comum: 3 de folga, depois uma mensagem a cada 30 s no primeiro dia", () => {
    const { vigia, andar } = novo()
    for (let i = 0; i < 3; i++) expect(vigia.enviar("@a", "24h")).toEqual({ ok: true })
    const recusa = vigia.enviar("@a", "24h")
    expect(recusa.ok).toBe(false)
    expect(!recusa.ok && recusa.retryAfterMs).toBe(30_000)
    andar(29_999)
    expect(vigia.enviar("@a", "24h").ok).toBe(false)
    andar(1)
    expect(vigia.enviar("@a", "24h").ok).toBe(true)
    // The new token is spent: the next one waits a full interval again.
    expect(vigia.enviar("@a", "24h").ok).toBe(false)
    // Quiet for long enough, the slack comes back, but never more than 3.
    andar(10 * 60_000)
    for (let i = 0; i < 3; i++) expect(vigia.enviar("@a", "24h").ok).toBe(true)
    expect(vigia.enviar("@a", "24h").ok).toBe(false)
  })

  it("na sala comum, de 24 a 72 h: a mesma folga de 3, depois uma a cada 10 s", () => {
    const { vigia, andar } = novo()
    for (let i = 0; i < 3; i++) expect(vigia.enviar("@b", "72h").ok).toBe(true)
    const recusa = vigia.enviar("@b", "72h")
    expect(!recusa.ok && recusa.retryAfterMs).toBe(10_000)
    andar(10_000)
    expect(vigia.enviar("@b", "72h").ok).toBe(true)
    expect(vigia.enviar("@b", "72h").ok).toBe(false)
    // An old account, and another account, are not touched.
    for (let i = 0; i < 10; i++) expect(vigia.enviar("@c", null).ok).toBe(true)
    expect(vigia.enviar("@d", "24h").ok).toBe(true)
  })

  it("na sala comum: a média continua a ser uma por intervalo", () => {
    const { vigia, andar } = novo()
    let enviadas = 0
    for (let s = 0; s < 600; s++) {
      if (vigia.enviar("@a", "24h").ok) enviadas++
      andar(1000)
    }
    // From 0 to 599 s: the slack of 3 plus one every full 30 s (19 of them).
    expect(enviadas).toBe(3 + 19)
  })

  it("pessoas novas por dia: 5 no primeiro dia, 15 depois; a mesma pessoa conta uma vez", () => {
    const { vigia, andar } = novo()
    for (let i = 0; i < 5; i++) expect(vigia.adicionar("@a", `@p${i}`, "24h")).toBe(true)
    expect(vigia.adicionar("@a", "@p0", "24h")).toBe(true)
    expect(vigia.adicionar("@a", "@p9", "24h")).toBe(false)
    expect(vigia.adicionar("@a", "@p9", "72h")).toBe(true)
    andar(24 * HORA + 1)
    expect(vigia.adicionar("@a", "@p10", "24h")).toBe(true)
    expect(vigia.adicionar("@b", "@x", null)).toBe(true)
  })

  it("canais novos por dia: 9 no primeiro dia, 21 depois", () => {
    const { vigia } = novo()
    for (let i = 0; i < 9; i++) expect(vigia.estrear("@a", "24h")).toBe(true)
    expect(vigia.estrear("@a", "24h")).toBe(false)
    expect(vigia.estrear("@a", "72h")).toBe(true)
    expect(vigia.estrear("@b", null)).toBe(true)
  })

  it("o tamanho: só no primeiro dia, e só acima do tecto", () => {
    const { vigia } = novo()
    expect(vigia.tamanhoPermitido(1000, "24h")).toBe(true)
    expect(vigia.tamanhoPermitido(1001, "24h")).toBe(false)
    expect(vigia.tamanhoPermitido(10_000, "72h")).toBe(true)
  })
})

describe("a fila da sala comum", () => {
  const novo = (porHora = 3) => {
    let agora = 1_000_000_000_000
    const fila = new FilaDaSalaComum({ porHora, agora: () => agora })
    return { fila, andar: (ms: number) => (agora += ms) }
  }

  it("deixa entrar até ao tecto por hora; quem vem a seguir espera na fila, pela ordem de chegada", () => {
    const { fila, andar } = novo(2)
    expect(fila.pedir("@a")).toEqual({ ok: true })
    expect(fila.pedir("@b")).toEqual({ ok: true })
    const c = fila.pedir("@c")
    const d = fila.pedir("@d")
    expect(c.ok || d.ok).toBe(false)
    expect(!c.ok && c.posicao).toBe(1)
    expect(!d.ok && d.posicao).toBe(2)
    // The same account asking again (the card, then the request) keeps its entry.
    expect(fila.pedir("@a")).toEqual({ ok: true })
    // The waiting keep asking (as the app does, every two minutes at most)...
    for (let minuto = 0; minuto < 54; minuto += 6) {
      andar(6 * 60_000)
      expect(fila.pedir("@d").ok).toBe(false)
      expect(fila.pedir("@c").ok).toBe(false)
    }
    // ...and when the first slot frees, the head of the queue goes in, never someone who just arrived.
    andar(6 * 60_000)
    expect(fila.pedir("@e").ok).toBe(false)
    expect(fila.pedir("@d").ok).toBe(true)
    expect(fila.pedir("@c").ok).toBe(true)
    expect(fila.pedir("@e").ok).toBe(false)
  })

  it("com um lugar livre, entra a cabeça da fila e não o segundo", () => {
    const { fila, andar } = novo(2)
    fila.pedir("@a")
    andar(30 * 60_000)
    fila.pedir("@b")
    fila.pedir("@c")
    fila.pedir("@d")
    andar(9 * 60_000)
    fila.pedir("@c")
    fila.pedir("@d")
    andar(9 * 60_000)
    fila.pedir("@c")
    fila.pedir("@d")
    andar(9 * 60_000)
    fila.pedir("@d")
    fila.pedir("@c")
    andar(4 * 60_000)
    // 61 minutes: @a's slot is free, @b's is not. @d asks first, but @c is ahead.
    expect(fila.pedir("@d").ok).toBe(false)
    expect(fila.pedir("@c").ok).toBe(true)
  })

  it("diz quando voltar a pedir: no máximo dois minutos, para manter o lugar", () => {
    const { fila } = novo(1)
    fila.pedir("@a")
    const b = fila.pedir("@b")
    expect(!b.ok && b.esperaMs).toBeLessThanOrEqual(120_000)
    expect(!b.ok && b.esperaMs).toBeGreaterThan(0)
  })

  it("quem deixa de pedir durante dez minutos perde o lugar", () => {
    const { fila, andar } = novo(1)
    fila.pedir("@a")
    fila.pedir("@b")
    fila.pedir("@c")
    andar(11 * 60_000)
    expect(!fila.pedir("@c").ok && (fila.pedir("@c") as { posicao: number }).posicao).toBe(1)
  })

  it("tecto 0 é sem tecto", () => {
    const { fila } = novo(0)
    for (let i = 0; i < 100; i++) expect(fila.pedir(`@${i}`).ok).toBe(true)
  })
})

describe("os passes dos convites de comunidade", () => {
  it("cada chave tem o limite de uma rede; um passe precisa de lugar em todas", () => {
    let agora = 1_000_000_000_000
    const passes = new PassesDoConvite({ porHora: 3, porDia: 10, agora: () => agora })
    // One maker, three communities: the maker's key fills at 3 an hour, whatever the channel.
    for (let i = 0; i < 3; i++) {
      const chaves = [`canal:!c${i}`, "quem:@dono"]
      expect(passes.pode(chaves)).toBe(true)
      passes.registar(chaves)
    }
    expect(passes.pode(["canal:!c3", "quem:@dono"])).toBe(false)
    // The same channels, by another maker: each channel still has room.
    expect(passes.pode(["canal:!c0", "quem:@outro"])).toBe(true)
    // Ten in 24 hours for the maker: an hour later three more, and so on, to ten.
    for (let hora = 1; hora <= 2; hora++) {
      agora += 3_600_000
      for (let i = 0; i < 3 && passes.pode([`canal:!h${hora}-${i}`, "quem:@dono"]); i++) passes.registar([`canal:!h${hora}-${i}`, "quem:@dono"])
    }
    agora += 3_600_000
    expect(passes.pode(["canal:!x", "quem:@dono"])).toBe(true)
    passes.registar(["canal:!x", "quem:@dono"])
    expect(passes.pode(["canal:!y", "quem:@dono"])).toBe(false)
    // A day after the first ones, the maker has room again.
    agora += 21 * 3_600_000
    expect(passes.pode(["canal:!z", "quem:@dono"])).toBe(true)
  })
})

describe("quem criou cada convite", () => {
  it("guarda o primeiro criador, esquece ao revogar, e não passa do máximo", () => {
    const criadores = new CriadoresDosConvites(2)
    criadores.anotar("h1", "@ana")
    criadores.anotar("h1", "@bento")
    expect(criadores.de("h1")).toBe("@ana")
    criadores.anotar("h2", "@ana")
    criadores.anotar("h3", "@ana")
    // The oldest went.
    expect(criadores.de("h1")).toBeUndefined()
    expect(criadores.de("h3")).toBe("@ana")
    criadores.esquecer("h3")
    expect(criadores.de("h3")).toBeUndefined()
  })
})
