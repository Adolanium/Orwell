import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  frequentes,
  lembrarEmoji,
  lerRapidas,
  RAPIDAS_POR_OMISSAO,
  rapidasEfectivas,
  registarUso,
  USOS_MAX,
  type UsoDeEmoji,
} from "./emojiFrequentes.js"
import { PREFS_KEY, readPrefs } from "../hooks/usePrefs.js"

const DIA = 86_400_000
const AGORA = 1_763_000_000_000

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe("registarUso", () => {
  it("conta cada uso e guarda a hora do último", () => {
    let usos: UsoDeEmoji[] = []
    usos = registarUso(usos, "👍", AGORA)
    usos = registarUso(usos, "👍", AGORA + 10)
    usos = registarUso(usos, "🎉", AGORA + 20)
    expect(usos).toEqual([
      { e: "👍", n: 2, t: AGORA + 10 },
      { e: "🎉", n: 1, t: AGORA + 20 },
    ])
  })

  it("não passa do tecto, e quem sai é o que vale menos", () => {
    let usos: UsoDeEmoji[] = [{ e: "👍", n: 50, t: AGORA }]
    for (let i = 0; i < USOS_MAX + 5; i++) usos = registarUso(usos, String.fromCodePoint(0x1f600 + i), AGORA + i)
    expect(usos.length).toBe(USOS_MAX)
    expect(usos.some((uso) => uso.e === "👍")).toBe(true)
    expect(usos.some((uso) => uso.e === "😀")).toBe(false)
  })
})

describe("frequentes", () => {
  it("ordena pela frequência, e o mais usado vem primeiro", () => {
    const usos = [
      { e: "🎉", n: 1, t: AGORA },
      { e: "👍", n: 9, t: AGORA - DIA },
      { e: "❤️", n: 3, t: AGORA },
    ]
    expect(frequentes(usos, [], AGORA)).toEqual(["👍", "❤️", "🎉"])
  })

  it("o que não se usa há semanas perde para o que se usa agora", () => {
    const usos = [
      { e: "👍", n: 8, t: AGORA - 60 * DIA },
      { e: "🔥", n: 2, t: AGORA },
    ]
    expect(frequentes(usos, [], AGORA)[0]).toBe("🔥")
  })

  it("sem contagens ainda, usa os recentes que já estavam no aparelho, pela mesma ordem", () => {
    expect(frequentes([], ["🌻", "☕"], AGORA)).toEqual(["🌻", "☕"])
  })

  it("respeita o limite", () => {
    const usos = ["a", "b", "c", "d"].map((e, i) => ({ e, n: i + 1, t: AGORA }))
    expect(frequentes(usos, [], AGORA, 2)).toEqual(["d", "c"])
  })
})

describe("rapidasEfectivas", () => {
  it("sem escolha nem uso, dá as três de fábrica", () => {
    expect(rapidasEfectivas([], [])).toEqual([...RAPIDAS_POR_OMISSAO])
  })

  it("sem escolha, dá as três mais usadas", () => {
    expect(rapidasEfectivas([], ["🔥", "👀", "🙏", "🎉"])).toEqual(["🔥", "👀", "🙏"])
  })

  it("com menos de três usadas, completa com as de fábrica, sem repetir", () => {
    expect(rapidasEfectivas([], ["❤️"])).toEqual(["❤️", "👍", "😂"])
  })

  it("a escolha da pessoa ganha, casa a casa; uma casa vazia vai às mais usadas", () => {
    expect(rapidasEfectivas(["🐈", "", "🍺"], ["🔥", "🐈"])).toEqual(["🐈", "🔥", "🍺"])
  })
})

describe("lembrarEmoji e lerRapidas", () => {
  it("guarda o uso nas preferências e mantém os recentes antigos em dia", () => {
    lembrarEmoji("🌻", AGORA)
    lembrarEmoji("☕", AGORA + 1)
    lembrarEmoji("🌻", AGORA + 2)
    const prefs = readPrefs()
    expect(prefs.emojiRecents).toEqual(["🌻", "☕"])
    expect(prefs.emojiUsos).toEqual([
      { e: "🌻", n: 2, t: AGORA + 2 },
      { e: "☕", n: 1, t: AGORA + 1 },
    ])
  })

  it("as rápidas seguem o que se usa, e a identidade só muda quando a lista muda", () => {
    const antes = lerRapidas()
    expect(antes).toEqual([...RAPIDAS_POR_OMISSAO])
    expect(lerRapidas()).toBe(antes)
    lembrarEmoji("🔥")
    const depois = lerRapidas()
    expect(depois[0]).toBe("🔥")
    expect(lerRapidas()).toBe(depois)
  })

  it("lê as escolhidas nas Definições, e deita fora o que não é emoji", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ reaccoesRapidas: ["🐈", 7, "uma frase muito comprida que não é emoji nenhum"] }))
    expect(readPrefs().reaccoesRapidas).toEqual(["🐈", "", ""])
    expect(lerRapidas()[0]).toBe("🐈")
  })
})
