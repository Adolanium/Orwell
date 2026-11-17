import { ed25519 } from "@noble/curves/ed25519.js"
import { toBase64, type Payload, type RelatosNoFio } from "@enclave/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { appendHistory, newVaultContents, type StoredPayload, type VaultContents } from "../vault.js"
import type { Folha } from "./eleicao.js"
import { TECTOS_DOS_ANEXOS } from "./instantaneo.js"
import { AntiEntropia, comAutoria, type PortaDaAntiEntropia } from "./pedido.js"
import type { QuemRelata } from "./relato.js"

/**
 * Asking for an image when the AUTHOR is online (12/11/2026).
 *
 * The report, with 1.3.7 in production: "the person who posted the image is
 * online, and it does not come through". In a large channel the request went
 * to the three lowest live leaves by tree index, whatever they held. The
 * vault keeps the bytes of only the 40 newest entries per room (and 4 MB in
 * all), so most members answer "I do not have it", and after three of those
 * the screen said "nobody connected has this image" with the author online,
 * never asked.
 *
 * An in-memory network like `instantaneo.test.ts`: no MLS and no server.
 */

const CANAL = "!sala-comum:orwell.test"
const CHAVE = { epoca: 1n, chave: new Uint8Array(32).fill(7) }
const IMAGEM = `data:image/png;base64,${"iVBORw0KGgo".repeat(40)}`
const MARCADOR = { evicted: true, name: "foto.png", mediaType: "image/png" }

interface No {
  nome: string
  eu: QuemRelata
  folha: Folha
  contents: VaultContents
  anti: AntiEntropia
}

class Rede {
  nos: No[] = []
  /** Connected leaves: only these receive, and only their accounts count as online. */
  ligados = new Set<No>()
  /** Connected, but not listening (a page that reloads, a frozen tab): receives nothing. */
  surdos = new Set<No>()
  seq = 1_000
  emVoo = 0

  criar(nome: string, indice: number, address = `@${nome}:orwell.test`): No {
    const privada = new Uint8Array(32).fill(indice + 1)
    const eu: QuemRelata = { address, aparelho: ed25519.getPublicKey(privada), assinar: (m) => ed25519.sign(m, privada) }
    const contents = newVaultContents()
    const folha: Folha = { indice, address, aparelho: toBase64(eu.aparelho) }
    const rede = this
    const porta: PortaDaAntiEntropia = {
      eu,
      conteudo: () => contents,
      podeSinalizar: () => true,
      elegivel: () => true,
      ehDirecta: () => false,
      membros: () => [...new Set(rede.nos.map((n) => n.eu.address))],
      folhas: () => rede.nos.map((n) => n.folha),
      epocaAtual: () => 1n,
      derivarChave: async () => CHAVE,
      lugar: () => -1,
      ancora: () => rede.seq,
      enviarSinal: (_canal, sinal) => rede.#entregar(no, (outro) => outro.anti.aoSinal({ channel: CANAL, from: address, sinal })),
      enviarRelatos: async (_canal, relatos: RelatosNoFio) => {
        const seq = ++rede.seq
        rede.#entregar(no, (outro) => outro.anti.aoRelatos(CANAL, seq, structuredClone(relatos), folha.aparelho))
      },
      gravarRelatado: (_canal, seq, autor, payload: Payload) => {
        appendHistory(contents, CANAL, { seq, sender: autor, at: 0, payload: payload as unknown as StoredPayload })
      },
      escoar: async () => {},
      marcarParaGravar: () => {},
      aparelhoConfiavel: async (_canal, autor, aparelho) => rede.nos.some((n) => n.eu.address === autor && n.folha.aparelho === aparelho),
      cadeiaDe: () => null,
      bloqueado: () => false,
      // Account presence, as the server tells it: any device of the account connected.
      online: (endereco) => [...rede.ligados].some((n) => n.eu.address === endereco),
      agora: () => Date.now(),
      gravarAnexo: async () => {},
    }
    const no: No = { nome, eu, folha, contents, anti: new AntiEntropia(porta) }
    this.nos.push(no)
    this.ligados.add(no)
    return no
  }

  #entregar(de: No, fazer: (outro: No) => Promise<void>): void {
    for (const outro of this.nos) {
      if (outro === de || !this.ligados.has(outro) || this.surdos.has(outro)) continue
      this.emVoo += 1
      setTimeout(() => {
        void fazer(outro).finally(() => {
          this.emVoo -= 1
        })
      }, 1)
    }
  }
}

/**
 * A channel with `semBytes` members at the LOWEST leaves, all holding only the
 * marker (the vault dumped the bytes), the author's leaf after them with the
 * bytes, and then whoever asks. Everyone has announced the capability.
 */
function salaGrande(semBytes: number): { rede: Rede; autor: No; quemPede: No; outros: No[]; mensagem: Record<string, unknown> } {
  const rede = new Rede()
  const outros = Array.from({ length: semBytes }, (_, i) => rede.criar(`membro${i}`, i))
  const autor = rede.criar("autor", semBytes)
  const quemPede = rede.criar("dono", semBytes + 1)
  const mensagem = comAutoria(
    CANAL,
    { t: "message", id: "msg-foto-000000", sentAt: 300, body: "olhem", attachments: [{ name: "foto.png", mediaType: "image/png", byteLength: 300, inline: IMAGEM }] } as never,
    autor.eu,
  ) as unknown as Record<string, unknown>
  guardar(autor, mensagem, true)
  for (const no of [...outros, quemPede]) guardar(no, mensagem, false)
  for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])
  return { rede, autor, quemPede, outros, mensagem }
}

/** Store the message in `no`'s vault, with the bytes or with the dump marker. */
function guardar(no: No, mensagem: Record<string, unknown>, comBytes: boolean): void {
  const payload = comBytes ? mensagem : { ...mensagem, attachments: [MARCADOR] }
  appendHistory(no.contents, CANAL, { seq: 300, sender: AUTOR, at: 300, payload: structuredClone(payload) as StoredPayload })
}

const AUTOR = "@autor:orwell.test"

const ORIGINAIS = { ...TECTOS_DOS_ANEXOS }
afterEach(() => {
  Object.assign(TECTOS_DOS_ANEXOS, ORIGINAIS)
})

describe("o autor está ligado e tem a imagem", () => {
  it("numa sala grande, com seis folhas vivas sem bytes antes da dele, a imagem chega pelo autor", async () => {
    const { autor, quemPede } = salaGrande(6)
    const inicio = Date.now()
    const desfecho = await quemPede.anti.pedirAnexo(CANAL, "msg-foto-000000", 0)
    expect(desfecho).toMatchObject({ ok: true })
    if (desfecho.ok) expect(desfecho.anexo["inline"]).toBe(IMAGEM)
    expect(autor.anti.estatisticas.anexosEnviados).toBe(1)
    // Asked first: no round of "I do not have it" before.
    expect(Date.now() - inicio).toBeLessThan(2_000)
  })

  it("o autor enviou do telemóvel, que tem os bytes; o computador dele não: chega pelo telemóvel", async () => {
    const rede = new Rede()
    const outros = Array.from({ length: 4 }, (_, i) => rede.criar(`membro${i}`, i))
    const computador = rede.criar("autor-pc", 4, "@autor:orwell.test")
    const telemovel = rede.criar("autor-tlm", 9, "@autor:orwell.test")
    const quemPede = rede.criar("dono", 10)
    const mensagem = comAutoria(
      CANAL,
      { t: "message", id: "msg-foto-000000", sentAt: 300, body: "olhem", attachments: [{ name: "foto.png", mediaType: "image/png", byteLength: 300, inline: IMAGEM }] } as never,
      telemovel.eu,
    ) as unknown as Record<string, unknown>
    guardar(telemovel, mensagem, true)
    for (const no of [...outros, computador, quemPede]) guardar(no, mensagem, false)
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])
    const desfecho = await quemPede.anti.pedirAnexo(CANAL, "msg-foto-000000", 0)
    expect(desfecho).toMatchObject({ ok: true })
    expect(telemovel.anti.estatisticas.anexosEnviados).toBe(1)
  })

  it("um segundo membro pede a mesma imagem logo a seguir, e não ouviu a primeira resposta: o autor serve-o outra vez", async () => {
    const { rede, autor, quemPede } = salaGrande(4)
    const segundo = rede.criar("segundo", 20)
    guardar(segundo, autorMensagem(quemPede), false)
    for (const no of rede.nos) no.anti.notarCapacidades(CANAL, segundo.folha.aparelho, ["sincronia-v1"])
    for (const no of rede.nos) segundo.anti.notarCapacidades(CANAL, no.folha.aparelho, ["sincronia-v1"])
    // The second one is reloading while the first one is served.
    rede.surdos.add(segundo)
    expect(await quemPede.anti.pedirAnexo(CANAL, "msg-foto-000000", 0)).toMatchObject({ ok: true })
    rede.surdos.delete(segundo)
    const desfecho = await segundo.anti.pedirAnexo(CANAL, "msg-foto-000000", 0)
    expect(desfecho).toMatchObject({ ok: true })
    expect(autor.anti.estatisticas.anexosEnviados).toBe(2)
  })

  it("quem ouviu a resposta dada a outro fica com a imagem: abrir depois não pede nada", async () => {
    const { rede, autor, quemPede } = salaGrande(4)
    const segundo = rede.criar("segundo", 20)
    guardar(segundo, autorMensagem(quemPede), false)
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])
    expect(await quemPede.anti.pedirAnexo(CANAL, "msg-foto-000000", 0)).toMatchObject({ ok: true })
    await ateSilencio(rede)
    const desfecho = await segundo.anti.pedirAnexo(CANAL, "msg-foto-000000", 0)
    expect(desfecho).toMatchObject({ ok: true })
    expect(autor.anti.estatisticas.anexosEnviados).toBe(1)
  })

  it("quem descarregou serve os outros, mesmo depois de o cofre despejar os bytes", async () => {
    const { rede, autor, quemPede, outros } = salaGrande(2)
    // The other two do not hear the answer: only the owner downloads it.
    for (const no of outros) rede.surdos.add(no)
    expect(await quemPede.anti.pedirAnexo(CANAL, "msg-foto-000000", 0)).toMatchObject({ ok: true })
    for (const no of outros) rede.surdos.delete(no)
    // The author leaves; a third member, who was not there, asks.
    rede.ligados.delete(autor)
    const terceiro = rede.criar("terceiro", 30)
    guardar(terceiro, autorMensagem(quemPede), false)
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])
    const desfecho = await terceiro.anti.pedirAnexo(CANAL, "msg-foto-000000", 0)
    expect(desfecho).toMatchObject({ ok: true })
    expect(quemPede.anti.estatisticas.anexosEnviados).toBe(1)
  })
})

describe("ninguém ligado tem a imagem: a mensagem diz a verdade", () => {
  it("o autor está desligado: o desfecho diz que quem enviou não está ligado", async () => {
    const { rede, autor, quemPede } = salaGrande(3)
    rede.ligados.delete(autor)
    const desfecho = await quemPede.anti.pedirAnexo(CANAL, "msg-foto-000000", 0)
    expect(desfecho).toEqual({ ok: false, motivo: "ninguem", autorLigado: false, autor: AUTOR })
  })

  it("o autor está ligado mas também já não tem os bytes: o desfecho diz que ninguém ligado a tem", async () => {
    const { autor, quemPede, mensagem } = salaGrande(3)
    autor.contents.history[CANAL] = []
    guardar(autor, mensagem, false)
    const desfecho = await quemPede.anti.pedirAnexo(CANAL, "msg-foto-000000", 0)
    expect(desfecho).toEqual({ ok: false, motivo: "ninguem", autorLigado: true, autor: AUTOR })
  })

  it("numa sala de 40 folhas vivas sem bytes, o pedido acaba depressa e pergunta a poucas", async () => {
    const { rede, autor, quemPede, outros } = salaGrande(40)
    rede.ligados.delete(autor)
    const inicio = Date.now()
    const desfecho = await quemPede.anti.pedirAnexo(CANAL, "msg-foto-000000", 0)
    expect(desfecho).toMatchObject({ ok: false, motivo: "ninguem" })
    // Quick "no" answers only: far below one 30 s silence.
    expect(Date.now() - inicio).toBeLessThan(10_000)
    // One `pa` per leaf asked: at most `folhasPorPedido`, never the 40.
    expect(outros.length).toBe(40)
    expect(quemPede.anti.estatisticas.sinaisEnviados).toBe(TECTOS_DOS_ANEXOS.folhasPorPedido)
  }, 30_000)
})

function autorMensagem(no: No): Record<string, unknown> {
  return no.contents.history[CANAL]!.find((e) => e.payload["id"] === "msg-foto-000000")!.payload as unknown as Record<string, unknown>
}

async function ateSilencio(rede: Rede, ms = 4_000): Promise<void> {
  const inicio = Date.now()
  let calmo = 0
  while (Date.now() - inicio < ms) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    calmo = rede.emVoo === 0 ? calmo + 1 : 0
    if (calmo >= 15) return
  }
}
