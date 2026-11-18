import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../types.js"
import { listarVotacoes, salasDaPagina } from "./listarVotacoes.js"

let seq = 0
function votacao(id: string, room: string | undefined, sentAt: number, pergunta = `P ${id}`): ChatMessage {
  return {
    channel: "c",
    seq: seq++,
    sender: "@ana:s",
    payload: {
      t: "message",
      id,
      sentAt,
      body: pergunta,
      poll: { question: pergunta, options: ["Sim", "Não"] },
      ...(room === undefined ? {} : { room }),
    },
  } as ChatMessage
}
function voto(alvo: string, quem: string, opcao: number, at = 1): ChatMessage {
  return {
    channel: "c",
    seq: seq++,
    sender: quem,
    payload: { t: "post.reaction", id: `v-${seq}`, target: alvo, emoji: "", vote: opcao, at },
  } as ChatMessage
}
function apagar(alvo: string): ChatMessage {
  return { channel: "c", seq: seq++, sender: "@ana:s", payload: { t: "redact", id: `r-${seq}`, target: alvo } } as ChatMessage
}

const SALAS = salasDaPagina({
  abertas: [
    { room: "geral", name: "Geral", kind: "text" },
    { room: "voz", name: "Voz", kind: "voice" },
  ],
  fechadas: [
    { room: "velha", name: "Velha", kind: "text", category: "" },
    { room: "secreta", name: "Secreta", kind: "text", category: "chefia" },
  ],
  categorias: [{ category: "chefia", roles: ["admin"] }],
  quemVe: { papeis: [], administra: false },
  nomeDaSalaPorOmissao: "Principal",
})
const EXISTENTES = new Set(["geral", "voz", "velha", "secreta", "escondida"])

function lista(messages: ChatMessage[]): ReturnType<typeof listarVotacoes> {
  return listarVotacoes({ messages, channel: "c", eu: "@bia:s", existentes: EXISTENTES, salas: SALAS, modera: () => false })
}

describe("salasDaPagina", () => {
  it("a sala por omissão está sempre; voz fica de fora; sala fechada de categoria escondida não aparece", () => {
    expect(SALAS.map((s) => [s.room, s.fechada])).toEqual([
      ["", false],
      ["geral", false],
      ["velha", true],
    ])
  })

  it("quem administra vê também as salas fechadas das categorias restritas", () => {
    const salas = salasDaPagina({
      abertas: [],
      fechadas: [{ room: "secreta", name: "Secreta", kind: "text", category: "chefia" }],
      categorias: [{ category: "chefia", roles: ["admin"] }],
      quemVe: { papeis: [], administra: true },
      nomeDaSalaPorOmissao: "Principal",
    })
    expect(salas.some((s) => s.room === "secreta")).toBe(true)
  })
})

describe("listarVotacoes", () => {
  it("ordena da mais recente para a mais antiga e conta os votos", () => {
    const resultado = lista([
      votacao("a", "geral", 100),
      votacao("b", "geral", 200),
      voto("a", "@carlos:s", 0),
      voto("a", "@bia:s", 1),
    ])
    expect(resultado.map((v) => v.id)).toEqual(["b", "a"])
    expect(resultado[1]?.apuramento.total).toBe(2)
    expect(resultado[1]?.apuramento.minha).toBe(1)
  })

  it("não mostra votações de salas que a pessoa não vê, e não as despeja na sala por omissão", () => {
    const resultado = lista([votacao("x", "secreta", 1), votacao("y", "escondida", 2), votacao("z", "geral", 3)])
    expect(resultado.map((v) => v.id)).toEqual(["z"])
  })

  it("a sala que já não existe lê-se na sala por omissão, como na conversa", () => {
    const resultado = lista([votacao("a", "apagada", 1), votacao("b", undefined, 2)])
    expect(resultado.map((v) => [v.id, v.room])).toEqual([
      ["b", ""],
      ["a", ""],
    ])
  })

  it("a votação de uma sala fechada continua aberta: o fecho é o da votação", () => {
    const resultado = lista([votacao("a", "velha", 1), votacao("b", "geral", 2)])
    expect(resultado.map((v) => [v.id, v.fechoEm])).toEqual([
      ["b", null],
      ["a", null],
    ])
  })

  it("traz o prazo de quem a criou como instante de fecho", () => {
    const comPrazo = votacao("p", "geral", 1)
    comPrazo.payload.poll = { question: "P p", options: ["Sim", "Não"], closesAt: 5000 }
    expect(lista([comPrazo])[0]?.fechoEm).toBe(5000)
  })

  it("quem a criou fecha-a antes do prazo; um membro qualquer não; quem modera sim", () => {
    const comPrazo = votacao("p", "geral", 1)
    comPrazo.payload.poll = { question: "P p", options: ["Sim", "Não"], closesAt: 9000 }
    const fecho = (sender: string, at: number): ChatMessage =>
      ({ channel: "c", seq: seq++, sender, payload: { t: "edit", id: `e${seq}`, target: "p", editedAt: at, body: "P p", closePoll: true } }) as ChatMessage
    const com = (extra: ChatMessage[], modera = (_: string) => false) =>
      listarVotacoes({ messages: [comPrazo, ...extra], channel: "c", eu: null, existentes: EXISTENTES, salas: SALAS, modera })[0]?.fechoEm
    expect(com([fecho("@ana:s", 3000)])).toBe(3000)
    expect(com([fecho("@intruso:s", 3000)])).toBe(9000)
    expect(com([fecho("@chefe:s", 2000)], (quem) => quem === "@chefe:s")).toBe(2000)
  })

  it("um voto carimbado depois do fecho não conta, mesmo chegando antes", () => {
    const comPrazo = votacao("p", "geral", 1)
    comPrazo.payload.poll = { question: "P p", options: ["Sim", "Não"], closesAt: 100 }
    const [v] = lista([comPrazo, voto("p", "@carlos:s", 0, 50), voto("p", "@dora:s", 1, 101)])
    expect(v?.apuramento.total).toBe(1)
    expect(v?.apuramento.porOpcao[0]).toEqual(["@carlos:s"])
  })

  it("uma votação apagada pelo autor sai da lista", () => {
    expect(lista([votacao("a", "geral", 1), apagar("a")])).toEqual([])
  })

  /*
    Deleting a poll (1.3.21) is the message tombstone, and the page already folds it
    with the same rule as the conversation (`comEmendas`): checked here, not rewritten.
  */
  it("uma votação eliminada por quem modera sai da lista; a lápide de um membro qualquer não a tira", () => {
    const deOutro = (alvo: string, quem: string): ChatMessage =>
      ({ channel: "c", seq: seq++, sender: quem, payload: { t: "redact", id: `r-${seq}`, target: alvo } }) as ChatMessage
    const mensagens = [votacao("a", "geral", 1), deOutro("a", "@mod:s")]
    const comModeracao = listarVotacoes({
      messages: mensagens,
      channel: "c",
      eu: "@bia:s",
      existentes: EXISTENTES,
      salas: SALAS,
      modera: (quem) => quem === "@mod:s",
    })
    expect(comModeracao).toEqual([])
    expect(lista([votacao("b", "geral", 1), deOutro("b", "@qualquer:s")]).map((v) => v.id)).toEqual(["b"])
  })

  it("uma votação que chega sem `poll` (sem o poder de criar, 1.3.21) não entra na página", () => {
    const semPoder = { channel: "c", seq: seq++, sender: "@carlos:s", payload: { t: "message", id: "x", sentAt: 1, body: "P x\n1. Sim\n2. Não", room: "geral" } } as ChatMessage
    expect(lista([semPoder, voto("x", "@dora:s", 0)])).toEqual([])
  })
})
