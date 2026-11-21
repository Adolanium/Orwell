import { ed25519 } from "@noble/curves/ed25519.js"
import { abrirSinal, selarSinal } from "@enclave/crypto"
import { fromBase64, toBase64, type Payload, type RelatosNoFio } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { appendHistory, newVaultContents, type StoredPayload, type VaultContents } from "../vault.js"
import { TECTOS_DA_SINCRONIA, type Folha } from "./eleicao.js"
import { _paraTestes, AntiEntropia, comAutoria, type PortaDaAntiEntropia } from "./pedido.js"
import type { QuemRelata } from "./relato.js"
import { chaveCurta, itensDoCanal, resumoDoCanal, tiposDiferentes } from "./resumo.js"

/**
 * Anti-entropy between N devices on an in-memory network: signals go to all
 * others (like the server's `channel.sinal`), reports also go to all (like a
 * stored `typing`), each with its own vault. No MLS and no server: that is in
 * `apps/server/src/sincronia-s4.test.ts`. Here we measure the protocol: who
 * speaks, how many times, and whether the digests match in the end.
 */

const CANAL = "!lagar:orwell.test"
const CHAVE = { epoca: 1n, chave: new Uint8Array(32).fill(7) }

interface No {
  nome: string
  eu: QuemRelata
  folha: Folha
  contents: VaultContents
  anti: AntiEntropia
  /** The `seq` of the location of this node. Changes on a reseat. */
  lugar: number
  /** The signals this node put on the wire, in order. */
  sinais: string[]
  /** Each time the session was asked to publish its own profile whole (`republicarPerfil`). */
  republicados: number
  /** The accounts this node was asked to relay profiles of (`perfisParaRelatar`), per call. */
  relatosPedidos: string[][]
}

class Rede {
  nos: No[] = []
  /** Leaf nodes without a peer: connected devices that only count for server copies. */
  fantasmas: Folha[] = []
  /** Reports from this node are held back (a slow relay): the test delivers them when it wants. */
  reterRelatosDe: No | null = null
  seq = 1_000
  /** What is in flight: deliver in order, one by one, so the test can wait for silence. */
  emVoo = 0
  /** The nodes' clock; `null` is the real one. */
  relogio: number | null = null
  /** Whether profiles go to third parties here (the common room). */
  perfisATerceiros = false
  /** Whether a request may ask for portraits here (`r`): not in the common room. */
  retratosAPedido = true
  /** Accounts whose leaves do not declare `EXTENSAO_PERFIS_A_PEDIDO` (1.3.25). */
  semPedido = new Set<string>()
  /** The signed profiles each node can relay, by name (`perfisParaRelatar`). */
  paraRelatar = new Map<string, { s: number; a: string; p: Record<string, unknown> }[]>()
  /** Each node's own profile version (`versaoDoMeuPerfil`), by name. */
  versoes = new Map<string, number>()
  /** Accounts left out of `membros` (they left the channel, or were never in it). */
  foraDosMembros = new Set<string>()

  criar(nome: string, indice: number): No {
    const privada = new Uint8Array(32).fill(indice + 1)
    const eu: QuemRelata = {
      address: `@${nome}:orwell.test`,
      aparelho: ed25519.getPublicKey(privada),
      assinar: (m) => ed25519.sign(m, privada),
    }
    const contents = newVaultContents()
    const folha: Folha = { indice, address: eu.address, aparelho: toBase64(eu.aparelho) }
    const rede = this
    const porta: PortaDaAntiEntropia = {
      eu,
      conteudo: () => contents,
      podeSinalizar: () => true,
      elegivel: () => true,
      ehDirecta: () => false,
      membros: () => rede.nos.map((n) => n.eu.address).filter((address) => !rede.foraDosMembros.has(address)),
      folhas: () => [...rede.nos.map((n) => n.folha), ...rede.fantasmas],
      epocaAtual: () => 1n,
      derivarChave: async () => CHAVE,
      lugar: () => no.lugar,
      ancora: () => rede.seq,
      enviarSinal: (_canal, sinal) => {
        no.sinais.push(sinal)
        rede.#entregar(no, (outro) => outro.anti.aoSinal({ channel: CANAL, from: eu.address, sinal }))
      },
      enviarRelatos: async (_canal, relatos: RelatosNoFio) => {
        if (rede.reterRelatosDe === no) return
        const seq = ++rede.seq
        rede.#entregar(no, (outro) => outro.anti.aoRelatos(CANAL, seq, relatos, folha.aparelho))
      },
      gravarRelatado: (_canal, seq, autor, payload: Payload) => {
        appendHistory(contents, CANAL, { seq, sender: autor, at: 0, payload: payload as unknown as StoredPayload })
      },
      escoar: async () => {},
      marcarParaGravar: () => {},
      aparelhoConfiavel: async (_canal, autor, aparelho) => rede.nos.some((n) => n.eu.address === autor && n.folha.aparelho === aparelho),
      cadeiaDe: () => null,
      bloqueado: () => false,
      online: () => true,
      agora: () => rede.relogio ?? Date.now(),
      perfisATerceiros: () => rede.perfisATerceiros,
      retratosAPedido: () => rede.retratosAPedido,
      versaoDoMeuPerfil: () => rede.versoes.get(nome) ?? 0,
      folhaPedeOsPerfis: (_canal, outra) => !rede.semPedido.has(outra.address),
      perfisParaRelatar: (_canal, contas) => {
        no.relatosPedidos.push([...contas])
        return (rede.paraRelatar.get(nome) ?? []).filter((item) => contas.includes(item.a))
      },
      republicarPerfil: () => {
        no.republicados += 1
      },
    }
    const no: No = { nome, eu, folha, contents, anti: new AntiEntropia(porta), lugar: -1, sinais: [], republicados: 0, relatosPedidos: [] }
    this.nos.push(no)
    return no
  }

  #entregar(de: No, fazer: (outro: No) => Promise<void>): void {
    for (const outro of this.nos) {
      if (outro === de) continue
      this.emVoo += 1
      setTimeout(() => {
        void fazer(outro).finally(() => {
          this.emVoo -= 1
        })
      }, 1)
    }
  }
}

/** A post signed by `author`, stored in each node's vault of `who`. */
function publicar(autor: No, quem: readonly No[], seq: number, legenda: string): void {
  const payload = comAutoria(CANAL, { t: "post", id: `post-${seq}-00000`, postedAt: seq, caption: legenda } as never, autor.eu)
  for (const no of quem) {
    appendHistory(no.contents, CANAL, { seq, sender: autor.eu.address, at: seq, payload: payload as unknown as StoredPayload })
  }
}

async function ateSilencio(rede: Rede, ms = 8_000): Promise<void> {
  const inicio = Date.now()
  let calmo = 0
  while (Date.now() - inicio < ms) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    calmo = rede.emVoo === 0 ? calmo + 1 : 0
    if (calmo >= 25) return
  }
}

/** A signal written by hand, signed by `de`: for tests to speak as a peer without running its logic. */
function sinalDe(de: No, corpo: Record<string, unknown>): string {
  const assinatura = de.eu.assinar(_paraTestes.mensagemDoSinal(CANAL, de.eu.address, CHAVE.epoca, corpo as never))
  const envelope = { ap: de.folha.aparelho, as: toBase64(assinatura), c: corpo }
  return toBase64(selarSinal(CHAVE, CANAL, new TextEncoder().encode(JSON.stringify(envelope))))
}

/** The body of a signal that went out, opened. */
function corpoDe(sinal: string): Record<string, unknown> {
  const aberto = abrirSinal(CHAVE, CANAL, fromBase64(sinal))!
  return (JSON.parse(new TextDecoder().decode(aberto)) as { c: Record<string, unknown> }).c
}

/** A message signed by `author`, with the server's `seq`, in the vault of `node`. */
function dizer(autor: No, no: No, seq: number, corpo: string): void {
  const payload = comAutoria(CANAL, { t: "message", id: `msg-${seq}-0000000`, sentAt: seq, body: corpo } as never, autor.eu)
  appendHistory(no.contents, CANAL, { seq, sender: autor.eu.address, at: seq, payload: payload as unknown as StoredPayload })
}

const iguais = (a: No, b: No): boolean =>
  tiposDiferentes(resumoDoCanal(a.contents, CANAL), resumoDoCanal(b.contents, CANAL)).length === 0

let passoAntes = 0
beforeEach(() => {
  passoAntes = TECTOS_DA_SINCRONIA.passoDaSupressaoMs
  TECTOS_DA_SINCRONIA.passoDaSupressaoMs = 150
})
afterEach(() => {
  TECTOS_DA_SINCRONIA.passoDaSupressaoMs = passoAntes
})

describe("a anti-entropia numa rede em memória", () => {
  it("quem tem menos pede e recebe; os resumos ficam iguais", async () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    for (let i = 0; i < 12; i++) publicar(ana, [ana, ...(i < 4 ? [bruno] : [])], 100 + i, `mural ${i}`)
    expect(iguais(ana, bruno)).toBe(false)
    await bruno.anti.enviarResumo(CANAL)
    await ateSilencio(rede)
    expect(iguais(ana, bruno)).toBe(true)
    expect(ana.anti.estatisticas.relatosEnviados).toBe(8)
    expect(bruno.anti.estatisticas.relatosAplicados).toBe(8)
  })

  it("nos dois sentidos ao mesmo tempo", async () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    publicar(ana, [ana], 100, "só da Ana")
    publicar(bruno, [bruno], 101, "só do Bruno")
    await ana.anti.enviarResumo(CANAL)
    await ateSilencio(rede)
    expect(iguais(ana, bruno)).toBe(true)
  })

  it("tempestade: cinco membros vêem a mesma diferença; responde um só, e cada item vai uma vez", async () => {
    const rede = new Rede()
    const quatro = ["ana", "bruno", "carla", "dora"].map((nome, i) => rede.criar(nome, i))
    const eva = rede.criar("eva", 4)
    for (let i = 0; i < 30; i++) publicar(quatro[i % 4]!, quatro, 100 + i, `mural ${i}`)
    // All alive and capable in everyone's eyes (like after a device signal).
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])
    await eva.anti.enviarResumo(CANAL)
    await ateSilencio(rede)
    expect(quatro.every((no) => iguais(no, eva))).toBe(true)
    const relataram = quatro.filter((no) => no.anti.estatisticas.relatosEnviados > 0)
    expect(relataram.map((no) => no.nome)).toEqual(["ana"])
    const relatados = quatro.reduce((soma, no) => soma + no.anti.estatisticas.relatosEnviados, 0)
    expect(relatados).toBeLessThanOrEqual(45)
    // Suppression: of the four that had the most, only one answered with its digest.
    expect(quatro.reduce((soma, no) => soma + no.anti.estatisticas.resumosEnviados, 0)).toBe(1)
  })
})

describe("o corpo de um sinal", () => {
  const { lerCorpo, emPartes } = _paraTestes

  it("recusa o que não tem a forma", () => {
    expect(lerCorpo({ k: "r0", l: 1, d: 1, r: [] })).toBeNull()
    expect(lerCorpo({ k: "pi", id: "a", para: "b", d: 1, l: 1, c: ["não-é-chave"] })).toBeNull()
    expect(lerCorpo({ k: "xx" })).toBeNull()
    expect(lerCorpo({ k: "ri", id: "a", de: 0 })).toEqual({ k: "ri", id: "a", de: 0 })
  })

  it("parte respostas grandes abaixo do tecto de um sinal", () => {
    const entradas = Array.from({ length: 3_000 }, (_, i) => ["mensagem", "2026-10-20", [`${i}`.padStart(12, "0")]])
    const partes = emPartes(entradas)
    expect(partes.length).toBeGreaterThan(1)
    for (const parte of partes) expect(JSON.stringify(parte).length).toBeLessThan(8 * 1024)
    expect(partes.flat()).toHaveLength(3_000)
  })
})

describe("o piso dos relatos de conversa (decisão 2a)", () => {
  it("sobe num reassento: quem foi sentado de novo não relata conversa anterior ao lugar novo", async () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    ana.lugar = 10
    await ana.anti.aoWelcome(CANAL)
    expect(ana.anti.piso(CANAL)).toBe(10)
    dizer(ana, ana, 40, "dita com a Ana sentada no 10")
    /*
      Ana leaves the tree. Meanwhile, Carlos enters at seq 30 (Ana does not see the
      commit) and Ana is reseated at 50. The report goes encrypted to the whole group:
      with the old floor (10), a request with the window at 10 would bring what
      was said at 40, and whoever joined after 40 would read it.
    */
    ana.lugar = 50
    await ana.anti.aoWelcome(CANAL)
    expect(ana.anti.piso(CANAL)).toBe(50)
    await ateSilencio(rede, 1_000)
    const relatadosAntes = ana.anti.estatisticas.relatosEnviados
    // A request with a low window, by hand: the floor is what holds it back.
    const curta = chaveCurta(itensDoCanal(ana.contents, CANAL).find((i) => i.tipo === "mensagem")!.chave)
    await ana.anti.aoSinal({ channel: CANAL, from: bruno.eu.address, sinal: sinalDe(bruno, { k: "pi", id: "pedido-baixo", para: ana.folha.aparelho, d: 10, l: 10, c: [curta] }) })
    expect(ana.anti.estatisticas.relatosEnviados).toBe(relatadosAntes)
  })
})

describe("o tecto de bytes do sinal conta as cópias (como o servidor)", () => {
  let tectoAntes = 0
  beforeEach(() => {
    tectoAntes = TECTOS_DA_SINCRONIA.bytesDeSinalPorCanalPorMinuto
  })
  afterEach(() => {
    TECTOS_DA_SINCRONIA.bytesDeSinalPorCanalPorMinuto = tectoAntes
  })

  it("onze ligações: cada sinal custa dez cópias, e o ciclo de partes pára à primeira recusa", async () => {
    // Two thousand comments in two thousand days: a large level 1, in many parts.
    const montar = (): { ana: No; bruno: No } => {
      const rede = new Rede()
      const ana = rede.criar("ana", 0)
      const bruno = rede.criar("bruno", 1)
      for (let i = 2; i < 11; i++) rede.fantasmas.push({ indice: i, address: `@fantasma${i}:orwell.test`, aparelho: `fantasma-${i}` })
      for (let i = 0; i < 2_000; i++) {
        const payload = { t: "post.comment", id: `com-${i}-0000000`, target: "post-0", postedAt: i * 86_400_000, body: "x" }
        appendHistory(ana.contents, CANAL, { seq: 100 + i, sender: bruno.eu.address, at: i, payload: payload as unknown as StoredPayload })
      }
      return { ana, bruno }
    }
    const pedir = async ({ ana, bruno }: { ana: No; bruno: No }): Promise<Record<string, unknown>[]> => {
      await ana.anti.aoSinal({
        channel: CANAL,
        from: bruno.eu.address,
        sinal: sinalDe(bruno, { k: "p1", id: "pedido-grande", para: ana.folha.aparelho, d: -1, l: -1, tipos: ["comentario"] }),
      })
      return ana.sinais.map(corpoDe).filter((c) => c["k"] === "n1")
    }

    // First without a cap, to find the size of a full part and the last (smaller) one.
    TECTOS_DA_SINCRONIA.bytesDeSinalPorCanalPorMinuto = Number.MAX_SAFE_INTEGER
    const sonda = montar()
    const todas = await pedir(sonda)
    expect(todas.length).toBeGreaterThan(4)
    const cheia = sonda.ana.sinais[0]!.length
    const ultima = sonda.ana.sinais[sonda.ana.sinais.length - 1]!.length
    expect(ultima).toBeLessThan(cheia)

    // A cap that fits three full parts and the last one, but not four full ones.
    const tecto = (3 * cheia + ultima) * 10 + 10
    TECTOS_DA_SINCRONIA.bytesDeSinalPorCanalPorMinuto = tecto
    const prova = montar()
    const partes = await pedir(prova)
    // Output as the server counts it: the size times ten other connections.
    expect(prova.ana.sinais.reduce((soma, sinal) => soma + sinal.length * 10, 0)).toBeLessThanOrEqual(tecto)
    // The parts that went out are the first ones, with no gaps: after the first refusal nothing else goes out,
    // not even the last one, which still fit.
    expect(partes.map((c) => c["parte"])).toEqual([1, 2, 3])
  })
})

describe("a lápide na anti-entropia (revisão de S4, achado 2)", () => {
  it("quem entra depois da lápide de uma publicação recebe a lápide, e a publicação não volta por quem não a viu apagar", async () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    const carla = rede.criar("carla", 2)
    carla.lugar = 50
    publicar(ana, [ana, bruno], 20, "apagada")
    // Ana deletes it at 30; Bruno did not see the tombstone.
    const lapide = comAutoria(CANAL, { t: "redact", id: "lapide-0000001", target: "post-20-00000", redactedAt: 30 } as never, ana.eu)
    appendHistory(ana.contents, CANAL, { seq: 30, sender: ana.eu.address, at: 30, payload: lapide as unknown as StoredPayload })
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])

    await carla.anti.enviarResumo(CANAL)
    await ateSilencio(rede)
    await bruno.anti.enviarResumo(CANAL)
    await ateSilencio(rede)

    const lapidesDe = (no: No) => itensDoCanal(no.contents, CANAL, { comApagados: true }).filter((i) => i.tipo === "apagamento").length
    // Carlos has the tombstone (from before his place: the board has no window) and does not have the post.
    expect(lapidesDe(carla)).toBe(1)
    expect(itensDoCanal(carla.contents, CANAL, { comApagados: true }).some((i) => i.tipo === "publicacao")).toBe(false)
    expect(lapidesDe(bruno)).toBe(1)
    for (const no of [bruno, carla]) expect(tiposDiferentes(resumoDoCanal(ana.contents, CANAL, { desde: 50 }), resumoDoCanal(no.contents, CANAL, { desde: 50 }))).toEqual([])

    // Same thing, nobody asks for anything more: the request does not repeat on every trigger.
    const pedidos = rede.nos.reduce((soma, no) => soma + no.anti.estatisticas.pedidosEnviados, 0)
    for (const no of rede.nos) await no.anti.enviarResumo(CANAL, -1)
    await ateSilencio(rede)
    expect(rede.nos.reduce((soma, no) => soma + no.anti.estatisticas.pedidosEnviados, 0)).toBe(pedidos)
  })

  it("um item apagado que chega por relato é recusado e não é gravado", async () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const carla = rede.criar("carla", 1)
    publicar(ana, [ana], 20, "apagada")
    const lapide = comAutoria(CANAL, { t: "redact", id: "lapide-0000001", target: "post-20-00000", redactedAt: 30 } as never, ana.eu)
    appendHistory(carla.contents, CANAL, { seq: 30, sender: ana.eu.address, at: 30, payload: lapide as unknown as StoredPayload })
    const { prepararItem } = await import("./relato.js")
    const fonte = itensDoCanal(ana.contents, CANAL).find((i) => i.tipo === "publicacao")!.fonte!
    const item = prepararItem(CANAL, fonte, ana.eu, null)!
    await carla.anti.aoRelatos(CANAL, 100, { v: 1, itens: [item] }, ana.folha.aparelho)
    expect(carla.anti.estatisticas.relatosRecusados.lapide).toBe(1)
    expect(itensDoCanal(carla.contents, CANAL, { comApagados: true }).some((i) => i.tipo === "publicacao")).toBe(false)
  })
})

describe("as partes de um relato só contam de quem respondeu (revisão de S4, achado 11)", () => {
  it("uma trama de outro membro com o q do nosso pedido não o fecha", async () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    const carla = rede.criar("carla", 2)
    for (let i = 0; i < 6; i++) publicar(ana, [ana, carla, ...(i < 2 ? [bruno] : [])], 100 + i, `mural ${i}`)
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])
    rede.reterRelatosDe = ana
    await bruno.anti.enviarResumo(CANAL)
    await ateSilencio(rede, 3_000)
    const pedido = bruno.sinais.map(corpoDe).find((c) => c["k"] === "pi")
    expect(pedido?.["para"]).toBe(ana.folha.aparelho)
    const pedidosAntes = bruno.anti.estatisticas.pedidosEnviados
    const q = `${pedido!["id"] as string}:1/1`
    // Carlos sends an empty frame with the q of Bruno's request to Ana.
    await bruno.anti.aoRelatos(CANAL, ++rede.seq, { v: 1, q, itens: [] }, carla.folha.aparelho)
    await ateSilencio(rede, 1_000)
    expect(bruno.anti.estatisticas.pedidosEnviados).toBe(pedidosAntes)
    // Verify: the same frame from Ana closes the request, and the remaining difference opens another.
    await bruno.anti.aoRelatos(CANAL, ++rede.seq, { v: 1, q, itens: [] }, ana.folha.aparelho)
    await ateSilencio(rede, 1_000)
    expect(bruno.anti.estatisticas.pedidosEnviados).toBeGreaterThan(pedidosAntes)
  })
})

describe("a presença a acender tem travão (revisão de S4, achado 14)", () => {
  let intervaloAntes = 0
  beforeEach(() => {
    intervaloAntes = TECTOS_DA_SINCRONIA.intervaloEntreResumosMs
    TECTOS_DA_SINCRONIA.intervaloEntreResumosMs = 100
  })
  afterEach(() => {
    TECTOS_DA_SINCRONIA.intervaloEntreResumosMs = intervaloAntes
  })

  it("um resumo por canal por minuto, por mais que a presença pisque", async () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    for (let i = 0; i < 4; i++) {
      publicar(ana, [ana], 100 + i, `pisca ${i}`)
      await ana.anti.aoVerOnline(bruno.eu.address, [CANAL])
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    expect(ana.anti.estatisticas.resumosEnviados).toBe(1)
  })
})

describe("a ligação de volta no mesmo minuto (fase 1 da 1.1, o retrato do Welcome)", () => {
  it("quem não mudou e volta depressa diz o resumo na mesma; quem não mudou e volta tarde, não", async () => {
    const rede = new Rede()
    const carla = rede.criar("carla", 0)
    rede.criar("bruno", 1)
    await carla.anti.enviarResumo(CANAL)
    expect(carla.anti.estatisticas.resumosEnviados).toBe(1)
    // The connection drops and comes back: Carlos's side did not change, but it is this digest that makes the others respond.
    await carla.anti.aoFimDaRecuperacao([CANAL], () => false)
    expect(carla.anti.estatisticas.resumosEnviados).toBe(2)
    // More than a minute later, whoever has new things says so when they see it light up (`aoVerOnline`): nothing goes out.
    const agora = Date.now
    Date.now = () => agora() + 61_000
    try {
      await carla.anti.aoFimDaRecuperacao([CANAL], () => false)
    } finally {
      Date.now = agora
    }
    expect(carla.anti.estatisticas.resumosEnviados).toBe(2)
  })
})

describe("um item sem autoria de outra pessoa (anterior a S4) (revisão de S4, achado 5)", () => {
  /** A post with no authorship, like the ones written before S4. */
  function publicarAntiga(autor: string, quem: readonly No[], seq: number): void {
    const payload = { t: "post", id: `antiga-${seq}-0000`, postedAt: seq, caption: "antiga" }
    for (const no of quem) appendHistory(no.contents, CANAL, { seq, sender: autor, at: seq, payload: payload as unknown as StoredPayload })
  }
  const pedidosDeItens = (no: No): number => no.sinais.map(corpoDe).filter((c) => c["k"] === "pi").length

  it("quem a tem e não a pode assinar diz quem é o autor, e a folha do autor relata-a", async () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    const carla = rede.criar("carla", 2)
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])
    publicarAntiga(carla.eu.address, [ana, carla], 100)
    await bruno.anti.enviarResumo(CANAL)
    await ateSilencio(rede)
    expect(iguais(ana, bruno)).toBe(true)
    expect(carla.anti.estatisticas.relatosEnviados).toBe(1)
  })

  it("se o autor não está, a chave fica lembrada um dia e o pedido não se repete a cada gatilho", async () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])
    publicarAntiga("@carla:orwell.test", [ana], 100)
    await bruno.anti.enviarResumo(CANAL)
    await ateSilencio(rede)
    expect(pedidosDeItens(bruno)).toBe(1)
    // Another trigger, then another: it goes down, sees that only what nobody gave is missing, and stops before the request.
    for (let i = 0; i < 2; i++) {
      await ana.anti.enviarResumo(CANAL, -1)
      await ateSilencio(rede)
    }
    expect(pedidosDeItens(bruno)).toBe(1)
  })
})

describe("o tecto de relatos por dia vive no cofre (revisão de S4, achado 8)", () => {
  it("uma recarga não dá outro dia inteiro, e os dias velhos saem", async () => {
    const hoje = new Date().toISOString().slice(0, 10)
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    for (let i = 0; i < 4; i++) publicar(ana, [ana], 100 + i, `mural ${i}`)
    // What the previous session already spent today, saved in the vault: the full cap.
    const cofre = ana.contents as unknown as { sincronia?: { bytesDoDia?: Record<string, number> } }
    cofre.sincronia = { bytesDoDia: { [`${hoje}|${CANAL}`]: TECTOS_DA_SINCRONIA.bytesDeRelatoPorCanalPorDia, [`2000-01-01|${CANAL}`]: 5 } }
    await bruno.anti.enviarResumo(CANAL)
    await ateSilencio(rede)
    expect(ana.anti.estatisticas.relatosEnviados).toBe(0)
    expect(iguais(ana, bruno)).toBe(false)
    // With room in the cap, report and count in the vault; the old day goes out. (The first
    // pass spent Bruno's requests from that minute: the test gives him more.)
    cofre.sincronia.bytesDoDia = { [`2000-01-01|${CANAL}`]: 5 }
    const pedidosAntes = TECTOS_DA_SINCRONIA.pedidosPorCanalPorMinuto
    TECTOS_DA_SINCRONIA.pedidosPorCanalPorMinuto = 1_000
    try {
      await bruno.anti.enviarResumo(CANAL, -1)
      await ateSilencio(rede)
    } finally {
      TECTOS_DA_SINCRONIA.pedidosPorCanalPorMinuto = pedidosAntes
    }
    expect(iguais(ana, bruno)).toBe(true)
    expect(Object.keys(cofre.sincronia.bytesDoDia ?? {})).toEqual([`${hoje}|${CANAL}`])
    expect(cofre.sincronia.bytesDoDia?.[`${hoje}|${CANAL}`]).toBeGreaterThan(0)
  })
})

describe("perfis relatados por um terceiro (3/11/2026, a sala comum)", () => {
  it("entra o perfil assinado pelo autor; o nome trocado, o de quem não é membro e o nosso não", async () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    const carla = rede.criar("carla", 2)
    const perfil = (quem: No, nome: string): Record<string, unknown> =>
      comAutoria(CANAL, { t: "profile", displayName: nome, donations: [], updatedAt: 5 } as never, quem.eu) as unknown as Record<string, unknown>
    const doBruno = perfil(bruno, "Bruno")
    const trocado = { ...doBruno, displayName: "Mentira" }
    // David signs a real profile, but has no leaf in this channel.
    const privada = new Uint8Array(32).fill(99)
    const dario: QuemRelata = { address: "@dario:orwell.test", aparelho: ed25519.getPublicKey(privada), assinar: (m) => ed25519.sign(m, privada) }
    const doDario = comAutoria(CANAL, { t: "profile", displayName: "Dário", donations: [], updatedAt: 5 } as never, dario) as unknown as Record<string, unknown>
    const daCarla = perfil(carla, "Carla")

    // The one who reports is Ana: what matters is each author's signature, not hers.
    await carla.anti.aoRelatos(
      CANAL,
      100,
      {
        v: 1,
        q: "pf.abc:1/1",
        itens: [
          { s: -1, a: bruno.eu.address, p: trocado },
          { s: -1, a: dario.address, p: doDario },
          { s: -1, a: carla.eu.address, p: daCarla },
          { s: -1, a: bruno.eu.address, p: doBruno },
        ],
      },
      ana.folha.aparelho,
    )
    // The swapped name does not verify; David's device is not in the tree; ours does not accept itself from anyone.
    expect(carla.anti.estatisticas.relatosRecusados).toEqual({ autoria: 1, aparelho: 1, tipo: 1 })
    expect(carla.anti.estatisticas.perfisAplicados).toBe(1)
  })
})

describe("quanto tempo uma conta pedida espera por outro pedido (revisão do 1.3.8, R4)", () => {
  it("24 h só para quem um relato deu sem nome; 10 min para quem ficou sem resposta", async () => {
    const rede = new Rede()
    rede.perfisATerceiros = true
    rede.relogio = 1_000_000
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    const carla = rede.criar("carla", 2)
    const semResposta = "@dario:orwell.test"
    expect(await ana.anti.pedirPerfis(CANAL, [bruno.eu.address, semResposta])).toBe(true)
    const pedido = corpoDe(ana.sinais.at(-1)!)
    expect(pedido["k"]).toBe("pp")

    // Carla relays Bruno's signed profile, which has no name.
    const semNome = comAutoria(CANAL, { t: "profile", displayName: "", donations: [], updatedAt: 5 } as never, bruno.eu) as unknown as Record<string, unknown>
    await ana.anti.aoRelatos(CANAL, 100, { v: 1, q: `pf.${String(pedido["id"])}:1/1`, itens: [{ s: -1, a: bruno.eu.address, p: semNome }] }, carla.folha.aparelho)

    expect(ana.anti.estatisticas.relatosRecusados).toEqual({})
    expect(ana.anti.estatisticas.perfisAplicados).toBe(1)
    rede.relogio += 11 * 60_000
    expect(ana.anti.contasPorPedir(CANAL, [bruno.eu.address, semResposta])).toEqual([semResposta])
    rede.relogio += 24 * 3_600_000
    expect(ana.anti.contasPorPedir(CANAL, [bruno.eu.address, semResposta]).sort()).toEqual([bruno.eu.address, semResposta].sort())
  })
})

describe("the portrait asked for in a profile request (1.3.26)", () => {
  it("its owner publishes it at once, and no relayer is asked for it", async () => {
    const rede = new Rede()
    rede.perfisATerceiros = true
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    const carla = rede.criar("carla", 2)
    expect(await ana.anti.pedirPerfis(CANAL, [bruno.eu.address, carla.eu.address], [carla.eu.address])).toBe(true)
    const pedido = corpoDe(ana.sinais.at(-1)!)
    expect(pedido["c"]).toEqual([bruno.eu.address, carla.eu.address].sort())
    expect(pedido["r"]).toEqual([carla.eu.address])
    await ateSilencio(rede, 400)
    // Carla does not wait for the relay turns: no relay carries a portrait.
    expect(carla.republicados).toBe(1)
    // Relayers are asked for Bruno only, never for Carla's portrait.
    const pedidos = rede.nos.flatMap((no) => no.relatosPedidos)
    expect(pedidos.length).toBeGreaterThan(0)
    for (const contas of pedidos) expect(contas).not.toContain(carla.eu.address)
  })

  it("in the common room the receiver ignores `r`: a hundred accounts asked make no owner publish before the relay turns", async () => {
    const rede = new Rede()
    rede.perfisATerceiros = true
    rede.retratosAPedido = false
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    const carla = rede.criar("carla", 2)
    // A modified client: `r` equal to `c`, a hundred accounts, the most a request carries.
    const contas = [bruno.eu.address, carla.eu.address, ...Array.from({ length: 98 }, (_, i) => `@outra${i}:orwell.test`)]
    const sinal = sinalDe(ana, { k: "pp", id: "pedido-hostil-0001", c: contas, r: contas })
    await Promise.all([bruno, carla].map((no) => no.anti.aoSinal({ channel: CANAL, from: ana.eu.address, sinal })))
    await ateSilencio(rede, 400)
    expect(bruno.republicados + carla.republicados).toBe(0)
    // And relayers are still asked for every account, as for a plain request.
    expect(rede.nos.flatMap((no) => no.relatosPedidos).some((pedidas) => pedidas.includes(carla.eu.address))).toBe(true)
  })

  it("a relay of an OLDER version of the owner's profile does not keep the owner quiet", async () => {
    const rede = new Rede()
    rede.perfisATerceiros = true
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    const carla = rede.criar("carla", 2)
    rede.versoes.set("carla", 10)
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarVivo(outro.folha.aparelho)
    // Bruno would relay nothing; Carla is named and waits for the relay turns.
    expect(await ana.anti.pedirPerfis(CANAL, [carla.eu.address])).toBe(true)
    const id = String(corpoDe(ana.sinais.at(-1)!)["id"])
    // Bruno relays an old version of Carla's profile (5 < 10), whole, signed by her.
    const antigo = comAutoria(CANAL, { t: "profile", displayName: "Carla", donations: [], updatedAt: 5 } as never, carla.eu) as unknown as Record<string, unknown>
    await carla.anti.aoRelatos(CANAL, 200, { v: 1, q: `pf.${id}:1/1`, itens: [{ s: -1, a: carla.eu.address, p: antigo }] }, bruno.folha.aparelho)
    await new Promise((resolve) => setTimeout(resolve, 2_200))
    expect(carla.republicados).toBe(1)
  })

  it("a relay of the owner's current version keeps the owner quiet, as before", async () => {
    const rede = new Rede()
    rede.perfisATerceiros = true
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    const carla = rede.criar("carla", 2)
    rede.versoes.set("carla", 10)
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarVivo(outro.folha.aparelho)
    expect(await ana.anti.pedirPerfis(CANAL, [carla.eu.address])).toBe(true)
    const id = String(corpoDe(ana.sinais.at(-1)!)["id"])
    const atual = comAutoria(CANAL, { t: "profile", displayName: "Carla", donations: [], updatedAt: 10 } as never, carla.eu) as unknown as Record<string, unknown>
    await carla.anti.aoRelatos(CANAL, 200, { v: 1, q: `pf.${id}:1/1`, itens: [{ s: -1, a: carla.eu.address, p: atual }] }, bruno.folha.aparelho)
    await new Promise((resolve) => setTimeout(resolve, 2_200))
    expect(carla.republicados).toBe(0)
  })

  it("a forged relay with a very high updatedAt does not keep the owner quiet (N-S3)", async () => {
    const rede = new Rede()
    rede.perfisATerceiros = true
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    const carla = rede.criar("carla", 2)
    rede.versoes.set("carla", 10)
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarVivo(outro.folha.aparelho)
    expect(await ana.anti.pedirPerfis(CANAL, [carla.eu.address])).toBe(true)
    const id = String(corpoDe(ana.sinais.at(-1)!)["id"])
    // Bruno sends Carla's profile unsigned, with a version far ahead of hers.
    const forjado = { t: "profile", displayName: "Carla", donations: [], updatedAt: 9e15 }
    await carla.anti.aoRelatos(CANAL, 200, { v: 1, q: `pf.${id}:1/1`, itens: [{ s: -1, a: carla.eu.address, p: forjado }] }, bruno.folha.aparelho)
    await new Promise((resolve) => setTimeout(resolve, 2_200))
    expect(carla.republicados).toBe(1)
  })

  it("a relay with a copied q and nothing authentic does not stand the honest relayer down (N-S1)", async () => {
    const rede = new Rede()
    rede.perfisATerceiros = true
    const ana = rede.criar("ana", 0)
    const dora = rede.criar("dora", 1)
    const bruno = rede.criar("bruno", 2)
    const carla = rede.criar("carla", 3)
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarVivo(outro.folha.aparelho)
    // Bruno holds Carla's profile signed by her; Dora, before him in the turns, holds nothing.
    const daCarla = comAutoria(CANAL, { t: "profile", displayName: "Carla", donations: [], updatedAt: 10 } as never, carla.eu) as unknown as Record<string, unknown>
    rede.paraRelatar.set("bruno", [{ s: -1, a: carla.eu.address, p: daCarla }])
    expect(await ana.anti.pedirPerfis(CANAL, [carla.eu.address])).toBe(true)
    const id = String(corpoDe(ana.sinais.at(-1)!)["id"])
    // Dora answers first with the request's q: an empty frame, and one with an old unsigned item.
    await bruno.anti.aoRelatos(CANAL, 200, { v: 1, q: `pf.${id}:1/1`, itens: [] }, dora.folha.aparelho)
    const velho = { t: "profile", displayName: "Carla", donations: [], updatedAt: 0 }
    await bruno.anti.aoRelatos(CANAL, 201, { v: 1, q: `pf.${id}:1/1`, itens: [{ s: -1, a: carla.eu.address, p: velho }] }, dora.folha.aparelho)
    await ateSilencio(rede, 600)
    expect(bruno.anti.estatisticas.respostasDePerfis).toBe(1)
  })

  it("a live 1.3.25 leaf does not count as someone who can answer pp (N-S2)", () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const velho = rede.criar("velho", 1)
    ana.anti.notarVivo(velho.folha.aparelho)
    expect(ana.anti.haQuemResponda(CANAL)).toBe(true)
    rede.semPedido.add(velho.eu.address)
    expect(ana.anti.haQuemResponda(CANAL)).toBe(false)
  })

  it("in the common room, with `r` ignored, an owner a relayer carried stays quiet after the relay turns (B1)", async () => {
    const rede = new Rede()
    rede.perfisATerceiros = true
    rede.retratosAPedido = false
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    const carla = rede.criar("carla", 2)
    rede.versoes.set("carla", 10)
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarVivo(outro.folha.aparelho)
    const daCarla = comAutoria(CANAL, { t: "profile", displayName: "Carla", donations: [], updatedAt: 10 } as never, carla.eu) as unknown as Record<string, unknown>
    rede.paraRelatar.set("bruno", [{ s: -1, a: carla.eu.address, p: daCarla }])
    const sinal = sinalDe(ana, { k: "pp", id: "pedido-hostil-0002", c: [carla.eu.address], r: [carla.eu.address] })
    await Promise.all([bruno, carla].map((no) => no.anti.aoSinal({ channel: CANAL, from: ana.eu.address, sinal })))
    // Past the relay turns and the owner's own wait.
    await new Promise((resolve) => setTimeout(resolve, 2_200))
    expect(bruno.anti.estatisticas.respostasDePerfis).toBe(1)
    expect(carla.republicados).toBe(0)
  })

  it("a frame with a copied q and only the sender's own signed profile does not silence the relay of the others (N3-S1)", async () => {
    const rede = new Rede()
    rede.perfisATerceiros = true
    const ana = rede.criar("ana", 0)
    const dora = rede.criar("dora", 1)
    const bruno = rede.criar("bruno", 2)
    const carla = rede.criar("carla", 3)
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarVivo(outro.folha.aparelho)
    const daCarla = comAutoria(CANAL, { t: "profile", displayName: "Carla", donations: [], updatedAt: 10 } as never, carla.eu) as unknown as Record<string, unknown>
    rede.paraRelatar.set("bruno", [{ s: -1, a: carla.eu.address, p: daCarla }])
    expect(await ana.anti.pedirPerfis(CANAL, [carla.eu.address, dora.eu.address])).toBe(true)
    const id = String(corpoDe(ana.sinais.at(-1)!)["id"])
    // Dora answers first, with only her own profile, signed by her: authentic, but not Carla.
    const daDora = comAutoria(CANAL, { t: "profile", displayName: "Dora", donations: [], updatedAt: 3 } as never, dora.eu) as unknown as Record<string, unknown>
    await bruno.anti.aoRelatos(CANAL, 200, { v: 1, q: `pf.${id}:1/1`, itens: [{ s: -1, a: dora.eu.address, p: daDora }] }, dora.folha.aparelho)
    await ateSilencio(rede, 600)
    expect(bruno.anti.estatisticas.respostasDePerfis).toBe(1)
    expect(bruno.anti.estatisticas.perfisRelatados).toBe(1)
  })

  it("a request without `r` reads as before: no portrait is asked for", async () => {
    const rede = new Rede()
    rede.perfisATerceiros = true
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    expect(await ana.anti.pedirPerfis(CANAL, [bruno.eu.address])).toBe(true)
    expect(corpoDe(ana.sinais.at(-1)!)["r"]).toBeUndefined()
  })
})

describe("o passado servido pelos membros (D2)", () => {
  const doPassado = (autor: No, seq: number, corpo: string): Record<string, unknown> => ({
    s: seq,
    a: autor.eu.address,
    p: comAutoria(CANAL, { t: "message", id: `msg-${seq}-0000000`, sentAt: seq, body: corpo } as never, autor.eu) as unknown as Record<string, unknown>,
  })

  it("LOW-01: um autor que nunca foi do canal é recusado; um ex-membro conhecido passa", async () => {
    const rede = new Rede()
    rede.criar("ana", 0)
    const eva = rede.criar("eva", 1)
    const carla = rede.criar("carla", 2)
    rede.foraDosMembros.add(eva.eu.address)
    const primeira = await carla.anti.aplicarDoPassado(CANAL, [doPassado(eva, 5, "de fora")], 100)
    expect(primeira.aplicados).toBe(0)
    expect(primeira.recusados["autor"]).toBe(1)
    // Eva is in Carla's vault (she wrote here before leaving): a known ex-member.
    dizer(eva, carla, 200, "antiga")
    const segunda = await carla.anti.aplicarDoPassado(CANAL, [doPassado(eva, 5, "de fora")], 100)
    expect(segunda.aplicados).toBe(1)
  })

  it("LOW-04: no máximo 8 autores fora da árvore por página", async () => {
    const rede = new Rede()
    const carla = rede.criar("carla", 0)
    const antigos = Array.from({ length: 9 }, (_, i) => rede.criar(`antigo${i}`, i + 1))
    for (const [i, antigo] of antigos.entries()) {
      rede.foraDosMembros.add(antigo.eu.address)
      dizer(antigo, carla, 300 + i, "antiga")
    }
    const pagina = antigos.map((antigo, i) => doPassado(antigo, 10 + i, `passado ${i}`))
    const r = await carla.anti.aplicarDoPassado(CANAL, pagina, 100)
    expect(r.aplicados).toBe(8)
    expect(r.recusados["autores"]).toBe(1)
  })

  it("a partir do lugar é do servidor; uma reacção ou um tipo sem janela não passam", async () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const carla = rede.criar("carla", 1)
    const r = await carla.anti.aplicarDoPassado(CANAL, [doPassado(ana, 150, "depois")], 100)
    expect(r.recusados["servidor-serve"]).toBe(1)
    const post = { s: 5, a: ana.eu.address, p: comAutoria(CANAL, { t: "post", id: "post-5-00000", postedAt: 5, caption: "x" } as never, ana.eu) }
    expect((await carla.anti.aplicarDoPassado(CANAL, [post], 100)).recusados["tipo"]).toBe(1)
  })
})
