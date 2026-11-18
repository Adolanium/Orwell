import { describe, expect, it } from "vitest"
import { dobrarReaccoes, type EntradaDeDobra } from "./dobras.js"

const ANA = "@ana:x"
const BRUNO = "@bruno:x"
const CARLA = "@carla:x"

type E = EntradaDeDobra & { payload: { t: string } & Record<string, unknown> }

const r = (seq: number, sender: string, target: string, emoji: string, remove = false, extra: Partial<E> = {}): E => ({
  seq,
  sender,
  payload: { t: "reaction", target, emoji, remove },
  ...extra,
})

/** Shuffle with a fixed seed, to make the test repeatable. */
function baralhar<T>(lista: readonly T[], semente: number): T[] {
  const copia = [...lista]
  let s = semente
  for (let i = copia.length - 1; i > 0; i--) {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648
    const j = s % (i + 1)
    ;[copia[i], copia[j]] = [copia[j] as T, copia[i] as T]
  }
  return copia
}

describe("dobrarReaccoes", () => {
  it("conta cada pessoa uma vez e marca a minha", () => {
    const fichas = dobrarReaccoes(
      [r(1, ANA, "m1", "👍"), r(2, BRUNO, "m1", "👍"), r(3, CARLA, "m1", "❤️"), r(4, ANA, "m1", "👍")],
      ANA,
    )
    expect(fichas.get("m1")).toEqual([
      { emoji: "👍", quem: [ANA, BRUNO], minha: true },
      { emoji: "❤️", quem: [CARLA], minha: false },
    ])
  })

  it("uma reacção por pessoa: outro emoji troca a anterior", () => {
    const fichas = dobrarReaccoes([r(1, ANA, "m1", "👍"), r(2, BRUNO, "m1", "👍"), r(3, ANA, "m1", "🎉")], ANA)
    expect(fichas.get("m1")).toEqual([
      { emoji: "👍", quem: [BRUNO], minha: false },
      { emoji: "🎉", quem: [ANA], minha: true },
    ])
  })

  it("retirar outro emoji que não o actual não tira nada; retirar o actual tira a pessoa", () => {
    // How this client switches: the new one first, then the removal of the old one.
    const troca = [r(1, ANA, "m1", "👍"), r(2, ANA, "m1", "🎉"), r(3, ANA, "m1", "👍", true)]
    expect(dobrarReaccoes(troca, ANA).get("m1")).toEqual([{ emoji: "🎉", quem: [ANA], minha: true }])
    expect(dobrarReaccoes([...troca, r(4, ANA, "m1", "🎉", true)], ANA).has("m1")).toBe(false)
  })

  it("um cliente antigo com duas reacções conta uma só, a mais recente", () => {
    // 1.3.7 to 1.3.19 keep one reaction per emoji: two presses with no removal.
    const fichas = dobrarReaccoes([r(1, BRUNO, "m1", "👍"), r(2, BRUNO, "m1", "❤️"), r(3, CARLA, "m1", "👍")], null)
    expect(fichas.get("m1")).toEqual([
      { emoji: "👍", quem: [CARLA], minha: false },
      { emoji: "❤️", quem: [BRUNO], minha: false },
    ])
  })

  it("uma rajada da mesma pessoa acaba na última pela ordem do servidor, seja qual for a ordem de chegada", () => {
    const emojis = ["👍", "❤️", "😂", "🎉", "🔥", "👀", "🙏", "😮"]
    const rajada = emojis.map((emoji, i) => r(i + 1, ANA, "m1", emoji))
    // Half of the old ones taken back (how this client switches), half not (how an old client left them).
    const remocoes = emojis.slice(0, 4).map((emoji, i) => r(20 + i, ANA, "m1", emoji, true))
    const esperado = [{ emoji: "😮", quem: [ANA], minha: true }]
    for (let semente = 1; semente < 30; semente++) {
      const fichas = dobrarReaccoes(baralhar([...rajada, ...remocoes, r(5, BRUNO, "m1", "🎉")], semente), ANA)
      expect(fichas.get("m1")?.filter((ficha) => ficha.minha)).toEqual(esperado)
      expect(fichas.get("m1")?.reduce((soma, ficha) => soma + ficha.quem.length, 0)).toBe(2)
    }
  })

  it("retirar tira a pessoa, e a ficha sem ninguém desaparece", () => {
    const fichas = dobrarReaccoes([r(1, ANA, "m1", "👍"), r(2, BRUNO, "m1", "😀"), r(3, ANA, "m1", "👍", true)], ANA)
    expect(fichas.get("m1")).toEqual([{ emoji: "😀", quem: [BRUNO], minha: false }])
    const so = dobrarReaccoes([r(1, ANA, "m1", "👍"), r(2, ANA, "m1", "👍", true)], ANA)
    expect(so.has("m1")).toBe(false)
  })

  it("vale o último acto de cada pessoa pela ordem do servidor, seja qual for a ordem de chegada", () => {
    const entradas = [
      r(1, ANA, "m1", "👍"),
      r(5, ANA, "m1", "👍", true),
      r(9, ANA, "m1", "👍"),
      r(2, BRUNO, "m1", "👍"),
      r(7, BRUNO, "m1", "👍", true),
      r(3, CARLA, "m2", "🎉"),
    ]
    const esperado = dobrarReaccoes(entradas, BRUNO)
    expect(esperado.get("m1")).toEqual([{ emoji: "👍", quem: [ANA], minha: false }])
    for (let semente = 1; semente < 30; semente++) {
      expect(dobrarReaccoes(baralhar(entradas, semente), BRUNO)).toEqual(esperado)
    }
  })

  it("um envio meu sem eco conta depois do que já vi", () => {
    // Pressed at seq 4, taken back before the echo: the removal without `seq` comes after.
    const fichas = dobrarReaccoes([r(4, ANA, "m1", "👍"), r(-1, ANA, "m1", "👍", true, { apos: 4 })], ANA)
    expect(fichas.has("m1")).toBe(false)
  })

  it("o mesmo acto duas vezes (cofre e rede) é um só", () => {
    const fichas = dobrarReaccoes([r(3, ANA, "m1", "👍"), r(3, ANA, "m1", "👍")], null)
    expect(fichas.get("m1")).toEqual([{ emoji: "👍", quem: [ANA], minha: false }])
  })

  it("ignora o que não é reacção de conversa e emojis vazios", () => {
    const fichas = dobrarReaccoes(
      [
        r(1, ANA, "m1", ""),
        { seq: 2, sender: ANA, payload: { t: "post.reaction", id: "x", target: "m1", emoji: "👍", at: 1, remove: false } },
        { seq: 3, sender: ANA, payload: { t: "reaction", emoji: "👍" } },
      ],
      ANA,
    )
    expect(fichas.size).toBe(0)
  })

  it("as fichas ficam pela ordem em que o emoji apareceu", () => {
    const fichas = dobrarReaccoes([r(1, ANA, "m1", "🎉"), r(2, BRUNO, "m1", "👍"), r(3, CARLA, "m1", "🎉")], null)
    expect(fichas.get("m1")?.map((ficha) => ficha.emoji)).toEqual(["🎉", "👍"])
  })
})
