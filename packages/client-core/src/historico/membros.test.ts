import { abrirSinal, type ChaveDoSinal } from "@enclave/crypto"
import { fromBase64, generateIdentity, parseServerName, signWithDevice, toBase64, type ItemRelatado } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { StoredChatMessage, VaultContents } from "../vault.js"
import type { Folha } from "../sincronia/eleicao.js"
import type { ItemDoResumo } from "../sincronia/resumo.js"
import {
  _fioParaTestes,
  _paraTestes,
  choosePageNewestFirst,
  cortarPorBytes,
  cutByBytesNewestFirst,
  escolherPagina,
  HistoricoDosMembros,
  inventarioDosMembros,
  leSala,
  MAGIA_DOS_MEMBROS,
  passadoLegivel,
  TECTOS_DOS_MEMBROS,
  TODOS_LEEM,
  type PortaDosMembros,
} from "./membros.js"

const CANAL = "!canal:casa.pt"

function entrada(seq: number, sender: string, payload: Record<string, unknown>): StoredChatMessage {
  return { seq, sender, at: seq, payload } as unknown as StoredChatMessage
}

function cofreCom(entradas: StoredChatMessage[]): VaultContents {
  return { history: { [CANAL]: entradas }, estadoDoCanal: {} } as unknown as VaultContents
}

function item(e: StoredChatMessage): ItemDoResumo {
  const p = e.payload as Record<string, unknown>
  const tipo = p["t"] === "redact" ? "apagamento" : p["t"] === "edit" ? "edicao" : p["t"] === "reaction" ? "reaccao" : "mensagem"
  return { tipo, balde: "", chave: `${tipo}|${e.sender}|${String(p["id"] ?? p["target"])}`, fonte: { autor: e.sender, seq: e.seq, payload: e.payload } }
}

describe("o passado legível", () => {
  const ana = "@ana:casa.pt"
  const entradas = [
    entrada(1, ana, { t: "message", id: "m1", body: "geral" }),
    entrada(2, ana, { t: "message", id: "m2", body: "segredo", room: "secreta" }),
    entrada(3, ana, { t: "edit", id: "e1", target: "m2", body: "segredo editado" }),
    entrada(4, ana, { t: "reaction", target: "m2", emoji: "x" }),
    entrada(5, ana, { t: "redact", id: "r1", target: "desconhecida" }),
    entrada(-1, ana, { t: "message", id: "sem-seq", body: "sem seq" }),
    entrada(9, ana, { t: "message", id: "m9", body: "depois do lugar" }),
  ]
  const cofre = cofreCom(entradas)
  const itens = entradas.map(item)

  it("corta no lugar e deixa de fora o que não tem seq", () => {
    const legivel = passadoLegivel(itens, cofre, CANAL, 9, TODOS_LEEM)
    expect(legivel.map((i) => i.fonte!.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it("uma sala que não se pode ler leva também as edições e reacções que lhe tocam", () => {
    const leitor = { podeLerSala: (sala: string) => sala !== "secreta", salasRestritas: true }
    const legivel = passadoLegivel(itens, cofre, CANAL, 9, leitor)
    // m2, its edit and its reaction stay out; the tombstone of an unknown target too (restricted channel).
    expect(legivel.map((i) => i.fonte!.seq)).toEqual([1])
  })

  it("sem categorias restritas, um alvo desconhecido passa", () => {
    const leitor = { podeLerSala: () => true, salasRestritas: false }
    expect(passadoLegivel(itens, cofre, CANAL, 9, leitor).map((i) => i.fonte!.seq)).toContain(5)
  })

  it("o inventário só tem resumos por balde, nunca contagens", () => {
    const inventario = inventarioDosMembros(passadoLegivel(itens, cofre, CANAL, 9, TODOS_LEEM))
    expect([...inventario.keys()]).toEqual([0])
    for (const h of inventario.values()) expect(h).toMatch(/^[0-9a-f]{16}$/)
    // The same keys in another order give the same hash.
    const invertido = inventarioDosMembros([...passadoLegivel(itens, cofre, CANAL, 9, TODOS_LEEM)].reverse())
    expect(invertido.get(0)).toBe(inventario.get(0))
  })
})

describe("quem lê uma sala", () => {
  const base = { sala: "secreta", categoria: "Direccao", rolesDaCategoria: ["chefe"], restritas: true, privilegiado: false, papeis: [] as string[] }
  it("LOW-02: uma sala desconhecida num canal com categorias restritas não se lê, a sala por omissão sim", () => {
    expect(leSala({ ...base, categoria: null })).toBe(false)
    expect(leSala({ ...base, sala: "", categoria: null })).toBe(true)
    expect(leSala({ ...base, categoria: null, restritas: false })).toBe(true)
  })
  it("categoria restrita: só o cargo ou quem tem privilégio", () => {
    expect(leSala(base)).toBe(false)
    expect(leSala({ ...base, papeis: ["chefe"] })).toBe(true)
    expect(leSala({ ...base, privilegiado: true })).toBe(true)
    expect(leSala({ ...base, rolesDaCategoria: [] })).toBe(true)
    expect(leSala({ ...base, categoria: "" })).toBe(true)
  })
})

describe("as páginas", () => {
  const ana = "@ana:casa.pt"
  const seqs = [1, 2, 2, 2, 3, 4, 300]
  const itens = seqs.map((seq, i) => item(entrada(seq, ana, { t: "message", id: `m${i}`, body: "x".repeat(10) })))

  it("nunca parte um seq entre duas páginas", () => {
    const primeira = escolherPagina(itens, 0, null, 2)
    expect(primeira.escolhidos.map((i) => i.fonte!.seq)).toEqual([1, 2, 2, 2])
    expect(primeira.fim).toBe(false)
    const segunda = escolherPagina(itens, 0, 2, 2)
    expect(segunda.escolhidos.map((i) => i.fonte!.seq)).toEqual([3, 4])
    expect(segunda.fim).toBe(true)
    // Another bucket is another bucket.
    expect(escolherPagina(itens, 1, null, 10).escolhidos.map((i) => i.fonte!.seq)).toEqual([300])
  })

  it("corta por bytes numa fronteira de seq, e o primeiro seq vai sempre", () => {
    const escolhidos = itens.slice(0, 6)
    const relatados = escolhidos.map((i): ItemRelatado => ({ s: i.fonte!.seq, a: ana, p: i.fonte!.payload as Record<string, unknown> }))
    const tamanho = JSON.stringify(relatados[0]).length + 1
    // Room for one and a half: the first `seq` goes, the three items of `seq` 2 wait for the next page.
    const cortada = cortarPorBytes(escolhidos, relatados, Math.floor(tamanho * 1.5))
    expect(cortada.cortada).toBe(true)
    expect(cortada.ate).toBe(1)
    // Room for two: the whole of `seq` 2 comes with it, never part of it.
    expect(cortarPorBytes(escolhidos, relatados, tamanho * 2).ate).toBe(2)
    expect(cortarPorBytes(escolhidos, relatados, 1).itens).toHaveLength(1)
    // An item that cannot be reported does not stop the cursor.
    const semUm = cortarPorBytes(escolhidos, [null, ...relatados.slice(1)], 1_000_000)
    expect(semUm.itens).toHaveLength(5)
    expect(semUm.ate).toBe(4)
  })

  it("history-last-100: a newest-first page takes the top of the bucket, and never splits a seq", () => {
    const primeira = choosePageNewestFirst(itens, 0, null, 2)
    expect(primeira.escolhidos.map((i) => i.fonte!.seq)).toEqual([3, 4])
    expect(primeira.fim).toBe(false)
    // Below 3, two items: the three of `seq` 2 come together.
    const segunda = choosePageNewestFirst(itens, 0, 3, 2)
    expect(segunda.escolhidos.map((i) => i.fonte!.seq)).toEqual([2, 2, 2])
    expect(segunda.fim).toBe(false)
    const terceira = choosePageNewestFirst(itens, 0, 2, 2)
    expect(terceira.escolhidos.map((i) => i.fonte!.seq)).toEqual([1])
    expect(terceira.fim).toBe(true)
    expect(choosePageNewestFirst(itens, 1, null, 10).escolhidos.map((i) => i.fonte!.seq)).toEqual([300])
  })

  it("history-last-100: a newest-first page cut by bytes keeps the newest seq, and says the lowest that went", () => {
    const escolhidos = itens.slice(0, 6)
    const relatados = escolhidos.map((i): ItemRelatado => ({ s: i.fonte!.seq, a: ana, p: i.fonte!.payload as Record<string, unknown> }))
    const tamanho = JSON.stringify(relatados[0]).length + 1
    const cortada = cutByBytesNewestFirst(escolhidos, relatados, Math.floor(tamanho * 2.5))
    expect(cortada.cortada).toBe(true)
    expect(cortada.itens.map((i) => i.s)).toEqual([3, 4])
    expect(cortada.ate).toBe(3)
    // The newest always goes, even past the bound.
    expect(cutByBytesNewestFirst(escolhidos, relatados, 1).itens.map((i) => i.s)).toEqual([4])
    expect(cutByBytesNewestFirst(escolhidos, relatados, 1_000_000)).toEqual({ itens: relatados, ate: 1, cortada: false })
  })
})

describe("o fio", () => {
  it("o primeiro byte é o de D2, e um cabeçalho estragado não passa", () => {
    const { embrulhar, desembrulhar } = _fioParaTestes
    const bytes = embrulhar({ v: 1, k: "mi", s: "s1", ap: "aparelho", para: "outro", x: "chave", l: 10 }, new Uint8Array([1, 2]))
    expect(bytes[0]).toBe(MAGIA_DOS_MEMBROS)
    expect(desembrulhar(bytes)?.cabecalho.l).toBe(10)
    const mau = embrulhar({ v: 1, k: "mi", s: "s1", ap: "aparelho", l: -1 } as never, new Uint8Array(0))
    expect(desembrulhar(mau)).toBeNull()
    const outroK = embrulhar({ v: 1, k: "zz", s: "s1", ap: "a" } as never, new Uint8Array(0))
    expect(desembrulhar(outroK)).toBeNull()
    expect(desembrulhar(new TextEncoder().encode('{"k":"r0"}'))).toBeNull()
  })
})

// ------------------------------------------------ two modules on one bus

interface Membro {
  nome: string
  modulo: HistoricoDosMembros
  address: string
  aparelho: string
  itens: ItemDoResumo[]
  entradas: StoredChatMessage[]
  responde: boolean
  /** The rooms this member's rules say each account may read. */
  podeLer: (quem: string, sala: string) => boolean
  recebidos: unknown[]
  enviadosPara: string[]
  /** Every signal this member put on the wire. */
  enviados: number
  assinar: (mensagem: Uint8Array) => Uint8Array
}

const CHAVE: ChaveDoSinal = { epoca: 7n, chave: new Uint8Array(32).fill(3) }

describe("dois membros e quem chegou", () => {
  const tectos = { ...TECTOS_DOS_MEMBROS }
  beforeAll(() => {
    Object.assign(TECTOS_DOS_MEMBROS, { primeiraVoltaMs: 0, passoMs: 20, esperaDoInventarioMs: 100, esperaDaRespostaMs: 100, itensPorPagina: 2 })
  })
  afterAll(() => {
    Object.assign(TECTOS_DOS_MEMBROS, tectos)
  })
  const ligados: HistoricoDosMembros[] = []
  afterEach(() => {
    for (const modulo of ligados.splice(0)) modulo.aoDesligar()
    _paraTestes.primeiro = null
    _paraTestes.adulterarPagina = null
  })

  function rede(): { membros: Membro[]; criar: (nome: string, entradas: StoredChatMessage[], lugar: number | null) => Membro } {
    const membros: Membro[] = []
    const folhas = (): Folha[] => membros.map((m, indice) => ({ indice, address: m.address, aparelho: m.aparelho }))
    const criar = (nome: string, entradas: StoredChatMessage[], lugar: number | null): Membro => {
      const identidade = generateIdentity(parseServerName("casa.pt"))
      const membro = {
        nome,
        address: identidade.address,
        aparelho: toBase64(identidade.deviceSigningPublicKey),
        entradas,
        itens: entradas.map(item),
        responde: true,
        podeLer: () => true,
        recebidos: [],
        enviadosPara: [],
        enviados: 0,
        assinar: (m: Uint8Array) => signWithDevice(identidade, m),
      } as unknown as Membro
      const porta: PortaDosMembros = {
        eu: () => ({ address: membro.address, aparelho: identidade.deviceSigningPublicKey, assinar: (m) => signWithDevice(identidade, m) }),
        conteudo: () => cofreCom(membro.entradas),
        canais: () => [CANAL],
        lugar: () => lugar,
        folhas,
        viva: () => true,
        derivarChave: async () => CHAVE,
        podeSinalizar: () => true,
        gastar: () => true,
        enviarSinal: (canal, sinal) => {
          const bytes = fromBase64(sinal)
          const aberto = abrirSinal(CHAVE, canal, bytes)!
          const para = _fioParaTestes.desembrulhar(aberto)?.cabecalho.para
          membro.enviados += 1
          if (para) membro.enviadosPara.push(para)
          for (const outro of membros) if (outro !== membro) void outro.modulo.aoSinalAberto(canal, membro.address, aberto, CHAVE.epoca)
        },
        arcaACorrer: () => false,
        responde: () => membro.responde,
        bloqueado: () => false,
        podeLerSala: (_canal, quem, sala) => membro.podeLer(quem, sala),
        salasRestritas: () => true,
        lines: () => membro.entradas.filter((e) => e.payload.t === "message").length,
        itens: () => membro.itens,
        relatar: async (_canal, itens) => itens.map((i) => ({ s: i.fonte!.seq, a: i.fonte!.autor, p: i.fonte!.payload as Record<string, unknown> })),
        receber: async (_canal, itens) => {
          let aplicados = 0
          const rooms: Record<string, number> = {}
          for (const bruto of itens) {
            const relatado = bruto as ItemRelatado
            if (relatado.p["body"] === "forjada") continue
            if (membro.entradas.some((e) => e.payload["id"] === relatado.p["id"] && e.payload.t === relatado.p["t"])) continue
            const nova = entrada(relatado.s, relatado.a, relatado.p)
            membro.entradas.push(nova)
            membro.itens.push(item(nova))
            membro.recebidos.push(bruto)
            aplicados += 1
            if (relatado.p["t"] === "message") {
              const room = typeof relatado.p["room"] === "string" ? relatado.p["room"] : ""
              rooms[room] = (rooms[room] ?? 0) + 1
            }
          }
          return { aplicados, recusados: {}, rooms }
        },
        gravar: (mudar) => mudar(estado),
        agora: () => Date.now(),
      }
      // The requester's vault state lives here (only `historicoDosMembros` is written).
      const estado = {} as VaultContents
      porta.conteudo = () => Object.assign(estado, cofreCom(membro.entradas))
      membro.modulo = new HistoricoDosMembros(porta)
      membro.modulo.aoLigar()
      ligados.push(membro.modulo)
      membros.push(membro)
      return membro
    }
    return { membros, criar }
  }

  const passado = (autor: string): StoredChatMessage[] => [
    entrada(1, autor, { t: "message", id: "a", body: "um" }),
    entrada(2, autor, { t: "message", id: "b", body: "dois" }),
    entrada(3, autor, { t: "message", id: "c", body: "fechada", room: "secreta" }),
    entrada(4, autor, { t: "message", id: "d", body: "quatro" }),
    entrada(5, autor, { t: "message", id: "e", body: "cinco" }),
  ]

  async function ate(predicado: () => boolean, prazoMs = 5_000): Promise<void> {
    const inicio = Date.now()
    while (!predicado()) {
      if (Date.now() - inicio > prazoMs) throw new Error("prazo")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  it("quem chega recebe o passado de um membro só, em páginas, sem a sala que não pode ler", async () => {
    const { criar } = rede()
    const ana = criar("Ana", [], null)
    ana.entradas.push(...passado(ana.address))
    ana.itens = ana.entradas.map(item)
    const carla = criar("Carla", [], 10)
    ana.podeLer = (quem, sala) => quem !== carla.address || sala !== "secreta"
    carla.modulo.pedirAgora()
    await ate(() => carla.recebidos.length === 4)
    // In `seq` order, as the vault places them: the pages come newest first (history-last-100).
    expect([...carla.entradas].sort((a, b) => a.seq - b.seq).map((e) => e.payload["body"])).toEqual(["um", "dois", "quatro", "cinco"])
    // Every request Carla sent went to one member.
    expect(new Set(carla.enviadosPara)).toEqual(new Set([ana.aparelho]))
    expect(carla.modulo.estatisticas.paginasRecebidas).toBeGreaterThan(1)
    expect(ana.modulo.estatisticas.sessoesServidas).toBe(1)
  })

  it("um membro da mesma conta não responde: o passado da conta é da Arca", async () => {
    const { criar } = rede()
    const carla = criar("Carla", [], 10)
    // A second module with Carla's address: same account, another device.
    const irma = criar("Irmã", passado(carla.address), null)
    irma.address = carla.address
    carla.modulo.pedirAgora()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(carla.recebidos).toHaveLength(0)
    expect(irma.modulo.estatisticas.sessoesServidas).toBe(0)
  })

  it("o primeiro membro calado: o segundo responde", async () => {
    const { criar } = rede()
    const ana = criar("Ana", [], null)
    ana.entradas.push(...passado(ana.address))
    ana.itens = ana.entradas.map(item)
    ana.responde = false
    const bruno = criar("Bruno", passado(ana.address), null)
    const carla = criar("Carla", [], 10)
    _paraTestes.primeiro = ana.address
    carla.modulo.pedirAgora()
    await ate(() => carla.recebidos.length === 5)
    expect(carla.modulo.estatisticas.semResposta).toBe(1)
    expect(bruno.modulo.estatisticas.paginasServidas).toBeGreaterThan(0)
  })

  it("um sinal com a assinatura de outro aparelho é largado", async () => {
    const { criar } = rede()
    const ana = criar("Ana", passado("@x:casa.pt"), null)
    const carla = criar("Carla", [], 10)
    const { embrulhar } = _fioParaTestes
    // Signed by nobody: a header that claims Carla's device, with a wrong signature.
    const falso = embrulhar({ v: 1, k: "mi", s: "s1", ap: carla.aparelho, para: ana.aparelho, x: toBase64(new Uint8Array(32).fill(9)), l: 10, as: toBase64(new Uint8Array(64)) }, new Uint8Array(0))
    await ana.modulo.aoSinalAberto(CANAL, carla.address, falso, CHAVE.epoca)
    expect(ana.modulo.estatisticas.ilegiveis).toBe(1)
    expect(ana.modulo.estatisticas.sessoesServidas).toBe(0)
  })

  /** A D2 signal written by hand, signed by `de`'s device: to speak as a peer without its logic. */
  function sinalDe(de: Membro, cabecalho: Record<string, unknown>, corpo = new Uint8Array(0)): Uint8Array {
    const { embrulhar, mensagemDoSinal } = _fioParaTestes
    const sem = { v: 1, ap: de.aparelho, ...cabecalho } as never
    const as = toBase64(de.assinar(mensagemDoSinal(CANAL, de.address, CHAVE.epoca, sem, corpo)))
    return embrulhar({ ...(sem as object), as } as never, corpo)
  }

  it("MED-01: o primeiro membro só tem parte do passado, e o segundo também é perguntado", async () => {
    const { criar } = rede()
    const autor = "@autor:casa.pt"
    const ana = criar("Ana", passado(autor).slice(0, 2), null)
    const bruno = criar("Bruno", passado(autor), null)
    const carla = criar("Carla", [], 10)
    _paraTestes.primeiro = ana.address
    carla.modulo.pedirAgora()
    await ate(() => carla.recebidos.length === 5)
    expect(ana.modulo.estatisticas.sessoesServidas).toBe(1)
    expect(bruno.modulo.estatisticas.sessoesServidas).toBe(1)
  })

  it("MED-02: um membro que declara o hash honesto e manda páginas vazias não fecha o balde", async () => {
    const { criar } = rede()
    const autor = "@autor:casa.pt"
    const ana = criar("Ana", passado(autor), null)
    const bruno = criar("Bruno", passado(autor), null)
    bruno.responde = false
    const carla = criar("Carla", [], 10)
    _paraTestes.adulterarPagina = (_canal, itens, quem) => (quem === ana.address ? [] : itens)
    _paraTestes.primeiro = ana.address
    carla.modulo.pedirAgora()
    await ate(() => ana.modulo.estatisticas.paginasServidas >= 3)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(carla.recebidos).toHaveLength(0)
    // An honest member later still brings the bucket.
    bruno.responde = true
    _paraTestes.primeiro = bruno.address
    carla.modulo.pedirAgora()
    await ate(() => carla.recebidos.length === 5)
  })

  it("MED-03: um mp sem para, ou de uma sessão que não existe, não tem resposta nenhuma", async () => {
    const { criar } = rede()
    const ana = criar("Ana", passado("@autor:casa.pt"), null)
    const carla = criar("Carla", [], null)
    await ana.modulo.aoSinalAberto(CANAL, carla.address, sinalDe(carla, { k: "mp", s: "nenhuma", id: "p1" }), CHAVE.epoca)
    await ana.modulo.aoSinalAberto(CANAL, carla.address, sinalDe(carla, { k: "mp", s: "nenhuma", id: "p2", para: ana.aparelho }), CHAVE.epoca)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ana.enviados).toBe(0)
  })

  it("MED-03 e LOW-05: um mi por aparelho a cada 30 s, e uma sessão repetida é ignorada", async () => {
    const { criar } = rede()
    const ana = criar("Ana", passado("@autor:casa.pt"), null)
    const carla = criar("Carla", [], null)
    const x = toBase64(new Uint8Array(32).fill(5))
    for (const s of ["s1", "s1", "s2"]) {
      await ana.modulo.aoSinalAberto(CANAL, carla.address, sinalDe(carla, { k: "mi", s, para: ana.aparelho, x, l: 10 }), CHAVE.epoca)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ana.modulo.estatisticas.sessoesServidas).toBe(1)
  })

  it("LOW-03: quem responde não serve um canal fora dos seus canais", async () => {
    const { criar } = rede()
    const ana = criar("Ana", passado("@autor:casa.pt"), null)
    const carla = criar("Carla", [], null)
    const x = toBase64(new Uint8Array(32).fill(5))
    const outro = "!directa:casa.pt"
    const { embrulhar, mensagemDoSinal } = _fioParaTestes
    const sem = { v: 1, k: "mi", s: "s9", ap: carla.aparelho, para: ana.aparelho, x, l: 10 } as never
    const as = toBase64(carla.assinar(mensagemDoSinal(outro, carla.address, CHAVE.epoca, sem, new Uint8Array(0))))
    await ana.modulo.aoSinalAberto(outro, carla.address, embrulhar({ ...(sem as object), as } as never, new Uint8Array(0)), CHAVE.epoca)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ana.modulo.estatisticas.sessoesServidas).toBe(0)
  })

  it("perguntar outra vez não traz nada repetido", async () => {
    const { criar } = rede()
    criar("Ana", passado("@ana:casa.pt"), null)
    const carla = criar("Carla", [], 10)
    carla.modulo.pedirAgora()
    await ate(() => carla.recebidos.length === 5)
    const paginas = carla.modulo.estatisticas.paginasRecebidas
    carla.modulo.pedirAgora()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(carla.recebidos).toHaveLength(5)
    // Same buckets, same hashes: no page asked again.
    expect(carla.modulo.estatisticas.paginasRecebidas).toBe(paginas)
  })

  describe("history-last-100: the newest lines on joining, the rest on demand", () => {
    const antes = { linesOnJoin: TECTOS_DOS_MEMBROS.linesOnJoin, linesPerLoad: TECTOS_DOS_MEMBROS.linesPerLoad, seqPorBalde: TECTOS_DOS_MEMBROS.seqPorBalde }
    beforeAll(() => {
      // Ten lines on joining, ten per "Load older", buckets of 8 `seq`: the pages cross buckets.
      Object.assign(TECTOS_DOS_MEMBROS, { linesOnJoin: 10, linesPerLoad: 10, seqPorBalde: 8, itensPorPagina: 4 })
    })
    afterAll(() => {
      Object.assign(TECTOS_DOS_MEMBROS, antes, { itensPorPagina: 2 })
    })
    const trinta = (autor: string): StoredChatMessage[] =>
      Array.from({ length: 30 }, (_, i) => entrada(i + 1, autor, { t: "message", id: `l${i + 1}`, body: `linha-${i + 1}` }))
    const seqsDe = (m: Membro): number[] => m.entradas.map((e) => e.seq).sort((a, b) => a - b)

    it("joining brings the newest ten lines and stops; each Load older brings the next ten, newest first", async () => {
      const { criar } = rede()
      criar("Ana", trinta("@ana:casa.pt"), null)
      const carla = criar("Carla", [], 40)
      carla.modulo.pedirAgora()
      await ate(() => carla.recebidos.length >= 10)
      // The clock goes on: nothing older comes by itself.
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(seqsDe(carla)).toEqual(Array.from({ length: 10 }, (_, i) => 21 + i))
      expect(carla.modulo.canaisATrazer()).toEqual([])
      expect(carla.modulo.hasOlder(CANAL)).toBe(true)

      const segunda = await carla.modulo.loadOlder(CANAL)
      expect(segunda).toEqual({ outcome: "loaded", lines: 10 })
      expect(seqsDe(carla)).toEqual(Array.from({ length: 20 }, (_, i) => 11 + i))
      const terceira = await carla.modulo.loadOlder(CANAL)
      expect(terceira.lines).toBe(10)
      expect(seqsDe(carla)).toEqual(Array.from({ length: 30 }, (_, i) => 1 + i))
      // The start: the next one says so, and nothing is asked twice.
      const paginas = carla.modulo.estatisticas.paginasRecebidas
      const fim = await carla.modulo.loadOlder(CANAL)
      expect(fim.outcome).toBe("end")
      expect(carla.modulo.hasOlder(CANAL)).toBe(false)
      expect(carla.recebidos).toHaveLength(30)
      expect(carla.modulo.estatisticas.paginasRecebidas).toBeLessThanOrEqual(paginas + 1)
    })

    it("Load older counts the lines of the room on screen", async () => {
      const { criar } = rede()
      const autor = "@ana:casa.pt"
      // Odd lines in "votos", even lines in the default room.
      criar("Ana", trinta(autor).map((e) => (e.seq % 2 ? { ...e, payload: { ...e.payload, room: "votos" } } : e)), null)
      const carla = criar("Carla", [], 40)
      carla.modulo.pedirAgora()
      await ate(() => carla.recebidos.length >= 10)
      const r = await carla.modulo.loadOlder(CANAL, "")
      expect(r.outcome).toBe("loaded")
      expect(r.lines).toBeGreaterThanOrEqual(10)
      const naSala = carla.entradas.filter((e) => e.payload["room"] === undefined)
      expect(naSala.length).toBeGreaterThanOrEqual(15)
    })

    it("with no member online, Load older says so", async () => {
      const { criar } = rede()
      // Carla alone on the bus: no other leaf is alive to ask.
      const carla = criar("Carla", [], 40)
      expect(await carla.modulo.loadOlder(CANAL)).toEqual({ outcome: "no-member", lines: 0 })
    })
  })
})
