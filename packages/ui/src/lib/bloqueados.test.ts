import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../types.js"
import { blocosOcultos, deQuemBloqueei, semBloqueados } from "./bloqueados.js"

const EU = "@eu:s"
const RUI = "@rui:s"
const ZE = "@ze:s"
const ANA = "@ana:s"
const BLOQUEADOS = new Set([RUI, ZE])

const DIA = new Date(2026, 10, 20, 12).getTime()
let seq = 0
const m = (sender: string, sentAt = DIA): ChatMessage => {
  seq += 1
  return { channel: "!c:s", seq, sender, payload: { t: "message", id: `m${seq}`, sentAt } }
}
const chave = (message: ChatMessage): string => message.payload.id ?? ""
const oculta = (message: ChatMessage): boolean => deQuemBloqueei(message, EU, BLOQUEADOS)

describe("deQuemBloqueei e semBloqueados", () => {
  it("as minhas nunca, mesmo com o meu endereço na lista", () => {
    expect(deQuemBloqueei(m(EU), EU, new Set([EU]))).toBe(false)
    expect(deQuemBloqueei(m(RUI), EU, BLOQUEADOS)).toBe(true)
  })

  it("sem ninguém a sair, devolve a mesma lista", () => {
    const lista = [m(ANA), m(EU)]
    expect(semBloqueados(lista, EU, BLOQUEADOS)).toBe(lista)
    expect(semBloqueados(lista, EU, new Set())).toBe(lista)
    const comRui = [...lista, m(RUI)]
    expect(semBloqueados(comRui, EU, BLOQUEADOS)).toEqual(lista)
  })
})

describe("blocosOcultos", () => {
  it("seguidas da mesma pessoa são um bloco; outra pessoa, ou alguém visível, abre outro", () => {
    const lista = [m(ANA), m(RUI), m(RUI), m(ZE), m(ANA), m(RUI)]
    const blocos = blocosOcultos(lista, oculta, chave)
    expect(blocos[0]).toBeNull()
    expect(blocos[1]).toEqual({ quantas: 2, chaves: [chave(lista[1]!), chave(lista[2]!)] })
    expect(blocos[2]).toBe("dentro")
    expect(blocos[3]).toEqual({ quantas: 1, chaves: [chave(lista[3]!)] })
    expect(blocos[4]).toBeNull()
    expect(blocos[5]).toEqual({ quantas: 1, chaves: [chave(lista[5]!)] })
  })

  it("um dia novo abre outro bloco, para o título do dia ficar por cima", () => {
    const lista = [m(RUI, DIA), m(RUI, DIA + 24 * 3_600_000)]
    const blocos = blocosOcultos(lista, oculta, chave)
    expect(blocos[0]).toEqual({ quantas: 1, chaves: [chave(lista[0]!)] })
    expect(blocos[1]).toEqual({ quantas: 1, chaves: [chave(lista[1]!)] })
  })
})
